/* =====================================================================
   オデュッセイア 縦書きビュワー  (dependency-free SPA)
   - 02_和訳 を縦書き(tategaki)で読む
   - 04_事典 を検索できる横書きの索引として読む
   ===================================================================== */
"use strict";

// viewer.js lives in <site>/viewer/ ; derive both dirs from the script URL,
// not from location.href (index.html sits at the site root).
const SCRIPT_SRC = (document.currentScript && document.currentScript.src) ||
  [...document.querySelectorAll("script")].map((s) => s.src).find((s) => /viewer\.js/.test(s)) ||
  new URL("viewer/viewer.js", location.href).href;
const BASE = new URL(".", SCRIPT_SRC).href; // .../viewer/
const ROOT = new URL("../", BASE).href;     // repo root (site root)
// このロードのバージョン(index.html が付与)。fetch のキャッシュ回避に使う。
const V = (typeof window !== "undefined" && window.__ODYSSEY_V__) || Date.now();

const state = { manifest: null };

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid == null) continue;
    n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return n;
};

// Note: apostrophe is intentionally NOT escaped. It is safe in element text
// content, and escaping it to &#39; would let the digit/tcy regex below corrupt
// the numeric entity.
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function fetchText(relPath) {
  const url = ROOT + relPath.split("/").map(encodeURIComponent).join("/") + "?v=" + V;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${relPath}`);
  return res.text();
}

/* ---------------------------------------------------------------------
   Inline markdown -> HTML  (bold, wikilinks, footnote markers, tcy)
   --------------------------------------------------------------------- */
function inline(raw) {
  let s = esc(raw);
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // wikilinks [[target|alias]] / [[target]]
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, target, alias) => {
    const label = alias || target;
    const t = target.trim();
    if (t === "人物索引") return `<a href="#/jiten/jinbutsu">${esc(label)}</a>`;
    if (t === "地名・民族索引") return `<a href="#/jiten/chimei">${esc(label)}</a>`;
    // 原文/脚注 は本ビュワー対象外 → プレーン表示
    return `<span class="wref">${esc(label)}</span>`;
  });
  // footnote markers [12] -> タップできるマーカー(data-fn に番号を保持)
  s = s.replace(/\[(\d{1,3})\]/g, '<a class="fnote" data-fn="$1" role="button" tabindex="0">[$1]</a>');
  // tate-chu-yoko: 1〜2桁の半角数字を正立(HTML属性・数値実体参照の中は除外)
  s = s.replace(/(?<![\d>#&"=])(\d{1,2})(?![\d])/g, '<span class="tcy">$1</span>');
  return s;
}

/* ---------------------------------------------------------------------
   Block markdown parser (headings, hr, callouts, blockquotes, tables,
   lists, paragraphs).  Returns an array of {type, ...}.
   --------------------------------------------------------------------- */
function stripFrontmatter(md) {
  const m = md.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return m ? md.slice(m[0].length) : md;
}

function parseBlocks(md) {
  const lines = stripFrontmatter(md).replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    // horizontal rule
    if (/^-{3,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }

    // heading
    let h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ type: "h", level: h[1].length, text: h[2].trim() }); i++; continue; }

    // blockquote group (includes Obsidian callouts)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^>\s?/.test(lines[i]) || (buf.length && /^\s*$/.test(lines[i]) === false && /^>/.test(lines[i])))) {
        if (!/^>/.test(lines[i])) break;
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const first = buf[0] || "";
      const co = first.match(/^\[!(\w+)\]\s*(.*)$/);
      if (co) {
        blocks.push({
          type: "callout",
          kind: co[1].toLowerCase(),
          title: co[2].trim(),
          body: buf.slice(1),
        });
      } else {
        blocks.push({ type: "quote", body: buf });
      }
      continue;
    }

    // table
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    // list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // paragraph (single line here; source uses blank-line separated paras)
    blocks.push({ type: "p", text: line.trim() });
    i++;
  }
  return blocks;
}

function splitRow(row) {
  let r = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return r.split("|").map((c) => c.trim());
}

/* ---------------------------------------------------------------------
   Renderers
   --------------------------------------------------------------------- */
function calloutHTML(b) {
  const cls = ["info", "note", "tip"].includes(b.kind) ? b.kind : "info";
  const bodyLines = b.body.filter((l) => l.trim() !== "");
  let inner;
  if (bodyLines.some((l) => /^\s*[-*]\s+/.test(l))) {
    inner = "<ul>" + bodyLines
      .filter((l) => /^\s*[-*]\s+/.test(l))
      .map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ""))}</li>`)
      .join("") + "</ul>";
  } else {
    inner = bodyLines.map((l) => `<p>${inline(l)}</p>`).join("");
  }
  const label = b.title || cls.toUpperCase();
  return `<div class="callout callout-${cls}"><p class="callout-title">${esc(label)}</p>${inner}</div>`;
}

