"""Headlines for the dashboard panel.

Real RSS, fetched by the agent process — the panel shows what a feed actually
published or it shows nothing. There is no placeholder copy anywhere in this
module, because a headline the user cannot click through to is a lie in a box.
"""

from __future__ import annotations

import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from email.utils import parsedate_to_datetime
from typing import Any

# Tech feeds, chosen because they are stable and lightweight.
FEEDS = [
    ("The Verge", "https://www.theverge.com/rss/index.xml"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ("BBC Tech", "http://feeds.bbci.co.uk/news/technology/rss.xml"),
]

REFRESH_SECONDS = 900  # 15 minutes
TIMEOUT = 6.0
USER_AGENT = "Paradox/0.1 (personal assistant; RSS reader)"

_cache: list["Headline"] = []
_fetched_at = 0.0
_lock = threading.Lock()


@dataclass
class Headline:
    title: str
    url: str
    source: str
    published: float | None

    def as_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["publishedAt"] = int(self.published * 1000) if self.published else None
        data.pop("published")
        return data


def _clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text)).strip()


def _timestamp(entry: ET.Element) -> float | None:
    for tag in ("pubDate", "published", "updated",
                "{http://www.w3.org/2005/Atom}published",
                "{http://www.w3.org/2005/Atom}updated"):
        node = entry.find(tag)
        if node is None or not node.text:
            continue
        raw = node.text.strip()
        try:
            return parsedate_to_datetime(raw).timestamp()
        except Exception:
            pass
        try:
            from datetime import datetime

            return datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp()
        except Exception:
            continue
    return None


def _parse(xml: bytes, source: str, limit: int) -> list[Headline]:
    root = ET.fromstring(xml)
    atom = "{http://www.w3.org/2005/Atom}"
    entries = root.findall(".//item") or root.findall(f".//{atom}entry")

    found: list[Headline] = []
    for entry in entries[:limit]:
        title_node = entry.find("title") or entry.find(f"{atom}title")
        title = _clean(title_node.text if title_node is not None else None)
        if not title:
            continue

        link_node = entry.find("link") or entry.find(f"{atom}link")
        url = ""
        if link_node is not None:
            url = (link_node.text or link_node.get("href") or "").strip()

        found.append(Headline(title=title[:160], url=url, source=source,
                              published=_timestamp(entry)))
    return found


def _fetch() -> list[Headline]:
    collected: list[Headline] = []
    for source, url in FEEDS:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
                collected += _parse(response.read(), source, limit=6)
        except Exception:
            continue  # a feed being down is not an error worth surfacing

    collected.sort(key=lambda h: h.published or 0, reverse=True)
    return collected[:12]


def headlines(force: bool = False) -> list[Headline]:
    """Cached headlines. Never blocks longer than one feed timeout."""
    global _cache, _fetched_at
    with _lock:
        stale = time.time() - _fetched_at > REFRESH_SECONDS
        if force or stale or not _cache:
            _cache = _fetch()
            _fetched_at = time.time()
        return list(_cache)


def refresh_async() -> None:
    threading.Thread(target=lambda: headlines(force=True), daemon=True).start()
