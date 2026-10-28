"""Make the tags in Appwrite match the tag names on the website.

The website's tags are the SUBS / SSC lists in each topic page (algebra.html etc.).
Tags in the database that don't match one of those get renamed to the closest match.
If that name already exists, the questions are moved onto it and the old tag is removed.

Needs APPWRITE_API_KEY in .env.local (scopes: rows.read + rows.write).

    python scripts/sync-tags.py           # dry run: only prints what would change
    python scripts/sync-tags.py --apply   # backs up to backups/, then makes the changes
    add --delete-unused to also delete tags with no match that no question uses
"""
import ast, difflib, json, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT, PROJECT_ID, DB_ID = 'https://sgp.cloud.appwrite.io/v1', '69f87cc5001ba9cd97e5', 'public'
PAGES = ['algebra', 'geometry', 'combinatorics', 'number-theory', 'problem-solving']
# Renames too different for best_match to find: (category, old name) -> new name
MANUAL = {('Problem Solving', 'Mentality'): 'Competition mentality'}


def load_key():
    env = ROOT / '.env.local'
    for line in env.read_text(encoding='utf-8').splitlines() if env.exists() else []:
        k, _, v = line.partition('=')
        if k.strip() == 'APPWRITE_API_KEY' and v.strip():
            return v.strip().strip('"\'')
    sys.exit('Put APPWRITE_API_KEY=<your key> in .env.local first.')


KEY = load_key()


def api(method, path, body=None):
    req = urllib.request.Request(ENDPOINT + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'X-Appwrite-Project': PROJECT_ID, 'X-Appwrite-Key': KEY, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {path} failed: {e.code} {e.read().decode()}')


def list_all(collection):
    docs, cursor = [], None
    while True:
        qs = [json.dumps({'method': 'limit', 'values': [100]})]
        if cursor: qs.append(json.dumps({'method': 'cursorAfter', 'values': [cursor]}))
        page = api('GET', f'/tablesdb/{DB_ID}/tables/{collection}/rows?'
                   + '&'.join('queries[]=' + urllib.parse.quote(q) for q in qs))['rows']
        docs += page
        if len(page) < 100: return docs
        cursor = page[-1]['$id']


def site_tags():
    """{category: set of tag names} exactly as the website builds them."""
    out = {}
    for p in PAGES:
        h = (ROOT / f'{p}.html').read_text(encoding='utf-8')
        cat = re.search(r"TOPIC_NAME\s*=\s*'([^']+)'", h).group(1)
        subs = ast.literal_eval(re.search(r'SUBS\s*=\s*(\[.*?\]);', h, re.S).group(1))
        ssc = ast.literal_eval(re.sub(r'\b(structure|technique)\s*:', r"'\1':",
                               re.search(r'SSC\s*=\s*(\{.*?\n\s*\});', h, re.S).group(1)))
        names = set(subs)
        for s in subs:
            for t in ('structure', 'technique'):
                names |= {f'{s}::{n}::{t}' for n in ssc.get(s, {}).get(t, [])}
        out[cat] = names
    return out


def norm(s): return re.sub(r'[^a-z0-9:]', '', s.lower())


def best_match(name, valid):
    """Same name ignoring case/punctuation, else the closest name of the same kind."""
    same_kind = [v for v in valid if v.count('::') == name.count('::')]
    for v in same_kind:
        if norm(v) == norm(name): return v
    m = difflib.get_close_matches(name, same_kind, n=1, cutoff=0.75)
    return m[0] if m else None


def main():
    apply, delete_unused = '--apply' in sys.argv, '--delete-unused' in sys.argv
    valid = site_tags()
    tags, links = list_all('tags'), list_all('question_tags')
    uses = {}
    for l in links: uses.setdefault(l['tag_id'], []).append(l)
    by_name = {(t['category'], t['name']): t for t in tags}

    plan, unmatched = [], []
    for t in tags:
        ok = valid.get(t['category'])
        if ok is None or t['name'] in ok: continue
        target = MANUAL.get((t['category'], t['name'])) or best_match(t['name'], ok)
        (plan if target else unmatched).append((t, target))
    unused = [t for t, _ in unmatched if not uses.get(t['$id'])] if delete_unused else []

    print(f'{len(tags)} tags in Appwrite, {len(plan)} to fix, {len(unmatched)} with no match.\n')
    for t, target in plan:
        how = 'merge into existing' if (t['category'], target) in by_name else 'rename'
        print(f"  [{t['category']}] {t['name']!r} -> {target!r}  ({how}, {len(uses.get(t['$id'], []))} questions)")
    if unmatched:
        print('\nNo match on the website:')
        for t, _ in unmatched:
            fate = 'delete' if t in unused else 'left alone'
            print(f"  [{t['category']}] {t['name']!r}  ({len(uses.get(t['$id'], []))} questions, {fate})")

    if not apply or not (plan or unused):
        if plan or unused: print('\nDry run only. Run with --apply to make these changes.')
        return

    backup = ROOT / 'backups' / f'tags-{time.strftime("%Y%m%d-%H%M%S")}.json'
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(json.dumps({'tags': tags, 'question_tags': links}, indent=1), encoding='utf-8')
    print(f'\nBacked up to {backup.relative_to(ROOT)}')

    base = f'/tablesdb/{DB_ID}/tables'
    for t, target in plan:
        existing = by_name.get((t['category'], target))
        if not existing:
            api('PATCH', f"{base}/tags/rows/{t['$id']}", {'data': {'name': target}})
            by_name[(t['category'], target)] = t
            continue
        already = {l['question_id'] for l in uses.get(existing['$id'], [])}
        for l in uses.get(t['$id'], []):
            if l['question_id'] in already:
                api('DELETE', f"{base}/question_tags/rows/{l['$id']}")
            else:
                api('PATCH', f"{base}/question_tags/rows/{l['$id']}", {'data': {'tag_id': existing['$id']}})
        api('DELETE', f"{base}/tags/rows/{t['$id']}")
    for t in unused:
        api('DELETE', f"{base}/tags/rows/{t['$id']}")
    print('Done.')


if __name__ == '__main__':
    main()
