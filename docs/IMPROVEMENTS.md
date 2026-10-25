# Verbesserungsideen

Offene Verbesserungen nach Bereich, dazu eine Liste des bereits Erledigten. Aufwand: **S** (< 1 h), **M** (einige Stunden), **L** (Tage). Priorität: 🔴 hoch, 🟡 mittel, ⚪ niedrig.

Stand: `check.py` 817 Zeilen, `store.py` 321, `add.py` 196, `dashboard.py` 118 (statisches Dashboard nur für den Datei-Modus), Web-Dashboard in `web/` (React, Supabase), 94 Python- und 18 Web-Tests. Daten liegen in Supabase (Tabellen `watchlist_*`). Das Repo ist öffentlich, persönliche Daten (URL-Liste) stehen nur in der Datenbank.

## Nächste Schritte (Top 8)

| # | Idee | Bereich | Prio | Aufwand |
|---|------|---------|------|---------|
| 1 | Bearbeiten von URLs im Dashboard (Name, Gruppe, Selector, JS, Pause) | Dashboard | 🔴 | M |
| 2 | Tab-Varianten derselben Seite zusammenfassen (Mehrfach-Einträge in Mails) | Features | 🔴 | M |
| 3 | Fehlerserie, Pause und Verlauf pro Seite im Dashboard | Dashboard | 🟡 | M |
| 4 | Weitere Kanäle (ntfy/Slack/Teams) und Digest-Modus | Features | 🟡 | M |
| 5 | `check.py` in Module aufteilen, `run()` entflechten, Annotationen, mypy `strict` | Refactoring | 🟡 | L |
| 6 | Branch Protection für `main` und Rate-Limit der Edge Function | Security | 🟡 | S |
| 7 | Tests für `RestStore`, `add.py`, Edge Function und Web-Komponenten | Qualität | 🟡 | M |
| 8 | Selector-Vorschau im Formular (erkannter Bereich und Textmenge) | Features | 🟡 | S |

---

## 1. Security

- 🔴 **Rechte im Dashboard prüfen:** Das Supabase-Projekt ist mit anderen Apps geteilt und hat offene Registrierung. Der Zugriff hängt allein an `watchlist_admins` und den RLS-Policies. Policies (insert/update/delete) per SQL-Skript regelmäßig verifizieren, z. B. mit einem zweiten, nicht freigeschalteten Konto. (S)
- 🟡 **Edge Function absichern:** `watchlist-trigger-check` läuft mit `--no-verify-jwt` und prüft Login und Admin selbst. Rate-Limit (z. B. höchstens ein Start pro Minute) und CORS auf `https://jhoelzl.github.io` einschränken. (S)
- 🟡 **ReDoS nur heuristisch abgefangen:** `config_errors` erkennt verschachtelte Quantifizierer und zu lange Muster, einen echten Timeout gibt es mit `re` nicht. Option: Bibliothek `regex` mit `timeout=`. Relevant, sobald `ignore`-Muster aus dem Dashboard kommen. (M)
- ⚪ **Redirect-/Schema-Kontrolle:** Nur `http`/`https` zulassen und Redirect-Ziele prüfen, weil URLs im Dashboard eingegeben werden können (SSRF auf interne Adressen ist auf GitHub-Runnern kaum relevant, lokal schon). (S)
- ⚪ **Fehlertexte von Resend** (`r.text`) landen im Log. Sicherstellen, dass dort nie Header oder Keys erscheinen. (S)
- ⚪ **Branch Protection für `main`** (Pull Requests, Status-Check `tests`). Kollidiert mit der Regel „direkt auf `main` pushen“ in `.github/copilot-instructions.md`. (S)
- ⚪ **Key-Rotation dokumentieren:** Wo `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY` und `GH_DISPATCH_TOKEN` gesetzt sind und wie man sie erneuert (Ablaufdatum des Tokens notieren). (S)

## 2. Features

