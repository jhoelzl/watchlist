# Verbesserungsideen

Offene Verbesserungen nach Bereich, dazu eine Liste des bereits Erledigten. Aufwand: **S** (< 1 h), **M** (einige Stunden), **L** (Tage). Priorität: 🔴 hoch, 🟡 mittel, ⚪ niedrig.

Stand: `check.py` 927 Zeilen, `store.py` 321, `add.py` 196, Web-Dashboard in `web/` (React, Supabase), 96 Python- und 44 Web-Tests. Daten liegen in Supabase (Tabellen `watchlist_*`). Das Repo ist öffentlich, persönliche Daten (URL-Liste) stehen nur in der Datenbank.

## Nächste Schritte (Top 7)

| # | Idee | Bereich | Prio | Aufwand |
|---|------|---------|------|---------|
| 1 | Weitere Kanäle (ntfy/Slack/Teams) und Digest-Modus | Features | 🟡 | M |
| 2 | `check.py` in Module aufteilen, `run()` entflechten, Annotationen, mypy `strict` | Refactoring | 🟡 | L |
| 3 | Tests für `RestStore`, `add.py`, Edge Functions und Web-Komponenten | Qualität | 🟡 | M |
| 4 | `timeout-minutes` und Alarm bei Workflow-Ausfall für `check.yml` | Betrieb | 🟡 | S |
| 5 | Backup der Datenbank (wöchentlicher Export als Artefakt) | Betrieb | 🟡 | S |
| 6 | Sortierbare Spalten und Toasts statt `window.confirm` | Dashboard | 🟡 | S |
| 7 | Rechte im Dashboard mit zweitem Konto verifizieren | Security | 🔴 | S |

---

## 1. Security

- 🔴 **Rechte im Dashboard prüfen:** Das Supabase-Projekt ist mit anderen Apps geteilt und hat offene Registrierung. Der Zugriff hängt allein an `watchlist_admins` und den RLS-Policies. Policies (insert/update/delete) per SQL-Skript regelmäßig verifizieren, z. B. mit einem zweiten, nicht freigeschalteten Konto. (S)
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
- 🟡 **Empfänger pro Gruppe:** `MAIL_TO` pro Gruppe überschreibbar. (S)
- ⚪ **JSON- und PDF-Quellen** unterstützen (JSON-Pfad, PDF-Text). (L)
- ⚪ **Screenshots bei JS-Seiten** als Artefakt, hilft bei Layout-Problemen. (M)
- ⚪ **Auth-Support** (Header/Cookies über Secrets) für geschützte Seiten. (M)
- ⚪ **`add.py` verbessern:** mehrere URLs auf einmal (`-f liste.txt`), Duplikatserkennung über normalisierte URL, Vorschlag für `ignore`. (S)

## 3. UX / UI (Mails und CLI)

- Aktuell keine offenen Punkte.


## 4. Dashboard

- 🟡 **Sortierung:** Spalten sortierbar (zuletzt geändert, zuletzt geprüft, Status). Gruppen sind bereits alphabetisch. (S)
- 🟡 **Toasts statt `window.confirm`/`alert`:** Löschen mit „Rückgängig“ (Soft-Delete über `active = false`), Fehlermeldungen als Hinweisleiste. (S)
- 🟡 **Lazy-Load/Pagination** des Verlaufs, falls `MAX_HISTORY` wächst. (M)
- ⚪ **Seitenweise Diff-Ansicht:** Nebeneinander (Alt/Neu) zusätzlich zum Inline-Diff, Umschalter „nur geänderte Zeilen“. (M)
- ⚪ **Als gelesen markieren** im Tab „Letzte Änderungen“ mit Zähler für Ungelesenes. (M)
- ⚪ **Accessibility:** `aria-label` für Filter, Tastaturbedienung der Diffs, Status nicht nur über Farbe, Fokusreihenfolge im Formular. (S)
- ⚪ **Laufhistorie:** Dauer und Fehlerquote der letzten Läufe anzeigen. (M)
- ⚪ **PWA/Installierbar** mit Offline-Cache der letzten Daten. (M)

