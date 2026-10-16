#!/usr/bin/env python3
"""CareHub audit of the pinned web source. Writes reports into an output dir."""
import json, os, re, sys
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
files = []
for root, dirs, fs in os.walk(os.path.join(src, 'src')):
    dirs[:] = [d for d in dirs if d not in ('__tests__', 'node_modules', '__mocks__')]
    for f in fs:
        if f.endswith(('.ts', '.tsx')) and '.test.' not in f and '.spec.' not in f and '.stories.' not in f:
            files.append(os.path.join(root, f))
files.sort()
# 1) API calls
url_re = re.compile(r"[`'\"](/?api/[^`'\"]*)[`'\"]")
meth_re = re.compile(r"\.(get|post|put|patch|delete)\s*(<|\()", re.I)
api = {}
for p in files:
    lines = open(p, encoding='utf-8', errors='replace').read().split('\n')
    for i, line in enumerate(lines):
        for m in url_re.finditer(line):
            u = m.group(1)
            u = '/' + u.lstrip('/')
            u = re.sub(r"\$\{[^}]*\}", "{}", u).split('?')[0]
            window = '\n'.join(lines[i:i + 14])
            methods = sorted(set(x.group(1).upper() for x in meth_re.finditer(window)))
            key = u
            e = api.setdefault(key, {'methods': set(), 'files': set()})
            e['methods'].update(methods or ['?'])
            e['files'].add(os.path.relpath(p, src))
with open(os.path.join(out, 'web-api.txt'), 'w') as f:
    for u in sorted(api):
        e = api[u]
        f.write(f"{u}\t{','.join(sorted(e['methods']))}\t{' '.join(sorted(e['files']))[:300]}\n")
# 2) Branding / social in translations
social = re.compile(r"twitter|x\.com|discord|reddit|youtube|linkedin|facebook|instagram|follow us|github\.com|appflowy\.(io|com)", re.I)
tr = os.path.join(src, 'src/@types/translations/en.json')
def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f"{path}.{k}" if path else k)
    elif isinstance(o, str):
        yield path, o
brand = []
if os.path.exists(tr):
    for k, v in walk(json.load(open(tr, encoding='utf-8'))):
        if re.search('appflowy', v, re.I) or social.search(v):
            brand.append(f"{k}\t{v}")
with open(os.path.join(out, 'web-brand-translations.txt'), 'w') as f:
    f.write('\n'.join(brand) + '\n')
# 3) Hardcoded visible text / links in components
code_hits = []
lit = re.compile(r"(>[^<>{}]*AppFlowy[^<>{}]*<)|(['\"`][^'\"`]*(AppFlowy|appflowy\.(io|com)|twitter\.com|x\.com/|discord\.(gg|com)|reddit\.com|youtube\.com|github\.com/AppFlowy)[^'\"`]*['\"`])")
for p in files:
    for i, line in enumerate(open(p, encoding='utf-8', errors='replace')):
        s = line.strip()
        if s.startswith(('import ', 'export ', '//', '*', '/*')) or "from '@appflowy" in s:
            continue
        if lit.search(s):
            code_hits.append(f"{os.path.relpath(p, src)}:{i+1}\t{s[:220]}")
with open(os.path.join(out, 'web-brand-code.txt'), 'w') as f:
    f.write('\n'.join(code_hits) + '\n')
# 4) Other places: index.html, public/
other = []
for root, dirs, fs in os.walk(os.path.join(src, 'public')):
    for fn in fs:
        other.append('public/' + os.path.relpath(os.path.join(root, fn), os.path.join(src, 'public')))
with open(os.path.join(out, 'web-public-files.txt'), 'w') as f:
    f.write('\n'.join(sorted(other)) + '\n')
print(f"api={len(api)} brand_tr={len(brand)} brand_code={len(code_hits)}")