- 🟡 **Weitere Kanäle:** ntfy.sh (einfachster Weg für Push aufs Handy), Slack/Teams/Discord-Webhook, Telegram. Konfigurierbar über Secrets und `options`, auch pro Gruppe. (M)
- 🟡 **Digest-Modus:** Optional tägliche Zusammenfassung statt sofortiger Mail, pro Gruppe oder URL (`notify: daily|immediate`). (M)
- 🟡 **Keyword-/Regex-Trigger:** `notify_if: 'Salzburg|Python'` löst die Mail nur aus, wenn neue Zeilen passen (Jobs, Events). Im Dashboard als Feld im Formular. (S)
- 🟡 **Pro-URL-Intervall:** `interval: daily|weekly`, damit selten ändernde Seiten seltener geprüft werden. (M)
- 🟡 **Ignore-Vorschläge:** Datums- und Zählerrauschen automatisch erkennen und `ignore`-Muster vorschlagen (in `add.py` oder Dashboard). Wiederkehrende Änderungen im Verlauf erkennen. (M)
- 🟡 **Selector-Vorschau im Formular:** Beim Eintippen der URL die Seite abrufen (Edge Function) und zeigen, welcher Bereich erkannt wird und wie viel Text er liefert. `selector: auto` gibt es bereits, die Vorschau fehlt. (M)
- 🟡 **Empfänger pro Gruppe:** `MAIL_TO` pro Gruppe überschreibbar. (S)
- ⚪ **Textfragment-Link robuster machen:** Heute wird die erste hinzugefügte Zeile verwendet. Besser: die längste Zeile ohne Sonderzeichen, bei Feeds direkt der Eintragslink. (S)
- ⚪ **JSON- und PDF-Quellen** unterstützen (JSON-Pfad, PDF-Text). (L)
- ⚪ **Screenshots bei JS-Seiten** als Artefakt, hilft bei Layout-Problemen. (M)
- ⚪ **Auth-Support** (Header/Cookies über Secrets) für geschützte Seiten. (M)
- ⚪ **`add.py` verbessern:** mehrere URLs auf einmal (`-f liste.txt`), Duplikatserkennung über normalisierte URL, Vorschlag für `ignore`. (S)
- ⚪ **Import/Export** der URL-Liste als YAML/JSON im Dashboard (Backup, Umzug), da `urls.yml` nicht mehr im Repo liegt. (S)

## 3. UX / UI (Mails und CLI)


## 4. Dashboard

