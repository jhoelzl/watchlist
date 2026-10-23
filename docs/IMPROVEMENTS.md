# Verbesserungsideen

Sammlung möglicher Verbesserungen, nach Bereich sortiert. Aufwand: **S** (< 1 h), **M** (einige Stunden), **L** (Tage). Priorität: 🔴 hoch, 🟡 mittel, ⚪ niedrig. Grundlage: Analyse von `check.py`, `dashboard.py`, `add.py`, `urls.yml`, den Workflows und den Tests.

## Übersicht (Top 8)

| # | Idee | Bereich | Prio | Aufwand |
|---|------|---------|------|---------|
| 1 | ~~Seiten parallel abrufen~~ (erledigt, 44 URLs in ~20 s) | Performance | ✅ | M |
| 2 | Tab-Varianten derselben Seite zusammenfassen (Mehrfach-Mails) | Features | 🔴 | M |
| 3 | ~~`state/` aus der Git-Historie von `main` herausnehmen~~ (erledigt, Branch `state`) | Betrieb | ✅ | M |
| 4 | `check.py` in Module aufteilen | Refactoring | 🟡 | M |
| 5 | Dashboard: Dark Mode, Sortierung, Statistik | UX/UI | 🟡 | M |
| 6 | Zusätzliche Benachrichtigungskanäle (Slack/Teams/ntfy/Webhook) | Features | 🟡 | M |
| 7 | ~~Action-Versionen per Commit-SHA pinnen~~ (erledigt) | Security | ✅ | S |
| 8 | Tests für Dashboard-Rendering und `add.py` erweitern | Qualität | 🟡 | M |

---

## 1. Security

- ✅ **Erledigt:** **GitHub Actions per Commit-SHA gepinnt** (`actions/checkout`, `setup-uv`, `upload-pages-artifact`, `deploy-pages`). Verhindert Supply-Chain-Angriffe über verschobene Tags. Dependabot hält die SHAs aktuell. (S)
- 🟡 **Rechte im Workflow minimieren:** `check.yml` hat `contents: write` auf Workflow-Ebene. Besser auf den Job begrenzen, der pusht. (S)
- ✅ **Erledigt:** **Bot-Commits und Branch-Schutz:** Der Push von `state/` und `site/` auf `main` funktioniert nur ohne Branch-Protection. Ein eigener Branch `state` löst das und hält `main` sauber (siehe Abschnitt 6). (M)
- ✅ **Erledigt:** **Regex aus `ignore:`:** Ein fehlerhaftes oder katastrophales Muster (ReDoS) in `urls.yml` kann den Lauf hängen lassen oder abbrechen. Beim Laden validieren und ungültige Muster als Konfigurationsfehler melden. (S)
- 🟡 **Dashboard auf Pages ist öffentlich** und enthält URLs, Namen und Diff-Inhalte. Wenn Pages aktiv ist, optional nur Metadaten veröffentlichen oder Diffs weglassen. (S)
- ⚪ **Redirect-/Schema-Kontrolle:** `requests` folgt Redirects automatisch. Nur `http`/`https` zulassen und Redirect-Ziele prüfen, falls `urls.yml` je aus fremden Beiträgen (PRs) kommt. (S)
- ✅ **Teilweise erledigt:** `uv audit` läuft in `tests.yml` (Push, PR, wöchentlich). **Offen:** Secret Scanning und Push Protection sind für dieses private Repo nicht verfügbar (die API meldet "not available", nötig wäre GitHub Secret Protection oder ein öffentliches Repo). Alternative: `gitleaks` als Workflow-Schritt oder pre-commit-Hook. (S)
- ⚪ **Fehlertexte von Resend** (`r.text`) landen im Log. Sicherstellen, dass dort nie Header oder Keys erscheinen. (S)
- ⚪ **HTML-Mail:** Inhalte werden mit `html.escape` maskiert. Per Test absichern, dass auch Feed-Inhalte mit `<script>` und Attributen sauber bleiben. (S)

## 2. Features

