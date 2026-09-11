"""Everything the agent can do, assembled into one registry."""

from __future__ import annotations

from .registry import Registry, Tool, ToolResult, untrusted


def build_registry() -> Registry:
    from . import (
        browser_tools,
        comm_tools,
        file_tools,
        input_tools,
        memory_tools,
        screen_tools,
        system_tools,
        window_tools,
    )

    registry = Registry()
    for module in (
        screen_tools,
        window_tools,
        input_tools,
        file_tools,
        system_tools,
        browser_tools,
        comm_tools,
        memory_tools,
    ):
        registry.extend(module.TOOLS)
    return registry


__all__ = ["Registry", "Tool", "ToolResult", "build_registry", "untrusted"]