## 5. Refactoring

- 🟡 **`check.py` aufteilen** (927 Zeilen, `run()` ist weiterhin sehr lang):
  - `config.py`: Optionen laden und validieren (`config_errors`)
  - `fetch.py`: HTTP, Retry, robots, Playwright, `fetch_all`
  - `parse.py`: Feed/HTML, `clean`, `ignore`, `auto_root`
  - `diffing.py`: `make_diff`, `annotate_diff`, `fragment_url`, `diff_counts`
  - `notify.py`: Resend, Mail-Rendering, `HINTS`, Heartbeat
  - `check.py`: nur Orchestrierung (M)
- 🟡 **`run()` entflechten:** Pro URL eine Funktion `check_url(opts, state) -> Result` (Dataclass) und getrennte Phasen „sammeln → senden → speichern“. (M)
- 🟡 **Typisierung abschließen:** Dicts (`entry`, `change`, `opts`) durch `TypedDict` oder `dataclass` ersetzen und Funktionen annotieren. Danach `strict = true`. (M)
- 🟡 **Python ↔ TypeScript angleichen:** `annotateDiff`, `fragmentUrl`, `countLines` und `groupOf` existieren doppelt. Per Test mit identischen Fällen (gemeinsame Fixture-Datei) abgleichen, damit sie nicht auseinanderlaufen. (S)
- 🟡 **`Dashboard.tsx` zerlegen** (488 Zeilen; `GroupsPanel` ist schon ausgelagert): `UrlsTab`, `ChangesTab`, `AddUrl`, `useWatchlist` (Laden, Aktionen) in eigene Dateien. (S)
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
- ⚪ **Parser-Version im State:** Ändert sich `clean`/`parse_html`/`auto_root`, erscheinen alle Seiten als geändert. Mit `parser_version` still neu baselinen. (M)
- ⚪ **Dependabot gruppieren** (ein PR pro Woche) und Auto-Merge für Patch-Updates bei grünen Tests. (S)

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

