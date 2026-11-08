// app.js — 搜尋頁（PLAN_WEBSITE W1.5：調號搜尋／POJ 輸入式／條目編號）
// ＋ DESIGN_SEARCH 2026-07-10：詞組形式搜尋（§5 chips/form: 語法）＋內文搜尋（§4 zh/tw/pj/jp 分組）
// 依賴：assets/poj_converter.js 需先載入（parsePoj 單一真相＝review_live 版，build 自動同步）
// 詞目索引欄位見 export_site_data.py：id/kanji/kana/kana_norm/poj/poj_ascii/poj_plain/summary/status/page/seg/form
// 內文索引：data/search/manifest.json ＋ c/content-*.json（{id, zh/tw/pj/jp: [[tag,text(,plain)]],
//   fm: [[tag,sig,pos,len,漢字段(,來源詞目id)]]}——例句 POJ 詞形片段，DESIGN_SEARCH §5.4）
'use strict';

/* ══════════ 純函數（node 可測；勿在此區碰 DOM） ══════════ */

function hira2kata(s) {
  return s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}
function stripDia(s) {
  return s.normalize('NFD').replace(/[̀-ͯ͘]/g, '')
          .replace(/ⁿ/g, 'n').toLowerCase();
}
function normKanaQ(s) {
  return hira2kata(s).replace(/[·̄̅\s0-9a-zA-Z\-ー]/g, '').replace(/ヰ/g, 'イ').replace(/ヱ/g, 'エ').replace(/ヤ/g, 'ア'); // ヰ視同イ（2026-07-22）；ヱ視同エ（2026-08-12 K248th，查詢端漏補、M025 補齊）；ヤ視同ア（M025 2026-09-10）——與 export kana_norm 同步
}
function hasCJK(s) { return /[㐀-鿿豈-﫿□々]/.test(s); }
// 混合缺字表頭：□ 逐位以對應 POJ 音節取代（□□哭 → āuⁿ āuⁿ 哭；2026-07-12 夥伴回饋補充）
// 音節數與字位數不合（IDS 等）＝不替換照舊；全 □ 走 isBlankKanji（POJ 主位）不經此
function mixKanjiParts(kanji, poj) {
  kanji = String(kanji || '');
  if (kanji.indexOf('□') < 0) return null;
  const units = [...kanji];
  if (units.every(u => u === '□' || u === '々')) return null;
  const syls = String(poj || '').split(/-+/).filter(Boolean);
  if (!syls.length || syls.length !== units.length) return null;
  return units.map((u, i) => u === '□' ? { t: syls[i], pj: true } : { t: u, pj: false });
}

// 全 □（殘字）表頭：主位改顯 POJ（2026-07-12 夥伴回饋；々 跟前字同視為空位）
function isBlankKanji(s) {
  s = String(s || '');
  let blank = false;
  for (const ch of s) {
    if (ch === '□') { blank = true; continue; }
    if (ch === '々') continue;
    return false;
  }
  return blank;
}
function hasKana(s) { return /[ぁ-ゖァ-ヺ]/.test(s); }
function hasLatinLoose(s) { return /[a-z]/.test(stripDia(s)); }   // á â ā a̍ 也算拉丁輸入

// ── POJ token 正規化（查詢與索引共用同一條路） ──
const TONE_MARK_RE = /[́̀̂̄̍̋̆̌]/;

function canonTok(raw) {
  let s = (raw || '').trim();
  if (!s) return null;
  const hasDigit = /[1-8]/.test(s);
  const hasMark = TONE_MARK_RE.test(s.normalize('NFD'));
  s = s.replace(/([1-8])(nn|ⁿ)$/i, '$2$1');         // a3nn → ann3（數字位置容錯）
  let p = null;
  try { p = parsePoj(s); } catch (e) { p = null; }
  if (!p) return null;
  const body = p.onset + p.vowels.join('') + p.final;
  if (!body) return null;
  return { body: body, tone: (hasDigit || hasMark) ? p.tone : 0,
           nasal: !!p.nasal, expl: (hasDigit || hasMark) };
}
function canonToks(str) {
  return String(str || '').split(/[-\s]+/).map(canonTok).filter(Boolean);
}

// token 比對：2=同調（strict）、1=異調（body 同、調或鼻音異）、0=不合
function tokMatch(q, t) {
  if (q.body !== t.body) return 0;
  const toneOK = (q.tone === 0) || (q.tone === t.tone);
  const nasalOK = (q.nasal === t.nasal) || (!q.nasal && !q.expl);
  return (toneOK && nasalOK) ? 2 : 1;
}

