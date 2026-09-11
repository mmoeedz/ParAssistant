"""Files, apps, clipboard, and the Explorer selection.

The Explorer selection matters more than it looks: it is how "open this",
"send this to Ahmed" and "move this to my desktop" resolve to an actual path
without asking the user which file they meant.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import win32clipboard
import win32con

from ..config import DEFAULT_ROOTS

SKIP_DIRS = {"node_modules", ".git", "__pycache__", "AppData", "$RECYCLE.BIN",
             "System Volume Information", ".venv", "venv"}


@dataclass
class FileInfo:
    path: Path
    size: int
    modified: float
    is_dir: bool

    def describe(self) -> str:
        kind = "folder" if self.is_dir else _human_size(self.size)
        return f"{self.path} — {kind} — modified {_ago(self.modified)}"

    def as_dict(self) -> dict[str, Any]:
        return {"path": str(self.path), "size": self.size,
                "modified": self.modified, "isDir": self.is_dir}


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} GB"


def _ago(ts: float) -> str:
    seconds = max(0, time.time() - ts)
    if seconds < 90:
        return f"{int(seconds)}s ago"
    if seconds < 5400:
        return f"{int(seconds / 60)} min ago"
    if seconds < 172800:
        return f"{int(seconds / 3600)}h ago"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(ts))


def info(path: Path) -> FileInfo:
    stat = path.stat()
    return FileInfo(path=path, size=stat.st_size, modified=stat.st_mtime,
                    is_dir=path.is_dir())


# ------------------------------------------------------------------ search --


def _roots(roots: Iterable[str | Path] | None) -> list[Path]:
    if roots:
        return [Path(os.path.expandvars(str(r))).expanduser() for r in roots]
    return [r for r in DEFAULT_ROOTS if r.exists()]


def find_files(query: str = "", roots: Iterable[str | Path] | None = None,
               extensions: Iterable[str] | None = None, limit: int = 40,
               max_depth: int = 4) -> list[FileInfo]:
    """Search by name fragment under the given roots, newest first."""
    needle = query.lower().strip()
    exts = {e.lower().lstrip(".") for e in extensions} if extensions else None
    results: list[FileInfo] = []

    for root in _roots(roots):
        if not root.exists():
            continue
        base_depth = len(root.parts)
        for dirpath, dirnames, filenames in os.walk(root):
            current = Path(dirpath)
            if len(current.parts) - base_depth >= max_depth:
                dirnames.clear()
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
            for name in filenames:
                if needle and needle not in name.lower():
                    continue
                if exts and name.rsplit(".", 1)[-1].lower() not in exts:
                    continue
                try:
                    results.append(info(current / name))
                except OSError:
                    continue
            if len(results) > limit * 8:
                break

    results.sort(key=lambda f: f.modified, reverse=True)
    return results[:limit]


def recent_files(roots: Iterable[str | Path] | None = None, limit: int = 12,
                 within_hours: float = 72.0) -> list[FileInfo]:
    """Recently changed files — how 'the file I just downloaded' is resolved."""
    cutoff = time.time() - within_hours * 3600
    found: list[FileInfo] = []
    for root in _roots(roots):
        if not root.exists():
            continue
        for entry in root.iterdir():
            try:
                fi = info(entry)
            except OSError:
                continue
            # A part-file means the browser is still writing it.
            if entry.suffix.lower() in (".crdownload", ".part", ".tmp"):
                continue
            if fi.modified >= cutoff:
                found.append(fi)
    found.sort(key=lambda f: f.modified, reverse=True)
    return found[:limit]


def is_still_downloading(path: Path) -> bool:
    """A file whose size is still changing is not finished."""
    if not path.exists():
        return True
    first = path.stat().st_size
    time.sleep(0.6)
    return path.stat().st_size != first


# ------------------------------------------------------------- operations --


def open_path(path: Path) -> None:
    os.startfile(str(path))  # noqa: S606 - the documented Windows shell open


def reveal_in_explorer(path: Path) -> None:
    subprocess.run(["explorer.exe", "/select,", str(path)], check=False)


def move(src: Path, dest: Path) -> Path:
    dest = dest / src.name if dest.is_dir() else dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    return Path(shutil.move(str(src), str(dest)))


def copy(src: Path, dest: Path) -> Path:
    dest = dest / src.name if dest.is_dir() else dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.is_dir():
        return Path(shutil.copytree(str(src), str(dest)))
    return Path(shutil.copy2(str(src), str(dest)))


def rename(src: Path, new_name: str) -> Path:
    dest = src.with_name(new_name)
    src.rename(dest)
    return dest


def recycle(path: Path) -> None:
    """Delete to the Recycle Bin, never a hard delete — deletions stay undoable."""
    from win32com.shell import shell, shellcon

    flags = shellcon.FOF_ALLOWUNDO | shellcon.FOF_NOCONFIRMATION | shellcon.FOF_SILENT
    result, aborted = shell.SHFileOperation(
        (0, shellcon.FO_DELETE, str(path), None, flags, None, None)
    )
    if result != 0 or aborted:
        raise OSError(f"could not move {path.name} to the Recycle Bin (code {result})")


def extract_archive(archive: Path, dest: Path | None = None) -> Path:
    """Unpack zip/tar/7z-as-zip into a folder next to the archive."""
    target = dest or archive.with_suffix("")
    target.mkdir(parents=True, exist_ok=True)

    if archive.suffix.lower() == ".zip":
        with zipfile.ZipFile(archive) as zf:
            # Refuse path traversal entries rather than writing outside target.
            for member in zf.namelist():
                resolved = (target / member).resolve()
                if not str(resolved).startswith(str(target.resolve())):
                    raise ValueError(f"archive contains an unsafe path: {member}")
            zf.extractall(target)
    else:
        shutil.unpack_archive(str(archive), str(target))
    return target


# ------------------------------------------------------------------- apps --

_start_apps_cache: list[tuple[str, str]] = []
_start_apps_at: float = 0.0


def start_apps(refresh: bool = False) -> list[tuple[str, str]]:
    """Everything on the Start menu, as (name, AppID) — desktop and Store apps."""
    global _start_apps_cache, _start_apps_at
    if _start_apps_cache and not refresh and time.time() - _start_apps_at < 300:
        return _start_apps_cache

    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command",
             "Get-StartApps | ForEach-Object { \"$($_.Name)`t$($_.AppID)\" }"],
            capture_output=True, text=True, timeout=25, check=False,
        )
        apps: list[tuple[str, str]] = []
        for line in proc.stdout.splitlines():
            if "\t" in line:
                name, app_id = line.split("\t", 1)
                apps.append((name.strip(), app_id.strip()))
        if apps:
            _start_apps_cache, _start_apps_at = apps, time.time()
    except Exception:
        pass
    return _start_apps_cache


def match_app(name: str) -> list[tuple[str, str]]:
    needle = name.lower().strip()
    apps = start_apps()
    exact = [a for a in apps if a[0].lower() == needle]
    if exact:
        return exact
    starts = [a for a in apps if a[0].lower().startswith(needle)]
    contains = [a for a in apps if needle in a[0].lower()]
    seen: set[str] = set()
    ordered: list[tuple[str, str]] = []
    for app in starts + contains:
        if app[1] not in seen:
            seen.add(app[1])
            ordered.append(app)
    return ordered


def launch(target: str) -> str:
    """Launch an app by Start-menu name, executable, path, or URL.

    Returns a short description of what was actually launched.
    """
    raw = target.strip()

    if raw.lower().startswith(("http://", "https://", "mailto:", "ms-settings:")):
        os.startfile(raw)  # noqa: S606
        return f"opened {raw}"

    path = Path(os.path.expandvars(raw)).expanduser()
    if path.exists():
        os.startfile(str(path))  # noqa: S606
        return f"opened {path}"

    matches = match_app(raw)
    if matches:
        name, app_id = matches[0]
        subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{app_id}"])
        return f"launched {name}"

    exe = shutil.which(raw) or shutil.which(f"{raw}.exe")
    if exe:
        subprocess.Popen([exe])
        return f"launched {exe}"

    raise FileNotFoundError(
        f"nothing on this machine matches {raw!r}. "
        f"Closest Start menu entries: "
        f"{', '.join(n for n, _ in start_apps()[:8]) or 'none found'}"
    )


# -------------------------------------------------------------- clipboard --


def read_clipboard() -> str:
    win32clipboard.OpenClipboard()
    try:
        if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
            return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
        if win32clipboard.IsClipboardFormatAvailable(win32con.CF_HDROP):
            paths = win32clipboard.GetClipboardData(win32con.CF_HDROP)
            return "\n".join(paths)
        return ""
    finally:
        win32clipboard.CloseClipboard()


def write_clipboard(text: str) -> None:
    win32clipboard.OpenClipboard()
    try:
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text, win32con.CF_UNICODETEXT)
    finally:
        win32clipboard.CloseClipboard()


# ------------------------------------------------------- explorer context --


def explorer_selection() -> list[Path]:
    """Files currently selected in any open File Explorer window."""
    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        try:
            shell_windows = win32com.client.Dispatch("Shell.Application").Windows()
            selected: list[Path] = []
            for window in shell_windows:
                try:
                    if not str(getattr(window, "FullName", "")).lower().endswith("explorer.exe"):
                        continue
                    for item in window.Document.SelectedItems():
                        selected.append(Path(item.Path))
                except Exception:
                    continue
            return selected
        finally:
            pythoncom.CoUninitialize()
    except Exception:
        return []


def explorer_folder() -> Path | None:
    """The folder the front-most Explorer window is showing."""
    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        try:
            for window in win32com.client.Dispatch("Shell.Application").Windows():
                try:
                    if str(getattr(window, "FullName", "")).lower().endswith("explorer.exe"):
                        return Path(window.Document.Folder.Self.Path)
                except Exception:
                    continue
        finally:
            pythoncom.CoUninitialize()
    except Exception:
        pass
    return None
