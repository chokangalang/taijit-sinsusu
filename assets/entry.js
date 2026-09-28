// entry.js — 詳細頁渲染（PLAN_WEBSITE W1.5）
// 三區塊：(a) 現代化對照（POJ＋日文中譯）、(b) 原冊數位化（照印）、(c) 原冊書影 crop
// W1.5：上一條/下一條導覽（鍵盤 ←→）＋本機校對模式（localhost 雙擊編輯→POST /feedback）
// 資料：data/entries/{page}.json（一頁一檔，DESIGN_SEARCH §6.1；entries[id] 取條目，含 prev/next）
'use strict';

const $ = s => document.querySelector(s);
const LOCAL = (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
// 圖床基底（PLAN_WEBSITE 裁決 5／S0）：本機校對走本地 img/（圖床伺服器），
// 線上走 R2 公開網址。R2_BASE 由 S0 部署時填入；空字串＝退回站內 img/（git 圖）。
const R2_BASE = 'https://pub-71b2d9166d2e4a9aa42c76a5f89a94a2.r2.dev/';
const IMG_BASE = (LOCAL || !R2_BASE) ? 'img/' : R2_BASE;

function ellipCenter(s) {
  // fid14（2026-07-13 裁決）：U+2026「…」為文學/一般文本正字（非 ⋯ 數學符號），依中文排版慣例顯示置中；
  // 僅顯示層以 .ellip 上抬，底本字元不動。輸入須為已 esc 之字串（… 非 HTML 特殊字元，安全）。
  return s.indexOf('\u2026') < 0 ? s : s.replace(/\u2026+/g, m => `<span class="ellip">${m}</span>`);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// 組字式（IDS）判定：⿰⿱⿸… 起首＝原書合字無碼位（J50 D5 2026-07-14 夥伴回饋 fid18/20）
function isIdsUnit(s) {
  s = String(s || '');
  if (s.length < 2) return false;
  const c = s.codePointAt(0);
  return c >= 0x2FF0 && c <= 0x2FFF;
}

// 全 □（殘字）表頭：主位改顯 POJ（2026-07-12 夥伴回饋；與 app.js 同規）
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

// 混合缺字：□ 逐位以對應 POJ 音節取代（□□哭 → āuⁿ āuⁿ 哭）；kanji_units＝IDS 感知字位
function mixKanjiParts(units, poj) {
  if (!units || units.indexOf('□') < 0) return null;
  if (units.every(u => u === '□' || u === '々')) return null;
  const syls = String(poj || '').split(/-+/).filter(Boolean);
  if (!syls.length || syls.length !== units.length) return null;
  return units.map((u, i) => u === '□' ? { t: syls[i], pj: true } : { t: u, pj: false });
}
function mixHTML(parts) {
  return parts.map(x => x.pj ? `<span class="pjsub">${esc(x.t)}</span>` : esc(x.t)).join('');
}

// ── ruby 渲染 ───────────────────────────────────────────
function annBox(cls, attr, base, ann) {
  return `<span class="rb ${cls}"${attr}><span class="ann">${ann}</span>${base}</span>`;
}

function rubyOrig(unit) {
  if (!unit.r) return ellipCenter(esc(unit.u));
  const r = unit.r;
  let rt = esc(r.k) + (r.tn ? `<sup class="tn">${esc(r.tn)}</sup>` : '');
  let cls = r.lang === 'tw' ? 'tw' : 'jp';
  let attr = '';
  let base = esc(unit.u);
  if (r.ed) {
    rt += '*';
    attr = ` title="校訂：${r.ed.corr ? esc(r.ed.corr) + '｜' : ''}${esc(r.ed.note)}"`;
    cls += ' ed';
  }
  if (r.orig) {                        // 173rd：校改存印（底本已依裁決校改；＊ 的鏡像機制）
    if (r.orig.at === 'kana') rt += '†'; else base += '<sup class="em">†</sup>';
    attr = ` title="校改存印：原印面「${esc(r.orig.was)}」｜${esc(r.orig.note)}"`;
    cls += ' emend';
  }
  return annBox(cls, attr, base, rt);
}

function rubyModern(unit) {
  if (!unit.r) return ellipCenter(esc(unit.u));
  const r = unit.r;
  if (r.poj == null) return esc(unit.u);      // 日文振假名：現代區不注（待中譯）
  let rt = esc(r.poj) + (r.star ? '*' : '');
  let attr = '';
  if (r.star) attr = ` title="採校訂值（見原冊區＊註）"`;
  else if (r.uncertain) attr = ` title="原書調記留空，調待考"`;
  const cls = 'poj' + (r.uncertain ? ' unc' : '') + (r.star ? ' ed' : '');
  // 缺字底字：□／IDS 合字→POJ 音節（ruby 照印保留；原冊視圖 rubyOrig 不動；J50 D5）
  const base = (unit.u === '□' || isIdsUnit(unit.u)) ? `<span class="pjsub">${esc(r.poj)}</span>` : esc(unit.u);
  return annBox(cls, attr, base, rt);
}

function unitsHTML(units, modern) {
  // 註／日釋內參照連結（2026-07-12 夥伴回饋；兩區共標）。
  // M033（C274）：**相鄰同 ref 之單位併成單一 <a>**——多字段參照（荖藤 型）export 端逐格掛 ref，
  // 若逐格各包一個 <a>，畫面上會是兩個並排的連結而非一個詞。單字案（連續長度 1）輸出與舊制逐字相同。
  const arr = units || [];
  const parts = [];
  let i = 0;
  while (i < arr.length) {
    const u = arr[i];
    if (!u.ref) {
      parts.push(modern ? rubyModern(u) : rubyOrig(u));
      i += 1;
      continue;
    }
    let inner = '';
    let j = i;
    while (j < arr.length && arr[j].ref === u.ref) {
      inner += modern ? rubyModern(arr[j]) : rubyOrig(arr[j]);
      j += 1;
    }
    if (parts.length && parts[parts.length - 1] === 'ー') {
      inner = parts.pop() + inner;         // 前一個裸 ー 併入連結
    }
    parts.push(`<a class="reflink" href="entry.html?id=${encodeURIComponent(u.ref)}" title="前往參照條目">${inner}</a>`);
    i = j;
  }
  return parts.join('');
}

function zhHTML(zh, units) {
  // 中譯內台文引用：zh_units 有 poj 的段落渲染 POJ ruby（export parse_zh 產）
  // 帶 ref＝可解析的參照詞 → 超連結（2026-07-12 夥伴回饋）
  if (!units) return esc(zh);
  return units.map(u => {
    if (u.poj == null) return esc(u.t);
    let h = annBox('poj', '', esc(u.t), esc(u.poj));
    if (u.ref) h = `<a class="reflink" href="entry.html?id=${encodeURIComponent(u.ref)}" title="前往參照條目">${h}</a>`;
    return h;
  }).join('');
}

function twModernHTML(items) {
  return (items || []).map(it => {
    if (it.poj == null) return esc(it.u);
    let cls = 'poj' + (it.fromHead ? ' fh' : '') + (it.uncertain ? ' unc' : '');
    let attr = it.fromHead ? ' title="由標頭字補回（原書作ー）"' : '';
    if (it.star) attr = ' title="採校訂值（見原冊區＊註）"';
    if (it.uncertain && !attr) attr = ' title="原書調記留空，調待考"';
    // 缺字底字：□／IDS 合字→POJ 音節（ruby 照印保留；2026-07-12 夥伴回饋＋J50 D5）
    const base = (it.u === '□' || isIdsUnit(it.u)) ? `<span class="pjsub">${esc(it.poj)}</span>` : esc(it.u);
    return annBox(cls, attr, base, esc(it.poj) + (it.star ? '*' : ''));
  }).join('');
}

function headKanaHTML(head) {
  let out = '';
  for (const t of head.kana || []) {
    out += esc(t.k) + (t.tn ? `<sup class="tn">${esc(t.tn)}</sup>` : '');
    if (t.orig && t.orig.at !== 'kanji') {   // 173rd：head 校改存印（遊 J150-9／窩 J150-16）；M019：at=kanji 者 † 改掛漢字（見 headKanjiHTML；p0127-1-04 換審→換蕃 曾掛錯到假名）
      out += `<sup class="em" title="校改存印：原印面「${esc(t.orig.was)}」｜${esc(t.orig.note)}">†</sup>`;
    }
    if (t.sep === '--') out += '--';
    else if (t.sep) out += ' ';
  }
  return out;
}

const CIRC = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
function markerOf(sense, i, total) {
  if (sense.marker) return sense.marker;
  return total > 1 ? (CIRC[i] || String(i + 1)) : '';
}

// ── 校對模式：原值萃取（供編輯面板 prefill 與 feedback.before） ──
function textOfUnits(units) {
  return (units || []).map(u => u.u).join('');
}
function rubyDump(units, modern) {
  const parts = [];
  for (const u of units || []) {
    if (!u.r) continue;
    if (modern) {
      if (u.r.poj != null) parts.push(`${u.u}=${u.r.poj}`);
    } else {
      parts.push(`${u.u}=${u.r.k}${u.r.tn || ''}`);
    }
  }
  return parts.join('、');
}
function twModernDump(items) {
  return (items || []).filter(it => it.poj != null)
    .map(it => `${it.u}=${it.poj}`).join('、');
}
function origAttr(text, ruby) {
  const v = ruby ? (text + '\n[注音] ' + ruby) : text;
  return ` data-orig="${esc(v)}"`;
}
function editAttr(path) {
  // M050 場 1（定案 §四 場 1 工項 3）：**永遠**輸出 `data-edit`，不再只給 localhost。
  // why：批注錨點 `placeMarkers` 靠它定位，而批注是給所有讀者看的；原本非 LOCAL 回空字串
  //   ⇒ 線上永遠找不到錨點元素、每一則都退成行尾記號。
  // ⚠ 射程只到「屬性出不出」：雙擊進 `#editbox` 那條路仍由 `init()` 裡的 LOCAL 閘守著
  //   （場 2 才改為團隊鑰匙制），故對一般讀者**行為零變化**。
  return ` data-edit="${esc(path)}"`;
}

// ── 三區塊 ──────────────────────────────────────────────
function blockImages(e) {
  const hasCrops = e.crops && e.crops.length;
  if (!hasCrops && !e.page_image) return '';
  const imgs = hasCrops ? e.crops.map(n =>
    `<img src="${IMG_BASE}crops/${esc(n)}.webp" alt="${esc(n)}" loading="lazy" data-zoom="${IMG_BASE}crops/${esc(n)}.webp">`
  ).join('') : '';
  const crossNote = (hasCrops && e.cross)
    ? `<div class="src">（本條目跨${esc(e.cross.to || '段')}，接續欄書影已列於末端）</div>` : '';
  const cropsDesc = (e.crops || []).join('、')
    + (e.cross ? `｜跨${e.cross.to || '段'}接續` : '')
    + `（掃描頁 ${e.page}・第${e.seg_num || ''}排・欄${(e.cols || []).join('–')}）`;
  const proofBtn = (LOCAL && hasCrops)
    ? `<button class="reportbtn proofbtn" data-edit="crops" data-orig="${esc(cropsDesc)}" title="回報切圖問題（缺欄、切偏、順序等）→ 本機佇列">本機校對</button>` : '';
  const locStr = e.seg_num
    ? `掃描頁 ${esc(e.page)}・第${esc(String(e.seg_num))}排 欄${esc((e.cols || []).join('–'))}`
    : `掃描頁 ${esc(e.page)}`;
  return `<section class="card imgcard">
    <h2>原冊書影<button class="reportbtn" data-block="原冊書影">回報錯誤</button>${proofBtn}</h2>
    ${imgs ? `<div class="strips">${imgs}</div>` : ''}${crossNote}
    <div class="tools"><a href="${IMG_BASE}pages/${esc(e.page_image)}.webp" data-zoom="${IMG_BASE}pages/${esc(e.page_image)}.webp">看整頁書影</a>
    　<span class="src">${locStr}</span></div>
    <div class="src">原冊圖檔來源：<a href="https://das.nlpi.edu.tw/" target="_blank" rel="noopener">國立公共資訊圖書館 數位典藏服務網</a></div>
  </section>`;
}

function senseHTML(s, i, total, modern, zhStatus, e) {
  const mk = markerOf(s, i, total);
  const base = `senses[${i}]`;
  let gloss;
  if (!modern) {
    // M030：gloss 級文字校改存印（SCHEMA_V2 §orig 文字級擴至 gloss）——只標原冊數位化層，現代化層不標
    const gem = (s.orig && s.orig.at === 'jp')
      ? `<sup class="em" title="校改存印：原印面「${esc(s.orig.was)}」｜${esc(s.orig.note)}">†</sup>` : '';
    gloss = `<span class="gloss"${editAttr(base + '.gloss')}${origAttr(textOfUnits(s.gloss), rubyDump(s.gloss, false))}>${unitsHTML(s.gloss, false)}${gem}</span>`;
  } else if (s.zh) {
    gloss = `<span class="zh"${editAttr(base + '.zh')}${origAttr(s.zh, '')}>${zhHTML(s.zh, s.zh_units)}</span>`;
  } else if ((s.gloss || []).length) {
    gloss = `<span class="pending">中文翻譯建置中——原文暫列：</span>` +
      `<span class="gloss"${editAttr(base + '.gloss_modern')}${origAttr(textOfUnits(s.gloss_modern), rubyDump(s.gloss_modern, true))}>${unitsHTML(s.gloss_modern, true)}</span>`;
  } else {
    gloss = '';                    // 原書無釋義（直接用例，如 百）：不顯示建置中
  }
  const notes = (s.notes || []).map((n, ni) => {
    const useZh = modern && n.zh;               // sense 註中譯疊加（2026-07-09 裁決；比照 refs note_zh）
    const uu = modern ? (n.units_modern || n.units) : n.units;   // 現代化區：台文註帶 POJ（2026-07-11 回饋）
    const body = useZh ? zhHTML(n.zh, n.zh_units) : unitsHTML(uu, modern);
    const orig = useZh ? origAttr(n.zh, '') : origAttr(textOfUnits(uu), rubyDump(uu, modern));
    return `<span class="notein"${editAttr(base + `.notes[${ni}]`)}${orig}>${body}</span>`;
  }).join('');
  // sense 級參照內嵌：ref.sense_i＝本義項者直接放行內（2026-07-12 使用者補裁：不另立參照行）
  // r.senses＝目標圈碼（亦①、欲②④）→ 行內 chip 顯示
  const inrefs = ((e && e.refs) || []).map((r, ri) => ({ r, ri }))
    .filter(x => (typeof x.r.sense_i === 'number' ? x.r.sense_i === i : x.r.senses && x.r.senses === mk))
    .map(x => {
      const p = refLineInner(x.r, x.ri, modern, (e && e.head && e.head.dial) || '');
      const sn = x.r.senses ? `<span class="chip">${esc(x.r.senses)}</span>` : '';
      return `<span class="refin">${p.body}${sn}${p.nt}</span>`;
    }).join('');
  const exs = (s.examples || []).map((x, xi) => {
    const ep = base + `.examples[${xi}]`;
    if (!modern) {
      const orig = textOfUnits(x.tw) + '＝' + textOfUnits(x.jp);
      const rb = [rubyDump(x.tw, false), rubyDump(x.jp, false)].filter(Boolean).join('；');
      const em = f => (x.orig && x.orig.at === f)   // 194th J194-9：文字級校改存印（欄整段校改）
        ? `<sup class="em" title="校改存印：原印面「${esc(x.orig.was)}」｜${esc(x.orig.note)}">†</sup>` : '';
      return `<div class="example"${editAttr(ep)}${origAttr(orig, rb)}><span class="tw">${unitsHTML(x.tw, false)}${em('tw')}</span>` +
             `<span class="eqsign">＝</span><span class="jp">${unitsHTML(x.jp, false)}${em('jp')}</span></div>`;
    }
    const zh = x.zh
      ? `<span class="zhline">${zhHTML(x.zh, x.zh_units)}</span>`
      : `<span class="pending">翻譯建置中</span>`;
    const orig = textOfUnits(x.tw_modern) + '＝' + (x.zh || '（翻譯建置中）');
    return `<div class="example"${editAttr(ep + '.modern')}${origAttr(orig, twModernDump(x.tw_modern))}><span class="tw">${twModernHTML(x.tw_modern)}</span>` +
           `<span class="eqsign">＝</span>${zh}</div>`;
  }).join('');
  // M032：標記級校改存印（SCHEMA_V2 §orig 標記級；首例 p0163-2-07）——只標原冊數位化層；印面無標記時 was 為 null → 顯示「（無）」
  const mkEm = (!modern && s.orig_marker)
    ? `<sup class="em" title="校改存印：原印面「${esc(origWasText(s.orig_marker))}」｜${esc(s.orig_marker.note)}">†</sup>` : '';
  return `<div class="sense">${mk ? `<span class="marker">${esc(mk)}${mkEm}</span>` : mkEm}${gloss}${notes}${inrefs}${exs}</div>`;
}
function origWasText(o) {               // M032：標記級 orig 之 was 可為 null（印面無標記）
  return (o && o.was != null && o.was !== '') ? o.was : '（無）';
}

function refUnitsModernHTML(units) {
  // fid9（2026-07-13 裁決）：參照現代化 POJ 疊字補連字號。□ 缺字底字＝裸 POJ；
  // 連續 tw-POJ □ 之間於底字尾插連字號（aⁿ-aⁿ），真漢字底字不動。
  const arr = units || [];
  const isBP = u => u.u === '\u25a1' && u.r && u.r.poj != null && (u.r.lang === 'tw' || u.r.lang == null);
  return arr.map((u, i) => {
    if (isBP(u) && i + 1 < arr.length && isBP(arr[i + 1])) {
      const r = u.r;
      const rt = esc(r.poj) + (r.star ? '*' : '');
      const attr = r.star ? ' title="\u63a1\u6821\u8a02\u503c\uff08\u898b\u539f\u518a\u5340\uff0a\u8a3b\uff09"' : (r.uncertain ? ' title="\u539f\u66f8\u8abf\u8a18\u7559\u7a7a\uff0c\u8abf\u5f85\u8003"' : '');
      const cls = 'poj' + (r.uncertain ? ' unc' : '') + (r.star ? ' ed' : '');
      const base = `<span class="pjsub">${esc(r.poj)}-</span>`;
      return annBox(cls, attr, base, rt);
    }
    return rubyModern(u);
  }).join('');
}

function refLineInner(r, ri, modern, headDial) {
  const units = modern ? r.kanji_modern : r.kanji;
  // 參照註三型位置（批次二 2026-07-12 J-B2-5／R04·R11 裁決）：in＝括弧內（百）、before＝槽前（閑）、after＝槽後（攬々）
  const noteHTML = (modern && r.note_zh) ? zhHTML(r.note_zh, r.note_zh_units)
                 : (r.note ? esc(r.note) : '');
  // M015 B（C273rd）：槽前註改由 refs.pre_note／pre_note_zh 承載（不論是否腔口白名單），與 note 分兩軸。
  // 現代化視圖＝dial 已升表頭者不前綴（rid 115），否則前綴 pre_note_zh‖pre_note；原冊視圖＝一律照印 pre_note。
  // 無 pre_note 之舊資料（站面尚未重出者）仍走下方 before 分支＝退路，不因先上碼後重出而掉字。
  // before 型之既有 note_zh 即該槽前註之中譯（A 案時期槽前註佔 note 格所致）＝遷 pre 軸時一併帶過來，
  // 否則已上站之 225 筆會由「（同安腔）」退回照印「（同）」。待 W2 補 pre_note_zh 後該欄優先。
  const preZh = r.pre_note_zh || (r.note_pos === 'before' ? r.note_zh : '');
  const preZhUnits = r.pre_note_zh ? r.pre_note_zh_units
                   : (r.note_pos === 'before' ? r.note_zh_units : null);
  const preHTML = r.pre_note
    ? ((modern && preZh) ? zhHTML(preZh, preZhUnits) : esc(r.pre_note))
    : '';
  let inner = `〔${modern ? refUnitsModernHTML(units) : unitsHTML(units, false)}${(noteHTML && r.note_pos === 'in') ? `<span class="src">${noteHTML}</span>` : ''}〕`;
  if (r.target) {                          // 參照超連結（2026-07-12 夥伴回饋；查無目標不連）
    inner = `<a class="reflink" href="entry.html?id=${encodeURIComponent(r.target)}" title="前往參照條目">${inner}</a>`;
  }
  let body = `＝${inner}`;                 // 照印呈現（2026-07-09 fid=3 裁決）
  let nt = '';
  // 槽前註軸（M015 B）：腔口已升表頭（2026-07-25 rid 115）者現代化視圖不前綴；原冊視圖照印
  // 是否已升表頭＝比對本條目 head.dial 與槽前註原文（M015 B 刻意不新增旗、也不借 r.dial——
  // r.dial 屬 note 軸，中譯線條文以它決定不產 note_zh，借用會讓 in-note 說明被連坐跳過不譯）。
  const preUp = !!r.pre_note && (r.dial === true || (!!headDial && r.pre_note === headDial));
  if (preHTML && !(modern && preUp)) {
    body = `<span class="src">（${preHTML}）</span>${body}`;
  }
  if (noteHTML && r.note_pos === 'before') {
    // before 型之 note ＝槽前註副本：pre_note 在時已由上段輸出，不重複；無者走此退路
    if (!preHTML && !(modern && r.dial)) body = `<span class="src">（${noteHTML}）</span>${body}`;
  } else if (noteHTML && r.note_pos === 'after') {
    nt = `<span class="src">（${noteHTML}）。</span>`;
  } else if (noteHTML && r.note_pos !== 'in') {
    nt = `<span class="src">（${noteHTML}）</span>`;
  }
  return { body: `<span${editAttr(`refs[${ri}]`)}${origAttr(textOfUnits(units), rubyDump(units, modern))}>${body}</span>`, nt };
}

function refsHTML(e, modern) {
  // 2026-07-12 使用者補裁：帶 sense_i 的參照一律行內（senseHTML），此處僅殘留無定位者（正常應為零）
  if (!e.refs || !e.refs.length) return '';
  const total = (e.senses || []).length;
  const markers = (e.senses || []).map((s, i) => markerOf(s, i, total));
  return e.refs.map((r, ri) => {
    if (typeof r.sense_i === 'number' && r.sense_i < total) return '';   // 已內嵌於該義項行
    if (r.senses && markers.indexOf(r.senses) >= 0) return '';           // 舊資料 marker 對應保險
    const p = refLineInner(r, ri, modern, (e.head && e.head.dial) || '');
    const sn = r.senses ? `<span class="chip">${esc(r.senses)}</span>` : '';
    return `<div class="refline"><span class="chip">參照</span>${p.body}${sn}${p.nt}</div>`;
  }).join('');
}

function collectEd(e) {
  // 收集本條目所有掛 ed 校訂疊加層的 ruby（fid7/13 2026-07-13：夥伴看不懂「*」→原冊區加可見圖例）
  const out = [];
  const scan = units => (units || []).forEach(u => { if (u && u.r && u.r.ed) out.push({ u: u.u, ed: u.r.ed }); });
  (e.senses || []).forEach(s => {
    scan(s.gloss);
    (s.notes || []).forEach(n => scan(n.units));
    (s.examples || []).forEach(x => { scan(x.tw); scan(x.jp); });
  });
  (e.refs || []).forEach(r => scan(r.kanji));
  (((e.head || {}).kana) || []).forEach(t => { if (t && t.ed) out.push({ u: t.k, ed: t.ed }); });  // head ed（J50-2）
  return out;
}
function collectOrig(e) {
  // 173rd：收集本條目所有掛 orig 校改存印層的 token（底本已依裁決校改，原印面存 was）
  const out = [];
  const scan = units => (units || []).forEach(u => {
    if (u && u.r && u.r.orig) out.push({ now: u.r.orig.at === 'kana' ? (u.r.k || '') + (u.r.tn || '') : u.u, orig: u.r.orig });
  });
  const nSense = (e.senses || []).length;
  (e.senses || []).forEach((s, si) => {
    scan(s.gloss);
    if (s.orig) out.push({ now: textOfUnits(s.gloss), orig: s.orig });   // M030：gloss 級文字校改存印
    if (s.orig_marker) out.push({ now: markerOf(s, si, nSense),          // M032：標記級（原印面「（無）」→「①」）
                                  orig: Object.assign({}, s.orig_marker, { was: origWasText(s.orig_marker) }) });
    (s.notes || []).forEach(n => scan(n.units));
    (s.examples || []).forEach(x => {
      scan(x.tw); scan(x.jp);
      if (x.orig) out.push({ now: textOfUnits(x.orig.at === 'jp' ? x.jp : x.tw), orig: x.orig });  // 194th：文字級
    });
  });
  (e.refs || []).forEach(r => scan(r.kanji));
  const hu = ((e.head || {}).kanji_units) || [];
  (((e.head || {}).kana) || []).forEach((t, i) => {   // M019：at=kanji 者「現值」取第 i 個漢字單位（原為假名，圖例寫成 原印面「審」→「ホアヌ」）
    if (t && t.orig) out.push({ now: t.orig.at === 'kanji' ? (hu[i] || (e.head || {}).kanji || '') : t.k + (t.tn || ''), orig: t.orig });
  });
  return out;
}
function blockOriginal(e) {
  const total = (e.senses || []).length;
  const senses = (e.senses || []).map((s, i) => senseHTML(s, i, total, false, e.zh_status, e)).join('');
  const eds = collectEd(e);
  const edLegend = eds.length
    ? `<div class="ednote"><b>＊</b>＝校訂註（底本照印存真，另記有依據之音理校訂）：${eds.map(x => `${esc(x.u)}〔${esc(x.ed.note || x.ed.corr)}〕`).join('；')}</div>`
    : '';
  const ems = collectOrig(e);            // 173rd：校改存印圖例（與 ＊ 並列、語意相反不可混）
  const emLegend = ems.length
    ? `<div class="ednote"><b>†</b>＝校改存印（原冊誤植／漏印，底本已依裁決校改，原印面存記於此）：${ems.map(x => `原印面「${esc(x.orig.was)}」→「${esc(x.now)}」〔${esc(x.orig.note)}〕`).join('；')}</div>`
    : '';
  let idsLegend = '';                    // 合字圖例（J50 D5 fid20）：條目含組字式時說明記法
  try {
    if (/[\u2FF0-\u2FFF]/.test(JSON.stringify([(e.head || {}).kanji, e.senses]))) {
      idsLegend = '<div class="ednote">組字式（⿰⿸…起首）＝原書合字無 Unicode 碼位，依部件照印記錄；現代化行以 POJ 音節替代顯示</div>';
    }
  } catch (err) { /* noop */ }
  return `<section class="card" data-blockname="原冊數位化">
    <h2>原冊數位化（照印）<button class="reportbtn" data-block="原冊數位化">回報錯誤</button></h2>
    ${origHead(e)}${senses}${refsHTML(e, false)}${kanjiNotesHTML(e)}${edLegend}${emLegend}${idsLegend}
  </section>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// M050 場 1（批注層 D）——發包單＝`協作規畫/M050_批注層四場定案_20260925.md` §二 5／6／7／8
// 卡名「做工á人批注」＝KB 既有名稱（§九 參數表）；夾在「POJ＋日文中譯」與「原冊數位化」之間；
// 無批注不渲染；`<details open>` 預設展開、摘要列帶計數、不記憶收攏狀態（§二 6）。
// 署名＝**卡標題本身**，每則不標個人（§二 7）⇒ 資料層的 `by` 不上畫面；每則只標最後核定日（§二 8）。
function blockAnnots(e) {
  const an = e.annots || [];
  if (!an.length) return '';                      // §二 6：無批注不渲染
  const items = an.map((a, i) => {
    const n = i + 1;
    // 編號回跳（§四 場 1 工項 3）：列號連回本文記號，記號連回本列
    const back = a.path ? `<a class="anback" href="#${esc(a.nid)}-m" title="回到本文記號">${n}</a>`
                        : `<span class="anback off">${n}</span>`;
    const dt = a.date ? `<span class="andate">${esc(a.date)}</span>` : '';
    return `<li class="anitem" id="${esc(a.nid)}">${back}` +
           `<span class="ankind">${esc(a.kind)}</span>` +
           `<span class="antext">${esc(a.text)}</span>${dt}</li>`;
  }).join('');
  return `<section class="card annots" data-blockname="批注">
    <details open>
      <summary>做工á人批注<span class="ancnt">${an.length}</span></summary>
      <ul class="anlist">${items}</ul>
    </details>
  </section>`;
}

// 資料路徑 → DOM 路徑。**為什麼需要這張表**（C321 逐處實測 `editAttr` 的呼叫面，非推想）：
//   `data-edit` 發出來的詞彙是**版面**的，批注的 `path` 是**資料**的，兩者不是同一組字串——
//   ・中譯住在現代化例句欄，其 `data-edit` 是 `…examples[j].modern`，資料路徑卻是 `…examples[j].zh`；
//     若改用「最長前綴」退讓，`senses[0].examples[1].zh` 會退到**原冊層**的 `senses[0].examples[1]`，
//     而該處的日文釋義字面常與中譯的引文同字（實例：p1006-2-09 的 jp 就是「斬鑪。」）
//     ⇒ 記號會插到原冊層的日文上，看起來還「成功」了。故用明表、不用前綴。
//   ・表頭各欄（`head.kanji`／`head.kana`／`head.poj`）在版面上共用同一個 `data-edit="head"`。
const AN_DOM_PATH = [
  [/^(senses\[\d+\]\.examples\[\d+\])\.zh$/, '$1.modern'],
  [/^head\.[A-Za-z_]\w*$/, 'head'],
];
function annDomPath(path) {
  for (const [re, to] of AN_DOM_PATH) if (re.test(path)) return path.replace(re, to);
  return path;
}

// 在錨點元素內找 quote，把記號插在該字之後；ruby 注音盒（.ann）與 <rt> 內的文字不算
//（那是注音、不是本文；在注音裡命中會把記號插進假名中間）。
function insertAfterQuote(el, quote, sup) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement && n.parentElement.closest('.ann, rt'))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  let n;
  while ((n = w.nextNode())) {
    const k = n.nodeValue.indexOf(quote);
    if (k < 0) continue;
    const rest = n.splitText(k + quote.length);
    rest.parentNode.insertBefore(sup, rest);
    return true;
  }
  return false;
}

// 渲染後放記號（§二 5）：找到 quote → 插在字後；找不到／無 quote／`.gloss`（帶假名 ruby）→ 行尾。
// 錨點元素找不到者不放記號（該則仍在卡內列出）——export 已驗過 path，這裡走到就是版面與
// 上表脫節，寧可少一個記號也不要插到別的欄位上。
// 同一路徑在兩個卡都有 data-edit（表頭即是）時取**文件序第一個**＝現代化卡那一個。
function placeMarkers(e, root) {
  (e.annots || []).forEach((a, i) => {
    if (!a.path) return;
    const el = root.querySelector(`[data-edit="${annDomPath(a.path)}"]`);
    if (!el) return;
    const sup = document.createElement('sup');
    sup.className = 'an';
    sup.id = a.nid + '-m';
    sup.innerHTML = `<a href="#${a.nid}" title="做工á人批注 ${i + 1}">${i + 1}</a>`;
    const atEnd = !a.quote || el.classList.contains('gloss');
    if (atEnd || !insertAfterQuote(el, a.quote, sup)) el.appendChild(sup);
  });
}


function blockModern(e) {
  const total = (e.senses || []).length;
  const senses = (e.senses || []).map((s, i) => senseHTML(s, i, total, true, e.zh_status, e)).join('');
  // 2026-07-17 站主裁示：區塊名「現代化對照」5 字自標題拿掉，只留「POJ＋日文中譯」
  //（data-block／data-blockname 內部值不動，修訂紀錄用語連續）
  return `<section class="card" data-blockname="現代化對照">
    ${headStrip(e, false)}
    <h2>POJ＋日文中譯<button class="reportbtn" data-block="現代化對照">回報錯誤</button></h2>
    ${senses}${refsHTML(e, true)}
  </section>`;
}

function navHTML(e) {
  // .lbl 文字在手機表頭條隱藏＝只留箭頭（68th 補2 站主回饋）；title/aria 保留語意
  const prev = e.prev
    ? `<a class="navbtn" id="navprev" href="entry.html?id=${encodeURIComponent(e.prev)}" title="上一條（鍵盤 ←）" aria-label="上一條">←<span class="lbl"> 上一條</span></a>`
    : `<span class="navbtn off">←<span class="lbl"> 上一條</span></span>`;
  const next = e.next
    ? `<a class="navbtn" id="navnext" href="entry.html?id=${encodeURIComponent(e.next)}" title="下一條（鍵盤 →）" aria-label="下一條"><span class="lbl">下一條 </span>→</a>`
    : `<span class="navbtn off"><span class="lbl">下一條 </span>→</span>`;
  return `<span class="nav">${prev}${next}</span>`;
}

// 表頭條（2026-07-17 版面改版：獨立表頭卡取消，融入第一個內容卡；
// 完整條目假名移到原冊數位化區 origHead，骨架條目 withKana=true 假名留在此）
function headStrip(e, withKana) {
  const h = e.head || {};
  const unc = h.poj_uncertain ? '<span class="unc" title="部分調記原書留空">ˀ</span>' : '';
  const kanaTxt = (h.kana || []).map(t => t.k + (t.tn || '') + (t.sep === '--' ? '--' : t.sep ? ' ' : '')).join('');
  const proofChip = LOCAL ? '<span class="chip proof" title="localhost 校對模式：雙擊任何文字段可回報修正">校對模式</span>' : '';
  const skelChip = e.status === 'skeleton'
    ? '<span class="chip skel" title="表頭為機器辨識初稿，尚未精校">建置中</span>' : '';
  const blank = isBlankKanji(h.kanji);   // □ 表頭：POJ 主位、□ 退次要（2026-07-12）
  const hzAttrs = `${editAttr('head')}${origAttr(h.kanji + '｜' + kanaTxt + '｜' + h.poj, '')}`;
  const mix = blank ? null : mixKanjiParts(h.kanji_units, h.poj);
  const hzHTML = blank
    ? `<span class="hz pjhz"${hzAttrs}>${esc(h.poj)}${unc}</span><span class="dimk">${esc(h.kanji)}</span>`
    : `<span class="hz"${hzAttrs}>${mix ? mixHTML(mix) : esc(h.kanji_disp || h.kanji)}</span>`;
  return `<div class="entryhead">
    ${hzHTML}
    ${blank ? '' : `<span class="pj"${h.poj_star ? ' title="採校訂值（見原冊區＊註）"' : ''}>${esc(h.poj)}${h.poj_star ? '*' : ''}${unc}</span>`}
    ${h.dial ? `<span class="dial" title="腔口註記：原冊印於釋義處（照印見原冊數位化區）">（${esc(h.dial)}）</span>` : ''}
    ${withKana ? `<span class="kn">${headKanaHTML(h)}</span>` : ''}${skelChip}${proofChip}
    <button class="reportbtn hd" data-block="表頭">回報錯誤</button>
    <span class="loc">${esc(locText(e))}</span>
    ${navHTML(e)}
  </div>`;
}

// 表頭漢字判讀註記（head.kanji_notes）→ 可見行（68th 補3 站主回饋：
// 原「字註」chip 只有 hover 提示、手機看不到；改比照校訂註 ednote 明示，
// 同文註記合併不重複——□□哮 兩筆「殘字」→「□＝殘字」一行）
function kanjiNotesHTML(e) {
  const h = e.head || {};
  const notes = h.kanji_notes || [];
  if (!notes.length) return '';
  const units = h.kanji_units || [];
  const groups = new Map();                    // note 全文 → [字位]
  for (const n of notes) {
    const ch = n.char || units[n.pos] || '□';
    const arr = groups.get(n.note) || [];
    if (arr.indexOf(ch) < 0) arr.push(ch);
    groups.set(n.note, arr);
  }
  const parts = [];
  for (const [note, chars] of groups) {
    parts.push(`${esc(chars.join('、'))}＝${esc(note)}`);
  }
  return `<div class="ednote headnote"><b>字註</b>：${parts.join('；')}</div>`;
}

// 原冊數位化區表頭：假名見出し（調記）＋【漢字】——仿原冊樣貌；
// 無漢字／缺字條目 □ 照印恢復方格，不做 POJ 替代（2026-07-17 版面改版）
// M019：表頭漢字 † 掛字（SCHEMA_V2 orig：at=kanji→掛漢字右上）——head.kana[i].orig.at==='kanji' ＝第 i 個漢字單位被校改
function headKanjiHTML(h) {
  const units = (h.kanji_units && h.kanji_units.length) ? h.kanji_units : [h.kanji || ''];
  const kana = h.kana || [];
  return units.map((u, i) => {
    const t = kana[i];
    const em = (t && t.orig && t.orig.at === 'kanji')
      ? `<sup class="em" title="校改存印：原印面「${esc(t.orig.was)}」｜${esc(t.orig.note)}">†</sup>` : '';
    return esc(u) + em;
  }).join('');
}

function origHead(e) {
  const h = e.head || {};
  const kanaTxt = (h.kana || []).map(t => t.k + (t.tn || '') + (t.sep === '--' ? '--' : t.sep ? ' ' : '')).join('');
  const attrs = `${editAttr('head')}${origAttr(h.kanji + '｜' + kanaTxt + '｜' + h.poj, '')}`;
  return `<div class="orighead"${attrs}><span class="okn">${headKanaHTML(h)}</span><span class="ohz">【${headKanjiHTML(h)}】</span></div>`;
}

function locText(e) {
  // p0052-1-01（書頁0001・上段・第1條）
  let out = e.id || '';
  const parts = [];
  if (e.page && /^p\d{4}$/.test(e.page)) {
    parts.push('書頁' + String(parseInt(e.page.slice(1), 10) - 51).padStart(4, '0'));
  }
  if (e.seg) parts.push(e.seg + '段');
  const n = (e.id || '').split('-')[2];
  if (n) parts.push('第' + parseInt(n, 10) + '條');
  return parts.length ? `${out}（${parts.join('・')}）` : out;
}

function skeletonCard(e) {
  // 骨架條目：表頭與建置中說明融合單卡（2026-07-17 版面改版；假名留在表頭條）
  return `<section class="card">
    ${headStrip(e, true)}
    <p class="skelnote">本條目<strong>資料建置中</strong>——表頭（漢字・假名・POJ）為機器辨識初稿，
    尚未精校；日文釋義、用例與現代化對照將於精校完成後上線。
    下方原冊書影可直接閱讀本條原文；發現表頭錯誤，歡迎按「回報錯誤」告訴我們。</p>
    ${kanjiNotesHTML(e)}
  </section>`;
}

// ── 回報（線上直送 /api/feedback；失敗自動退回複製模式） ──
let reportCtx = '';
let reportBlock = '';
function openReport(block, eid) {
  reportBlock = block;
  reportCtx = `【回報】條目 ${eid}／區塊：${block}`;
  $('#reportctx').textContent = reportCtx;
  $('#reporttext').value = '';
  try { $('#reportname').value = localStorage.getItem('tjss_reporter') || ''; } catch (e) {}
  $('#reportbox').classList.add('on');
}
async function fallbackCopy(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    alert('線上送出暫時不可用，回報內容已複製——請把這段文字用 LINE 或 Email 傳給站主，謝謝！');
  } catch (e) {
    prompt('請手動複製以下回報內容：', txt);
  }
}
async function sendReport(eid) {
  const note = $('#reporttext').value.trim();
  if (!note) { alert('請先描述問題內容。'); return; }
  const reporter = $('#reportname').value.trim();
  try { localStorage.setItem('tjss_reporter', reporter); } catch (e) {}
  const rec = { source: 'online', ts: new Date().toISOString(), id: eid,
                block: reportBlock, note: note, reporter: reporter };
  let ok = false;
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
    ok = r.ok && (await r.json()).ok === true;
  } catch (e) { ok = false; }
  if (ok) {
    alert('已送出，感謝回報！');
  } else {
    await fallbackCopy(reportCtx + '\n回報者：' + reporter + '\n說明：' + note);
  }
  $('#reportbox').classList.remove('on');
}

// ── 校對模式（localhost；送 bridge_server /feedback） ────
let editTarget = null;
let entryId = '';

function openEdit(el) {
  editTarget = el;
  const path = el.dataset.edit || '';
  const orig = el.dataset.orig || el.textContent;
  $('#editctx').textContent = `條目 ${entryId}／欄位 ${path}`;
  $('#editorig').value = orig;
  $('#editnew').value = orig.split('\n')[0];
  $('#editnote').value = '';
  $('#editbox').classList.add('on');
  $('#editnew').focus();
}

async function submitEdit() {
  if (!editTarget) return;
  const rec = {
    source: 'website',
    ts: new Date().toISOString(),
    id: entryId,
    path: editTarget.dataset.edit || '',
    before: editTarget.dataset.orig || '',
    after: $('#editnew').value.trim(),
    note: $('#editnote').value.trim(),
  };
  try {
    const r = await fetch('/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
    if (!r.ok) throw new Error(r.status);
    editTarget.classList.add('edited');
    $('#editbox').classList.remove('on');
  } catch (err) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(rec, null, 1));
      alert('無法連到本機伺服器（圖床伺服器.bat 有開嗎？）。修正內容已複製到剪貼簿，請貼回對話。');
    } catch (e2) {
      prompt('無法送出，請手動複製：', JSON.stringify(rec));
    }
  }
}

// ── 初始化 ──────────────────────────────────────────────
async function init() {
  const id = new URLSearchParams(location.search).get('id') || '';
  const root = $('#entry');
  if (!/^[\w\-]+$/.test(id)) { root.innerHTML = '<p class="pending">條目編號不正確。</p>'; return; }
  let e;
  try {
    const page = id.split('-')[0];               // p0052-1-01 → p0052（一頁一檔）
    const r = await fetch(`data/entries/${page}.json`);
    if (!r.ok) throw new Error(r.status);
    e = ((await r.json()).entries || {})[id];
    if (!e) throw new Error('no entry');
  } catch (err) {
    root.innerHTML = '<p class="pending">找不到此條目。</p>';
    return;
  }
  entryId = e.id;
  const tmix = isBlankKanji(e.head.kanji) ? null
    : mixKanjiParts(e.head.kanji_units, e.head.poj);
  document.title = isBlankKanji(e.head.kanji)
    ? `${e.head.poj}・台日新辭書線上版`
    : `${tmix ? tmix.map(x => x.t).join(' ') : e.head.kanji}（${e.head.poj}）・台日新辭書線上版`;
  if (LOCAL) document.body.classList.add('proof');
  // 2026-07-17 版面改版：獨立表頭卡取消——表頭融入第一卡，
  // 整體＝POJ＋日文中譯（含表頭條）→ 原冊數位化（含原冊表頭）→ 原冊書影
  let html;
  if (e.status === 'skeleton') {
    html = skeletonCard(e) + blockImages(e);   // 骨架：表頭＋建置中說明單卡＋該條原冊書影（B 版）
  } else {
    // M050 場 1（§二 6）：批注卡夾在「POJ＋日文中譯」與「原冊數位化」之間
    html = `<div class="twocol">${blockModern(e)}${blockAnnots(e)}${blockOriginal(e)}</div>` +
           blockImages(e);
  }
  html += `<div class="footnav">${navHTML(e)}</div>`;
  root.innerHTML = html;
  placeMarkers(e, root);                 // M050 場 1：批注記號須在 DOM 存在之後才放

  root.addEventListener('click', ev => {
    const z = ev.target.closest('[data-zoom]');
    if (z) {
      ev.preventDefault();
      $('#lightbox img').src = z.dataset.zoom;
      $('#lightbox').classList.add('on');
      return;
    }
    const pb = ev.target.closest('.proofbtn');
    if (pb) { openEdit(pb); return; }
    const rb = ev.target.closest('.reportbtn');
    if (rb) openReport(rb.dataset.block, e.id);
  });
  if (LOCAL) {
    root.addEventListener('dblclick', ev => {
      const t = ev.target.closest('[data-edit]');
      if (t) { ev.preventDefault(); openEdit(t); }
    });
  }
  document.addEventListener('keydown', ev => {
    if (ev.target.closest('input, textarea')) return;
    if ($('#editbox') && $('#editbox').classList.contains('on')) return;
    if ($('#reportbox').classList.contains('on')) return;
    if (ev.key === 'ArrowLeft' && e.prev) location.href = 'entry.html?id=' + encodeURIComponent(e.prev);
    if (ev.key === 'ArrowRight' && e.next) location.href = 'entry.html?id=' + encodeURIComponent(e.next);
  });
  $('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('on'));
  $('#reportsend').addEventListener('click', () => sendReport(e.id));
  $('#reportcancel').addEventListener('click', () => $('#reportbox').classList.remove('on'));
  if ($('#editsend')) {
    $('#editsend').addEventListener('click', submitEdit);
    $('#editcancel').addEventListener('click', () => $('#editbox').classList.remove('on'));
  }
}
document.addEventListener('DOMContentLoaded', init);
