"""Files: finding them, resolving "this", and acting on them."""

from __future__ import annotations

import os
from pathlib import Path

from ..computer import files as fs
from ..computer import win
from .registry import Tool, ToolResult, array, integer, schema, string, untrusted


def _resolve(raw: str) -> Path:
    return Path(os.path.expandvars(raw.strip().strip('"'))).expanduser()


def find_files(query: str = "", roots: list[str] | None = None,
               extensions: list[str] | None = None, limit: int = 20) -> ToolResult:
    found = fs.find_files(query=query, roots=roots, extensions=extensions, limit=limit)
    if not found:
        where = ", ".join(roots) if roots else "the usual folders (Downloads, Desktop, Documents, …)"
        return ToolResult(ok=True, summary=f"nothing matching {query!r} in {where}",
                          evidence=f"no match for {query!r}", label=f"No files matching {query!r}")

    listing = "\n".join(f"- {f.describe()}" for f in found)
    return ToolResult(
        ok=True,
        summary=untrusted(listing, "filesystem"),
        evidence=f"{len(found)} match(es); newest: {found[0].path.name}",
        label=f"Found {len(found)} file(s)",
    )


def recent_files(hours: float = 72.0, limit: int = 12) -> ToolResult:
    found = fs.recent_files(limit=limit, within_hours=hours)
    if not found:
        return ToolResult(ok=True, summary=f"nothing changed in the last {hours:g}h",
                          evidence="no recent files", label="No recent files")

    listing = "\n".join(f"- {f.describe()}" for f in found)
    return ToolResult(
        ok=True,
        summary=untrusted(listing, "filesystem"),
        evidence=f"newest: {found[0].path.name} ({fs._ago(found[0].modified)})",
        label=f"Found {len(found)} recent file(s)",
    )


def current_selection() -> ToolResult:
    """What "this" means right now: Explorer selection, then clipboard."""
    selected = fs.explorer_selection()
    folder = fs.explorer_folder()
    clip = fs.read_clipboard()
    active = win.active_window()

    lines = []
    if selected:
        lines.append("Selected in File Explorer:")
        lines += [f"- {fs.info(p).describe()}" for p in selected[:12] if p.exists()]
    if folder:
        lines.append(f"Explorer is showing: {folder}")
    if active:
        lines.append(f"Active window: {active.title!r} ({active.process})")
    if clip:
        preview = clip if len(clip) <= 300 else clip[:300] + "…"
        lines.append(f"Clipboard: {preview!r}")

    if not lines:
        return ToolResult(ok=True,
                          summary="nothing is selected, the clipboard is empty, and no window is active",
                          evidence="no selection context", label="Checked what is selected")

    evidence = (f"selected: {selected[0].name}" if selected
                else f"active: {active.title or active.process}" if active else "clipboard only")
    return ToolResult(
        ok=True,
        summary=untrusted("\n".join(lines), "explorer selection / clipboard"),
        evidence=evidence,
        label="Checked what is selected",
    )


def open_file(path: str) -> ToolResult:
    target = _resolve(path)
    if not target.exists():
        return ToolResult.fail(f"{target} does not exist", label=f"{target.name} not found")

    before = {w.hwnd for w in win.list_windows()}
    fs.open_path(target)

    import time
    appeared = None
    for _ in range(20):
        time.sleep(0.25)
        for window in win.list_windows():
            if window.hwnd not in before and window.title:
                appeared = window
                break
        if appeared:
            break

    if appeared:
        return ToolResult(
            ok=True,
            summary=f"opened {target.name} — it is showing in {appeared.title!r} ({appeared.process}).",
            evidence=f"opened in {appeared.process}",
            label=f"Opened {target.name}",
            observation={"activeWindow": appeared.title, "method": "uia"},
        )
    return ToolResult(
        ok=True,
        summary=f"asked Windows to open {target.name}; no new window appeared within 5s. "
                "It may have opened in an existing window — observe the screen to confirm.",
        evidence="no new window within 5s",
        label=f"Opened {target.name} (unconfirmed)",
    )


def file_operation(action: str, path: str, destination: str | None = None,
                   new_name: str | None = None) -> ToolResult:
    src = _resolve(path)

    if action == "create_folder":
        src.mkdir(parents=True, exist_ok=True)
        return ToolResult(ok=True, summary=f"created {src}", evidence=f"{src} exists: {src.exists()}",
                          label=f"Created folder {src.name}")

    if not src.exists():
        return ToolResult.fail(f"{src} does not exist", label=f"{src.name} not found")

    if action == "move":
        if not destination:
            return ToolResult.fail("move needs a destination")
        dest = fs.move(src, _resolve(destination))
        return ToolResult(ok=True, summary=f"moved {src.name} to {dest}",
                          evidence=f"{dest} exists: {dest.exists()}; source gone: {not src.exists()}",
                          label=f"Moved {src.name}")

    if action == "copy":
        if not destination:
            return ToolResult.fail("copy needs a destination")
        dest = fs.copy(src, _resolve(destination))
        return ToolResult(ok=True, summary=f"copied {src.name} to {dest}",
                          evidence=f"{dest} exists: {dest.exists()}", label=f"Copied {src.name}")

    if action == "rename":
        if not new_name:
            return ToolResult.fail("rename needs new_name")
        dest = fs.rename(src, new_name)
        return ToolResult(ok=True, summary=f"renamed to {dest.name}",
                          evidence=f"now {dest.name}", label=f"Renamed to {dest.name}")

    if action == "delete":
        fs.recycle(src)
        return ToolResult(ok=True,
                          summary=f"moved {src.name} to the Recycle Bin (recoverable from there)",
                          evidence=f"gone from original location: {not src.exists()}",
                          label=f"Recycled {src.name}")

    if action == "reveal":
        fs.reveal_in_explorer(src)
        return ToolResult(ok=True, summary=f"showing {src.name} in File Explorer",
                          evidence=f"revealed {src.name}", label=f"Revealed {src.name}")

    return ToolResult.fail(f"unknown file action: {action}")


