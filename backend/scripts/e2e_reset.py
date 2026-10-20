"""Reset the end-to-end database: drop everything and migrate from scratch. Refuses non-e2e databases."""

from __future__ import annotations

import os

from alembic import command
from alembic.config import Config

from app.core.config import get_settings

if __name__ == "__main__":
    url = get_settings().database_url
    if "e2e" not in url.rsplit("/", 1)[-1]:
        raise SystemExit("Refusing to reset a database whose name does not contain 'e2e'")
    cfg = Config(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini"))
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    print("e2e database reset")
