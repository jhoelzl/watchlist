# Verbesserungsideen

Offene Verbesserungen nach Bereich. Aufwand: **S** (< 1 h), **M** (einige Stunden), **L** (Tage). Priorität: 🔴 hoch, 🟡 mittel, ⚪ niedrig.

Stand: `check.py` 356 Zeilen (dazu `config.py`, `fetch.py`, `parse.py`, `diffing.py`, `notify.py`, `errors.py`), `store.py` 323, `add.py` 216, Web-Dashboard in `web/` (React, Supabase), 125 Python- und 78 Web-Tests. Daten liegen in Supabase (Tabellen `watchlist_*`). Das Repo ist öffentlich, persönliche Daten (URL-Liste) stehen nur in der Datenbank.

## Nächste Schritte (Top 5)

| # | Idee | Bereich | Prio | Aufwand |
|---|------|---------|------|---------|
| 1 | Weitere Kanäle (ntfy/Slack/Teams) und Digest-Modus | Features | 🟡 | M |
| 2 | Tests für `RestStore`, `add.py`, Edge Functions und Web-Komponenten | Qualität | 🟡 | M |
| 3 | `timeout-minutes` und Alarm bei Workflow-Ausfall für `check.yml` | Betrieb | 🟡 | S |
| 4 | Backup der Datenbank (wöchentlicher Export als Artefakt) | Betrieb | 🟡 | S |
| 5 | Rechte im Dashboard mit zweitem Konto verifizieren | Security | 🔴 | S |

---

## 1. Security

