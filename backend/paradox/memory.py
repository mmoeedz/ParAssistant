"""Persistent memory.

A small SQLite file in the user's profile. It holds two things: facts worth
remembering between sessions (preferences, people, learned workflows) and a
history of tasks. Both are inspectable and deletable from the UI — memory the
user cannot see or erase is surveillance, not assistance.

Nothing here is written automatically from screen content. Facts are stored
only when the model decides something is worth keeping, or when the user says
so, and every fact records where it came from.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("NEXUS_MEMORY", str(Path.home() / ".nexus" / "memory.db")))

KINDS = ("preference", "person", "workflow", "note")

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS facts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL,
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    source     TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    uses       INTEGER NOT NULL DEFAULT 0,
    UNIQUE(kind, key)
);

CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    goal       TEXT NOT NULL,
    status     TEXT NOT NULL,
    summary    TEXT,
    steps      INTEGER NOT NULL DEFAULT 0,
    started_at REAL NOT NULL,
    ended_at   REAL
);
"""


@dataclass
class Fact:
    id: int
    kind: str
    key: str
    value: str
    source: str | None
    created_at: float
    updated_at: float
    uses: int

    def as_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["createdAt"] = int(self.created_at * 1000)
        data["updatedAt"] = int(self.updated_at * 1000)
        return data

    def describe(self) -> str:
        return f"[{self.kind}] {self.key}: {self.value}"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA)
    return connection


# ------------------------------------------------------------------ facts --


def remember(kind: str, key: str, value: str, source: str = "conversation") -> Fact:
    """Store or update one fact. The (kind, key) pair is the identity."""
    if kind not in KINDS:
        kind = "note"
    key = key.strip()[:120]
    value = value.strip()[:2000]
    if not key or not value:
        raise ValueError("a memory needs both a key and a value")

    now = time.time()
    with _lock, _connect() as connection:
        connection.execute(
            """
            INSERT INTO facts (kind, key, value, source, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(kind, key) DO UPDATE SET
                value = excluded.value,
                source = excluded.source,
                updated_at = excluded.updated_at
            """,
            (kind, key, value, source, now, now),
        )
        row = connection.execute(
            "SELECT * FROM facts WHERE kind = ? AND key = ?", (kind, key)
        ).fetchone()
    return Fact(**dict(row))


def recall(query: str | None = None, kind: str | None = None, limit: int = 25) -> list[Fact]:
    sql = "SELECT * FROM facts"
    clauses: list[str] = []
    params: list[Any] = []

    if kind:
        clauses.append("kind = ?")
        params.append(kind)
    if query:
        clauses.append("(key LIKE ? OR value LIKE ?)")
        params += [f"%{query}%", f"%{query}%"]
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC LIMIT ?"
    params.append(limit)

    with _lock, _connect() as connection:
        rows = connection.execute(sql, params).fetchall()
        if query or kind:
            ids = [row["id"] for row in rows]
            if ids:
                connection.execute(
                    f"UPDATE facts SET uses = uses + 1 WHERE id IN ({','.join('?' * len(ids))})",
                    ids,
                )
    return [Fact(**dict(row)) for row in rows]


def forget(fact_id: int | None = None, kind: str | None = None, key: str | None = None) -> int:
    with _lock, _connect() as connection:
        if fact_id is not None:
            cursor = connection.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
        elif kind and key:
            cursor = connection.execute(
                "DELETE FROM facts WHERE kind = ? AND key = ?", (kind, key)
            )
        elif key:
            cursor = connection.execute("DELETE FROM facts WHERE key = ?", (key,))
        else:
            raise ValueError("say which memory to forget")
        return cursor.rowcount


def clear(kind: str | None = None) -> int:
    with _lock, _connect() as connection:
        if kind:
            cursor = connection.execute("DELETE FROM facts WHERE kind = ?", (kind,))
        else:
            cursor = connection.execute("DELETE FROM facts")
        return cursor.rowcount


# ------------------------------------------------------------------ tasks --


def record_task(task_id: str, goal: str, status: str, summary: str | None,
                steps: int, started_at: float, ended_at: float | None) -> None:
    with _lock, _connect() as connection:
        connection.execute(
            """
            INSERT INTO tasks (id, goal, status, summary, steps, started_at, ended_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                summary = excluded.summary,
                steps = excluded.steps,
                ended_at = excluded.ended_at
            """,
            (task_id, goal, status, summary, steps, started_at, ended_at),
        )


def recent_tasks(limit: int = 10) -> list[dict[str, Any]]:
    with _lock, _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM tasks ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(row) for row in rows]


# ------------------------------------------------------------- for prompt --


def context_block(limit: int = 24) -> str:
    """What NEXUS knows about this user, for the system prompt."""
    facts = recall(limit=limit)
    if not facts:
        return ""

    grouped: dict[str, list[Fact]] = {}
    for fact in facts:
        grouped.setdefault(fact.kind, []).append(fact)

    lines = ["\n# What you remember about this user\n"]
    for kind in KINDS:
        if kind not in grouped:
            continue
        lines.append(f"{kind.capitalize()}:")
        lines += [f"- {f.key}: {f.value}" for f in grouped[kind]]
        lines.append("")
    lines.append(
        "These are remembered from earlier sessions. Use them, but if one looks stale, "
        "check rather than trusting it."
    )
    return "\n".join(lines)


def stats() -> dict[str, Any]:
    with _lock, _connect() as connection:
        facts = connection.execute("SELECT COUNT(*) AS n FROM facts").fetchone()["n"]
        tasks = connection.execute("SELECT COUNT(*) AS n FROM tasks").fetchone()["n"]
    return {"facts": facts, "tasks": tasks, "path": str(DB_PATH)}