// 連續 token 子序列比對 → {kind:'strict'|'loose', at} | null
function seqMatch(qToks, iToks) {
  if (!qToks.length || !iToks.length || qToks.length > iToks.length) return null;
  let loose = null;
  for (let st = 0; st + qToks.length <= iToks.length; st++) {
    let min = 2;
    for (let k = 0; k < qToks.length; k++) {
      const m = tokMatch(qToks[k], iToks[st + k]);
      if (m === 0) { min = 0; break; }
      if (m < min) min = m;
    }
    if (min === 2) return { kind: 'strict', at: st };
    if (min === 1 && !loose) loose = { kind: 'loose', at: st };
  }
  return loose;
}

// ── 條目編號查詢 ──
// 規則：有 p 前綴＝掃描頁（p0052-1-01；p52 亦可）；無 p＝書頁，自動 +51 換算
//（0001-上-01／0001-1-01／0001 → p0052…）。段可用 123 或 上中下；序可不補零。
// 純數字無段序時須 ≥3 位（避免打字途中誤觸發）。
const SEGMAP = { '上': '1', '中': '2', '下': '3' };
function parseIdQuery(qRaw) {
  const s = qRaw.trim();
  let m = s.match(/^p(\d{1,4})(?:-([123上中下]))?(?:-(\d{1,3}))?$/i);
  let page;
  if (m) {
    page = m[1].padStart(4, '0');                                   // 掃描頁
  } else {
    m = s.match(/^(\d{1,4})(?:-([123上中下]))?(?:-(\d{1,3}))?$/);   // 書頁 → +51
    if (!m) return null;
    if (!m[2] && !m[3] && m[1].length < 3) return null;
    page = String(parseInt(m[1], 10) + 51).padStart(4, '0');
  }
  const seg = m[2] ? (SEGMAP[m[2]] || m[2]) : null;
  const num = m[3] || null;
  let prefix = 'p' + page;
  if (seg) {
    prefix += '-' + seg;
    if (num) prefix += '-' + num.padStart(2, '0');
  }
  return { full: !!(seg && num), prefix: prefix };
}

// ── 查詢上下文（每次輸入算一次） ──
function buildQueryCtx(qRaw) {
  const q = qRaw.trim();
  const ctx = { q: q, idQ: null, cjk: false, kana: false, latin: false,
                qk: '', qplain: '', qToks: [], toned: false };
  if (!q) return ctx;
  ctx.idQ = parseIdQuery(q);
  ctx.cjk = hasCJK(q);
  ctx.kana = hasKana(q);
  ctx.latin = hasLatinLoose(q);
  if (ctx.kana) ctx.qk = normKanaQ(q);
  if (ctx.latin) {
    ctx.qplain = stripDia(q).replace(/[^a-z]/g, '');
    ctx.qToks = canonToks(q);
    ctx.toned = ctx.qToks.length > 0 && ctx.qToks.some(t => t.expl);
  }
  return ctx;
}

// 索引條目快取 token
function entryToks(e) {
  if (!e._toks) e._toks = canonToks(e.poj_ascii || '');
  return e._toks;
}

/* ── 詞組形式搜尋（DESIGN_SEARCH §5） ── */

const FORM_RE = /(?:^|\s)form[:：]\s*([A-Za-z]{2,4})(?=\s|$)/;

// 'form:AAB 甜' → {form:'AAB', rest:'甜'}；無 form: → {form:null, rest:原字串}
function parseFormQuery(qRaw) {
  const m = String(qRaw || '').match(FORM_RE);
  if (!m) return { form: null, rest: String(qRaw || '') };
  return { form: m[1].toUpperCase(),
           rest: String(qRaw).replace(FORM_RE, ' ').trim() };
}

// 疊字符展開：〳〵/〱/々 → 前一字（含字比對用；IDS 序列以尾字近似，§5.3）
function expandIterK(s) {
  s = String(s || '').replace(/〳〵/g, '々').replace(/〱/g, '々');
  let out = '';
  let prev = '';
  for (const ch of s) {
    if (ch === '々' && prev) out += prev;
    else { out += ch; prev = ch; }
  }
  return out;
}

// 詞形過濾：e.form 全等 ＋（空查詢｜含漢字｜POJ 音節相符｜一般比對）
function formMatch(e, ctx, form) {
  if (!e.form || e.form !== form) return false;
  if (!ctx.q) return true;
  if (ctx.idQ) return e.id.startsWith(ctx.idQ.prefix);
  if (ctx.cjk) {
    return e.kanji.includes(ctx.q) || expandIterK(e.kanji).includes(ctx.q);
  }
  if (ctx.latin && ctx.qToks.length === 1) {
    const qt = ctx.qToks[0];
    const need = qt.expl ? 2 : 1;               // 帶調＝同調；無調＝body（＋鼻音旗標寬鬆）
    return entryToks(e).some(t => tokMatch(qt, t) >= need);
  }
  return !!matchEntry(e, ctx, 'fuzzy');
}