- 🔴 **Tab-/Parameter-Varianten zusammenfassen:** Seiten wie `language-support?tabs=stt|tts|...` oder `voice-live-language-support?tabs=speechinput|speechoutput` liefern vermutlich denselben HTML-Inhalt. Eine Änderung erzeugt dann mehrere Einträge in der Mail. Idee: Inhalts-Hash über Einträge hinweg erkennen und gemeinsam melden oder eine Option `variants:` einführen. (M)
- ✅ **Erledigt:** **Parallele Abrufe** mit `ThreadPoolExecutor` (z. B. 6 Worker, höchstens 1-2 pro Host, damit die Rücksicht auf Server erhalten bleibt). Verkürzt den Lauf deutlich. (M)
- 🟡 **Ein Playwright-Browser pro Lauf** statt pro URL (aktuell `launch()` je Aufruf). (S)
- 🟡 **Weitere Kanäle:** Slack/Teams/Discord-Webhook, ntfy.sh, Telegram. Konfigurierbar über Secrets und `notify:` in `urls.yml`, auch pro Gruppe. (M)
- 🟡 **Digest-Modus:** Optional tägliche Zusammenfassung statt sofortiger Mail, pro Gruppe oder URL (`notify: daily|immediate`). (M)
- 🟡 **Keyword-/Regex-Trigger:** `notify_if: 'Salzburg|Python'` löst die Mail nur aus, wenn neue Zeilen passen (Jobs, Events). (S)
- 🟡 **Pro-URL-Intervall:** `interval: daily|weekly`, damit selten ändernde Seiten seltener geprüft werden. (M)
- 🟡 **Ignore-Vorschläge:** Datums- und Zählerrauschen automatisch erkennen und `ignore`-Muster vorschlagen (in `add.py` oder Dashboard). (M)
- ⚪ **Diff auf Wortebene** (Inline-Hervorhebung) statt nur Zeilen. (M)
- ⚪ **JSON- und PDF-Quellen** unterstützen (JSON-Pfad, PDF-Text). (L)
- ⚪ **Screenshots bei JS-Seiten** als Artefakt, hilft bei Layout-Problemen. (M)
- ⚪ **Auth-Support** (Header/Cookies über Secrets) für geschützte Seiten. (M)
- ⚪ **`add.py` verbessern:** mehrere URLs auf einmal (`-f liste.txt`), Duplikatserkennung über normalisierte URL, `--only-added`, Vorschlag für `ignore`. Heute wird jede URL einzeln aufgerufen. (S)
- ⚪ **`remove.py` / `move.py`** zum Löschen oder Umgruppieren von Einträgen, inklusive Aufräumen verwaister Snapshots in `state/`. (S)

## 3. UX / UI (Mails und CLI)

- 🟡 **Mail:** Link zum Dashboard, farbige Diff-Zeilen (add/del) auch in der HTML-Mail, lange Zeilen kürzen. (S)
- 🟡 **Warnmails verständlicher:** Bei wiederholten Fehlern Hinweis auf mögliche Ursache (robots.txt, 403, Timeout) und Abhilfe (`js: true`, `ignore_robots`). (S)
- ⚪ **Lebenszeichen-Mail** mit Statistik pro Gruppe und Liste dauerhaft kaputter URLs. (S)
- ⚪ **Einheitliche Sprache** in Meldungen, Kommentaren und Namen (derzeit Deutsch und Englisch gemischt). Entscheidung treffen und dokumentieren. (S)

## 4. Dashboard

- 🟡 **Dark Mode** (`prefers-color-scheme`) und bessere Kontraste. (S)
- 🟡 **Sortierung und einklappbare Gruppen:** Spalten sortierbar (zuletzt geändert, Status), Gruppen als `<details>`. (S)
- 🟡 **Filterzustand in der URL** (`#g=Azure&s=problem`), damit Ansichten teilbar sind. (S)
- 🟡 **Statistik-Kopf:** Gesamtzahl, Änderungen der letzten 7/30 Tage, Fehleranzahl, letzter erfolgreicher Lauf. (S)
- 🟡 **Verlauf pro Seite:** Klick auf eine Seite zeigt nur deren Änderungen. Derzeit nur die letzten 50 global. (M)
- 🟡 **Lazy-Load/Pagination** des Verlaufs, falls `MAX_HISTORY` wächst. (M)
- ⚪ **Responsive Tabelle** für schmale Displays (Karten statt Tabelle). (S)
- ⚪ **Accessibility:** `aria-label` für Filter, Tastaturbedienung der Diffs, Status nicht nur über Farbe. (S)
- ⚪ **Alle Diffs auf-/zuklappen** und Schnellfilter „Nur Probleme". (S)
- ⚪ **Änderungshäufigkeit** pro Seite als Sparkline oder Heatmap. (M)
- ⚪ **CSS/JS aus `dashboard.py` auslagern** (Template-Dateien), damit Linting, Formatierung und Syntax-Highlighting funktionieren. (M)
- ⚪ **Laufhistorie:** Dauer und Fehlerquote der letzten Läufe anzeigen. (M)

## 5. Refactoring

- 🟡 **`check.py` aufteilen** (472 Zeilen, `run()` ist ~190 Zeilen lang):
  - `config.py`: Laden und Validieren von `urls.yml`
  - `fetch.py`: HTTP, Retry, robots, Playwright
  - `parse.py`: Feed/HTML, `clean`, `ignore`
  - `notify.py`: Resend, Mail-Rendering
  - `state.py`: Snapshots, `status.json`, `history.json`, Zähler
  - `check.py`: nur Orchestrierung (M)
