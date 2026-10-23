# Verbesserungsideen

Offene Verbesserungen nach Bereich, dazu eine Liste des bereits Erledigten. Aufwand: **S** (< 1 h), **M** (einige Stunden), **L** (Tage). Priorität: 🔴 hoch, 🟡 mittel, ⚪ niedrig.

Stand: `check.py` 626 Zeilen (26 Funktionen), `dashboard.py` 116, `add.py` 172, 83 Tests. `mypy --strict` meldet noch 127 Fehler (fehlende Annotationen).

## Nächste Schritte (Top 7)

| # | Idee | Bereich | Prio | Aufwand |
|---|------|---------|------|---------|
| 1 | Tab-Varianten derselben Seite zusammenfassen (Mehrfach-Einträge in Mails) | Features | 🔴 | M |
| 2 | `check.py` in Module aufteilen, `run()` entflechten | Refactoring | 🟡 | M |
| 3 | Dashboard: Dark Mode, Sortierung, Statistik, Filter in der URL | UX/UI | 🟡 | M |
| 4 | Weitere Kanäle (Slack/Teams/ntfy) und Digest-Modus | Features | 🟡 | M |
| 5 | Funktionen annotieren, dann mypy `strict = true` | Qualität | 🟡 | M |
| 6 | Secret-Scan per `gitleaks` (GitHub Secret Scanning ist im privaten Repo nicht verfügbar) | Security | 🟡 | S |
| 7 | Tests für `add.py`-Ablauf und Integrationstest mit lokalem HTTP-Server | Qualität | 🟡 | M |

---

## 1. Security