/* ── 內文搜尋（DESIGN_SEARCH §4）：欄位權重／徽章／掃描／摘錄 ── */

function contentWeight(field, tag) {
  if ((tag || '').charAt(0) === 'r') return 6;                 // 參照
  const isGloss = /^s\d+$/.test(tag || '');
  if (field === 'zh') return isGloss ? 0 : 1;                  // 中譯釋義 > 中譯例句/註
  if (field === 'tw') return 2;                                // 例句台文
  if (field === 'jp') return isGloss ? 3 : 4;                  // 日釋 > 日文例句/註
  return 5;                                                    // 例句 POJ
}

function contentBadge(field, tag) {
  if ((tag || '').charAt(0) === 'r') return field === 'zh' ? '參照註' : '參照';
  const isGloss = /^s\d+$/.test(tag || '');
  const isNote = /n\d+$/.test(tag || '');
  if (field === 'zh') return isGloss ? '中譯釋義' : (isNote ? '中譯註' : '中譯例句');
  if (field === 'jp') return isGloss ? '日釋' : (isNote ? '日文註' : '日文例句');
  if (field === 'tw') return '例句台文';
  return '例句POJ';
}

// 單一內文條目掃描 → 最佳命中 {field, tag, text, pos, len, w} | null
// 路由（§4.3）：漢字→zh/tw/jp 子字串；假名→jp（正規化後）；拉丁→pj plain
function contentScan(ce, ctx) {
  let best = null;
  const take = h => { if (!best || h.w < best.w) best = h; };
  if (ctx.cjk) {
    for (const f of ['zh', 'tw', 'jp']) {
      for (const row of ce[f] || []) {
        const pos = row[1].indexOf(ctx.q);
        if (pos >= 0) take({ field: f, tag: row[0], text: row[1],
                             pos: pos, len: ctx.q.length, w: contentWeight(f, row[0]) });
      }
    }
    return best;
  }
  if (ctx.kana && ctx.qk) {
    for (const row of ce.jp || []) {
      if (normKanaQ(row[1]).indexOf(ctx.qk) >= 0) {
        take({ field: 'jp', tag: row[0], text: row[1], pos: -1, len: 0,
               w: contentWeight('jp', row[0]) });
      }
    }
    return best;
  }
  if (ctx.latin && ctx.qplain) {
    for (const row of ce.pj || []) {
      if ((row[2] || '').indexOf(ctx.qplain) >= 0) {
        take({ field: 'pj', tag: row[0], text: row[1], pos: -1, len: 0,
               w: contentWeight('pj', row[0]) });
      }
    }
    return best;
  }
  return best;
}

/* ── 內文詞形命中（DESIGN_SEARCH §5.4）：例句 POJ 疊詞片段 ── */

// 詞形片段 vs 查詢：空＝過；漢字＝漢字段含字（々展開）；
// 單 POJ 音節＝tokMatch（帶調同調、無調寬鬆）；其他拉丁＝片段純字母子字串；假名＝不合
function formSpanMatch(spanText, kanji, ctx) {
  if (!ctx.q) return true;
  if (ctx.cjk) {
    const kj = kanji || '';
    return kj.includes(ctx.q) || expandIterK(kj).includes(ctx.q);
  }
  if (ctx.latin && ctx.qToks.length === 1) {
    const qt = ctx.qToks[0];
    const need = qt.expl ? 2 : 1;               // 帶調＝同調；無調＝body 寬鬆
    return canonToks(spanText).some(t => tokMatch(qt, t) >= need);
  }
  if (ctx.latin && ctx.qplain) {
    return stripDia(spanText).replace(/[^a-z]/g, '').includes(ctx.qplain);
  }
  return false;
}

// 內文條目 → 詞形命中列（每例句每形式一列；span 取第一個符合查詢者）
// ce.fm 列：[tag, sig, pos, len, 漢字段(, 來源詞目id)]
function contentFormMatch(ce, ctx, form) {
  if (!ce.fm || !ce.fm.length) return [];
  if (ctx.idQ && !ce.id.startsWith(ctx.idQ.prefix)) return [];
  const fctx = ctx.idQ ? { q: '' } : ctx;       // 編號查詢＝已過濾條目，不再比片段
  const out = [];
  const done = new Set();
  for (const r of ce.fm) {
    if (r[1] !== form || done.has(r[0])) continue;
    const pjrow = (ce.pj || []).find(p => p[0] === r[0]);
    if (!pjrow) continue;
    const spanText = pjrow[1].slice(r[2], r[2] + r[3]);
    if (!formSpanMatch(spanText, r[4], fctx)) continue;
    done.add(r[0]);
    out.push({ tag: r[0], text: pjrow[1], pos: r[2], len: r[3], src: r[5] || null });
  }
  return out;
}

