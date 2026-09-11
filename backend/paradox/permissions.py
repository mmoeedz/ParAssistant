"""Permission tiers and policy.

The UI owns the settings; this module enforces them. A category set to "never"
is refused outright and the refusal is fed back to the model so it can adapt.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Policy = Literal["auto", "ask", "never"]
Tier = Literal["safe", "sensitive", "dangerous"]

TIER_OF: dict[str, Tier] = {
    "input_control": "safe",
    "open_apps": "safe",
    "read_screen": "safe",
    "find_files": "safe",
    "browse_web": "safe",
    "media_control": "safe",
    "send_messages": "sensitive",
    "send_files": "sensitive",
    "send_email": "sensitive",
    "move_files": "sensitive",
    "system_settings": "dangerous",
    "delete_files": "dangerous",
    "destructive_ops": "dangerous",
}

DEFAULT_POLICY: dict[str, Policy] = {
    "input_control": "auto",
    "open_apps": "auto",
    "read_screen": "auto",
    "find_files": "auto",
    "browse_web": "auto",
    "media_control": "auto",
    "send_messages": "ask",
    "send_files": "ask",
    "send_email": "ask",
    "move_files": "auto",
    "system_settings": "ask",
    "delete_files": "ask",
    "destructive_ops": "ask",
}


@dataclass
class Decision:
    allowed: bool
    needs_confirmation: bool
    reason: str = ""


class Permissions:
    def __init__(self) -> None:
        self._policy = dict(DEFAULT_POLICY)

    def update_from_settings(self, settings: dict) -> None:
        """Apply the permission list the UI sends on connect and on change."""
        rules = settings.get("permissions") or []
        for rule in rules:
            category = rule.get("category")
            policy = rule.get("policy")
            if category in self._policy and policy in ("auto", "ask", "never"):
                self._policy[category] = policy

    def policy_for(self, category: str) -> Policy:
        return self._policy.get(category, "ask")

    def tier_for(self, category: str) -> Tier:
        return TIER_OF.get(category, "sensitive")

    def check(self, category: str) -> Decision:
        policy = self.policy_for(category)
        tier = self.tier_for(category)

        if policy == "never":
            return Decision(False, False, f"the user has blocked {category} entirely")

        # A dangerous action always asks, whatever the stored policy says.
        if tier == "dangerous":
            return Decision(True, True)

        if policy == "ask":
            return Decision(True, True)

        return Decision(True, False)
