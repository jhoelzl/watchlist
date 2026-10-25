"""Central settings; values are stored in settings.json so the dashboard can read them too."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    max_history: int  # History entries; the dashboard loads the same number (HISTORY_LIMIT).
    store_diff_lines: int  # Diff lines stored per change.
    mail_diff_lines: int  # Number of those lines included in the email.
    diff_context: int  # Context lines in the diff.
    max_workers: int  # parallele fetches insgesamt
    stuck_after: int  # Consecutive runs after which a page is considered persistently broken (2 runs per day).


SETTINGS = Settings(**json.loads((Path(__file__).parent / "settings.json").read_text(encoding="utf-8")))
