"""ORION — the browser agent.

Everything here goes through the DevTools Protocol, so the model works with
real elements and real page text rather than guessed pixel positions.
"""

from __future__ import annotations

from pathlib import Path

from ..computer import browser as web
from .input_tools import click_category
from .registry import Tool, ToolResult, array, boolean, integer, schema, string, untrusted


def _tab() -> web.Tab:
    if not web.is_attached():
        web.launch("chrome")
    return web.active_tab()


def browser_open(url: str | None = None, browser: str = "chrome") -> ToolResult:
    message = web.launch(browser)
    tab = web.active_tab()
    if url:
        tab = web.navigate(tab, url)
    return ToolResult(
        ok=True,
        summary=f"{message}. Current page: {tab.title!r} — {tab.url}",
        evidence=f"page loaded: {tab.title or tab.url}",
        label=f"Opened {url or browser}",
        observation={"activeWindow": f"{browser}: {tab.title or tab.url}", "method": "dom"},
    )


def browser_navigate(url: str) -> ToolResult:
    tab = web.navigate(_tab(), url)
    page = web.read_page(tab, text_limit=600)
    return ToolResult(
        ok=True,
        summary=f"loaded {tab.url}\nTitle: {tab.title!r}\nFirst text: {page.get('text', '')[:400]}",
        evidence=f"landed on {tab.url[:70]}",
        label=f"Opened {url}",
        observation={"activeWindow": f"browser: {tab.title or tab.url}", "method": "dom"},
    )


def browser_read(text_limit: int = 6000) -> ToolResult:
    tab = _tab()
    page = web.read_page(tab, text_limit=text_limit)

    parts = [f"URL: {page['url']}", f"Title: {page['title']}", "", page["text"]]
    if page.get("links"):
        parts += ["", "Links:"] + [f"- {l['text']} -> {l['href']}" for l in page["links"][:30]]
    if page.get("fields"):
        parts += ["", "Form fields:"] + [
            f"- {f['label'] or '(unlabelled)'} [{f['type']}] = {f['value']!r}" for f in page["fields"]
        ]
    if page.get("buttons"):
        parts += ["", "Buttons: " + ", ".join(page["buttons"][:20])]

    return ToolResult(
        ok=True,
        summary=untrusted("\n".join(parts), f"web page: {page['url']}"),
        evidence=f"read {len(page['text'])} chars from {page['title'][:50] or page['url'][:50]}",
        label=f"Read {page['title'][:40] or 'the page'}",
        observation={"activeWindow": f"browser: {page['title'] or page['url']}", "method": "dom"},
    )


def browser_find(text: str) -> ToolResult:
    tab = _tab()
    hits = web.find(tab, text)
    if not hits:
        return ToolResult(
            ok=False,
            summary=f"nothing matching {text!r} on {tab.url}. Use browser_read to see what is there.",
            evidence=f"no match for {text!r}",
            label=f"Looked for {text!r}",
        )
    listing = "\n".join(
        f"- <{h['tag']}> {h['text']}" + (f" -> {h['href']}" if h.get("href") else "")
        for h in hits[:12]
    )
    return ToolResult(
        ok=True,
        summary=untrusted(f"{len(hits)} match(es):\n{listing}", f"web page: {tab.url}"),
        evidence=f"{len(hits)} match(es) for {text!r}",
        label=f"Found {text!r}",
    )


def browser_click(text: str | None = None, selector: str | None = None) -> ToolResult:
    tab = _tab()
    before = tab.url
    result = web.click(tab, text=text, selector=selector)

    if not result.get("ok"):
        return ToolResult.fail(
            f"nothing clickable matching {text or selector!r}: {result.get('reason')}. "
            "Call browser_read to see the real links and buttons.",
            label=f"Could not click {text or selector!r}",
        )

    web.wait_for_load(tab, timeout=12)
    after = web.active_tab()
    moved = after.url != before
    return ToolResult(
        ok=True,
        summary=f"clicked {result['label']!r}. "
                + (f"The page moved to {after.url}" if moved else f"Still on {after.url}"),
        evidence=f"clicked {result['label'][:50]!r}" + (f"; now at {after.url[:50]}" if moved else ""),
        label=f"Clicked {result['label'][:40]!r}",
        observation={"activeWindow": f"browser: {after.title or after.url}", "method": "dom"},
    )