// 摘錄窗（±rad 字）；pos<0（正規化比對，無法定位）→ 只截頭
function snippet(text, pos, len, rad) {
  rad = rad || 20;
  text = String(text || '');
  if (pos < 0) {
    return { pre: text.length > 60 ? text.slice(0, 60) + '…' : text, hit: '', post: '' };
  }
  const a = Math.max(0, pos - rad);
  const b = Math.min(text.length, pos + len + rad);
  return { pre: (a > 0 ? '…' : '') + text.slice(a, pos),
           hit: text.slice(pos, pos + len),
           post: text.slice(pos + len, b) + (b < text.length ? '…' : '') };
}

// ── 主比對：回 {tier, other} | null ──
// tier：7=編號全中、6=編號前綴、5=精確、4=起首、3=包含、1=異調
function matchEntry(e, ctx, mode) {
  if (!ctx.q) return null;
  if (ctx.idQ) {
    if (ctx.idQ.full && e.id === ctx.idQ.prefix) return { tier: 7, other: false };
    if (!ctx.idQ.full && e.id.startsWith(ctx.idQ.prefix)) return { tier: 6, other: false };
    return null;                                    // 編號型查詢不混其他比對
  }
  const qlow = ctx.q.toLowerCase();

  if (mode === 'exact') {
    if (ctx.cjk && e.kanji === ctx.q) return { tier: 5, other: false };
    if (ctx.kana && ctx.qk) {
      const kq = hira2kata(ctx.q).replace(/\s/g, '');
      if (e.kana.replace(/\s/g, '') === kq) return { tier: 5, other: false };
      if (!/[1-8]/.test(kq) && e.kana_norm === ctx.qk) return { tier: 5, other: false };
    }
    if (ctx.latin) {
      if (ctx.toned) {
        const it = entryToks(e);
        if (it.length === ctx.qToks.length) {
          const r = seqMatch(ctx.qToks, it);
          if (r && r.kind === 'strict' && r.at === 0) return { tier: 5, other: false };
        }
      } else {
        if (e.poj.normalize('NFC') === qlow.normalize('NFC') ||
            stripDia(e.poj).replace(/-/g, '') === stripDia(qlow).replace(/-/g, '')) {
          return { tier: 5, other: false };
        }
      }
    }
    return null;
  }

  // fuzzy
  let best = null;
  const take = (tier, other) => {
    if (!best || tier > best.tier) best = { tier: tier, other: !!other };
  };
  if (ctx.cjk) {
    if (e.kanji.startsWith(ctx.q)) take(4);
    else if (e.kanji.includes(ctx.q)) take(3);
  }
  if (ctx.kana && ctx.qk) {
    if (e.kana_norm.startsWith(ctx.qk)) take(4);
    else if (e.kana_norm.includes(ctx.qk)) take(3);
  }
  if (ctx.latin) {
    if (ctx.toned) {
      const r = seqMatch(ctx.qToks, entryToks(e));
      if (r) {
        if (r.kind === 'strict') take(r.at === 0 ? 4 : 3);
        else take(1, true);
      }
    } else if (ctx.qplain) {
      if (e.poj_plain.startsWith(ctx.qplain)) take(4);
      else if (e.poj_plain.includes(ctx.qplain)) take(3);
    }
  }
  return best;
}

/* ── 腔口組（DESIGN_SEARCH §4.6；C429／U242，站主 M069_X3 §四）── */
// 查詢字→全稱表不在前端另抄：export `dial_query_table()` 經 index.json 頂層 `dial_query` 交來；
// 條目側比對鍵＝index 條目 `dial_full`（表頭各段＋參照槽級腔口註記之全稱，export `dial_search_keys`）。
// 只認全等（去前後空白）：表內的短寫／全稱／全稱去「腔」才觸發；「安」「腔」「漳音」等不在表內＝不觸發。
function dialQueryFull(q, table) {
  const k = String(q || '').trim();
  return (table && k && Object.prototype.hasOwnProperty.call(table, k)) ? table[k] : '';
}
// 腔口組命中：任一段全稱相符即中；組內照條目編號序（不跨組去重——組數即全庫該腔口條數）
function dialCollect(index, full) {
  if (!full) return [];
  return (index || []).filter(e => (e.dial_full || []).indexOf(full) >= 0)
    .sort((a, b) => (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));
}
// 結果分組順序（§4.4／§4.6）：詞目→內文→腔口（最後一組）
const RESULT_GROUPS = ['entry', 'content', 'dial'];
// 腔口組外框：預設收合（open 只在使用者本查詢已點開時才帶）、只露標題與數量
function dialGroupHTML(n, open) {
  return `<details class="dialgrp"${open ? ' open' : ''}>` +
    `<summary class="group-hd">腔口符合（${n} 條）</summary><ul class="dialrows"></ul></details>`;
}