/* ---------- 和訳: 縦書き ---------- */
function renderWayaku(md, entry) {
  const blocks = parseBlocks(md);
  const container = el("article", { class: "reader-vertical" });
  const parts = [];
  parts.push(`<p class="book-label">第${entry.book}歌 ・ BOOK ${entry.roman}</p>`);
  for (const b of blocks) {
    switch (b.type) {
      case "h":
        if (b.level === 1) parts.push(`<h1>${inline(b.text.replace(/^第\d+歌\s*/, ""))}</h1>`);
        else parts.push(`<h2>${inline(b.text)}</h2>`);
        break;
      case "hr": parts.push("<hr>"); break;
      case "callout": parts.push(calloutHTML(b)); break;
      case "quote": parts.push(`<blockquote>${b.body.map((l) => `<p>${inline(l)}</p>`).join("")}</blockquote>`); break;
      case "ul": parts.push("<ul>" + b.items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>"); break;
      case "p":
        // drop the obsidian cross-ref nav line (原文 → ... / 脚注 → ...)
        if (/原文\s*→|脚注\s*→/.test(b.text)) {
          const cleaned = inline(b.text);
          parts.push(`<p class="xref">${cleaned}</p>`);
        } else {
          parts.push(`<p>${inline(b.text)}</p>`);
        }
        break;
      case "table": break; // 和訳に表は無い想定
    }
  }
  container.innerHTML = parts.join("");
  return container;
}

/* ---------- 事典: 横書きの検索できる索引 ---------- */
function renderJiten(md, entry) {
  const blocks = parseBlocks(md);
  const wrap = el("div", { class: "jiten-view" });

  const search = el("div", { class: "jiten-search" });
  const input = el("input", { type: "search", placeholder: "名前・原文表記・説明で絞り込み…", "aria-label": "検索" });
  const count = el("div", { class: "jiten-count" });
  search.appendChild(input);

  // タイトル(h1)を取り出す
  let title = entry.label;
  const h1b = blocks.find((b) => b.type === "h" && b.level === 1);
  if (h1b) title = h1b.text;

  const bodyEls = [];
  for (const b of blocks) {
    switch (b.type) {
      case "h":
        if (b.level === 1) break;                 // タイトルは別で表示
        bodyEls.push(el("h2", { html: inline(b.text) }));
        break;
      case "callout": { const d = el("div", { html: calloutHTML(b) }); bodyEls.push(d.firstElementChild || d); break; }
      case "table": bodyEls.push(buildCards(b)); break;
      case "p": if (!/^\s*$/.test(b.text)) bodyEls.push(el("p", { html: inline(b.text) })); break;
      case "ul": { const ul = el("ul"); b.items.forEach((it) => ul.appendChild(el("li", { html: inline(it) }))); bodyEls.push(ul); break; }
      case "hr": break;
    }
  }
  const body = el("div", { class: "jiten-body" });
  bodyEls.forEach((e) => body.appendChild(e));

  const doFilter = () => {
    const q = input.value.trim();
    let shown = 0, total = 0;
    body.querySelectorAll(".entry-card").forEach((card) => {
      total++;
      const text = card.getAttribute("data-text") || card.textContent;
      const hit = q === "" || text.toLowerCase().includes(q.toLowerCase());
      card.style.display = hit ? "" : "none";
      if (hit) shown++;
      clearMarks(card);
      if (q && hit) addMarks(card, q);
    });
    // 空になった見出しは隠す
    body.querySelectorAll(".entry-list").forEach((list) => {
      const anyShown = [...list.querySelectorAll(".entry-card")].some((c) => c.style.display !== "none");
      const h = list.previousElementSibling;
      if (h && h.tagName === "H2") h.style.display = anyShown ? "" : "none";
    });
    count.textContent = q ? `${shown} 件 / 全 ${total} 件` : `全 ${total} 件`;
  };
  input.addEventListener("input", doFilter);

  wrap.appendChild(el("h1", { html: inline(title) }));
  wrap.appendChild(search);
  wrap.appendChild(count);
  wrap.appendChild(body);
  setTimeout(doFilter, 0);
  return wrap;
}

// 事典の各行をスマホで読みやすいカードにする
function buildCards(b) {
  const idx = {};
  b.header.forEach((h, i) => { idx[h.replace(/\s/g, "")] = i; });
  const iName = idx["名前"] ?? 0, iSrc = idx["原文表記"] ?? 1, iDesc = idx["説明"] ?? 2, iApp = idx["登場"] ?? 3;
  const list = el("div", { class: "entry-list" });
  b.rows.forEach((row) => {
    const card = el("div", { class: "entry-card" });
    card.setAttribute("data-text", row.join(" "));
    const head = el("div", { class: "entry-head" }, el("span", { class: "entry-name", html: inline(row[iName] || "") }));
    if (row[iSrc]) head.appendChild(el("span", { class: "entry-src", html: inline(row[iSrc]) }));
    card.appendChild(head);
    if (row[iDesc]) card.appendChild(el("div", { class: "entry-desc", html: inline(row[iDesc]) }));
    if (row[iApp]) {
      card.appendChild(el("div", { class: "entry-app" },
        el("span", { class: "entry-app-label" }, "登場"),
        el("span", { class: "entry-app-val", html: inline(row[iApp]) })
      ));
    }
    list.appendChild(card);
  });
  return list;
}

// 検索ハイライト:テキストノードだけを対象にして tcy/リンクを壊さない
function clearMarks(root) {
  root.querySelectorAll("mark").forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
  root.normalize();
}
function addMarks(root, q) {
  if (!q) return;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeValue && re.test(node.nodeValue)) targets.push(node);
  }
  for (const t of targets) {
    const s = t.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0, m; re.lastIndex = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const mk = document.createElement("mark"); mk.textContent = m[0]; frag.appendChild(mk);
      last = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    t.replaceWith(frag);
  }
}

