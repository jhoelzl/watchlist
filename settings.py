"""Zentrale Einstellungen; die Werte stehen in settings.json, damit das Dashboard dieselben liest."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    max_history: int  # Einträge im Verlauf; das Dashboard lädt genauso viele (HISTORY_LIMIT)
    store_diff_lines: int  # gespeicherte Diff-Zeilen pro Änderung
    mail_diff_lines: int  # davon stehen so viele in der Mail
    diff_context: int  # Kontextzeilen im Diff
    max_workers: int  # parallele Abrufe insgesamt
    stuck_after: int  # Läufe in Folge, ab denen eine Seite als dauerhaft kaputt gilt (2 Läufe pro Tag)


SETTINGS = Settings(**json.loads((Path(__file__).parent / "settings.json").read_text(encoding="utf-8")))
