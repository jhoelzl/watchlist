# watchlist

Prüft die Seiten aus `urls.yml` 2x täglich (GitHub Actions) und schickt bei Änderungen eine Sammelmail über Resend.

## Setup
1. Resend-Account anlegen und API-Key erzeugen.
2. Repo → Settings → Secrets and variables → Actions:
   - `RESEND_API_KEY`
   - `MAIL_TO` (ohne eigene Domain: die Adresse deines Resend-Accounts)
   - `MAIL_FROM` (optional, Standard `onboarding@resend.dev`)
3. `urls.yml` pflegen, dann Actions → check → Run workflow (erzeugt die Baselines, keine Mail).

## Lokal testen
```
pip install -r requirements.txt
python check.py
```
Ohne `RESEND_API_KEY` wird die Mail nur ausgegeben.