- 🟡 **`run()` entflechten:** Pro URL eine Funktion `check_url(opts, state) -> Result` (Dataclass) und getrennte Phasen „sammeln → senden → speichern". Erleichtert Tests und Parallelisierung. (M)
- 🟡 **Typisierung:** Dicts (`entry`, `change`, `opts`) durch `TypedDict` oder `dataclass` ersetzen, mypy strenger konfigurieren (`disallow_untyped_defs`). (M)
- 🟡 **Zähler-Dateien** (`<key>.fail`, `<key>.short`) in `state/counters.json` zusammenführen. (S)
- ⚪ **Konfigurationsschema** mit klaren Fehlern bei Tippfehlern (`selektor:`), unbekannten Optionen und falschen Typen. (M)
- ⚪ **Konstanten** in einem `Settings`-Objekt bündeln, optional per Umgebung überschreibbar (`MAX_HISTORY`, Retry, Guard). (S)
- ⚪ **Logging** statt `print` (Modul `logging`, GitHub-Actions-Gruppen `::group::` und `::warning::`-Annotationen). (S)
- ⚪ **Paketstruktur** (`src/watchlist/`, Entry-Points `watchlist check|add`). (M)

## 6. Zuverlässigkeit und Betrieb

- 🟡 **`state/` wächst mit der Git-Historie:** Läuft jetzt auf dem Branch `state` (`main` bleibt sauber). Der Branch wächst weiter; optional regelmäßig squashen (Orphan-Commit + Force-Push). (S)
- 🟡 **Push-Konflikte im Workflow:** Wenn zwischen Checkout und Push ein Commit eintrifft, schlägt `git push` fehl und der Lauf verliert Snapshots. Vor dem Push `git pull --rebase` mit Retry. (S)
- 🟡 **`timeout-minutes`** für den Job setzen, damit ein hängender Playwright-Lauf nicht Stunden blockiert. (S)
- 🟡 **Cron in UTC** (`0 6,18 * * *`): in der README dokumentieren oder auf lokale Zeiten abstimmen. (S)
- 🟡 **Rate-Limits pro Host:** Verzögerung zwischen Abrufen desselben Hosts, damit ein Host andere nicht ausbremst (relevant mit Parallelisierung und vielen `learn.microsoft.com`-URLs). (M)
- ⚪ **Retry mit Jitter** und Unterscheidung dauerhafter Fehler (404/410) von vorübergehenden. Bei 404/410 früher warnen. (S)
- ⚪ **Parser-Version im State:** Ändert sich `clean`/`parse_html`, erscheinen alle Seiten als geändert. Mit `parser_version` still neu baselinen. (M)
- ⚪ **`site/status.json`** für externe Monitore (Uptime Kuma etc.). (S)
- ⚪ **Dependabot gruppieren** (ein PR pro Woche) und Auto-Merge für Patch-Updates bei grünen Tests. (S)

## 7. Tests und Qualität

- 🟡 **Tests für `dashboard.build`:** Escaping, Gruppen, leere Historie, XSS-Fälle in Name und Diff. Es gibt noch keine eigene Testdatei. (S)
- 🟡 **Tests für den `add.py`-Ablauf:** `main` mit gemocktem `fetch_body`, `--feed`, `-y`, Duplikate, robots-Sperre. (M)
- 🟡 **Integrationstest** mit lokalem HTTP-Server für 304, 429/5xx-Retry, Redirects und Zeichensatz. (M)
- 🟡 **Coverage** messen (`pytest --cov`) und Mindestwert in CI festlegen. (S)
- ⚪ **Property-Tests** (Hypothesis) für `make_diff`, `clean` und Regex-Ignore. (M)
- ⚪ **`ruff` erweitern** (`SIM`, `C4`, `PTH`), `mypy --strict` schrittweise. (S)
- ⚪ **pre-commit** (ruff, ruff-format, mypy). (S)
- ⚪ **Konfigurationsprüfung in CI:** `urls.yml` auf Duplikate, ungültige Regex, unbekannte Optionen prüfen (`check.py --validate`). (S)

## 8. Dokumentation

- 🟡 **README erweitern:** Architekturüberblick (`urls.yml` → Fetch → Snapshot → Diff → Mail/Dashboard), Beispiel-Mail, Fehlerbehebung („Seite liefert zu wenig Text", „robots.txt verbietet den Abruf"). (S)
- ⚪ **Beispielkonfigurationen** für typische Fälle (Release Notes mit `only_added`, JS-Seite, Feed, Stellenanzeigen mit `ignore`). (S)
- ⚪ **CHANGELOG** und Versionspflege (aktuell `0.1.0`). (S)
- ⚪ **CONTRIBUTING.md** mit Setup, Tests und Stil. (S)

## Vorgeschlagene Reihenfolge

1. Schnell und wirksam (alle S): Push-Retry im Workflow, `timeout-minutes`, Action-SHA-Pinning, Dashboard-Tests, Regex-Validierung.
2. Mehrfach-Mails durch Tab-Varianten vermeiden, Browser-Wiederverwendung, parallele Abrufe mit Host-Limit.
3. `check.py` zerlegen (Module, `check_url`, TypedDict), danach neue Kanäle und Digest.
4. Dashboard-Politur (Dark Mode, Sortierung, Statistik, Template-Auslagerung).
5. Langfristig: `state`-Branch, Paketstruktur, Konfigurationsschema.