- 🔴 **URLs bearbeiten:** Name, Gruppe, Selector, JS, `ignore`, `only_added` ändern sowie Pausieren (`active = false`). Es gibt bisher nur Hinzufügen, Löschen und Gruppenzuordnung. Die RLS-Policy `admins update urls` ist bereits da. (M)
- 🟡 **Fehlerserie anzeigen:** `streak` liegt im Status und ist im Typ vorhanden, wird aber nicht angezeigt. Dauerhaft kaputte Seiten hervorheben, Filter „Dauerhaft kaputt“. (S)
- 🟡 **Verlauf pro Seite:** Klick auf eine Seite zeigt nur deren Änderungen. Derzeit nur die letzten 100 global. (M)
- 🟡 **Sortierung:** Spalten sortierbar (zuletzt geändert, zuletzt geprüft, Status). Gruppen sind bereits alphabetisch. (S)
- 🟡 **Filterzustand in der URL** (`#g=Azure&s=problem&t=changes`), damit Ansichten teilbar sind und beim Neuladen bleiben. (S)
- 🟡 **Gruppen-Tab erweitern:** Reihenfolge der Gruppen, Farbe/Icon pro Gruppe, Sammelaktionen (alle URLs einer Gruppe pausieren). Heute ist eine Gruppe nur ein Textfeld an den URLs, leere Gruppen gibt es nicht. (M)
- 🟡 **Rückmeldung nach „Jetzt prüfen“:** Lauf-Status live aus der GitHub-API holen (läuft/fertig/Fehler) statt fest 90 Sekunden zu warten. (M)
- 🟡 **Toasts statt `window.confirm`/`alert`:** Löschen mit „Rückgängig“ (Soft-Delete über `active = false`), Fehlermeldungen als Hinweisleiste. (S)
- 🟡 **Anzeige-Einstellungen merken** (offene/zugeklappte Gruppen, Tab, Filter) in `localStorage`. (S)
- 🟡 **Lazy-Load/Pagination** des Verlaufs, falls `MAX_HISTORY` wächst. (M)
- ⚪ **Seitenweise Diff-Ansicht:** Nebeneinander (Alt/Neu) zusätzlich zum Inline-Diff, Umschalter „nur geänderte Zeilen“. (M)
- ⚪ **Als gelesen markieren** im Tab „Letzte Änderungen“ mit Zähler für Ungelesenes. (M)
- ⚪ **Accessibility:** `aria-label` für Filter, Tastaturbedienung der Diffs, Status nicht nur über Farbe, Fokusreihenfolge im Formular. (S)
- ⚪ **Änderungshäufigkeit** pro Seite als Sparkline. (M)
- ⚪ **Laufhistorie:** Dauer und Fehlerquote der letzten Läufe anzeigen. (M)
- ⚪ **PWA/Installierbar** mit Offline-Cache der letzten Daten. (M)
- ⚪ **Statisches `dashboard.py`** entfernen oder auf das Nötigste reduzieren, da das Web-Dashboard es ersetzt (nur noch Datei-Modus). (S)

## 5. Refactoring

- 🟡 **`check.py` aufteilen** (817 Zeilen, `run()` ist weiterhin sehr lang):
  - `config.py`: Optionen laden und validieren (`config_errors`)
  - `fetch.py`: HTTP, Retry, robots, Playwright, `fetch_all`
  - `parse.py`: Feed/HTML, `clean`, `ignore`, `auto_root`
  - `diffing.py`: `make_diff`, `annotate_diff`, `fragment_url`, `diff_counts`
  - `notify.py`: Resend, Mail-Rendering, `HINTS`, Heartbeat
  - `check.py`: nur Orchestrierung (M)
- 🟡 **`run()` entflechten:** Pro URL eine Funktion `check_url(opts, state) -> Result` (Dataclass) und getrennte Phasen „sammeln → senden → speichern“. (M)
- 🟡 **Typisierung abschließen:** Dicts (`entry`, `change`, `opts`) durch `TypedDict` oder `dataclass` ersetzen und Funktionen annotieren. Danach `strict = true`. (M)
- 🟡 **Python ↔ TypeScript angleichen:** `annotateDiff`, `fragmentUrl`, `countLines` und `groupOf` existieren doppelt. Per Test mit identischen Fällen (gemeinsame Fixture-Datei) abgleichen, damit sie nicht auseinanderlaufen. (S)
- 🟡 **`Dashboard.tsx` zerlegen** (252 Zeilen): `UrlsTab`, `ChangesTab`, `AddUrl`, `useWatchlist` (Laden, Aktionen) in eigene Dateien. (S)
- ⚪ **Konfigurationsschema** mit klaren Fehlern bei Tippfehlern (`selektor:`), unbekannten Optionen und falschen Typen, auch beim Speichern im Dashboard. (M)
- ⚪ **Konstanten** in einem `Settings`-Objekt bündeln (`MAX_HISTORY`, `STORE_DIFF_LINES`, `MAIL_DIFF_LINES`, `DIFF_CONTEXT`, `MAX_WORKERS`, `STUCK_AFTER`). Das Dashboard liest `HISTORY_LIMIT` getrennt davon, beide müssen zusammenpassen. (S)
- ⚪ **Logging** statt `print` (GitHub-Actions-Gruppen `::group::` und `::warning::`-Annotationen). (S)
- ⚪ **Paketstruktur** (`src/watchlist/`, Entry-Points `watchlist check|add`). (M)