- 🟡 **Secret-Scan:** GitHub Secret Scanning und Push Protection sind für dieses private Repo nicht verfügbar (API: „not available", nötig wäre GitHub Secret Protection oder ein öffentliches Repo). Alternative: `gitleaks` als Schritt in `tests.yml` oder als pre-commit-Hook. (S)
- 🟡 **Dashboard auf Pages ist öffentlich** und enthält URLs, Namen und Diff-Inhalte. Wenn `ENABLE_PAGES` aktiv ist, optional nur Metadaten veröffentlichen oder Diffs weglassen. (S)
- 🟡 **ReDoS nur heuristisch abgefangen:** `config_errors` erkennt verschachtelte Quantifizierer und zu lange Muster, einen echten Timeout gibt es mit `re` nicht (lehnt auch harmlose Muster wie `(\d+,)+` ab). Option: Bibliothek `regex` mit `timeout=`. (M)
- ⚪ **Redirect-/Schema-Kontrolle:** `requests` folgt Redirects automatisch. Nur `http`/`https` zulassen und Redirect-Ziele prüfen, falls `urls.yml` je aus fremden Beiträgen (PRs) kommt. (S)
- ⚪ **Fehlertexte von Resend** (`r.text`) landen im Log. Sicherstellen, dass dort nie Header oder Keys erscheinen. (S)
- ⚪ **HTML-Mail:** Inhalte werden mit `html.escape` maskiert. Per Test absichern, dass auch Feed-Inhalte mit `<script>` und Attributen sauber bleiben. (S)
- ⚪ **Branch Protection für `main`** aktivieren (Pull Requests, Status-Check `tests`). Da der Workflow nichts mehr auf `main` committet, ist das möglich. Achtung: Es kollidiert mit der Regel „direkt auf `main` pushen" in `.github/copilot-instructions.md`. (S)

## 2. Features

- 🔴 **Tab-/Parameter-Varianten zusammenfassen:** Seiten wie `language-support?tabs=stt|tts|...` oder `voice-live-language-support?tabs=speechinput|speechoutput` liefern vermutlich denselben HTML-Inhalt (noch nicht geprüft). Eine Änderung erzeugt dann mehrere Einträge in der Mail. Idee: gleiche Inhalts-Hashes über Einträge hinweg erkennen und gemeinsam melden, oder Option `variants:`. (M)
- 🟡 **Weitere Kanäle:** Slack/Teams/Discord-Webhook, ntfy.sh, Telegram. Konfigurierbar über Secrets und `notify:` in `urls.yml`, auch pro Gruppe. (M)
- 🟡 **Digest-Modus:** Optional tägliche Zusammenfassung statt sofortiger Mail, pro Gruppe oder URL (`notify: daily|immediate`). (M)
- 🟡 **Keyword-/Regex-Trigger:** `notify_if: 'Salzburg|Python'` löst die Mail nur aus, wenn neue Zeilen passen (Jobs, Events). (S)
- 🟡 **Pro-URL-Intervall:** `interval: daily|weekly`, damit selten ändernde Seiten seltener geprüft werden. (M)
- 🟡 **Ignore-Vorschläge:** Datums- und Zählerrauschen automatisch erkennen und `ignore`-Muster vorschlagen (in `add.py` oder Dashboard). (M)
- ⚪ **Diff auf Wortebene** (Inline-Hervorhebung) statt nur Zeilen. (M)
- ⚪ **JSON- und PDF-Quellen** unterstützen (JSON-Pfad, PDF-Text). (L)
- ⚪ **Screenshots bei JS-Seiten** als Artefakt, hilft bei Layout-Problemen. (M)
- ⚪ **Auth-Support** (Header/Cookies über Secrets) für geschützte Seiten. (M)
- ⚪ **`add.py` verbessern:** mehrere URLs auf einmal (`-f liste.txt`, heute wird jede URL einzeln aufgerufen), Duplikatserkennung über normalisierte URL, `--only-added`, Vorschlag für `ignore`. (S)
- ⚪ **`remove.py` / `move.py`** zum Löschen oder Umgruppieren von Einträgen, inklusive Aufräumen verwaister Snapshots in Supabase. Die drei Voice-Live-Seiten mussten z. B. von Hand umgruppiert werden. (S)

## 3. UX / UI (Mails und CLI)

- 🟡 **Mail:** Link zum Dashboard, farbige Diff-Zeilen (add/del) auch in der HTML-Mail, lange Zeilen kürzen. (S)
- ⚪ **Hinweistexte (`HINTS`) pflegen:** Die Tipps greifen über Textmuster im Fehlertext. Ändert sich eine Meldung (z. B. durch ein `requests`-Update), fällt der Tipp weg. Fehler künftig als eigene Exception-Klassen mit Code statt Textsuche modellieren. (M)

## 4. Dashboard

- 🟡 **Dark Mode** (`prefers-color-scheme`) und bessere Kontraste. (S)
- 🟡 **Sortierung und einklappbare Gruppen:** Spalten sortierbar (zuletzt geändert, Status), Gruppen als `<details>`. (S)
- 🟡 **Filterzustand in der URL** (`#g=Azure&s=problem`), damit Ansichten teilbar sind. (S)
- 🟡 **Statistik-Kopf:** Gesamtzahl, Änderungen der letzten 7/30 Tage, Fehleranzahl, letzter erfolgreicher Lauf. (S)
- 🟡 **Fehlerserie anzeigen:** `status.json` speichert jetzt `streak` (Läufe in Folge mit Problem), das Dashboard zeigt es noch nicht. Dauerhaft kaputte Seiten hervorheben. (S)
- 🟡 **Verlauf pro Seite:** Klick auf eine Seite zeigt nur deren Änderungen. Derzeit nur die letzten 50 global. (M)
- 🟡 **Lazy-Load/Pagination** des Verlaufs, falls `MAX_HISTORY` wächst. (M)
- ⚪ **Responsive Tabelle** für schmale Displays (Karten statt Tabelle). (S)
- ⚪ **Accessibility:** `aria-label` für Filter, Tastaturbedienung der Diffs, Status nicht nur über Farbe. (S)
- ⚪ **Alle Diffs auf-/zuklappen** und Schnellfilter „Nur Probleme". (S)
- ⚪ **Änderungshäufigkeit** pro Seite als Sparkline oder Heatmap. (M)
- ⚪ **CSS/JS aus `dashboard.py` auslagern** (Template-Dateien), damit Linting, Formatierung und Syntax-Highlighting funktionieren. (M)
- ⚪ **Laufhistorie:** Dauer und Fehlerquote der letzten Läufe anzeigen. (M)

## 5. Refactoring

- 🟡 **`check.py` aufteilen** (626 Zeilen, `run()` ist weiterhin sehr lang, trotz ausgelagertem `fetch_all`):
  - `config.py`: Laden und Validieren von `urls.yml` (`load_config`, `config_errors`)
  - `fetch.py`: HTTP, Retry, robots, Playwright, `fetch_all`
  - `parse.py`: Feed/HTML, `clean`, `ignore`
  - `notify.py`: Resend, Mail-Rendering, `HINTS`, Heartbeat
  - `state.py`: Snapshots, `status.json`, `history.json`, Zähler
  - `check.py`: nur Orchestrierung (M)
- 🟡 **`run()` entflechten:** Pro URL eine Funktion `check_url(opts, state) -> Result` (Dataclass) und getrennte Phasen „sammeln → senden → speichern". (M)
- 🟡 **Typisierung abschließen:** Dicts (`entry`, `change`, `opts`) durch `TypedDict` oder `dataclass` ersetzen und rund 40 Funktionen annotieren (127 Fehler unter `mypy --strict`). Danach `strict = true` in `pyproject.toml` und die einzeln aufgelisteten Flags entfernen. (M)
- 🟡 **Zähler-Dateien** (`<key>.fail`, `<key>.short`) in `counters.json` oder direkt in `status.json` zusammenführen (dort liegt `streak` bereits). (S)
- ⚪ **Konfigurationsschema** mit klaren Fehlern bei Tippfehlern (`selektor:`), unbekannten Optionen und falschen Typen. (M)
- ⚪ **Konstanten** in einem `Settings`-Objekt bündeln, optional per Umgebung überschreibbar (`MAX_HISTORY`, `MAX_WORKERS`, `MAX_PER_HOST`, `STUCK_AFTER`, Retry, Guard). (S)
- ⚪ **Logging** statt `print` (Modul `logging`, GitHub-Actions-Gruppen `::group::` und `::warning::`-Annotationen). (S)
- ⚪ **Paketstruktur** (`src/watchlist/`, Entry-Points `watchlist check|add`). (M)

## 6. Zuverlässigkeit und Betrieb

- 🟡 **Erster Workflow-Lauf nach der Umstellung beobachten:** Checkout von `state` nach `data/`, Push mit Rebase-Retry und `permissions` pro Job wurden nur lokal geprüft, nicht auf GitHub. (S)
- 🟡 **`timeout-minutes`** für den Job setzen, damit ein hängender Playwright-Lauf nicht Stunden blockiert. (S)
- 🟡 **Cron in UTC** (`0 6,18 * * *`): in der README dokumentieren oder auf lokale Zeiten abstimmen. (S)
- 🟡 **Host-Limit prüfen:** Die meisten URLs liegen auf `learn.microsoft.com`. Mit `MAX_PER_HOST = 2` ist der Speed-up auf dem Runner kleiner als lokal (44 URLs in ~20 s). Nach dem ersten Lauf Dauer vergleichen und ggf. Limit oder eine kleine Pause pro Host justieren. (S)
- ⚪ **Retry mit Jitter** und Unterscheidung dauerhafter Fehler (404/410) von vorübergehenden. Bei 404/410 früher warnen. (S)
- ⚪ **Parser-Version im State:** Ändert sich `clean`/`parse_html`, erscheinen alle Seiten als geändert. Mit `parser_version` still neu baselinen. (M)
- ⚪ **`site/status.json`** für externe Monitore (Uptime Kuma etc.). (S)
- ⚪ **Dependabot gruppieren** (ein PR pro Woche) und Auto-Merge für Patch-Updates bei grünen Tests. (S)
- ⚪ **Wöchentlicher `tests.yml`-Lauf** führt auch Lint und Tests aus, obwohl nur `uv audit` neue Erkenntnisse liefert. Audit in einen eigenen Job auslagern. (S)

## 7. Tests und Qualität

- 🟡 **Tests für `dashboard.build`:** Escaping, Gruppen, leere Historie, XSS-Fälle in Name und Diff. Es gibt nur einen einfachen Test in `test_check.py`. (S)
- 🟡 **Tests für den `add.py`-Ablauf:** `main` mit gemocktem `fetch_body`, `--feed`, `-y`, Duplikate, robots-Sperre. (M)
- 🟡 **Integrationstest** mit lokalem HTTP-Server für 304, 429/5xx-Retry, Redirects und Zeichensatz. (M)
- 🟡 **Coverage** messen (`pytest --cov`) und Mindestwert in CI festlegen. (S)
- ⚪ **Property-Tests** (Hypothesis) für `make_diff`, `clean` und Regex-Ignore. (M)
- ⚪ **Konfigurationsprüfung in CI:** `check.py --validate` für `urls.yml` (Duplikate, ungültige Regex, unbekannte Optionen), ohne Netzwerkzugriff. `config_errors` ist dafür bereits vorhanden. (S)
- ⚪ **pre-commit** ist eingerichtet, aber nicht automatisch aktiv. Jeder Klon braucht einmal `uv run pre-commit install`. (S)

## 8. Dokumentation

- 🟡 **README erweitern:** Architekturüberblick (`urls.yml` → Fetch → Snapshot → Diff → Mail/Dashboard), Beispiel-Mail, Fehlerbehebung („Seite liefert zu wenig Text", „robots.txt verbietet den Abruf"). (S)
- ⚪ **Beispielkonfigurationen** für typische Fälle (Release Notes mit `only_added`, JS-Seite, Feed, Stellenanzeigen mit `ignore`). (S)
- ⚪ **CHANGELOG** und Versionspflege (aktuell `0.1.0`). (S)
- ⚪ **CONTRIBUTING.md** mit Setup, Tests und Stil. (S)

---

## Erledigt

| Thema | Umsetzung |
|-------|-----------|
| Speicher in Supabase | `store.py` (FileStore/PgStore), Schema `supabase/schema.sql` mit Präfix `watchlist_`, `migrate.py`, `add.py` schreibt in die DB; Workflow wechselt mit Secret `SUPABASE_DB_URL`. `urls.yml` und der Branch `state` sind entfernt. Offen: Secret `SUPABASE_SERVICE_KEY` setzen |
| Ein Playwright-Browser pro Lauf | `BrowserPool` startet Chromium lazy beim ersten `js: true`-Aufruf, nutzt eine Seite pro URL in einem eigenen Thread (Sync-API ist thread-gebunden) und schließt am Laufende; Neustart nach Absturz |
| Actions per Commit-SHA gepinnt | `checkout`, `setup-uv`, `upload-pages-artifact`, `deploy-pages` mit SHA und Versionskommentar (Dependabot aktualisiert) |
| Rechte im Workflow minimiert | `permissions: {}` global, `contents: write` nur im Job `check`, `pages: write` und `id-token: write` nur im Job `pages` |
| Bot-Commits getrennt von `main` | Früher Branch `state`, jetzt gar keine Bot-Commits mehr (Daten in Supabase) |
| `ignore`-Regex validiert | `config_errors`: ungültig, über 300 Zeichen, verschachtelte Quantifizierer. Betroffene URL steht auf „Fehler", Lauf endet mit Fehler. Einzelner Text als `ignore` wird nicht mehr in Zeichen zerlegt |
| `uv audit` in CI | In `tests.yml` bei Push, Pull Request und wöchentlich |
| Parallele Abrufe | `fetch_all` mit 6 Threads, 2 pro Host, JS-Seiten nacheinander. 44 URLs in ~20 s |
| Warnmails mit Tipp | `hint_for`/`with_hint` nennen Ursache und Abhilfe (robots.txt, 403, 404, Timeout, Selector, zu wenig Text, …) |
| Lebenszeichen-Mail | Statistik pro Gruppe, letzte Änderungen, Problemseiten und „Dauerhaft kaputt" (ab `STUCK_AFTER` = 6 Läufen in Folge, mit Tipp) |
| Einheitliche Sprache | Deutsch für Meldungen, Mails, Kommentare, Doku. Englisch für Code-Bezeichner und Commit-Nachrichten (README, `copilot-instructions.md`) |
| Ruff erweitert | `SIM`, `C4`, `PTH` zusätzlich zu `E`, `F`, `I`, `UP`, `B` |
| mypy verschärft | Alle strict-Flags, die ohne Annotationen erfüllbar sind, inkl. `check_untyped_defs`. Offen: `disallow_untyped_defs`, `disallow_untyped_calls` |
| pre-commit | `.pre-commit-config.yaml` mit ruff, ruff format und mypy über `uv run --frozen` |
| Copilot-Anweisungen | `.github/copilot-instructions.md`: direkt auf `main` committen und pushen, Sprache, `add.py` nutzen, Prüfungen vor dem Commit |

## Vorgeschlagene Reihenfolge

1. Ersten Workflow-Lauf nach der Umstellung auf `state` und Parallelisierung prüfen, `timeout-minutes` setzen.
2. Tab-Varianten zusammenfassen.
3. `check.py` zerlegen (Module, `check_url`, TypedDict, Annotationen), danach `strict = true`.
4. Dashboard-Politur (Dark Mode, Sortierung, Statistik, Fehlerserie), dann neue Kanäle und Digest.
5. Tests für `add.py`, Dashboard und HTTP-Integration, Coverage und `gitleaks` in CI.