- 🟡 **README erweitern:** Architekturdiagramm (Supabase, Actions, Dashboard, Edge Function), Einrichtung als Checkliste (Supabase, Secrets, Pages, Redirect-URL, `GH_DISPATCH_TOKEN`), Fehlerbehebung („Seite liefert zu wenig Text“, „robots.txt verbietet den Abruf“, „Selector nicht gefunden“, „Jetzt prüfen schlägt fehl“). (S)
- ⚪ **Screenshots** des Dashboards und einer Beispiel-Mail im README. (S)
- ⚪ **Beispielkonfigurationen** für typische Fälle (Release Notes mit `only_added`, JS-Seite, Feed, Stellenanzeigen mit `ignore`, `selector: auto`). (S)
- ⚪ **CHANGELOG** und Versionspflege (aktuell `0.1.0`). (S)

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
| pre-commit für web/ | Hooks `web oxlint` und `web tsc` in `.pre-commit-config.yaml`, mypy deckt alle Module ab. Aktivierung bleibt einmal pro Klon (`uv run pre-commit install`), CI prüft alles ohnehin |
| Audit-Job | `tests.yml`: `uv audit` und `npm audit` laufen im eigenen Job `audit` (auch wöchentlich). Beim Zeitplan laufen nur dort Schritte, Lint und Tests nur bei Push und PR |
| Selector-Vorschau | Edge Function `watchlist-preview` ruft die Seite ab (SSRF-Schutz, nur freigeschaltete Konten) und zeigt im Formular erkannten Bereich, Zeichenzahl, Textprobe und Kandidaten. Logik in `analyze.ts` spiegelt `auto_root`. Kein JavaScript-Rendering |
| Textfragment-Link | `fragment_url`/`fragmentUrl`: bei Feeds der Eintragslink, sonst die hinzugefügte Zeile mit dem längsten schlichten Textanfang (ohne Sonderzeichen), Fallback die längste |
| Import/Export | Menü „Import / Export“ im Dashboard: Export als YAML oder JSON im `urls.yml`-Format, Import (auch alte `urls.yml`) mit Vorschau, vorhandene URLs werden übersprungen. Globale `defaults` sind nicht enthalten |
| URLs bearbeiten und pausieren | Stift-Button pro URL öffnet ein Formular: Name, Gruppe, Selector (mit Vorschau), JS, `ignore` (Regex pro Zeile, geprüft), `only_added` und Pausieren (`active = false`, Status „Pausiert“, eigener Filter). Unbekannte Optionen bleiben erhalten. Braucht die Policy `admins update urls` |
| Verlauf pro Seite | Uhr-Button (⏱) in der URL-Tabelle öffnet „Letzte Änderungen“ gefiltert auf diese Seite. Die Änderungen kommen komplett aus `watchlist_history` (bis 500), nicht nur aus den letzten 100 insgesamt |
| Filterzustand in der URL | Tab, Gruppe, Status, Zeitraum und Suche stehen im Hash (`#t=changes&g=Azure&s=problem&p=7d&q=…`), bleiben beim Neuladen und sind teilbar. Alte Mail-Links (`#changes:<URL>`) funktionieren weiter |
| Gruppen-Tab erweitert | Reihenfolge (↑/↓), Farbe, Icon, leere Gruppen und „Alle pausieren/fortsetzen“ pro Gruppe. Metadaten liegen in der neuen Tabelle `watchlist_groups` (Block am Ende von `supabase/schema.sql` im SQL-Editor ausführen), ohne sie bleibt der Rest nutzbar |
| Live-Status nach „Jetzt prüfen“ | Das Dashboard fragt alle 5 s den Lauf über die Edge Function ab (wartet/läuft/fertig/Fehler, Link zum Lauf, max. 10 Minuten) und lädt die Daten nach Ende neu, statt fest 90 Sekunden zu warten |
| Anzeige-Einstellungen gemerkt | Tab, Filter und zugeklappte Gruppen liegen in `localStorage` und kommen beim nächsten Besuch zurück. Ein Hash in der URL (geteilter Link) hat Vorrang |
| Änderungshäufigkeit als Sparkline | Neue Spalte „Letzte 30 Tage“ in der URL-Tabelle: Balken pro Tag mit Änderungen, aus `watchlist_history` (bis 5000 Einträge der letzten 30 Tage) |
| Statisches `dashboard.py` entfernt | `check.py` erzeugt kein `site/index.html` mehr, das Web-Dashboard ersetzt es vollständig. Tests, Hooks, CI und Docs angepasst |
| Retry mit Jitter, dauerhafte Fehler | Wartezeit zwischen Wiederholungen bekommt bis zu 25 % Zufall. 404/410 werden sofort als „dauerhafter Fehler“ gemeldet (kein Retry) und lösen die Warn-Mail schon nach 2 statt 3 Läufen aus |
| CONTRIBUTING.md | Setup, Tests, Stil, Daten und Doku-Pflege in `CONTRIBUTING.md`, in der README verlinkt |
| Edge Functions abgesichert | `watchlist-trigger-check` und `watchlist-preview` erlauben CORS nur für `https://jhoelzl.github.io` (und `localhost:5173` für die Entwicklung), fremde Origins bekommen 403. Der Start einer Prüfung ist auf einen pro Minute begrenzt (429) |
| Fehlerserie im Dashboard | Badge „N Läufe in Folge“ bei Fehlern (aus `streak`), ab 6 Läufen „Dauerhaft kaputt“ (gleiche Schwelle wie `STUCK_AFTER` in `check.py`) und neuer Filter „Dauerhaft kaputt“ |
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