## 6. Zuverlässigkeit und Betrieb

- 🟡 **`timeout-minutes`** für den Job `check` setzen, damit ein hängender Playwright-Lauf nicht Stunden blockiert (derzeit nicht gesetzt). (S)
- 🟡 **Laufdauer beobachten:** 52 URLs, viele auf `learn.microsoft.com` (`MAX_PER_HOST = 2`). Nach einigen Läufen Dauer prüfen, ggf. Limit oder Pause pro Host justieren. (S)
- 🟡 **Cron in UTC** (`0 6,18 * * *`) in der README dokumentieren oder auf lokale Zeiten abstimmen (Sommer-/Winterzeit verschiebt die Mailzeit). (S)
- 🟡 **Benachrichtigung bei Workflow-Ausfall:** Scheitert `check.yml` selbst (Supabase down, Secret fehlt), kommt keine Mail. Zweiter Job mit `if: failure()` oder Überwachung „kein Lauf seit 36 h“. (S)
- 🟡 **Backup der Datenbank:** Regelmäßiger Export von `watchlist_urls` und `watchlist_history` (z. B. wöchentlich als Artefakt). Das Supabase-Projekt ist geteilt. (S)
- ⚪ **Retry mit Jitter** und Unterscheidung dauerhafter Fehler (404/410) von vorübergehenden. (S)
- ⚪ **Parser-Version im State:** Ändert sich `clean`/`parse_html`/`auto_root`, erscheinen alle Seiten als geändert. Mit `parser_version` still neu baselinen. (M)
- ⚪ **Dependabot gruppieren** (ein PR pro Woche) und Auto-Merge für Patch-Updates bei grünen Tests. (S)
- ⚪ **Wöchentlicher `tests.yml`-Lauf** führt auch Lint und Tests aus, obwohl nur `uv audit` neue Erkenntnisse liefert. Audit in einen eigenen Job auslagern. (S)
- ⚪ **Web-Prüfungen in `tests.yml`:** `tsc`, `oxlint` und `vitest` laufen bisher nur lokal, der `pages`-Workflow baut nur. (S)

## 7. Tests und Qualität

- 🟡 **Web-Komponenten testen** (Testing Library): Tabs, Filter, Gruppen-Formular, Fehlermeldung bei „Jetzt prüfen“, mit gemocktem Supabase-Client. Bisher sind nur die reinen Helfer getestet. (M)
- 🟡 **`RestStore` testen:** Gegen einen HTTP-Mock (PostgREST-Antworten), inklusive Fehlern. `PgStore` hat Tests (Python 3.12 und `pgserver`), `RestStore` nicht. (M)
- 🟡 **Tests für den `add.py`-Ablauf:** `main` mit gemocktem `fetch_body`, `--feed`, `-y`, Duplikate, robots-Sperre. (M)
- 🟡 **Integrationstest** mit lokalem HTTP-Server für 304, 429/5xx-Retry, Redirects und Zeichensatz. (M)
- 🟡 **Edge Function testen** (Deno-Test) für 401, 403, „Lauf aktiv“ und Start. (S)
- 🟡 **End-to-End-Test** des Dashboards (Playwright) mit gemockten REST-Antworten. Playwright ist schon Abhängigkeit. (L)
- 🟡 **Coverage** messen (`pytest --cov`, `vitest --coverage`) und Mindestwert in CI festlegen. (S)
- ⚪ **Tests für `dashboard.build`:** Escaping, Gruppen, leere Historie, XSS-Fälle in Name und Diff. (S)
- ⚪ **Property-Tests** (Hypothesis, fast-check) für `make_diff`, `annotate_diff`, `fragment_url`, `clean` und Regex-Ignore. (M)
- ⚪ **Konfigurationsprüfung in CI:** `check.py --validate` ohne Netzwerkzugriff (Duplikate, ungültige Regex, unbekannte Optionen). (S)
- ⚪ **pre-commit** ist eingerichtet, aber nicht automatisch aktiv (einmal `uv run pre-commit install` pro Klon). Für `web/` fehlen Hooks (Lint, `tsc`). (S)

