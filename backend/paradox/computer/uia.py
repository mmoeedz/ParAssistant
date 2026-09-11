"""Windows UI Automation reading.

This is the preferred way for the agent to understand a window: it returns
named, typed, positioned controls rather than pixels. Vision is the fallback
when a window exposes nothing useful here (games, canvas apps, some Electron
windows).
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Callable

try:  # the package needs a Windows COM stack
    import uiautomation as auto

    AVAILABLE = True
except Exception:  # pragma: no cover - non-Windows or missing dependency
    auto = None  # type: ignore[assignment]
    AVAILABLE = False


# Controls worth reporting to the model; the rest are layout noise.
INTERESTING = {
    "ButtonControl", "EditControl", "TextControl", "ListItemControl", "MenuItemControl",
    "CheckBoxControl", "RadioButtonControl", "ComboBoxControl", "TabItemControl",
    "HyperlinkControl", "TreeItemControl", "DocumentControl", "ImageControl",
    "SliderControl", "ProgressBarControl", "DataItemControl", "SplitButtonControl",
}


@dataclass
class Element:
    name: str
    control: str
    rect: tuple[int, int, int, int]
    center: tuple[int, int]
    enabled: bool
    value: str | None = None
    is_password: bool = False
    depth: int = 0

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    def describe(self) -> str:
        bits = [f"{self.control.removesuffix('Control')}"]
        if self.name:
            bits.append(f'"{self.name}"')
        if self.value:
            bits.append(f"= {self.value[:60]!r}")
        if not self.enabled:
            bits.append("(disabled)")
        bits.append(f"at {self.center[0]},{self.center[1]}")
        return " ".join(bits)


def _value_of(node: Any) -> str | None:
    try:
        pattern = node.GetValuePattern()
        return pattern.Value or None
    except Exception:
        return None


#  A minimized window's descendants keep reporting a cached bounding box near
#  (-32000, -32000) — the Win32 WINDOWPLACEMENT convention for "not on screen".
#  It has positive width/height, so the size check alone lets it through; a
#  model handed that as a click target will act on a coordinate that hits
#  nothing.
_OFFSCREEN_SENTINEL = -10_000


def _to_element(node: Any, depth: int) -> Element | None:
    try:
        if bool(getattr(node, "IsOffscreen", False)):
            return None
        rect = node.BoundingRectangle
        if rect.width() <= 0 or rect.height() <= 0:
            return None
        if rect.left <= _OFFSCREEN_SENTINEL or rect.top <= _OFFSCREEN_SENTINEL:
            return None
        name = (node.Name or "").strip()
        control = node.ControlTypeName
        value = _value_of(node) if control in ("EditControl", "ComboBoxControl") else None
        if not name and not value:
            return None
        return Element(
            name=name,
            control=control,
            rect=(rect.left, rect.top, rect.right, rect.bottom),
            center=(rect.xcenter(), rect.ycenter()),
            enabled=bool(node.IsEnabled),
            value=value,
            is_password=bool(getattr(node, "IsPassword", False)),
            depth=depth,
        )
    except Exception:
        return None


def read_window(hwnd: int, max_depth: int = 6, max_nodes: int = 140) -> list[Element]:
    """Walk a window's automation tree, breadth-first, and return what matters."""
    if not AVAILABLE:
        return []

    with auto.UIAutomationInitializerInThread(debug=False):
        try:
            root = auto.ControlFromHandle(hwnd)
        except Exception:
            return []
        if not root:
            return []

        out: list[Element] = []
        frontier = [(root, 0)]
        visited = 0

        while frontier and len(out) < max_nodes and visited < max_nodes * 8:
            node, depth = frontier.pop(0)
            visited += 1
            if depth > max_depth:
                continue
            try:
                children = node.GetChildren()
            except Exception:
                children = []
            for child in children:
                try:
                    if child.ControlTypeName in INTERESTING:
                        element = _to_element(child, depth + 1)
                        if element:
                            out.append(element)
                    frontier.append((child, depth + 1))
                except Exception:
                    continue
        return out


def find_elements(hwnd: int, name: str | None = None, control: str | None = None,
                  exact: bool = False) -> list[Element]:
    """Find controls in a window by (partial) name and/or control type."""
    elements = read_window(hwnd)
    needle = (name or "").strip().lower()
    wanted = (control or "").strip().lower().removesuffix("control")

    def matches(el: Element) -> bool:
        if needle:
            label = f"{el.name} {el.value or ''}".lower()
            if exact:
                if el.name.strip().lower() != needle:
                    return False
            elif needle not in label:
                return False
        if wanted and wanted not in el.control.lower():
            return False
        return True

    return [el for el in elements if matches(el)]


def deep_scan(
    hwnd: int,
    predicate: Callable[[str, str], bool],
    max_depth: int = 40,
    budget: int = 6000,
) -> list[Element]:
    """Search a window's whole automation tree, however deep it goes.

    `read_window` deliberately stays shallow and cheap. WebView2 apps —
    WhatsApp, Teams, Discord — keep their real content 20-30 levels down, so
    reaching it needs an explicit, budgeted walk. The predicate takes
    (control_type, name) so most nodes are rejected before building an Element.
    """
    if not AVAILABLE:
        return []

    found: list[Element] = []
    remaining = budget

    with auto.UIAutomationInitializerInThread(debug=False):
        try:
            root = auto.ControlFromHandle(hwnd)
        except Exception:
            return []
        if not root:
            return []

        def walk(node: Any, depth: int) -> None:
            nonlocal remaining
            if remaining <= 0 or depth > max_depth:
                return
            try:
                children = node.GetChildren()
            except Exception:
                return
            for child in children:
                remaining -= 1
                if remaining <= 0:
                    return
                try:
                    control = child.ControlTypeName
                    name = (child.Name or "").strip()
                except Exception:
                    continue
                if predicate(control, name):
                    element = _to_element(child, depth + 1)
                    if element:
                        found.append(element)
                walk(child, depth + 1)

        walk(root, 0)

    return found


def focused_element(hwnd: int) -> Element | None:
    """What currently has keyboard focus, so typing goes somewhere known."""
    if not AVAILABLE:
        return None
    with auto.UIAutomationInitializerInThread(debug=False):
        try:
            node = auto.GetFocusedControl()
        except Exception:
            return None
        if not node:
            return None
        return _to_element(node, 0)


def summarize(elements: list[Element], limit: int = 60) -> str:
    """A compact, model-readable description of a window's controls."""
    if not elements:
        return "no readable UI elements (this window may need vision instead)"
    lines = [f"- {el.describe()}" for el in elements[:limit]]
    if len(elements) > limit:
        lines.append(f"- … and {len(elements) - limit} more")
    return "\n".join(lines)
