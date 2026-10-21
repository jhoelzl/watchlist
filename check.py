import difflib
import hashlib
import os
import re
import sys
from pathlib import Path

import requests
import yaml
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent
STATE = ROOT / "state"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "de,en;q=0.8",
}


def extract_text(html, selector, ignore):
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg"]):
        tag.decompose()
    root = soup
    if selector:
        root = soup.select_one(selector)
        if root is None:
            raise ValueError(f"Selector nicht gefunden: {selector}")
    lines = [re.sub(r"\s+", " ", l).strip() for l in root.get_text("\n").splitlines()]
    text = "\n".join(l for l in lines if l)
    for pattern in ignore:
        text = re.sub(pattern, "", text)
    return text


def send_mail(subject, body):
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        print("RESEND_API_KEY fehlt, Mail wird nur ausgegeben:\n", body)
        return
    r = requests.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "from": os.environ.get("MAIL_FROM", "onboarding@resend.dev"),
            "to": [os.environ["MAIL_TO"]],
            "subject": subject,
            "text": body,
        },
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"Resend {r.status_code}: {r.text}")
    print(f"Mail gesendet: {subject} (Resend-ID {r.json().get('id')})")


def main():
    STATE.mkdir(exist_ok=True)
    entries = yaml.safe_load((ROOT / "urls.yml").read_text()) or []
    changes, errors = [], []

    print(f"Prüfe {len(entries)} URL(s)...")
    for e in entries:
        url = e["url"] if isinstance(e, dict) else e
        opts = e if isinstance(e, dict) else {}
        name = hashlib.sha1(url.encode()).hexdigest()[:16]
        snap = STATE / f"{name}.txt"
        fail = STATE / f"{name}.fail"
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            text = extract_text(resp.text, opts.get("selector"), opts.get("ignore", []))
        except Exception as ex:
            n = int(fail.read_text()) + 1 if fail.exists() else 1
            fail.write_text(str(n))
            print(f"[FEHLER]    {url} (Versuch {n} in Folge): {ex}")
            if n == 3:
                errors.append(f"{url}: {ex}")
            continue
        fail.unlink(missing_ok=True)

        if not snap.exists():
            print(f"[NEU]       {url} (Baseline gespeichert, {len(text)} Zeichen)")
        else:
            old = snap.read_text()
            if old == text:
                print(f"[UNVERÄNDERT] {url} ({len(text)} Zeichen)")
            else:
                print(f"[GEÄNDERT]  {url} ({len(old)} -> {len(text)} Zeichen)")
                diff = "\n".join(
                    list(
                        difflib.unified_diff(
                            old.splitlines(), text.splitlines(), lineterm="", n=1
                        )
                    )[:60]
                )
                changes.append(f"{url}\n{diff}")
        snap.write_text(text)

    if changes:
        print(f"Sende Änderungs-Mail an {os.environ.get('MAIL_TO', '?')}...")
        send_mail(
            f"Watchlist: {len(changes)} Seite(n) geändert",
            "\n\n==========\n\n".join(changes),
        )
    if errors:
        send_mail(
            "Watchlist: Abruf schlägt dauerhaft fehl",
            "3 Fehlversuche in Folge:\n\n" + "\n".join(errors),
        )
    print(f"{len(entries)} geprüft, {len(changes)} geändert, {len(errors)} Fehler")


if __name__ == "__main__":
    sys.exit(main())
