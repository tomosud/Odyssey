import os, re, json, glob

ROOT = "Odyssey"
def frontmatter(path):
    txt = open(path, encoding="utf-8").read()
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", txt, re.S)
    fm = {}
    if m:
        for line in m.group(1).splitlines():
            mm = re.match(r'^([A-Za-z_]+):\s*(.*)$', line)
            if mm:
                k, v = mm.group(1), mm.group(2).strip()
                v = v.strip('"').strip("'")
                fm[k] = v
    return fm

wayaku = []
for path in sorted(glob.glob(f"{ROOT}/02_和訳/*.md")):
    fm = frontmatter(path)
    base = os.path.basename(path)
    num = int(re.match(r"^(\d+)_", base).group(1))
    wayaku.append({
        "book": int(fm.get("book", num)),
        "roman": fm.get("roman", ""),
        "heading": fm.get("heading_ja", ""),
        "file": f"{ROOT}/02_和訳/{base}",
    })
wayaku.sort(key=lambda e: e["book"])

jiten = []
jmap = [("人物索引.md","jinbutsu","人物索引"),("地名・民族索引.md","chimei","地名・民族索引")]
for fname, slug, label in jmap:
    p = f"{ROOT}/04_事典/{fname}"
    if os.path.exists(p):
        jiten.append({"slug": slug, "label": label, "file": p})

manifest = {"title":"オデュッセイア", "subtitle":"Homer / Samuel Butler 英訳からの現代日本語訳", "wayaku": wayaku, "jiten": jiten}
os.makedirs("viewer", exist_ok=True)
json.dump(manifest, open("viewer/manifest.json","w",encoding="utf-8"), ensure_ascii=False, indent=2)
print(json.dumps(manifest, ensure_ascii=False, indent=2))
