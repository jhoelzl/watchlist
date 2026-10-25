import difflib
import re
import urllib.parse

STORE_DIFF_LINES = 500  # so viele Diff-Zeilen werden gespeichert (Dashboard)
DIFF_CONTEXT = 3


def make_diff(old, new, only_added):
    old_l, new_l = old.splitlines(), new.splitlines()
    if only_added:
        seen = set(old_l)
        diff = ["+" + l for l in new_l if l not in seen]
    else:
        diff = [l for l in difflib.unified_diff(old_l, new_l, lineterm="", n=DIFF_CONTEXT) if not l.startswith(("---", "+++"))]
    extra = max(0, len(diff) - STORE_DIFF_LINES)
    return diff[:STORE_DIFF_LINES], extra


PLAIN_SNIPPET = re.compile(r"[\w .,'\-]+")


def feed_entry_link(line):
    """Feed-Zeilen heißen "Datum | Titel | Link | Zusammenfassung": der Eintragslink ist das bessere Ziel."""
    for part in line.split(" | ")[1:]:
        if re.fullmatch(r"https?://\S+", part.strip()):
            return part.strip()
    return ""


def fragment_url(url, diff):
    """Sprungziel zur geänderten Stelle: bei Feeds der Eintragslink, sonst Textfragment (#:~:text=).

    Gewählt wird die hinzugefügte Zeile mit dem längsten Textanfang ohne Sonderzeichen (die sind für das
    Textfragment fehleranfällig), sonst die längste überhaupt.
    """
    added = [line[1:] for line in diff if line.startswith("+") and not line.startswith("+++")]
    for line in added:
        link = feed_entry_link(line)
        if link:
            return link
    best = ("", False)
    for line in added:
        snippet = " ".join(line.split()[:8])[:80].strip()
        if len(snippet) < 8:
            continue
        plain = PLAIN_SNIPPET.fullmatch(snippet) is not None
        if (plain, len(snippet)) > (best[1], len(best[0])):
            best = (snippet, plain)
    if not best[0]:
        return url
    encoded = urllib.parse.quote(best[0], safe="").replace("-", "%2D")
    return f"{url}{':~:text=' if '#' in url else '#:~:text='}{encoded}"


TOKEN = re.compile(r"\s+|\w+|[^\w\s]")


def word_segments(old, new):
    """Teilt zwei ersetzte Zeilen in (Text, geändert)-Stücke, damit nur die tatsächlich geänderten Wörter hervorgehoben werden."""
    a, b = TOKEN.findall(old), TOKEN.findall(new)
    out_old: list[tuple[str, bool]] = []
    out_new: list[tuple[str, bool]] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            out_old.append(("".join(a[i1:i2]), False))
            out_new.append(("".join(b[j1:j2]), False))
        else:
            if i2 > i1:
                out_old.append(("".join(a[i1:i2]), True))
            if j2 > j1:
                out_new.append(("".join(b[j1:j2]), True))
    return out_old, out_new


def annotate_diff(diff):
    """Je Diff-Zeile eine Liste aus (Text, geändert)-Stücken. Aufeinanderfolgende -/+ Blöcke werden zeilenweise verglichen."""
    result: list[list[tuple[str, bool]] | None] = [None] * len(diff)
    i = 0
    while i < len(diff):
        if diff[i].startswith("-"):
            j = i
            while j < len(diff) and diff[j].startswith("-"):
                j += 1
            k = j
            while k < len(diff) and diff[k].startswith("+"):
                k += 1
            for n in range(min(j - i, k - j)):
                old, new = diff[i + n][1:], diff[j + n][1:]
                if difflib.SequenceMatcher(None, old, new, autojunk=False).quick_ratio() >= 0.5:
                    o, w = word_segments(old, new)
                    result[i + n] = [("-", False), *o]
                    result[j + n] = [("+", False), *w]
            i = k
        else:
            i += 1
    return [r if r is not None else [(line, False)] for r, line in zip(result, diff, strict=True)]


def diff_counts(diff):
    return (
        sum(1 for l in diff if l.startswith("+") and not l.startswith("+++")),
        sum(1 for l in diff if l.startswith("-") and not l.startswith("---")),
    )
