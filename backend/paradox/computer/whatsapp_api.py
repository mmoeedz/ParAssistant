"""WhatsApp, through Meta's official Cloud API.

This is a different capability from whatsapp.py's UI automation, not a
faster version of the same one. The Cloud API sends from a WhatsApp Business
phone number registered to a Meta developer app — it has no way to act as the
user's own personal WhatsApp number, because that is not what the API is for.

Two real constraints, both Meta's policy rather than anything in this code:

* A free-text message (send_text) only delivers if the recipient messaged
  this business number within the last 24 hours, or is one of the up to five
  numbers Meta lets a developer app message for testing without business
  verification.
* Outside that window, only a pre-approved message template (send_template)
  can start the conversation.

The token and phone number id come from the environment — see .env.example
for how to get them from Meta's developer console. Nothing here ever
receives or stores either value any other way.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any

from ..config import CONFIG

GRAPH_HOST = "https://graph.facebook.com"


class WhatsAppAPIError(RuntimeError):
    pass


def configured() -> bool:
    return bool(CONFIG.whatsapp_api_token and CONFIG.whatsapp_phone_number_id)


def _require_configured() -> None:
    if not configured():
        raise WhatsAppAPIError(
            "WHATSAPP_API_TOKEN and WHATSAPP_PHONE_NUMBER_ID are not set — "
            "see backend/.env.example for how to get them from Meta's developer console."
        )


def _normalize(to: str) -> str:
    """Meta wants digits only: country code then number, no '+' or spacing."""
    digits = re.sub(r"[^\d]", "", to)
    if not digits:
        raise WhatsAppAPIError(
            f"{to!r} does not look like a phone number in international format "
            "(country code + number, digits only)"
        )
    return digits


def _post(payload: dict[str, Any]) -> dict[str, Any]:
    _require_configured()
    url = f"{GRAPH_HOST}/{CONFIG.whatsapp_api_version}/{CONFIG.whatsapp_phone_number_id}/messages"
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {CONFIG.whatsapp_api_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(detail)["error"]["message"]
        except Exception:
            message = detail or exc.reason
        raise WhatsAppAPIError(f"WhatsApp API rejected the request: {message}") from exc
    except urllib.error.URLError as exc:
        raise WhatsAppAPIError(f"could not reach the WhatsApp API: {exc.reason}") from exc


def send_text(to: str, message: str) -> dict[str, Any]:
    payload = {
        "messaging_product": "whatsapp",
        "to": _normalize(to),
        "type": "text",
        "text": {"body": message},
    }
    result = _post(payload)
    message_id = (result.get("messages") or [{}])[0].get("id")
    return {"to": to, "message": message, "message_id": message_id, "raw": result}


def send_template(
    to: str,
    template: str,
    language: str = "en_US",
    params: list[str] | None = None,
) -> dict[str, Any]:
    """The template must already exist and be approved in the Meta Business
    dashboard — this cannot create or check one, only send it."""
    payload: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "to": _normalize(to),
        "type": "template",
        "template": {"name": template, "language": {"code": language}},
    }
    if params:
        payload["template"]["components"] = [
            {"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}
        ]
    result = _post(payload)
    message_id = (result.get("messages") or [{}])[0].get("id")
    return {"to": to, "template": template, "message_id": message_id, "raw": result}