def extract_archive(path: str, destination: str | None = None) -> ToolResult:
    archive = _resolve(path)
    if not archive.exists():
        return ToolResult.fail(f"{archive} does not exist", label=f"{archive.name} not found")

    if fs.is_still_downloading(archive):
        return ToolResult.fail(f"{archive.name} is still being written — wait for it to finish",
                               label=f"{archive.name} still downloading")

    try:
        target = fs.extract_archive(archive, _resolve(destination) if destination else None)
    except Exception as exc:
        return ToolResult.fail(f"could not extract {archive.name}: {exc}",
                               label=f"Could not extract {archive.name}")

    contents = list(target.iterdir())
    listing = ", ".join(p.name for p in contents[:8])
    return ToolResult(
        ok=True,
        summary=f"extracted {archive.name} to {target} ({len(contents)} items: {listing})",
        evidence=f"{len(contents)} items in {target.name}",
        label=f"Extracted {archive.name}",
    )


TOOLS = [
    Tool(
        name="current_selection",
        description=(
            "Resolve what the user means by 'this', 'that' or 'it': files selected in File "
            "Explorer, the folder it is showing, the active window and the clipboard. "
            "Call this before asking the user which file they meant."
        ),
        schema=schema({}),
        handler=current_selection,
        category="find_files",
        label=lambda a: "Checking what is selected",
    ),
    Tool(
        name="find_files",
        description=(
            "Search for files by name fragment and/or extension under the user's folders "
            "(Downloads, Desktop, Documents, Pictures, Videos, Music), newest first."
        ),
        schema=schema({
            "query": string("Part of the file name. Empty matches everything."),
            "roots": array("Folders to search. Defaults to the user's usual folders."),
            "extensions": array("Extensions to keep, e.g. ['pdf','png']."),
            "limit": integer("Maximum results. Default 20."),
        }),
        handler=find_files,
        category="find_files",
        label=lambda a: f"Searching for {a.get('query') or 'files'}",
    ),
    Tool(
        name="recent_files",
        description=(
            "List recently changed files in the user's folders. This is how "
            "'the file I just downloaded' is resolved. Skips part-files still being written."
        ),
        schema=schema({
            "hours": {"type": "number", "description": "How far back to look. Default 72."},
            "limit": integer("Maximum results. Default 12."),
        }),
        handler=recent_files,
        category="find_files",
        label=lambda a: "Looking for recent files",
    ),
    Tool(
        name="open_file",
        description="Open a file or folder with whatever Windows uses for it, and confirm a window appeared.",
        schema=schema({"path": string("Full path to the file or folder.")}, ["path"]),
        handler=open_file,
        category="open_apps",
        label=lambda a: f"Opening {Path(str(a.get('path', ''))).name or a.get('path')}",
    ),
    Tool(
        name="file_operation",
        description=(
            "Move, copy, rename, delete, reveal, or create a folder. Deleting goes to the "
            "Recycle Bin, never a permanent erase. Each operation is verified afterwards."
        ),
        schema=schema({
            "action": string("What to do.",
                             ["move", "copy", "rename", "delete", "reveal", "create_folder"]),
            "path": string("The file or folder to act on."),
            "destination": string("Destination folder or path, for move and copy."),
            "new_name": string("New file name, for rename."),
        }, ["action", "path"]),
        handler=file_operation,
        category=lambda a: {"delete": "delete_files", "move": "move_files",
                            "copy": "move_files", "rename": "move_files"}.get(
                                str(a.get("action")), "find_files"),
        label=lambda a: f"{str(a.get('action', 'changing')).replace('_', ' ').capitalize()} "
                        f"{Path(str(a.get('path', ''))).name}",
        confirm=lambda a: (
            f"{str(a.get('action')).replace('_', ' ').capitalize()} "
            f"{Path(str(a.get('path', ''))).name}?",
            "Deleted files go to the Recycle Bin." if a.get("action") == "delete" else "",
            {k: str(v) for k, v in a.items() if v},
        ),
    ),
    Tool(
        name="extract_archive",
        description="Unpack a .zip/.tar/.gz archive into a folder and list what came out.",
        schema=schema({
            "path": string("The archive file."),
            "destination": string("Where to extract. Defaults to a folder beside the archive."),
        }, ["path"]),
        handler=extract_archive,
        category="move_files",
        label=lambda a: f"Extracting {Path(str(a.get('path', ''))).name}",
    ),
]
