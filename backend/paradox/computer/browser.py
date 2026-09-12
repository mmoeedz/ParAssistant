"""Chrome and Edge, through the DevTools Protocol.

Driving the browser over CDP rather than through the window gives real DOM
access: element text, links, form fields, load state. That is the difference
between "click at 640,318 and hope" and "click the link whose text is X".

Attachment model: Paradox talks to a browser started with a remote debugging
port. If one is already listening it attaches to that; otherwise it launches
one against a dedicated Paradox profile, because Chrome ignores the debugging
flag when an instance is already running on the default profile. That profile
persists between runs, so logins stay put after the first time.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from websockets.sync.client import connect

DEBUG_PORT = 9222
PROFILE_DIR = Path(os.getenv("LOCALAPPDATA", str(Path.home()))) / "Paradox" / "browser-profile"

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]
EDGE_PATHS = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


class BrowserError(RuntimeError):
    pass


@dataclass
class Tab:
    id: str
    title: str
    url: str
    ws_url: str

    def describe(self) -> str:
        return f"{self.title or '(untitled)'} — {self.url[:90]}"


# ------------------------------------------------------------- lifecycle --


def _http(path: str, port: int = DEBUG_PORT, timeout: float = 2.0) -> Any:
    url = f"http://127.0.0.1:{port}{path}"
    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - localhost only
        return json.loads(response.read().decode("utf-8"))


def is_attached(port: int = DEBUG_PORT) -> bool:
    try:
        _http("/json/version", port)
        return True
    except Exception:
        return False


def _exe(browser: str) -> str:
    paths = EDGE_PATHS if browser.lower().startswith("edge") else CHROME_PATHS
    for path in paths:
        if Path(path).exists():
            return path
    found = shutil.which("chrome") or shutil.which("msedge")
    if found:
        return found
    raise BrowserError(f"could not find {browser} on this machine")


def launch(browser: str = "chrome", port: int = DEBUG_PORT, timeout: float = 20.0) -> str:
    """Attach to a debuggable browser, starting one if needed."""
    if is_attached(port):
        return "attached to the browser already listening for automation"

    exe = _exe(browser)
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(
        [
            exe,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={PROFILE_DIR}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_attached(port):
            return f"launched {Path(exe).stem} with automation enabled"
        time.sleep(0.4)

    raise BrowserError(
        f"{Path(exe).stem} did not open a debugging port within {timeout:g}s. "
        "If a normal browser window is already running, Windows may have reused it."
    )


def browser_ws(port: int = DEBUG_PORT) -> str:
    return _http("/json/version", port)["webSocketDebuggerUrl"]


# ------------------------------------------------------------------ CDP --


def call(ws_url: str, method: str, params: dict[str, Any] | None = None,
         timeout: float = 25.0) -> dict[str, Any]:
    """One CDP command. Opens a connection, sends, waits for that id."""
    try:
        with connect(ws_url, open_timeout=8, max_size=None) as ws:
            ws.send(json.dumps({"id": 1, "method": method, "params": params or {}}))
            deadline = time.time() + timeout
            while time.time() < deadline:
                raw = ws.recv(timeout=max(0.1, deadline - time.time()))
                message = json.loads(raw)
                if message.get("id") != 1:
                    continue  # an event; not our answer
                if "error" in message:
                    raise BrowserError(message["error"].get("message", "CDP error"))
                return message.get("result", {})
    except BrowserError:
        raise
    except Exception as exc:
        raise BrowserError(f"browser connection failed: {exc}") from exc
    raise BrowserError(f"{method} timed out after {timeout:g}s")


def tabs(port: int = DEBUG_PORT) -> list[Tab]:
    pages = [
        t for t in _http("/json/list", port)
        if t.get("type") == "page" and not str(t.get("url", "")).startswith("devtools://")
    ]
    return [
        Tab(id=t["id"], title=t.get("title", ""), url=t.get("url", ""),
            ws_url=t.get("webSocketDebuggerUrl", ""))
        for t in pages
        if t.get("webSocketDebuggerUrl")
    ]


def active_tab(port: int = DEBUG_PORT) -> Tab:
    found = tabs(port)
    if not found:
        raise BrowserError("the browser has no open pages")
    # /json/list is most-recently-focused first.
    return found[0]


def open_tab(url: str, port: int = DEBUG_PORT) -> Tab:
    call(browser_ws(port), "Target.createTarget", {"url": url})
    time.sleep(0.6)
    for tab in tabs(port):
        if tab.url.startswith(url[:40]) or url in tab.url:
            return tab
    return active_tab(port)


def close_tab(target_id: str, port: int = DEBUG_PORT) -> None:
    call(browser_ws(port), "Target.closeTarget", {"targetId": target_id})


def activate_tab(target_id: str, port: int = DEBUG_PORT) -> None:
    call(browser_ws(port), "Target.activateTarget", {"targetId": target_id})


# ------------------------------------------------------------ page verbs --


def evaluate(tab: Tab, expression: str, timeout: float = 25.0) -> Any:
    """Run JS in the page and return a JSON-serialisable result."""
    result = call(
        tab.ws_url,
        "Runtime.evaluate",
        {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
            "userGesture": True,
        },
        timeout=timeout,
    )
    if result.get("exceptionDetails"):
        detail = result["exceptionDetails"]
        message = detail.get("exception", {}).get("description") or detail.get("text")
        raise BrowserError(f"page script failed: {str(message)[:300]}")
    return result.get("result", {}).get("value")


def wait_for_load(tab: Tab, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if evaluate(tab, "document.readyState", timeout=5) == "complete":
                # let late scripts settle a moment
                time.sleep(0.35)
                return True
        except BrowserError:
            pass
        time.sleep(0.3)
    return False


def navigate(tab: Tab, url: str, timeout: float = 25.0) -> Tab:
    if not url.startswith(("http://", "https://", "file://", "about:")):
        url = "https://" + url
    call(tab.ws_url, "Page.navigate", {"url": url}, timeout=timeout)
    wait_for_load(tab, timeout)
    for refreshed in tabs():
        if refreshed.id == tab.id:
            return refreshed
    return tab


# JS helpers injected into the page. Kept in one place so the shapes returned
# to the model stay consistent.
JS_READ = """
(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const main = document.querySelector('main, article, [role=main]') || document.body;
  const links = [...document.querySelectorAll('a[href]')]
    .filter(visible).slice(0, 60)
    .map((a) => ({ text: clean(a.innerText).slice(0, 120), href: a.href }))
    .filter((l) => l.text);
  const fields = [...document.querySelectorAll('input, textarea, select')]
    .filter(visible).slice(0, 30)
    .map((el) => ({
      label: clean(el.getAttribute('aria-label') || el.placeholder || el.name || el.id),
      type: el.type || el.tagName.toLowerCase(),
      value: (el.type === 'password') ? '(hidden)' : clean(el.value).slice(0, 80),
    }));
  const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')]
    .filter(visible).slice(0, 40)
    .map((b) => clean(b.innerText || b.value || b.getAttribute('aria-label'))).filter(Boolean);
  return {
    title: document.title,
    url: location.href,
    text: clean(main.innerText).slice(0, %TEXT_LIMIT%),
    links, fields, buttons,
  };
})()
"""

JS_CLICK = """
(() => {
  const target = %TARGET%;
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  let el = null;
  if (target.selector) {
    el = document.querySelector(target.selector);
  } else {
    const needle = target.text.toLowerCase();
    const candidates = [...document.querySelectorAll(
      'a, button, [role=button], input[type=submit], [role=link], [onclick]')]
      .filter(visible);
    el = candidates.find((c) => clean(c.innerText || c.value || c.getAttribute('aria-label') || '')
          .toLowerCase() === needle)
      || candidates.find((c) => clean(c.innerText || c.value || c.getAttribute('aria-label') || '')
          .toLowerCase().includes(needle));
  }
  if (!el) return { ok: false, reason: 'no matching element' };
  el.scrollIntoView({ block: 'center' });
  const label = clean(el.innerText || el.value || el.getAttribute('aria-label') || el.tagName);
  const href = el.href || null;
  el.click();
  return { ok: true, label: label.slice(0, 120), href };
})()
"""

JS_FILL = """
(() => {
  const target = %TARGET%;
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  let el = target.selector
    ? document.querySelector(target.selector)
    : [...document.querySelectorAll('input, textarea, [contenteditable=true]')]
        .find((c) => {
          const label = clean(c.getAttribute('aria-label') || c.placeholder || c.name || c.id || '');
          return label.toLowerCase().includes(target.text.toLowerCase());
        });
  if (!el) el = document.querySelector('input[type=search], input[type=text], textarea');
  if (!el) return { ok: false, reason: 'no matching field' };
  if (el.type === 'password') return { ok: false, reason: 'password field' };
  el.focus();
  el.scrollIntoView({ block: 'center' });
  if (el.isContentEditable) {
    el.textContent = target.value;
  } else {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
    setter ? setter.call(el, target.value) : (el.value = target.value);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return {
    ok: true,
    label: clean(el.getAttribute('aria-label') || el.placeholder || el.name || el.id || el.tagName),
    value: el.value ?? el.textContent,
  };
})()
"""

JS_FIND = """
(() => {
  const needle = %NEEDLE%.toLowerCase();
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const out = [];
  const walk = document.querySelectorAll('a, button, h1, h2, h3, li, p, span, div, [role=button]');
  for (const el of walk) {
    if (out.length >= 20) break;
    const text = clean(el.innerText);
    if (!text || text.length > 300) continue;
    if (!text.toLowerCase().includes(needle)) continue;
    if ([...el.children].some((c) => clean(c.innerText) === text)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ text: text.slice(0, 160), tag: el.tagName.toLowerCase(), href: el.href || null });
  }
  return out;
})()
"""


def read_page(tab: Tab, text_limit: int = 6000) -> dict[str, Any]:
    return evaluate(tab, JS_READ.replace("%TEXT_LIMIT%", str(int(text_limit))))


def click(tab: Tab, text: str | None = None, selector: str | None = None) -> dict[str, Any]:
    target = json.dumps({"text": text or "", "selector": selector or ""})
    return evaluate(tab, JS_CLICK.replace("%TARGET%", target))


def fill(tab: Tab, value: str, label: str | None = None,
         selector: str | None = None) -> dict[str, Any]:
    target = json.dumps({"text": label or "", "selector": selector or "", "value": value})
    return evaluate(tab, JS_FILL.replace("%TARGET%", target))


def find(tab: Tab, needle: str) -> list[dict[str, Any]]:
    return evaluate(tab, JS_FIND.replace("%NEEDLE%", json.dumps(needle))) or []


def press_enter(tab: Tab) -> None:
    for event in ("keyDown", "char", "keyUp"):
        call(tab.ws_url, "Input.dispatchKeyEvent", {
            "type": event,
            "key": "Enter",
            "code": "Enter",
            "text": "\r",
            "windowsVirtualKeyCode": 13,
            "nativeVirtualKeyCode": 13,
        }, timeout=8)
        time.sleep(0.03)


def scroll(tab: Tab, amount: int = 600) -> None:
    evaluate(tab, f"window.scrollBy({{top: {int(amount)}, behavior: 'instant'}}); document.title")


def screenshot(tab: Tab) -> str:
    result = call(tab.ws_url, "Page.captureScreenshot", {"format": "png"}, timeout=20)
    return f"data:image/png;base64,{result.get('data', '')}"


def upload(tab: Tab, paths: list[str], selector: str | None = None) -> dict[str, Any]:
    """Attach local files to a file input, the way a person would pick them."""
    document = call(tab.ws_url, "DOM.getDocument", {"depth": 1})
    root = document.get("root", {}).get("nodeId")
    if not root:
        raise BrowserError("could not read the page's DOM")

    node = call(tab.ws_url, "DOM.querySelector", {
        "nodeId": root,
        "selector": selector or "input[type=file]",
    })
    node_id = node.get("nodeId")
    if not node_id:
        raise BrowserError("this page has no file input to attach to")

    call(tab.ws_url, "DOM.setFileInputFiles", {"nodeId": node_id, "files": paths})
    return {"ok": True, "files": [Path(p).name for p in paths]}


def set_download_dir(tab: Tab, directory: str) -> None:
    call(tab.ws_url, "Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": directory})


def handle_dialog(tab: Tab, accept: bool, text: str | None = None) -> None:
    """Answer a blocking JavaScript alert/confirm/prompt."""
    params: dict[str, Any] = {"accept": accept}
    if text is not None:
        params["promptText"] = text
    call(tab.ws_url, "Page.handleJavaScriptDialog", params, timeout=8)