def browser_fill(value: str, label: str | None = None, selector: str | None = None,
                 submit: bool = False) -> ToolResult:
    tab = _tab()
    result = web.fill(tab, value, label=label, selector=selector)

    if not result.get("ok"):
        reason = result.get("reason")
        if reason == "password field":
            return ToolResult.fail(
                "that is a password field — I do not type credentials. Ask the user to type it.",
                label="Refused to type into a password field",
            )
        return ToolResult.fail(f"no field matching {label or selector!r} ({reason})",
                               label=f"Could not find the field {label or selector!r}")

    if submit:
        web.press_enter(tab)
        web.wait_for_load(tab, timeout=15)
        after = web.active_tab()
        return ToolResult(
            ok=True,
            summary=f"typed into {result['label']!r} and submitted. Now on {after.url}",
            evidence=f"submitted; now at {after.url[:60]}",
            label=f"Searched {value[:32]!r}",
            observation={"activeWindow": f"browser: {after.title or after.url}", "method": "dom"},
        )

    return ToolResult(
        ok=True,
        summary=f"typed into {result['label']!r}; it now contains {str(result.get('value'))[:80]!r}",
        evidence=f"field {result['label'][:40]} contains the text",
        label=f"Filled {result['label'][:32]!r}",
    )


def browser_tabs(action: str = "list", url: str | None = None, index: int | None = None) -> ToolResult:
    if not web.is_attached():
        web.launch("chrome")

    if action == "new":
        tab = web.open_tab(url or "about:blank")
        return ToolResult(ok=True, summary=f"opened a tab at {tab.url}",
                          evidence=f"new tab: {tab.title or tab.url}", label="Opened a tab")

    open_tabs = web.tabs()
    if action == "list":
        listing = "\n".join(f"[{i}] {t.describe()}" for i, t in enumerate(open_tabs))
        return ToolResult(ok=True, summary=f"{len(open_tabs)} open tab(s):\n{listing}",
                          evidence=f"{len(open_tabs)} tabs open", label="Listed tabs")

    if index is None or index >= len(open_tabs):
        return ToolResult.fail(f"there is no tab {index}; there are {len(open_tabs)}")

    target = open_tabs[index]
    if action == "switch":
        web.activate_tab(target.id)
        return ToolResult(ok=True, summary=f"switched to {target.describe()}",
                          evidence=f"active tab: {target.title[:50]}", label=f"Switched to {target.title[:30]}")

    if action == "close":
        web.close_tab(target.id)
        remaining = web.tabs()
        return ToolResult(ok=True, summary=f"closed {target.title!r}; {len(remaining)} tab(s) left",
                          evidence=f"{len(remaining)} tabs remain", label=f"Closed {target.title[:30]}")

    return ToolResult.fail(f"unknown tab action: {action}")


def browser_scroll(amount: int = 600) -> ToolResult:
    tab = _tab()
    web.scroll(tab, amount)
    return ToolResult(ok=True, summary=f"scrolled {'down' if amount > 0 else 'up'} {abs(amount)}px",
                      evidence=f"scrolled {'down' if amount > 0 else 'up'}", label="Scrolled the page")


def browser_upload(paths: list[str], selector: str | None = None) -> ToolResult:
    tab = _tab()
    resolved = [str(Path(p).expanduser()) for p in paths]
    missing = [p for p in resolved if not Path(p).exists()]
    if missing:
        return ToolResult.fail(f"these files do not exist: {', '.join(missing)}")

    result = web.upload(tab, resolved, selector=selector)
    return ToolResult(
        ok=True,
        summary=f"attached {', '.join(result['files'])} to the file input on {tab.url}. "
                "The page still has to be submitted.",
        evidence=f"attached {len(resolved)} file(s)",
        label=f"Attached {result['files'][0]}" + (f" +{len(resolved) - 1}" if len(resolved) > 1 else ""),
    )


def browser_dialog(accept: bool = True, text: str | None = None) -> ToolResult:
    tab = _tab()
    try:
        web.handle_dialog(tab, accept, text)
    except web.BrowserError as exc:
        return ToolResult.fail(f"no dialog was open ({exc})", label="No dialog to answer")
    return ToolResult(ok=True, summary=f"{'accepted' if accept else 'dismissed'} the dialog",
                      evidence=f"dialog {'accepted' if accept else 'dismissed'}",
                      label=f"{'Accepted' if accept else 'Dismissed'} a dialog")