/* ---------------------------------------------------------------------
   Persistence (IndexedDB) — 読んだ位置を覚える
   --------------------------------------------------------------------- */
const DB_NAME = "odyssey-reader", STORE = "progress";
let _dbPromise = null;
function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((res, rej) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return _dbPromise;
}
async function idbGet(key) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch (e) { return null; }
}
async function idbPut(obj) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const r = db.transaction(STORE, "readwrite").objectStore(STORE).put(obj);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    });
  } catch (e) { return false; }
}
function saveProgress(book, page, total, heading) {
  const now = Date.now();
  idbPut({ key: "wayaku/" + book, type: "wayaku", book, page, total, heading, updatedAt: now });
  idbPut({ key: "__last__", route: "wayaku/" + book, book, page, total, heading, updatedAt: now });
}

/* ---------------------------------------------------------------------
   脚注(Butler原文)— タップで内容を一時表示
   --------------------------------------------------------------------- */
const FOOTNOTES_JSON = BASE + "footnotes.json";     // {n: {ja, en}}
let _fnMap = null, _fnPromise = null;
function loadFootnotes() {
  if (_fnMap) return Promise.resolve(_fnMap);
  if (_fnPromise) return _fnPromise;
  _fnPromise = fetch(FOOTNOTES_JSON + "?v=" + V, { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => { _fnMap = j; return j; })
    .catch(() => ({}));
  return _fnPromise;
}

function ensureFootnotePopup() {
  let ov = document.getElementById("fnOverlay");
  if (ov) return ov;
  ov = el("div", { id: "fnOverlay", class: "fn-overlay", hidden: "" });
  const sheet = el("div", { class: "fn-sheet", role: "dialog", "aria-label": "脚注" });
  const head = el("div", { class: "fn-head" },
    el("span", { class: "fn-num" }, ""),
    el("button", { class: "fn-close", "aria-label": "閉じる", type: "button" }, "×")
  );
  const bodyEl = el("div", { class: "fn-body" }, "");
  sheet.appendChild(head);
  sheet.appendChild(bodyEl);
  ov.appendChild(sheet);
  ov.addEventListener("click", (e) => { if (e.target === ov) closeFootnote(); });
  head.querySelector(".fn-close").addEventListener("click", closeFootnote);
  document.body.appendChild(ov);
  return ov;
}
function closeFootnote() {
  const ov = document.getElementById("fnOverlay");
  if (ov) ov.hidden = true;
}
async function showFootnote(num) {
  const ov = ensureFootnotePopup();
  ov.querySelector(".fn-num").textContent = `脚注 [${num}]`;
  const bodyEl = ov.querySelector(".fn-body");
  bodyEl.textContent = "読み込み中…";
  bodyEl.scrollTop = 0;
  ov.hidden = false;
  const map = await loadFootnotes();
  // 表示中に別の脚注へ切り替わっていないかを確認
  if (ov.hidden || ov.querySelector(".fn-num").textContent !== `脚注 [${num}]`) return;
  const e = map && map[num];
  bodyEl.innerHTML = "";
  if (e && (e.ja || e.en)) {
    if (e.ja) bodyEl.appendChild(el("p", { class: "fn-ja" }, e.ja));
    if (e.en) bodyEl.appendChild(el("p", { class: "fn-en" }, e.en));
  } else {
    bodyEl.textContent = "(この脚注は見つかりませんでした)";
  }
}

/* ---------------------------------------------------------------------
   文字サイズ設定(localStorage)
   --------------------------------------------------------------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FONT_SIZES = [0.92, 1.0, 1.08, 1.18, 1.3, 1.44];
function fontIdx() {
  const v = parseInt(localStorage.getItem("odyssey-fontidx"), 10);
  return isNaN(v) ? 2 : clamp(v, 0, FONT_SIZES.length - 1);
}
function applyFont() {
  document.documentElement.style.setProperty("--reading-size", FONT_SIZES[fontIdx()] + "rem");
}
function changeFont(delta) {
  const i = clamp(fontIdx() + delta, 0, FONT_SIZES.length - 1);
  localStorage.setItem("odyssey-fontidx", String(i));
  applyFont();
  if (pager) pager.relayout();
}

/* ---------------------------------------------------------------------
   Views
   --------------------------------------------------------------------- */
const app = () => document.getElementById("app");
const extra = () => document.getElementById("extra");
let pager = null;            // 現在の和訳リーダーのページャ
let pendingStart = null;     // 章送りで開くときの初期ページ {book, page}

function setReadingMode(on) {
  document.body.classList.toggle("reading", on);
  const fd = document.getElementById("fontDec"), fi = document.getElementById("fontInc");
  if (fd) fd.hidden = !on;
  if (fi) fi.hidden = !on;
}

// ヘッダー/フッターの実寸を測って CSS 変数に反映し、リーダーの高さを
// 画面ぴったりにする(タイトル折り返しやセーフエリアで下が欠けるのを防ぐ)。
function syncChrome() {
  const header = document.querySelector(".app-header");
  const foot = document.querySelector(".page-nav");
  const hh = header ? header.offsetHeight : 52;
  const fh = foot ? foot.offsetHeight : 60;
  document.documentElement.style.setProperty("--header-h", hh + "px");
  document.documentElement.style.setProperty("--footer-h", fh + "px");
}

function setBusy(msg) {
  app().innerHTML = "";
  app().appendChild(el("div", { class: "status-msg" }, msg || "読み込み中…"));
  extra().innerHTML = "";
}
function setError(msg) {
  app().innerHTML = "";
  app().appendChild(el("div", { class: "status-msg error" }, msg));
  extra().innerHTML = "";
}

async function renderHome() {
  pager = null;
  setReadingMode(false);
  document.getElementById("backBtn").hidden = true;
  const m = state.manifest;
  const root = el("div", { class: "home" });

  const hero = el("div", { class: "hero" },
    el("h1", {}, m.title),
    el("p", {}, m.subtitle),
    el("p", {}, "縦書きで読む、ホメロス『オデュッセイア』全24歌")
  );
  root.appendChild(hero);

  // 続きから読む(前回の位置)
  const last = await idbGet("__last__");
  if (last && last.book) {
    const e = m.wayaku.find((x) => x.book === last.book);
    if (e) {
      const pg = (typeof last.page === "number" && last.total)
        ? ` ・ ${last.page + 1} / ${last.total} ページ` : "";
      root.appendChild(el("a", { class: "resume-card", href: `#/wayaku/${e.book}` },
        el("span", { class: "resume-label" }, "続きから読む"),
        el("span", { class: "resume-book" }, `第${e.book}歌${pg}`),
        el("span", { class: "resume-head" }, e.heading)
      ));
    }
  }

  root.appendChild(el("div", { class: "section-title" }, "和訳 — 全24歌(縦書き)"));
  const grid = el("div", { class: "book-grid" });
  m.wayaku.forEach((e) => {
    grid.appendChild(el("a", { class: "book-card", href: `#/wayaku/${e.book}` },
      el("div", { class: "num" }, el("b", {}, `第${e.book}歌`), el("span", {}, `BOOK ${e.roman}`)),
      el("div", { class: "heading" }, e.heading)
    ));
  });
  root.appendChild(grid);

  root.appendChild(el("div", { class: "section-title" }, "事典 — 索引"));
  const jrow = el("div", { class: "jiten-row" });
  m.jiten.forEach((j) => {
    jrow.appendChild(el("a", { class: "jiten-card", href: `#/jiten/${j.slug}` },
      el("b", {}, j.label),
      el("span", {}, "検索できる索引(横書き)")
    ));
  });
  root.appendChild(jrow);

  app().innerHTML = "";
  app().appendChild(root);
  extra().innerHTML = "";
  document.title = `${m.title} — 縦書きビュワー`;
  window.scrollTo(0, 0);
}

async function renderWayakuView(book) {
  const entry = state.manifest.wayaku.find((e) => e.book === book);
  if (!entry) return setError("その歌は見つかりませんでした。");
  pager = null;
  closeFootnote();
  loadFootnotes();                 // 脚注を先読み(タップ時に即表示)
  setReadingMode(true);
  document.getElementById("backBtn").hidden = false;
  setBusy(`第${book}歌 を読み込み中…`);

  let md;
  try { md = await fetchText(entry.file); }
  catch (e) { setReadingMode(false); return setError("読み込みに失敗しました: " + e.message); }

  const article = renderWayaku(md, entry);
  app().innerHTML = "";
  app().appendChild(article);

  const list = state.manifest.wayaku;
  const idx = list.findIndex((e) => e.book === book);
  const prev = list[idx - 1], next = list[idx + 1];

  // ---- フッター: ページ送り(縦書きは左が「次」)----
  const btnNextCh = next
    ? el("a", { class: "ch-link", href: `#/wayaku/${next.book}` }, "◀ 次の歌")
    : el("span", { class: "ch-link disabled" }, "　");
  const btnPrevCh = prev
    ? el("a", { class: "ch-link", href: `#/wayaku/${prev.book}` }, "前の歌 ▶")
    : el("span", { class: "ch-link disabled" }, "　");
  const btnFwd = el("button", { class: "pg-btn to-next", type: "button", "aria-label": "次のページ" }, "◀");
  const btnBack = el("button", { class: "pg-btn to-prev", type: "button", "aria-label": "前のページ" }, "▶");
  const pgTitle = el("div", { class: "pg-title" }, `第${book}歌 ${entry.heading.split(" — ")[0]}`);
  const pgCount = el("div", { class: "pg-count" }, "");
  const nav = el("div", { class: "page-nav" },
    btnNextCh,
    btnFwd,
    el("div", { class: "pg-center" }, pgTitle, pgCount),
    btnBack,
    btnPrevCh
  );
  extra().innerHTML = "";
  extra().appendChild(nav);
  syncChrome();  // リーダー高さをヘッダー/フッターの実寸に合わせる
  document.title = `第${book}歌 — ${state.manifest.title}`;

  // ---- 初期ページ(章送り指定 > 保存位置 > 先頭)----
  let initialPage = 0;
  if (pendingStart && pendingStart.book === book) { initialPage = pendingStart.page; pendingStart = null; }
  else {
    const saved = await idbGet("wayaku/" + book);
    if (saved && typeof saved.page === "number") initialPage = saved.page;
  }
  // フォント確定後にレイアウトを測る(縦書きの行送り=段の幅)
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}

  let cur = 0;                                  // 現在ページ番号(表示・保存用)
  let geo = { cw: 1, lh: 34, maxScroll: 0, total: 1 };

  // リーダー幅を段(縦の行)の整数倍に固定して中央寄せ。
  // 行送りを整数pxに固定するのが要点:端末のピクセル丸めで段位置が少しずつ
  // ずれて深いページで累積するのを防ぐ。
  function computeGeo() {
    article.style.lineHeight = "";                            // 現フォントの自然な行送りを読む
    const raw = parseFloat(getComputedStyle(article).lineHeight) || 34;
    const lh = Math.max(1, Math.round(raw));                  // 整数pxに固定
    article.style.lineHeight = lh + "px";
    const avail = (article.parentElement || article).clientWidth || window.innerWidth;
    const margin = avail < 480 ? 12 : 40;
    const cols = Math.max(1, Math.floor((avail - margin * 2) / lh));
    article.style.width = cols * lh + "px";
    // 見出しは字が大きく段幅が本文と違うため、以降の段グリッドがずれる。
    // 見出しの行送りを基準段幅(lh)の整数倍に丸め、グリッドを保つ。
    const heads = article.querySelectorAll("h1, h2");
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      h.style.lineHeight = "";
      const nat = parseFloat(getComputedStyle(h).lineHeight) || lh;
      h.style.lineHeight = Math.max(1, Math.round(nat / lh)) * lh + "px";
    }
    snapBoxesToGrid(lh);   // コールアウト・箇条書き等の箱を基準グリッドに合わせる
    const cw = article.clientWidth;
    const maxScroll = Math.max(0, article.scrollWidth - cw);
    const total = Math.max(1, Math.round(maxScroll / cw) + 1);
    geo = { cw, lh, maxScroll, total };
  }

  // コールアウトや箇条書きの箱は、左右(段方向)の枠・パディング・余白が段幅の
  // 整数倍でないため、箱の中の段と箱の後ろの本文が基準グリッドからずれて端で切れる。
  // 箱を「グリッドに透明」にする:右余白で(枠+右パディング)を、左余白で箱全体の
  // 幅を、それぞれ段幅の整数倍に丸める。箱の中身は段幅の整数倍で組まれているので、
  // これで箱の中の段も箱の後ろの本文も基準グリッドに乗り続ける。
  function snapBoxesToGrid(lh) {
    const boxes = article.querySelectorAll(":scope > .callout, :scope > blockquote, :scope > ul, :scope > hr");
    boxes.forEach((box) => {
      box.style.marginRight = "";
      box.style.marginLeft = "";
      const cs = getComputedStyle(box);
      const startFixed = (parseFloat(cs.borderRightWidth) || 0) + (parseFloat(cs.paddingRight) || 0);
      const mR = ((lh - (startFixed % lh)) % lh);
      box.style.marginRight = mR + "px";          // 箱の中の先頭段を段境界に合わせる
      const total = mR + box.offsetWidth;         // = 余白 + 枠 + パディング + 中身(段幅の整数倍)
      const mL = ((lh - (total % lh)) % lh);
      box.style.marginLeft = mL + "px";           // 箱の終端を段境界に合わせる
    });
  }

  // いまの表示位置で、本文の段グリッドを画面右端へぴったり合わせる。
  // 段の位相(右端からの距離を行送りで割った余り)の最頻値=本文の主グリッドを
  // 採用し、見出し・コールアウト・縦中横など少数派のズレに惑わされないようにする。
  function alignHere() {
    const aRect = article.getBoundingClientRect();
    const lh = geo.lh;
    const minH = article.clientHeight * 0.5;                  // 段らしい高い矩形だけ
    const range = document.createRange();
    range.selectNodeContents(article);
    const rects = range.getClientRects();
    const buckets = new Map();
    let bestKey = 0, bestCount = -1;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.height < minH) continue;
      let ph = (aRect.right - r.right) % lh;
      ph = ((ph % lh) + lh) % lh;                             // [0, lh)
      const key = Math.round(ph) % lh;
      const c = (buckets.get(key) || 0) + 1;
      buckets.set(key, c);
      if (c > bestCount) { bestCount = c; bestKey = key; }
    }
    if (bestCount <= 0) return;
    let target = bestKey;
    if (target > lh / 2) target -= lh;                        // 0 にいちばん近い段境界へ [-lh/2, lh/2]
    if (Math.abs(target) > 0.5 && Math.abs(target) <= lh) {
      // scrollLeft を +δ すると位相は +δ 変化する。位相 target を 0 にするには -target。
      article.scrollLeft = Math.min(0, Math.max(-geo.maxScroll, article.scrollLeft - target));
    }
  }

  function gotoScroll(target) {
    target = Math.min(0, Math.max(-geo.maxScroll, target));
    article.scrollLeft = target;  // 同期で反映(直後に段合わせを実測するため)
    alignHere();
    cur = clamp(geo.cw > 0 ? Math.round(-article.scrollLeft / geo.cw) : 0, 0, geo.total - 1);
  }
  function updateUI() {
    const atEnd = article.scrollLeft <= -geo.maxScroll + 1;
    const atStart = article.scrollLeft >= -1;
    if (atEnd && next) pgCount.textContent = `最終ページ ・ 次の歌へ ◀`;
    else pgCount.textContent = `${cur + 1} / ${geo.total}`;
    nav.classList.toggle("at-end", atEnd && !!next);
    nav.classList.toggle("at-start", atStart && !!prev);
    btnFwd.classList.toggle("edge", atEnd && !next);
    btnBack.classList.toggle("edge", atStart && !prev);
  }
  function go(delta) {
    if (delta > 0 && article.scrollLeft <= -geo.maxScroll + 1) { // 末尾 → 次の歌
      if (next) { pendingStart = { book: next.book, page: 0 }; location.hash = `#/wayaku/${next.book}`; }
      return;
    }
    if (delta < 0 && article.scrollLeft >= -1) {                 // 先頭 → 前の歌の末尾
      if (prev) { pendingStart = { book: prev.book, page: 1e9 }; location.hash = `#/wayaku/${prev.book}`; }
      return;
    }
    gotoScroll(article.scrollLeft - delta * geo.cw);            // 進む=より負へ
    updateUI();
    saveProgress(book, cur, geo.total, entry.heading);
  }
  function relayout() {
    syncChrome();
    const frac = geo.maxScroll > 0 ? (-article.scrollLeft / geo.maxScroll) : 0;
    computeGeo();
    gotoScroll(-(frac * geo.maxScroll));
    updateUI();
  }

  // 初期位置へ
  computeGeo();
  gotoScroll(-(clamp(initialPage, 0, geo.total - 1) * geo.cw));
  updateUI();
  saveProgress(book, cur, geo.total, entry.heading);

  // ---- 操作: ボタン ----
  btnFwd.addEventListener("click", () => go(+1));
  btnBack.addEventListener("click", () => go(-1));

  // ---- 操作: ホイール(縦回転→ページ送り、連射を抑制)----
  let wheelLock = 0;
  article.addEventListener("wheel", (ev) => {
    const d = Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ? ev.deltaY : ev.deltaX;
    ev.preventDefault();
    const now = Date.now();
    if (now < wheelLock || Math.abs(d) < 6) return;
    wheelLock = now + 240;
    go(d > 0 ? +1 : -1);
  }, { passive: false });

  // ---- 操作: スワイプ / 端タップ ----
  let tsx = 0, tsy = 0, moved = false;
  article.addEventListener("touchstart", (ev) => {
    const t = ev.touches[0]; tsx = t.clientX; tsy = t.clientY; moved = false;
  }, { passive: true });
  article.addEventListener("touchmove", (ev) => {
    const t = ev.touches[0];
    if (Math.abs(t.clientX - tsx) > 10 || Math.abs(t.clientY - tsy) > 10) moved = true;
  }, { passive: true });
  article.addEventListener("touchend", (ev) => {
    const t = ev.changedTouches[0];
    const dx = t.clientX - tsx, dy = t.clientY - tsy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? +1 : -1); // 左スワイプ=次へ
  }, { passive: true });
  article.addEventListener("click", (ev) => {
    if (moved) { moved = false; return; }
    const fn = ev.target.closest(".fnote");                   // 脚注マーカー → 内容を表示
    if (fn) { ev.preventDefault(); showFootnote(fn.getAttribute("data-fn")); return; }
    if (ev.target.closest("a")) return;                       // リンクは通常遷移
    const sel = window.getSelection && window.getSelection().toString();
    if (sel && sel.length > 0) return;                        // 文字選択中は無視
    const r = article.getBoundingClientRect();
    const x = ev.clientX - r.left;
    if (x < r.width * 0.32) go(+1);                           // 左端タップ=次へ(左へ進む)
    else if (x > r.width * 0.68) go(-1);                      // 右端タップ=戻る
  });

  pager = { go, relayout };
}

