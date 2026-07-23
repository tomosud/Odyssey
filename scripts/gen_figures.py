#!/usr/bin/env python3
# image.txt を解析して viewer/figures.json を生成する。
#   figures: {"01": {"title","url"}, ...}
#   byNote:  {"5": ["03","04","02"], ...}  脚注番号 -> 図版番号(表示順)
import re, json, os, subprocess

# image.txt はリポジトリ(main)にある。作業ツリーに無ければ git から取得。
SRC = "image.txt"
if not os.path.exists(SRC):
    txt = subprocess.check_output(["git", "show", "origin/main:image.txt"]).decode("utf-8")
else:
    txt = open(SRC, encoding="utf-8").read()

# 各図版: 番号・題・URL・(本文で挙げられた対応脚注)
figures = {}
fig_notes = {}   # 図版番号 -> [脚注番号...]
for m in re.finditer(r'-{10,}\n図版(\d+)\s+(.*?)\n-{10,}(.*?)(?=\n-{10,}\n図版|\n={10,})', txt, re.S):
    num, name, body = m.group(1), m.group(2).strip(), m.group(3)
    url = re.search(r'(https?://\S+\.(?:jpg|jpeg|png|gif))', body)
    if url:
        figures[num] = {"title": name, "url": url.group(1)}
        fig_notes[num] = re.findall(r'脚注\s*\[(\d+)\]', body)

# 末尾の「脚注→図版」索引を解析
byNote = {}
idx = txt.split("脚注→図版")[-1] if "脚注→図版" in txt else txt
# 「脚注 [N]」ブロックごとに、続く「→ 図版NN」を集める
for blk in re.split(r'\n(?=脚注\s*\[\d+\])', idx):
    mm = re.match(r'\s*脚注\s*\[(\d+)\]', blk)
    if not mm:
        continue
    note = str(int(mm.group(1)))
    figs = re.findall(r'図版(\d+)', blk)
    # 出現順で重複排除
    seen = []
    for f in figs:
        if f in figures and f not in seen:
            seen.append(f)
    if seen:
        byNote[note] = seen

# 各図版本文の「対応脚注」からも補完(索引の取りこぼしを埋める。図版番号順)
for fnum in sorted(figures):
    for note in fig_notes.get(fnum, []):
        note = str(int(note))
        byNote.setdefault(note, [])
        if fnum not in byNote[note]:
            byNote[note].append(fnum)

os.makedirs("viewer", exist_ok=True)
out = {"figures": figures, "byNote": byNote}
json.dump(out, open("viewer/figures.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"figures: {len(figures)}, notes with figures: {len(byNote)}")
print("byNote:", json.dumps(byNote, ensure_ascii=False))