TOOLS = [
    Tool(
        name="browser_open",
        description=(
            "Start or attach to an automatable browser and optionally open a URL. Call this before "
            "any other browser tool. NEXUS drives a browser started with automation enabled, using "
            "its own profile, so the first visit to a site may not be logged in."
        ),
        schema=schema({
            "url": string("Optional URL to open once attached."),
            "browser": string("Which browser.", ["chrome", "edge"]),
        }),
        handler=browser_open,
        category="browse_web",
        label=lambda a: f"Opening {a.get('url') or 'the browser'}",
    ),
    Tool(
        name="browser_navigate",
        description="Go to a URL in the current tab and wait for it to finish loading.",
        schema=schema({"url": string("Where to go. A bare domain is fine.")}, ["url"]),
        handler=browser_navigate,
        category="browse_web",
        label=lambda a: f"Opening {a.get('url')}",
    ),
    Tool(
        name="browser_read",
        description=(
            "Read the current page: title, URL, visible text, links, form fields and buttons. "
            "This is how you find out what is on a page — prefer it over a screenshot."
        ),
        schema=schema({"text_limit": integer("Maximum characters of body text. Default 6000.")}),
        handler=browser_read,
        category="browse_web",
        label=lambda a: "Reading the page",
    ),
    Tool(
        name="browser_find",
        description="Find elements on the page containing some text, with their tags and links.",
        schema=schema({"text": string("Text to look for.")}, ["text"]),
        handler=browser_find,
        category="browse_web",
        label=lambda a: f"Looking for {a.get('text')!r}",
    ),
    Tool(
        name="browser_click",
        description=(
            "Click a link or button by its visible text, or by a CSS selector. Reports whether the "
            "page navigated as a result."
        ),
        schema=schema({
            "text": string("Visible text of the link or button."),
            "selector": string("CSS selector, when text is ambiguous."),
        }),
        handler=browser_click,
        category=click_category,
        label=lambda a: f"Clicking {a.get('text') or a.get('selector')!r}",
        confirm=lambda a: (
            f"Click {a.get('text') or a.get('selector')!r} in the browser?",
            "",
            {"Target": str(a.get("text") or a.get("selector"))},
        ),
    ),
    Tool(
        name="browser_fill",
        description=(
            "Type into a form field found by its label, placeholder or name, optionally pressing "
            "Enter afterwards. This is how you search: fill the search box with submit=true. "
            "Refuses password fields."
        ),
        schema=schema({
            "value": string("Text to enter."),
            "label": string("Label, placeholder or name of the field."),
            "selector": string("CSS selector, when the label is ambiguous."),
            "submit": boolean("Press Enter after typing.", False),
        }, ["value"]),
        handler=browser_fill,
        category="browse_web",
        label=lambda a: f"Typing {(a.get('value') or '')[:28]!r}",
    ),
    Tool(
        name="browser_tabs",
        description="List, switch to, close or open browser tabs.",
        schema=schema({
            "action": string("What to do.", ["list", "switch", "close", "new"]),
            "url": string("URL, for a new tab."),
            "index": integer("Tab number from the list, for switch and close."),
        }),
        handler=browser_tabs,
        category="browse_web",
        label=lambda a: f"{str(a.get('action', 'list')).capitalize()} tabs",
    ),
    Tool(
        name="browser_scroll",
        description="Scroll the page. Positive scrolls down.",
        schema=schema({"amount": integer("Pixels; negative scrolls up. Default 600.")}),
        handler=browser_scroll,
        category="browse_web",
        label=lambda a: "Scrolling the page",
    ),
    Tool(
        name="browser_upload",
        description=(
            "Attach local files to a file input on the page — the web equivalent of picking files "
            "in a dialog. The form still has to be submitted afterwards."
        ),
        schema=schema({
            "paths": array("Full paths of the files to attach."),
            "selector": string("CSS selector of the file input, if there is more than one."),
        }, ["paths"]),
        handler=browser_upload,
        category="send_files",
        label=lambda a: f"Attaching {len(a.get('paths') or [])} file(s)",
        confirm=lambda a: (
            "Attach these files to the page?",
            "\n".join(str(p) for p in (a.get("paths") or [])),
            {"Files": ", ".join(Path(str(p)).name for p in (a.get("paths") or []))},
        ),
    ),
    Tool(
        name="browser_dialog",
        description="Accept or dismiss a JavaScript alert, confirm or prompt that is blocking the page.",
        schema=schema({
            "accept": boolean("Accept it, rather than dismiss.", True),
            "text": string("Text to enter, for a prompt."),
        }),
        handler=browser_dialog,
        category="browse_web",
        label=lambda a: "Answering a browser dialog",
    ),
]