- 🔴 **Rechte im Dashboard prüfen:** Das Supabase-Projekt ist mit anderen Apps geteilt und hat offene Registrierung. Der Zugriff hängt allein an `watchlist_admins` und den RLS-Policies. Policies (insert/update/delete) per SQL-Skript regelmäßig verifizieren, z. B. mit einem zweiten, nicht freigeschalteten Konto. (S)
- ⚪ **Redirect-/Schema-Kontrolle:** Nur `http`/`https` zulassen und Redirect-Ziele prüfen, weil URLs im Dashboard eingegeben werden können (SSRF auf interne Adressen ist auf GitHub-Runnern kaum relevant, lokal schon). (S)
- ⚪ **Fehlertexte von Resend** (`r.text`) landen im Log. Sicherstellen, dass dort nie Header oder Keys erscheinen. (S)
- ⚪ **Key-Rotation dokumentieren:** Alle Secrets liegen im 1Password-Tresor `watchlist` (in GitHub bleibt nur `OP_SERVICE_ACCOUNT_TOKEN`). Offen: wie man Service-Account-Token, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY` und `GH_DISPATCH_TOKEN` (liegt als Supabase-Secret, nicht in 1Password) erneuert, mit Ablaufdatum des Tokens. (S)

## 2. Features

- 🟡 **Weitere Kanäle:** ntfy.sh (einfachster Weg für Push aufs Handy), Slack/Teams/Discord-Webhook, Telegram. Konfigurierbar über Secrets und `options`, auch pro Gruppe. (M)
- 🟡 **Digest-Modus:** Optional tägliche Zusammenfassung statt sofortiger Mail, pro Gruppe oder URL (`notify: daily|immediate`). (M)
- 🟡 **Keyword-/Regex-Trigger:** `notify_if: 'Salzburg|Python'` löst die Mail nur aus, wenn neue Zeilen passen (Jobs, Events). Im Dashboard als Feld im Formular. (S)
- 🟡 **Empfänger pro Gruppe:** `MAIL_TO` pro Gruppe überschreibbar. (S)
- ⚪ **JSON- und PDF-Quellen** unterstützen (JSON-Pfad, PDF-Text). (L)
- ⚪ **Screenshots bei JS-Seiten** als Artefakt, hilft bei Layout-Problemen. (M)
- ⚪ **Auth-Support** (Header/Cookies über Secrets) für geschützte Seiten. (M)
- ⚪ **`add.py` verbessern:** mehrere URLs auf einmal (`-f liste.txt`), Duplikatserkennung über normalisierte URL, Vorschlag für `ignore`. (S)

## 3. UX / UI (Mails und CLI)

- Aktuell keine offenen Punkte.


## 4. Dashboard

- ⚪ **Als gelesen markieren** im Tab „Letzte Änderungen“ mit Zähler für Ungelesenes. (M)
- ⚪ **Accessibility:** `aria-label` für Filter, Tastaturbedienung der Diffs, Status nicht nur über Farbe, Fokusreihenfolge im Formular. (S)
- ⚪ **PWA/Installierbar** mit Offline-Cache der letzten Daten. (M)

## 5. Refactoring

- ⚪ **Konfigurationsschema** mit klaren Fehlern bei Tippfehlern (`selektor:`), unbekannten Optionen und falschen Typen, auch beim Speichern im Dashboard. (M)
- ⚪ **Logging** statt `print` (GitHub-Actions-Gruppen `::group::` und `::warning::`-Annotationen). (S)
- ⚪ **Paketstruktur** (`src/watchlist/`, Entry-Points `watchlist check|add`). (M)

## 6. Zuverlässigkeit und Betrieb

- 🟡 **`timeout-minutes`** für den Job `check` setzen, damit ein hängender Playwright-Lauf nicht Stunden blockiert (derzeit nicht gesetzt). (S)
- 🟡 **Seiten, die GitHub-Runner blockieren:** `buch.stadt-salzburg.at` antwortet nur von privaten IPs (ConnectTimeout bzw. `goto`-Timeout auf dem Runner). Optionen: Self-hosted Runner, Proxy oder lokaler launchd-Job. Bisher aus der Liste entfernt. (M)
- ⚪ **Seiten mit A/B-Varianten:** `deepl.com/en/pro` liefert bei jedem Abruf zufällig eine von zwei Textvarianten, es gibt dauernd Änderungsmails (URL pausiert). Idee: Erkennen, wenn Snapshot ständig zwischen zwei Zuständen wechselt, und im Dashboard warnen oder automatisch pausieren. (M)
- 🟡 **Laufdauer beobachten:** 52 URLs, viele auf `learn.microsoft.com` (`MAX_PER_HOST = 2`). Nach einigen Läufen Dauer prüfen, ggf. Limit oder Pause pro Host justieren. (S)
- 🟡 **Benachrichtigung bei Workflow-Ausfall:** Scheitert `check.yml` selbst (Supabase down, Secret fehlt), kommt keine Mail. Zweiter Job mit `if: failure()` oder Überwachung „kein Lauf seit 36 h“. (S)
- 🟡 **Backup der Datenbank:** Regelmäßiger Export von `watchlist_urls` und `watchlist_history` (z. B. wöchentlich als Artefakt). Das Supabase-Projekt ist geteilt. (S)
- ⚪ **Parser-Version im State:** Ändert sich `clean`/`parse_html`/`auto_root`, erscheinen alle Seiten als geändert. Mit `parser_version` still neu baselinen. (M)

## 7. Tests und Qualität

- 🟡 **Web-Komponenten testen** (Testing Library): Tabs, Filter, Gruppen-Formular, Fehlermeldung bei „Jetzt prüfen“, mit gemocktem Supabase-Client. Bisher sind nur die reinen Helfer getestet. (M)
- 🟡 **`RestStore` testen:** Gegen einen HTTP-Mock (PostgREST-Antworten), inklusive Fehlern. `PgStore` hat Tests (Python 3.12 und `pgserver`), `RestStore` nicht. (M)
- 🟡 **Tests für den `add.py`-Ablauf:** `main` mit gemocktem `fetch_body`, `--feed`, `-y`, Duplikate, robots-Sperre. (M)
- 🟡 **Integrationstest** mit lokalem HTTP-Server für 304, 429/5xx-Retry, Redirects und Zeichensatz. (M)
- 🟡 **Edge Functions testen** (Deno-Test, `watchlist-trigger-check` und `watchlist-preview`) für 401, 403, 429, „Lauf aktiv“, Start und CORS. (S)
- 🟡 **End-to-End-Test** des Dashboards (Playwright) mit gemockten REST-Antworten. Playwright ist schon Abhängigkeit. (L)
- 🟡 **Coverage** messen (`pytest --cov`, `vitest --coverage`) und Mindestwert in CI festlegen. (S)
- ⚪ **Property-Tests** (Hypothesis, fast-check) für `make_diff`, `annotate_diff`, `fragment_url`, `clean` und Regex-Ignore. (M)
- ⚪ **Konfigurationsprüfung in CI:** `check.py --validate` ohne Netzwerkzugriff (Duplikate, ungültige Regex, unbekannte Optionen). (S)

## 8. Dokumentation

- ⚪ **Screenshots** des Dashboards und einer Beispiel-Mail im README. (S)
- ⚪ **Beispielkonfigurationen** für typische Fälle (Release Notes mit `only_added`, JS-Seite, Feed, Stellenanzeigen mit `ignore`, `selector: auto`). (S)
- ⚪ **CHANGELOG** und Versionspflege (aktuell `0.1.0`). (S)

---

## Vorgeschlagene Reihenfolge

1. URLs im Dashboard bearbeiten und pausieren, Fehlerserie anzeigen, Rückmeldung nach „Jetzt prüfen“.
2. `timeout-minutes`, Benachrichtigung bei Workflow-Ausfall, Backup und Web-Prüfungen in CI.
3. Tab-Varianten zusammenfassen, danach ntfy und Digest-Modus.
4. Tests für `RestStore`, `add.py`, Edge Function und Web-Komponenten, Coverage in CI.