## 8. Dokumentation

- 🟡 **README erweitern:** Architekturdiagramm (Supabase, Actions, Dashboard, Edge Function), Einrichtung als Checkliste (Supabase, Secrets, Pages, Redirect-URL, `GH_DISPATCH_TOKEN`), Fehlerbehebung („Seite liefert zu wenig Text“, „robots.txt verbietet den Abruf“, „Selector nicht gefunden“, „Jetzt prüfen schlägt fehl“). (S)
- ⚪ **Screenshots** des Dashboards und einer Beispiel-Mail im README. (S)
- ⚪ **Beispielkonfigurationen** für typische Fälle (Release Notes mit `only_added`, JS-Seite, Feed, Stellenanzeigen mit `ignore`, `selector: auto`). (S)
- ⚪ **CHANGELOG** und Versionspflege (aktuell `0.1.0`). (S)
- ⚪ **CONTRIBUTING.md** mit Setup, Tests und Stil. (S)

---

## Erledigt

| Thema | Umsetzung |
|-------|-----------|
| HTML-Mail abgesichert | Tests für feindliche Inhalte (`<script>`, Attribute, Feed-Inhalte) und Sonderzeichen im Fragment-Link. `safe_link` verlinkt nur `http(s)`-URLs, `javascript:` bleibt Text |
| Tab-/Parameter-Varianten | `merge_variants` in `check.py` fasst Einträge mit identischem Diff in derselben Gruppe in Mail und Betreff zu einem Eintrag zusammen, die weiteren URLs stehen als "Gleicher Inhalt auch unter". Snapshots und Verlauf bleiben pro URL |
| Mail-Betreff | `subject_for`: "3 Änderungen: Voice Live, S-Bike, Drei, … (Gruppen)" statt nur der Anzahl |
| Dashboard-Link | Jede Mail verlinkt `#changes` und pro Eintrag `#changes:<URL>`. Das Dashboard öffnet den Tab und springt zum Eintrag. Basis-URL per `DASHBOARD_URL` überschreibbar |
| Plain-Text-Mail | Gleiche Struktur wie HTML: Zusammenfassung, Gruppen, +/−-Zähler, Sprunglink, Dashboard-Link, Varianten |
| Fehlercodes statt Textsuche | `CheckError(message, code)` und `error_code(ex)`, `HINTS` ist ein Dict nach Code. Der Code steht auch im Status (`code`) |
| Speicher in Supabase | `store.py` (`FileStore`, `PgStore`, `RestStore`), Schema `supabase/schema.sql` mit Präfix `watchlist_`, `migrate.py`. Workflow nutzt `SUPABASE_URL` und `SUPABASE_SERVICE_KEY`. `urls.yml` und der Branch `state` sind entfernt, der Workflow committet nichts mehr |
| Persönliche Daten aus dem Repo | `urls.yml` und `import_urls.sql` stehen in `.gitignore`, `urls.example.yml` ist die Vorlage. Historie auf einen Initial-Commit gesquasht, Backup liegt außerhalb des Repos. Repo ist öffentlich |
| Web-Dashboard | `web/` (Vite, React, Supabase-Login mit Freigabeliste `watchlist_admins`, RLS), Deploy per `pages.yml` auf GitHub Pages |
| URLs im Dashboard verwalten | Hinzufügen (mit `selector: auto`), Löschen (kleines „×“ mit Rückfrage), Tab „Gruppen“ zum Anlegen, Umbenennen, Zuordnen und Auflösen |
| „Jetzt prüfen“ | Edge Function `watchlist-trigger-check` startet `check.yml` (Login und Freigabe werden geprüft), der Fehlertext der Funktion wird angezeigt |
| Dashboard-Design | Dark Mode, Tabs als Segmented Control, Statusfilter mit Zählern, Gruppen einklappbar und alphabetisch, responsive Tabellen, redundante Kacheln entfernt |
| Tab „Letzte Änderungen“ | Letzte 100 Diffs aus der Datenbank, nach Tag gruppiert, Zeitraumfilter (Heute/7/30 Tage), Gruppen- und Textsuche, `+N −M`, Link „zur geänderten Stelle“ |
| Diff-Qualität | Wortgenaue Hervorhebung (Python und TypeScript), 3 Zeilen Kontext, bis zu 500 gespeicherte Zeilen, die Mail zeigt 60 |
| Mail-Verbesserungen | Zusammenfassung oben mit Sprunglinks, Farben für Hinzugefügt/Entfernt, `+N −M` im Kopf, Hinweis auf das Dashboard bei gekürzten Diffs |
| `selector: auto` | Wählt `main`, `article`, `[role=main]`, `#main-content`, `#content` oder die ganze Seite. Standard im Dashboard-Formular. Behebt „Selector nicht gefunden“ (z. B. DeepL, S-Bike) |
| Ein Playwright-Browser pro Lauf | `BrowserPool` startet Chromium lazy beim ersten `js: true`-Aufruf, eine Seite pro URL in einem eigenen Thread, Neustart nach Absturz |
| Actions per Commit-SHA gepinnt | `checkout`, `setup-uv`, `upload-pages-artifact`, `deploy-pages` mit SHA und Versionskommentar (Dependabot aktualisiert) |
| Rechte im Workflow minimiert | `permissions: {}` global, `contents: read` im Job `check`, `pages: write` und `id-token: write` nur im Pages-Workflow |
| `ignore`-Regex validiert | `config_errors`: ungültig, über 300 Zeichen, verschachtelte Quantifizierer. Betroffene URL steht auf „Fehler“ |
| Secret-Scan | GitHub Secret Scanning und Push Protection aktiviert, `gitleaks` als Job in `tests.yml` (gesamte Historie) und als pre-commit-Hook |
| `uv audit` in CI | In `tests.yml` bei Push, Pull Request und wöchentlich |
| Parallele Abrufe | `fetch_all` mit 6 Threads, 2 pro Host, JS-Seiten nacheinander, ETag/Last-Modified (304) |
| Warnmails mit Tipp | `hint_for`/`with_hint` nennen Ursache und Abhilfe (robots.txt, 403, 404, Timeout, Selector, zu wenig Text, …) |
| Lebenszeichen-Mail | Statistik pro Gruppe, letzte Änderungen, Problemseiten und „Dauerhaft kaputt“ (ab `STUCK_AFTER` = 6 Läufen in Folge) |
| Einheitliche Sprache | Deutsch für Meldungen, Mails, Kommentare, Doku. Englisch für Code-Bezeichner und Commit-Nachrichten |
| Linting und Typen | Ruff (`E`, `F`, `I`, `UP`, `B`, `SIM`, `C4`, `PTH`), mypy mit den ohne Annotationen erfüllbaren strict-Flags, `oxlint` und `tsc` für `web/`, pre-commit für Python |
| Copilot-Anweisungen | `.github/copilot-instructions.md`: direkt auf `main` committen und pushen, Sprache, `add.py` nutzen, Prüfungen vor dem Commit |

## Vorgeschlagene Reihenfolge

1. URLs im Dashboard bearbeiten und pausieren, Fehlerserie anzeigen, Rückmeldung nach „Jetzt prüfen“.
2. `timeout-minutes`, Benachrichtigung bei Workflow-Ausfall, Backup und Web-Prüfungen in CI.
3. Tab-Varianten zusammenfassen, danach ntfy und Digest-Modus.
4. `check.py` zerlegen (Module, `check_url`, TypedDict, Annotationen), danach `strict = true`.
5. Tests für `RestStore`, `add.py`, Edge Function und Web-Komponenten, Coverage in CI.