async function renderJitenView(slug) {
  const entry = state.manifest.jiten.find((j) => j.slug === slug);
  if (!entry) return setError("その索引は見つかりませんでした。");
  pager = null;
  setReadingMode(false);
  document.getElementById("backBtn").hidden = false;
  setBusy(`${entry.label} を読み込み中…`);
  try {
    const md = await fetchText(entry.file);
    const view = renderJiten(md, entry);
    app().innerHTML = "";
    app().appendChild(view);
    extra().innerHTML = "";
    document.title = `${entry.label} — ${state.manifest.title}`;
    window.scrollTo(0, 0);
  } catch (e) {
    setError("読み込みに失敗しました: " + e.message);
  }
}

/* ---------------------------------------------------------------------
   Router
   --------------------------------------------------------------------- */
function route() {
  closeFootnote();
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return renderHome();
  if (parts[0] === "wayaku" && parts[1]) return renderWayakuView(parseInt(parts[1], 10));
  if (parts[0] === "jiten" && parts[1]) return renderJitenView(parts[1]);
  return renderHome();
}

/* キーボード: 縦書きリーダーのページ送り(← が「次」)*/
document.addEventListener("keydown", (ev) => {
  const ov = document.getElementById("fnOverlay");
  if (ov && !ov.hidden) {                    // 脚注表示中は Esc で閉じる/ページ送りしない
    if (ev.key === "Escape") { closeFootnote(); ev.preventDefault(); }
    return;
  }
  if (!pager) return;
  if (ev.key === "ArrowLeft" || ev.key === "ArrowDown" || ev.key === "PageDown" || ev.key === " ") {
    pager.go(+1); ev.preventDefault();
  } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "PageUp") {
    pager.go(-1); ev.preventDefault();
  }
});

/* 画面リサイズ・回転・ツールバー開閉で段組みを組み直す */
let _resizeTimer = 0;
function onViewportChange() {
  if (!pager) return;
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { if (pager) pager.relayout(); }, 180);
}
window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", onViewportChange);
if (window.visualViewport) window.visualViewport.addEventListener("resize", onViewportChange);

async function main() {
  document.getElementById("backBtn").addEventListener("click", () => {
    if (location.hash && location.hash !== "#/") location.hash = "#/";
  });
  document.getElementById("fontDec").addEventListener("click", () => changeFont(-1));
  document.getElementById("fontInc").addEventListener("click", () => changeFont(+1));
  applyFont();
  setBusy("目次を読み込み中…");
  try {
    const res = await fetch(BASE + "manifest.json?v=" + V, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status + " manifest.json");
    state.manifest = await res.json();
  } catch (e) {
    return setError("目次(manifest.json)の読み込みに失敗しました: " + e.message);
  }
  window.addEventListener("hashchange", route);
  route();
}

main();