/* ══════════ 以下 DOM（瀏覽器限定） ══════════ */

if (typeof document !== 'undefined') {

  let INDEX = [];
  let DIALQ = {};                       // C429：腔口查詢字→全稱（index.json 頂層 dial_query）
  let DIAL_OPEN = '';                   // C429：使用者點開腔口組時的全稱（分片陸續到齊重繪時保持展開）
  let META = {};
  let BYID = new Map();                 // id → {e, ord}（內文命中顯示詞目用）
  let FORM = '';                        // 詞形 chip 狀態（''＝未啟用）
  let mode = 'fuzzy';
  let timer = null;
  const CSTATE = { status: 'idle', entries: [], done: 0, total: 0 };   // 內文索引

  const $q = s => document.querySelector(s);

  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // 主位組：漢字→POJ（全□＝POJ 主位、□ 退次要；混合□＝逐位 POJ 取代）——2026-07-12 夥伴回饋
  const mixHTML = parts => parts.map(x =>
    x.pj ? `<span class="pjsub">${escH(x.t)}</span>` : escH(x.t)).join('');
  const headSpans = e => {
    // 腔口升表頭（2026-07-25 rid 115）：index.dial → POJ 右側淺色（腔）
    const dial = e.dial ? `<span class="dial">（${escH(e.dial)}）</span>` : '';
    if (isBlankKanji(e.kanji)) {
      return `<span class="hz pjhz">${escH(e.poj)}</span>${dial}<span class="dimk">${escH(e.kanji)}</span>`;
    }
    const mix = mixKanjiParts(e.kanji, e.poj);
    const hz = mix ? mixHTML(mix) : escH(e.kanji_disp || e.kanji);
    return `<span class="hz">${hz}</span><span class="pj">${escH(e.poj)}</span>${dial}`;
  };

  const rowHTML = (e, m) => {
    const skel = e.status === 'skeleton';
    return `<a class="row${m.other ? ' othertone' : ''}" href="entry.html?id=${encodeURIComponent(e.id)}">` +
      headSpans(e) +
      `<span class="kn">${escH(e.kana)}</span>` +
      (e.form ? `<span class="badge form">${escH(e.form)}</span>` : '') +
      (m.other ? '<span class="badge other">異調</span>' : '') +
      (skel ? '<span class="badge skel">內容建置中</span>'
            : '<span class="badge">完整</span>') +
      `<span class="eid">${escH(e.id)}</span>` +
      `<button type="button" class="reportbtn rowreport" data-id="${escH(e.id)}" title="回報這條資料的問題">回報錯誤</button>` +
      (skel || !e.summary ? '' : `<span class="sm">${escH(e.summary)}</span>`) +
      '</a>';
  };

  const contentRowHTML = hit => {
    const rec = BYID.get(hit.id);
    if (!rec) return '';
    const e = rec.e;
    const sn = snippet(hit.text, hit.pos, hit.len);
    const snipHTML = escH(sn.pre) +
      (sn.hit ? `<mark>${escH(sn.hit)}</mark>` : '') + escH(sn.post);
    return `<a class="row crow" href="entry.html?id=${encodeURIComponent(e.id)}">` +
      headSpans(e) +
      `<span class="kn">${escH(e.kana)}</span>` +
      (hit.sig ? `<span class="badge form">${escH(hit.sig)}</span>` : '') +
      `<span class="badge fld">${escH(contentBadge(hit.field, hit.tag))}</span>` +
      `<span class="eid">${escH(e.id)}</span>` +
      `<button type="button" class="reportbtn rowreport" data-id="${escH(e.id)}" title="回報這條資料的問題">回報錯誤</button>` +
      `<span class="sm snip">${snipHTML}</span>` +
      '</a>';
  };

  // ── 回報（2026-07-17 站主需求：搜尋頁也要有回報入口；線上直送 /api/feedback、失敗退回複製） ──
  let reportId = '';
  const openReport = id => {
    reportId = id;
    $q('#reportctx').textContent = `【回報】條目 ${id}／區塊：搜尋列表`;
    $q('#reporttext').value = '';
    try { $q('#reportname').value = localStorage.getItem('tjss_reporter') || ''; } catch (e) {}
    $q('#reportbox').classList.add('on');
  };
  const fallbackCopy = async txt => {
    try {
      await navigator.clipboard.writeText(txt);
      alert('線上送出暫時不可用，回報內容已複製——請把這段文字用 LINE 或 Email 傳給站主，謝謝！');
    } catch (e) {
      prompt('請手動複製以下回報內容：', txt);
    }
  };
  const sendReport = async () => {
    const note = $q('#reporttext').value.trim();
    if (!note) { alert('請先描述問題內容。'); return; }
    const reporter = $q('#reportname').value.trim();
    try { localStorage.setItem('tjss_reporter', reporter); } catch (e) {}
    const rec = { source: 'online', ts: new Date().toISOString(), id: reportId,
                  block: '搜尋列表', note: note, reporter: reporter };
    let okd = false;
    try {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      okd = r.ok && (await r.json()).ok === true;
    } catch (e) { okd = false; }
    if (okd) {
      alert('已送出，感謝回報！');
    } else {
      await fallbackCopy(`【回報】條目 ${reportId}／區塊：搜尋列表\n回報者：${reporter}\n說明：${note}`);
    }
    $q('#reportbox').classList.remove('on');
  };

  const hintLi = (ul, html) => {
    const li = document.createElement('li');
    li.className = 'hint';
    li.innerHTML = html;
    ul.appendChild(li);
  };

  const contentStateText = () => {
    if (CSTATE.status === 'loading') return `內文索引載入中（${CSTATE.done} 片）…`;
    if (CSTATE.status === 'error') return '內文索引載入失敗';
    return '';
  };

  // ── 主渲染：條目組（現行邏輯）＋內文組（§4.4 分組不混排）＋腔口組（§4.6，最後一組、預設收合） ──
  const render = (list, ctx, chits, dhits, dfull) => {
    const ul = $q('#results');
    const st = $q('#stats');
    ul.innerHTML = '';
    dhits = dhits || [];
    if (!ctx.q && !FORM) {
      st.textContent = META.total
        ? `收錄 ${META.total} 條（完整 ${META.complete}・建置中 ${META.skeleton}）` : '';
      return;
    }
    const cload = contentStateText();
    if (!list.length && !(chits && chits.length) && !dhits.length) {
      st.textContent = '查無結果' + (cload ? `（${cload}）` : '');
      hintLi(ul, '查無結果。可以試試：改用<b>模糊</b>模式、拿掉調號（如 a 代替 á）、' +
        '檢查輸入式（a5＝â、ann3＝àⁿ、oo2＝ó͘）、或用條目編號（如 p0052-1-01）。');
      return;
    }
    const nStrict = list.filter(x => !x.m.other).length;
    const nOther = list.length - nStrict;
    let stat = FORM
      ? `詞形 ${FORM}：條目 ${list.length}・內文 ${(chits || []).length}`
      : (ctx.toned
        ? `條目 ${list.length}（同調 ${nStrict}・異調 ${nOther}）`
        : `條目 ${list.length}`);
    if (!FORM && chits && chits.length) stat += `・內文 ${chits.length}`;
    if (dhits.length) stat += `・腔口 ${dhits.length}`;
    if (cload && (FORM || (ctx.q && mode === 'fuzzy'))) stat += `・${cload}`;
    st.textContent = stat;

    const groups = {
      entry: () => {
        const frag = document.createDocumentFragment();
        for (const hit of list.slice(0, 200)) {
          const li = document.createElement('li');
          li.innerHTML = rowHTML(hit.e, hit.m);
          frag.appendChild(li);
        }
        ul.appendChild(frag);
        if (list.length > 200) hintLi(ul, '條目僅顯示前 200 條，請縮小關鍵字。');
      },
      content: () => {
        if (chits && chits.length) {
          const hd = document.createElement('li');
          hd.className = 'group-hd';
          hd.textContent = `內文符合（${chits.length} 條）`;
          ul.appendChild(hd);
          const cfrag = document.createDocumentFragment();
          for (const h of chits.slice(0, 100)) {
            const li = document.createElement('li');
            li.innerHTML = contentRowHTML(h);
            cfrag.appendChild(li);
          }
          ul.appendChild(cfrag);
          if (chits.length > 100) hintLi(ul, '內文僅顯示前 100 條，請縮小關鍵字。');
        } else if ((FORM || (ctx.q && mode === 'fuzzy')) && CSTATE.status === 'error') {
          hintLi(ul, '內文索引載入失敗。<a href="#" id="cretry">重新載入內文索引</a>');
        }
      },
      dial: () => {
        if (!dhits.length) return;
        const li = document.createElement('li');
        li.className = 'dialgrp-li';
        const open = DIAL_OPEN === dfull;
        li.innerHTML = dialGroupHTML(dhits.length, open);
        const det = li.querySelector('details');
        const fill = () => {                 // 點開才畫列（收合時不畫＝單字「漳」數百條也不拖慢打字）
          const box = det.querySelector('.dialrows');
          if (box.childElementCount) return;
          box.innerHTML = dhits.map(e => `<li>${rowHTML(e, { tier: 0, other: false })}</li>`).join('');
        };
        if (open) fill();
        det.addEventListener('toggle', () => {
          DIAL_OPEN = det.open ? dfull : '';
          if (det.open) fill();
        });
        ul.appendChild(li);
      },
    };
    for (const g of RESULT_GROUPS) groups[g]();
  };

  // ── 內文命中收集（模糊模式限定；排除已在條目組者；欄位權重→冊序） ──
  const collectContent = (ctx, seenIds) => {
    if (mode !== 'fuzzy' || FORM || !ctx.q || ctx.idQ) return [];
    if (!CSTATE.entries.length) return [];
    const hits = [];
    for (const ce of CSTATE.entries) {
      if (seenIds.has(ce.id)) continue;
      const h = contentScan(ce, ctx);
      if (h) {
        const rec = BYID.get(ce.id);
        hits.push({ id: ce.id, ord: rec ? rec.ord : 1e9,
                    field: h.field, tag: h.tag, text: h.text,
                    pos: h.pos, len: h.len, w: h.w });
      }
    }
    hits.sort((a, b) => (a.w - b.w) || (a.ord - b.ord));
    return hits;
  };

  const syncURL = (qRaw, effForm) => {
    const p = new URLSearchParams();
    if (qRaw.trim()) p.set('q', qRaw.trim());
    if (effForm) p.set('form', effForm);
    const qs = p.toString();
    history.replaceState(null, '', qs ? ('?' + qs) : location.pathname);
  };

  const updateChips = effForm => {
    document.querySelectorAll('#formchips button').forEach(b =>
      b.classList.toggle('on', b.dataset.form === effForm));
  };

  const doSearch = () => {
    const raw = $q('#q').value;
    const fq = parseFormQuery(raw);
    const effForm = fq.form || FORM;
    const ctx = buildQueryCtx(fq.form ? fq.rest : raw);
    syncURL(raw, effForm);
    updateChips(effForm);
    if (effForm) {
      const hits = [];
      for (const e of INDEX) {
        if (formMatch(e, ctx, effForm)) hits.push({ e: e, m: { tier: 3, other: false } });
      }
      FORM = effForm;                    // form: 語法回寫 chip 狀態
      const chits = [];                  // 內文組：例句詞形片段（§5.4）
      for (const ce of CSTATE.entries) {
        for (const h of contentFormMatch(ce, ctx, effForm)) {
          const rec = BYID.get(ce.id);
          chits.push({ id: ce.id, ord: rec ? rec.ord : 1e9, field: 'pj',
                       tag: h.tag, text: h.text, pos: h.pos, len: h.len,
                       w: 5, sig: effForm });
        }
      }
      chits.sort((a, b) => a.ord - b.ord);
      if (CSTATE.status === 'idle') loadContent();   // chip 先於閒置預抓時主動載
      render(hits, ctx, chits);
      return;
    }
    const hits = [];
    for (const e of INDEX) {
      const m = matchEntry(e, ctx, mode);
      if (m) hits.push({ e: e, m: m });
    }
    hits.sort((a, b) => b.m.tier - a.m.tier);       // 同 tier 保持冊序
    const seen = new Set(hits.map(h => h.e.id));
    // C429（§4.6）：腔口組——精確／模糊兩模式都出（查詢字全等才觸發）；編號查詢不出
    const dfull = ctx.idQ ? '' : dialQueryFull(ctx.q, DIALQ);
    if (dfull !== DIAL_OPEN) DIAL_OPEN = '';        // 換了腔口（或不再是腔口查詢）＝回到預設收合
    render(hits, ctx, collectContent(ctx, seen), dialCollect(INDEX, dfull), dfull);
  };

  // ── 內文索引：閒置預抓、逐片漸進、失敗可重試（§4.5） ──
  const loadContent = async () => {
    if (CSTATE.status === 'loading' || CSTATE.status === 'ready') return;
    CSTATE.status = 'loading';
    try {
      const man = await (await fetch('data/search/manifest.json')).json();
      CSTATE.total = man.total || 0;
      for (const s of man.shards || []) {
        const d = await (await fetch('data/search/' + s.file)).json();
        for (const ce of d.entries || []) CSTATE.entries.push(ce);
        CSTATE.done += 1;
        if ($q('#q').value.trim() || FORM) doSearch();   // 分片到齊一片補一片
      }
      CSTATE.status = 'ready';
    } catch (e) {
      CSTATE.status = 'error';
    }
    if ($q('#q').value.trim() || FORM) doSearch();
  };

  const buildChips = () => {
    const box = $q('#formchips');
    if (!box) return;
    const forms = META.forms || {};
    const cf = META.cforms || {};                  // 例句層計數（§5.4）
    const tot = {};
    for (const k in forms) tot[k] = (tot[k] || 0) + forms[k];
    for (const k in cf) tot[k] = (tot[k] || 0) + cf[k];
    const pref = ['AA', 'AAB', 'ABB', 'AABB', 'ABAB'];
    const names = pref.filter(f => tot[f])
      .concat(Object.keys(tot).filter(f => pref.indexOf(f) < 0).sort());
    if (!names.length) { box.style.display = 'none'; return; }
    box.innerHTML = '<span class="chiplabel">疊詞形式：</span>' + names.map(f =>
      `<button type="button" data-form="${escH(f)}">${escH(f)}` +
      `<span class="cnt">${tot[f]}</span></button>`).join('') +
      '<span class="chiphint">點選後輸入單一漢字或 POJ 音節可過濾；不輸入＝瀏覽全部（計數含條目與例句）</span>';
    box.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const f = b.dataset.form;
        FORM = (FORM === f) ? '' : f;
        const fq = parseFormQuery($q('#q').value);
        if (fq.form) $q('#q').value = fq.rest;     // 清掉輸入框的 form: 語法避免打架
        doSearch();
        $q('#q').focus();
      });
    });
  };

  const init = async () => {
    try {
      const rs = await Promise.all([fetch('data/index.json'), fetch('data/meta.json')]);
      const ij = await rs[0].json();
      INDEX = ij.entries;
      DIALQ = ij.dial_query || {};           // C429：舊資料無此鍵＝腔口組不出（不報錯）
      META = await rs[1].json();
    } catch (e) {
      $q('#stats').textContent = '索引載入失敗（請經由本機伺服器開啟，不能直接雙擊檔案）';
      return;
    }
    BYID = new Map(INDEX.map((e, i) => [e.id, { e: e, ord: i }]));
    $q('#stats').textContent =
      `收錄 ${META.total} 條（完整 ${META.complete}・建置中 ${META.skeleton}）` +
      `・資料版本 ${META.generated}`;
    buildChips();
    $q('#q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(doSearch, 150);
    });
    $q('#q').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        const first = document.querySelector('#results a.row');
        if (first) location.href = first.getAttribute('href');
      }
    });
    document.querySelectorAll('.mode button').forEach(b => {
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        document.querySelectorAll('.mode button').forEach(x =>
          x.classList.toggle('on', x === b));
        doSearch();
      });
    });
    $q('#results').addEventListener('click', ev => {
      const rb = ev.target.closest && ev.target.closest('.rowreport');
      if (rb) {                              // 回報鈕在 <a> 內：擋導航、開回報框
        ev.preventDefault();
        ev.stopPropagation();
        openReport(rb.dataset.id);
        return;
      }
      if (ev.target && ev.target.id === 'cretry') {
        ev.preventDefault();
        CSTATE.status = 'idle';
        loadContent();
      }
    });
    if ($q('#reportsend')) {
      $q('#reportsend').addEventListener('click', sendReport);
      $q('#reportcancel').addEventListener('click', () => $q('#reportbox').classList.remove('on'));
    }
    const params = new URLSearchParams(location.search);
    if (params.get('form')) FORM = params.get('form').toUpperCase();
    if (params.get('q')) $q('#q').value = params.get('q');
    if (params.get('q') || FORM) doSearch();
    $q('#q').focus();
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 1200));
    idle(() => loadContent());                     // 閒置預抓內文索引
  };
  document.addEventListener('DOMContentLoaded', init);
}

/* node 測試掛鉤 */
if (typeof globalThis !== 'undefined') {
  globalThis.__searchTest = { canonTok: canonTok, canonToks: canonToks, tokMatch: tokMatch,
                              seqMatch: seqMatch, parseIdQuery: parseIdQuery,
                              buildQueryCtx: buildQueryCtx, matchEntry: matchEntry,
                              stripDia: stripDia, isBlankKanji: isBlankKanji, mixKanjiParts: mixKanjiParts,
                              parseFormQuery: parseFormQuery, expandIterK: expandIterK,
                              formMatch: formMatch, contentWeight: contentWeight,
                              contentBadge: contentBadge, contentScan: contentScan,
                              snippet: snippet, normKanaQ: normKanaQ,
                              formSpanMatch: formSpanMatch,
                              contentFormMatch: contentFormMatch,
                              dialQueryFull: dialQueryFull, dialCollect: dialCollect,
                              RESULT_GROUPS: RESULT_GROUPS, dialGroupHTML: dialGroupHTML };
}
