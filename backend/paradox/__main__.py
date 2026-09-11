"""Entry point: python -m paradox"""

from __future__ import annotations

import asyncio


def main() -> None:
    from .server import run

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\nParadox stopped.")


if __name__ == "__main__":
    main()
