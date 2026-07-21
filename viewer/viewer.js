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
  const url = ROOT + relPath.split("/").map(encodeURIComponent).join("/");
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
  // footnote markers [12] -> small marker
  s = s.replace(/\[(\d{1,3})\]/g, '<span class="fnote">[$1]</span>');
  // tate-chu-yoko: 1〜2桁の半角数字を正立(HTML属性/数値実体参照の中は除外)
  s = s.replace(/(?<![\d>#&])(\d{1,2})(?![\d])/g, '<span class="tcy">$1</span>');
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
  const parts = [];
  const tables = [];
  for (const b of blocks) {
    switch (b.type) {
      case "h":
        if (b.level === 1) parts.push(`<h1>${inline(b.text)}</h1>`);
        else parts.push(`<h2>${inline(b.text)}</h2>`);
        break;
      case "callout": parts.push(calloutHTML(b)); break;
      case "table": {
        const idx = tables.length;
        tables.push(b);
        parts.push(`<div data-table="${idx}"></div>`);
        break;
      }
      case "p": if (!/^\s*$/.test(b.text)) parts.push(`<p>${inline(b.text)}</p>`); break;
      case "hr": break;
      case "ul": parts.push("<ul>" + b.items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>"); break;
    }
  }

  const search = el("div", { class: "jiten-search" });
  const input = el("input", { type: "search", placeholder: "名前・原文表記・説明で絞り込み…", "aria-label": "検索" });
  const count = el("div", { class: "jiten-count" });
  search.appendChild(input);

  const body = el("div", { html: parts.join("") });
  // mount tables
  body.querySelectorAll("[data-table]").forEach((slot) => {
    const b = tables[+slot.getAttribute("data-table")];
    slot.replaceWith(buildTable(b));
  });

  const doFilter = () => {
    const q = input.value.trim();
    let shown = 0, total = 0;
    body.querySelectorAll("table").forEach((tbl) => {
      tbl.querySelectorAll("tbody tr").forEach((tr) => {
        total++;
        const text = tr.getAttribute("data-text") || tr.textContent;
        const hit = q === "" || text.toLowerCase().includes(q.toLowerCase());
        tr.style.display = hit ? "" : "none";
        if (hit) shown++;
        // highlight
        if (q && hit) highlightRow(tr, q); else clearHighlight(tr);
      });
    });
    count.textContent = q ? `${shown} 件 / 全 ${total} 件` : `全 ${total} 件`;
  };
  input.addEventListener("input", doFilter);

  wrap.appendChild(body.querySelector("h1") || el("h1", {}, entry.label));
  const h1InBody = body.querySelector("h1");
  if (h1InBody) h1InBody.remove();
  wrap.appendChild(search);
  wrap.appendChild(count);
  wrap.appendChild(body);
  setTimeout(doFilter, 0);
  return wrap;
}

function buildTable(b) {
  const table = el("table");
  const thead = el("thead");
  const htr = el("tr");
  b.header.forEach((h) => htr.appendChild(el("th", {}, h)));
  thead.appendChild(htr);
  const tbody = el("tbody");
  const classes = ["c-name", "c-src", "c-desc", "c-app"];
  b.rows.forEach((row) => {
    const tr = el("tr");
    tr.setAttribute("data-text", row.join(" "));
    row.forEach((cell, ci) => {
      const td = el("td", { class: classes[ci] || "" });
      td.innerHTML = inline(cell);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  return table;
}

function highlightRow(tr, q) {
  clearHighlight(tr);
  const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
  tr.querySelectorAll("td").forEach((td) => {
    if (td.querySelector("a, span.fnote")) return; // 触らない
    if (re.test(td.textContent)) {
      td.innerHTML = td.innerHTML.replace(re, "<mark>$1</mark>");
    }
  });
}
function clearHighlight(tr) {
  tr.querySelectorAll("mark").forEach((m) => {
    const t = document.createTextNode(m.textContent);
    m.replaceWith(t);
  });
  tr.querySelectorAll("td").forEach((td) => td.normalize());
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
  const btnFwd = el("button", { class: "pg-btn", type: "button", "aria-label": "次のページ" }, "◀");
  const btnBack = el("button", { class: "pg-btn", type: "button", "aria-label": "前のページ" }, "▶");
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

  let cur = 0;
  let geo = { step: 1, maxScroll: 0, total: 1 };
  // リーダーを「段数ぴったりの幅」に固定して中央寄せする。1ページ=その幅ぶんを
  // 送るので、段(縦の行)が途中で切れない。
  function layout() {
    const cs = getComputedStyle(article);
    const lh = parseFloat(cs.lineHeight) || 34;               // 縦書きでは行送り=1段の幅(px)
    const avail = (article.parentElement || article).clientWidth || window.innerWidth;
    const margin = avail < 480 ? 12 : 40;
    const cols = Math.max(1, Math.floor((avail - margin * 2) / lh));
    const bandW = cols * lh;
    article.style.width = bandW + "px";                       // 段の整数倍の幅に固定
    const step = article.clientWidth;                         // = bandW(左右パディング0)
    const maxScroll = Math.max(0, article.scrollWidth - article.clientWidth);
    const total = Math.max(1, Math.ceil(article.scrollWidth / step));
    geo = { step, maxScroll, total };
    return geo;
  }
  function applyScroll(smooth) {
    const left = Math.max(-geo.maxScroll, -(cur * geo.step));  // vertical-rl は先頭が 0、左へ進むと負
    article.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }
  function updateUI() {
    pgCount.textContent = `${cur + 1} / ${geo.total}`;
    btnFwd.classList.toggle("edge", cur >= geo.total - 1 && !next);
    btnBack.classList.toggle("edge", cur <= 0 && !prev);
  }
  function go(delta) {
    const target = cur + delta;
    if (target < 0) {            // 先頭より前 → 前の歌の末尾へ
      if (prev) { pendingStart = { book: prev.book, page: 1e9 }; location.hash = `#/wayaku/${prev.book}`; }
      return;
    }
    if (target > geo.total - 1) { // 末尾より先 → 次の歌の先頭へ
      if (next) { pendingStart = { book: next.book, page: 0 }; location.hash = `#/wayaku/${next.book}`; }
      return;
    }
    cur = target;
    applyScroll(true);
    updateUI();
    saveProgress(book, cur, geo.total, entry.heading);
  }
  function relayout() {
    layout();
    cur = clamp(cur, 0, geo.total - 1);
    applyScroll(false);
    updateUI();
  }

  // 初期位置へ
  layout();
  cur = clamp(initialPage, 0, geo.total - 1);
  applyScroll(false);
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
  const hash = location.hash.replace(/^#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts.length === 0) return renderHome();
  if (parts[0] === "wayaku" && parts[1]) return renderWayakuView(parseInt(parts[1], 10));
  if (parts[0] === "jiten" && parts[1]) return renderJitenView(parts[1]);
  return renderHome();
}

/* キーボード: 縦書きリーダーのページ送り(← が「次」)*/
document.addEventListener("keydown", (ev) => {
  if (!pager) return;
  if (ev.key === "ArrowLeft" || ev.key === "ArrowDown" || ev.key === "PageDown" || ev.key === " ") {
    pager.go(+1); ev.preventDefault();
  } else if (ev.key === "ArrowRight" || ev.key === "ArrowUp" || ev.key === "PageUp") {
    pager.go(-1); ev.preventDefault();
  }
});

/* 画面リサイズ・回転で段組みを組み直す */
let _resizeTimer = 0;
window.addEventListener("resize", () => {
  if (!pager) return;
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { if (pager) pager.relayout(); }, 180);
});

async function main() {
  document.getElementById("backBtn").addEventListener("click", () => {
    if (location.hash && location.hash !== "#/") location.hash = "#/";
  });
  document.getElementById("fontDec").addEventListener("click", () => changeFont(-1));
  document.getElementById("fontInc").addEventListener("click", () => changeFont(+1));
  applyFont();
  setBusy("目次を読み込み中…");
  try {
    const res = await fetch(BASE + "manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status + " manifest.json");
    state.manifest = await res.json();
  } catch (e) {
    return setError("目次(manifest.json)の読み込みに失敗しました: " + e.message);
  }
  window.addEventListener("hashchange", route);
  route();
}

main();
