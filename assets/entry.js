// entry.js — 詳細頁渲染（PLAN_WEBSITE W1.5）
// 三區塊：(a) 現代化對照（POJ＋日文中譯）、(b) 原冊數位化（照印）、(c) 原冊書影 crop
// W1.5：上一條/下一條導覽（鍵盤 ←→）
// C324（M050 場 2）：團隊模式（鑰匙）＋雙擊編輯直送 `/api/feedback` ＋疊加層
// 資料：data/entries/{page}.json（一頁一檔，DESIGN_SEARCH §6.1；entries[id] 取條目，含 prev/next）
//      ＋ data/opsrc/{page}.json（團隊模式才抓；產 op 用的 v2 原值，見 export_site_data.py）
'use strict';

const $ = s => document.querySelector(s);
// 圖床基底（PLAN_WEBSITE 裁決 5／S0）：R2 公開網址；空字串＝退回站內 img/（git 圖）。
// C324（定案 §二 15）：`LOCAL` 旗標退場，本機圖床分支一併拿掉——`圖床伺服器.bat` 同批移除，
//   留著那個判斷式只會讓 localhost 預覽去抓一個已經沒人在服務的 img/。
const R2_BASE = 'https://pub-71b2d9166d2e4a9aa42c76a5f89a94a2.r2.dev/';
const IMG_BASE = R2_BASE || 'img/';

// ══ C324：團隊模式與 op 白名單（M050 定案 §二 3／4／12、§四 場 2 之 3）══════════
// 一把型鑰匙、無特權角色（站主亦同）。`TEAM.on` 取代舊的 `LOCAL`。
// ⚠ **鑰匙不賦予直接發布或繞過驗證的權力**（定案 §二 3）：它只讓伺服器蓋 `role='team'`，
//   送出的 op 照樣要過每小時工作的驗證器與 export gate 才寫得進 canonical。
const TEAM = { on: false, name: '', token: '' };
const TEAM_KEY = 'tjss_team_token';

// 產 op 用的 v2 原值（`data/opsrc/{page}.json`）；抓不到＝整頁退描述模式。
let OPSRC = null;

// ⚠ **本戳與 `website/build/export_site_data.py` 的 `PATH_SYNTAX_VERSION` 必須相等**；
//   下面兩張形狀表必須逐項等於 `review_live/feedback_daily.py` 的 `OP_LEAF_SHAPES`／
//   `OP_TOKEN_SHAPES`（**那一份是驗證器、是單一真相**，本表只是瀏覽器端的前置篩）。
//   三份由 `website/build/test_op_syntax.py` 機械對版——照定案 §三「path 互轉 JS／Python
//   各一份、無法單一來源 ⇒ 設同步戳」之處置（體例同 `AN_DOM_SYNC`）。
//   **改任一邊必同批改另外兩邊並 bump 戳。**
const PATH_SYNTAX_VERSION = 'C324';
const OP_LEAF_SHAPES = [            // 葉型：old/new＝整個字串葉值
  ['head', 'kanji'],
  ['head', 'sep', '#'],
  ['senses', '#', 'gloss', 'jp'],
  ['senses', '#', 'gloss', 'ruby', '#', 'k'],
  ['senses', '#', 'gloss', 'ruby', '#', 'c'],
  ['senses', '#', 'examples', '#', 'tw'],
  ['senses', '#', 'examples', '#', 'jp'],
  ['senses', '#', 'examples', '#', 'jp_ruby', '#', 'k'],
  ['senses', '#', 'examples', '#', 'jp_ruby', '#', 'c'],
];
const OP_TOKEN_SHAPES = [           // token 型：old/new＝整個假名 token 物件，鍵組不增不減
  ['head', 'kana', '#'],
  ['senses', '#', 'examples', '#', 'tw_ruby', '#'],
];

// 'senses[0].examples[1].tw' → ['senses',0,'examples',1,'tw']
function pathToArr(s) {
  const out = [];
  for (const seg of String(s || '').split('.')) {
    const m = /^([A-Za-z_]\w*)((?:\[\d+\])*)$/.exec(seg);
    if (!m) return null;
    out.push(m[1]);
    for (const b of (m[2].match(/\d+/g) || [])) out.push(parseInt(b, 10));
  }
  return out;
}
function shapeMatch(arr, shapes) {
  for (const sh of shapes) {
    if (sh.length !== arr.length) continue;
    let ok = true;
    for (let i = 0; i < sh.length; i++) {
      if (sh[i] === '#') {
        if (!(Number.isInteger(arr[i]) && arr[i] >= 0)) { ok = false; break; }
      } else if (arr[i] !== sh[i]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
// → 'leaf'｜'token'｜''（空＝不在白名單，只能走描述模式）
function opKind(pathStr) {
  const arr = pathToArr(pathStr);
  if (!arr) return '';
  if (shapeMatch(arr, OP_TOKEN_SHAPES)) return 'token';
  if (shapeMatch(arr, OP_LEAF_SHAPES)) return 'leaf';
  return '';
}

// 顯示層調記：`display_tn`（export_site_data.py）的 JS 對應——第1調（非鼻音）不標。
// ⚠ 疊加層要把 token 型 op 的新值畫回站面，就得自己算這個字串（站面上的 `tn` 是算過的結果）。
function tnOf(tok) {
  const tn = String((tok && tok.tone) || '') + ((tok && tok.nasal) ? 'n' : '');
  return tn === '1' ? '' : tn;
}
function tokDisp(tok) {
  return String((tok && tok.k) || '') + tnOf(tok);
}

// 渲染層 → v2 槽位的掛鉤屬性（editor 與疊加層共用同一組）。
//   data-v2 ＝該元素承載的 v2 文字葉路徑；data-rb ＝該元素內 ruby 陣列的 v2 路徑；
//   data-rbk＝該 ruby 陣列的 op 型別（token／leaf）；帶 ruby 的單位另掛 data-ri＝陣列索引。
function v2Attr(leafPath, rubyPath, rubyKind) {
  let s = ` data-v2="${esc(leafPath)}"`;
  if (rubyPath) s += ` data-rb="${esc(rubyPath)}" data-rbk="${esc(rubyKind || 'leaf')}"`;
  return s;
}

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
function annBox(cls, attr, base, ann, extra) {
  return `<span class="rb ${cls}"${attr}${extra || ''}><span class="ann">${ann}</span>${base}</span>`;
}

// C324：`ri`＝該 ruby 在 v2 陣列裡的索引。**為什麼推得出來**：`attach_ruby`（export）以單一
//   指標依序消耗 ruby 陣列 ⇒ 文件序第 n 個帶 `r` 的單位恰為 `ruby[n]`；未掛完的只會留在尾端，
//   不會插隊。⚠ 只有掛著 `data-rb` 的宿主裡這個索引才有意義（參照槽等處是別的陣列）。
function riAttr(ri) {
  return (typeof ri === 'number' && ri >= 0) ? ` data-ri="${ri}"` : '';
}

function rubyOrig(unit, ri) {
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
  return annBox(cls, attr, base, rt, riAttr(ri));
}

function rubyModern(unit, ri) {
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
  return annBox(cls, attr, base, rt, riAttr(ri));
}

function unitsHTML(units, modern) {
  // 註／日釋內參照連結（2026-07-12 夥伴回饋；兩區共標）。
  // M033（C274）：**相鄰同 ref 之單位併成單一 <a>**——多字段參照（荖藤 型）export 端逐格掛 ref，
  // 若逐格各包一個 <a>，畫面上會是兩個並排的連結而非一個詞。單字案（連續長度 1）輸出與舊制逐字相同。
  const arr = units || [];
  const parts = [];
  let i = 0;
  let rc = 0;                                // C324：已掛載 ruby 數＝下一個單位的 v2 陣列索引
  const one = u => {
    const ri = u.r ? rc++ : -1;              // ⚠ 兩條分支共用同一個計數器＝維持文件序
    return modern ? rubyModern(u, ri) : rubyOrig(u, ri);
  };
  while (i < arr.length) {
    const u = arr[i];
    if (!u.ref) {
      parts.push(one(u));
      i += 1;
      continue;
    }
    let inner = '';
    let j = i;
    while (j < arr.length && arr[j].ref === u.ref) {
      inner += one(arr[j]);
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
  // C324：每個假名 token 包一層 `.kt`（帶 v2 索引），token 之間的分隔包一層 `.ksep`
  //   ——音節編輯器與 `head.sep[i]` 切換鈕都靠這兩個索引定位（定案 §四 場 2 之 3）。
  //   ⚠ 對一般讀者是零視覺變化（span 不帶樣式），但 DOM 變了 ⇒ 站面要實看一次。
  let out = '';
  const ks = head.kana || [];
  for (let i = 0; i < ks.length; i++) {
    const t = ks[i];
    let one = esc(t.k) + (t.tn ? `<sup class="tn">${esc(t.tn)}</sup>` : '');
    if (t.orig && t.orig.at !== 'kanji') {   // 173rd：head 校改存印（遊 J150-9／窩 J150-16）；M019：at=kanji 者 † 改掛漢字（見 headKanjiHTML；p0127-1-04 換審→換蕃 曾掛錯到假名）
      one += `<sup class="em" title="校改存印：原印面「${esc(t.orig.was)}」｜${esc(t.orig.note)}">†</sup>`;
    }
    out += `<span class="kt" data-kt="${i}">${one}</span>`;
    if (i >= ks.length - 1) continue;
    // ⚠ 站面只分得出 `--` 與「不是 --」（export `head_view` 把 '-'／'|'／'' 壓成空格）
    //   ⇒ 切換鈕的 `old` 一律取自 `opsrc.sep[i]`，不從這裡讀。
    const body = (t.sep === '--') ? '--' : (t.sep ? ' ' : '');
    out += `<span class="ksep" data-ksep="${i}">${body}</span>`;
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
  // ⚠ 射程只到「屬性出不出」：雙擊進 `#editbox` 那條路自 C324 起由**團隊鑰匙**守著
  //   （`TEAM.on`；場 2 依定案 §二 3 換制），故對一般讀者**行為零變化**。
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
  // C324：舊「本機校對」鈕（LOCAL）改為團隊鈕。`crops` 不在 op 白名單內
  //   ⇒ 它一律走描述模式，這是設計內、不是退化（切圖問題本來就不是「改某個欄位的值」）。
  const proofBtn = (TEAM.on && hasCrops)
    ? `<button class="reportbtn proofbtn" data-edit="crops" data-orig="${esc(cropsDesc)}" title="回報切圖問題（缺欄、切偏、順序等）">切圖問題</button>` : '';
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
    gloss = `<span class="gloss"${editAttr(base + '.gloss')}${v2Attr(base + '.gloss.jp', base + '.gloss.ruby', 'leaf')}${origAttr(textOfUnits(s.gloss), rubyDump(s.gloss, false))}>${unitsHTML(s.gloss, false)}${gem}</span>`;
  } else if (s.zh) {
    gloss = `<span class="zh"${editAttr(base + '.zh')}${origAttr(s.zh, '')}>${zhHTML(s.zh, s.zh_units)}</span>`;
  } else if ((s.gloss || []).length) {
    gloss = `<span class="pending">中文翻譯建置中——原文暫列：</span>` +
      `<span class="gloss"${editAttr(base + '.gloss_modern')}${v2Attr(base + '.gloss.jp', base + '.gloss.ruby', 'leaf')}${origAttr(textOfUnits(s.gloss_modern), rubyDump(s.gloss_modern, true))}>${unitsHTML(s.gloss_modern, true)}</span>`;
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
      // C324：`tw_ruby` 是 **token 型** op（整個假名 token）、`jp_ruby` 是葉型（k／c 各一葉）
      //   ——兩者在白名單裡本來就不同型，掛在元素上才不必在編輯器裡重猜。
      return `<div class="example"${editAttr(ep)}${origAttr(orig, rb)}>` +
             `<span class="tw"${v2Attr(ep + '.tw', ep + '.tw_ruby', 'token')}>${unitsHTML(x.tw, false)}${em('tw')}</span>` +
             `<span class="eqsign">＝</span>` +
             `<span class="jp"${v2Attr(ep + '.jp', ep + '.jp_ruby', 'leaf')}>${unitsHTML(x.jp, false)}${em('jp')}</span></div>`;
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

// 資料路徑 → DOM 落點。**為什麼需要這張表**（C321 逐處實測 `editAttr` 的呼叫面，非推想）：
//   `data-edit` 發出來的詞彙是**版面**的，批注的 `path` 是**資料**的，兩者不是同一組字串——
//   ・中譯住在現代化例句欄，其 `data-edit` 是 `…examples[j].modern`，資料路徑卻是 `…examples[j].zh`；
//     若改用「最長前綴」退讓，`senses[0].examples[1].zh` 會退到**原冊層**的 `senses[0].examples[1]`，
//     而該處的日文釋義字面常與中譯的引文同字（實例：p1006-2-09 的 jp 就是「斬鑪。」）
//     ⇒ 記號會插到原冊層的日文上，看起來還「成功」了。故用明表、不用前綴。
//   ・表頭各欄（`head.kanji`／`head.kana`／`head.poj`）在版面上共用同一個 `data-edit="head"`。
//
// ── C322 補第三欄〈宿主內範圍〉。實案＝p0092-1-06 記號落在台語原句「火油」的「油」後面 ──
//   ⚠ **不是**「`zh` 對不到 DOM 元素」：上表第一列當初就寫了 `zh` → `modern`，`querySelector`
//   找得到。真因是**找到的那個元素太大**——`<div class="example" data-edit="…modern">` 裡同時裝著
//   `<span class="tw">`（台語現代化行）與 `<span class="zhline">`（中譯行），而 `insertAfterQuote`
//   按文件序走文字節點，台語行排在中譯行前面 ⇒ 先撞到。2026-09-29 線上逐頁實測：該枚不只落錯行，
//   還落進了 ruby 注音盒的**底字**（`span.rb.poj` 之內）——底字是 `.ann` 的兄弟節點、不是它的後代，
//   所以下面那道 `.ann, rt` 過濾放它過（那是對的：底字本來就是本文）。
//   ⇒ 治法＝**先把搜尋範圍收窄到該欄自己的元素**，再搜 quote。
//   ⚠ 同批四枚裡 p1006-2-09 之所以沒出事，是「斬鑪」只在中譯出現、台語行是代用符「斬ー」
//   ＝**碰巧過的，不是設計上安全的**；不可拿它當「這條路沒問題」的證據。
//
// ⚠ **本表與 `website/build/export_site_data.py` 的 `ANNOT_DOM_SCOPE` 是同一件事的兩份**
//   （JS＝渲染端、Python＝驗收端）。照 M050 定案 §十一 對「path 互轉 JS／Python 各一份」的處置
//   ＝**改同步戳**：兩邊各帶一個戳，`test_export` 讀本檔原始碼斷言兩戳相等 ⇒ 漂移是機械可見的，
//   不是靠誰記得。**改本表必同時改那一支並 bump 兩邊的戳。**
const AN_DOM_SYNC = 'C322';
const AN_DOM_PATH = [
  // [資料路徑, DOM 宿主之 data-edit 值, 宿主內之範圍選擇器（null＝宿主自己就是該欄）]
  [/^(senses\[\d+\]\.examples\[\d+\])\.zh$/, '$1.modern', '.zhline'],
  [/^head\.[A-Za-z_]\w*$/, 'head', null],
];
function annDomPath(path) {
  for (const [re, to, scope] of AN_DOM_PATH) {
    if (re.test(path)) return { sel: path.replace(re, to), scope: scope || null };
  }
  return { sel: path, scope: null };
}

// 在錨點元素內找 quote，把記號插在該字之後；ruby 注音盒（.ann）與 <rt> 內的文字不算
//（那是注音、不是本文；在注音裡命中會把記號插進假名中間）。
// ⚠ 注音盒的**底字**不在此列——它是 `.ann` 的兄弟節點、是本文，故放行（C322 覆核，行為不變）。
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
// C322：宿主之內再收窄一層（見上表第三欄）。收窄不到＝該欄此刻沒渲染（例：中譯為「翻譯建置中」
//   時沒有 `.zhline`）⇒ 退行尾，而**不是**回頭在整個宿主裡搜——那正是 p0092 那一枚的成因。
function placeMarkers(e, root) {
  (e.annots || []).forEach((a, i) => {
    if (!a.path) return;
    const dp = annDomPath(a.path);
    const host = root.querySelector(`[data-edit="${dp.sel}"]`);
    if (!host) return;
    const scoped = dp.scope ? host.querySelector(dp.scope) : host;
    const sup = document.createElement('sup');
    sup.className = 'an';
    sup.id = a.nid + '-m';
    sup.innerHTML = `<a href="#${a.nid}" title="做工á人批注 ${i + 1}">${i + 1}</a>`;
    const atEnd = !a.quote || !scoped || host.classList.contains('gloss');
    if (atEnd || !insertAfterQuote(scoped, a.quote, sup)) host.appendChild(sup);
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
  const proofChip = TEAM.on
    ? `<span class="chip proof" title="團隊模式（${esc(TEAM.name)}）：雙擊任何文字段可直接修正">團隊模式</span>` : '';
  const skelChip = e.status === 'skeleton'
    ? '<span class="chip skel" title="表頭為機器辨識初稿，尚未精校">建置中</span>' : '';
  const blank = isBlankKanji(h.kanji);   // □ 表頭：POJ 主位、□ 退次要（2026-07-12）
  const hzAttrs = `${editAttr('head')}${v2Attr('head.kanji')}${origAttr(h.kanji + '｜' + kanaTxt + '｜' + h.poj, '')}`;
  // C333（U117）：骨架條目的假名畫在這裡、沒有 `origHead` ⇒ 原本不在任何 `[data-edit]` 裡，
  //   雙擊入口（`init` 的 `closest('[data-edit]')`）直接丟掉、音節編輯器開不起來。
  //   比照 `origHead` 給宿主掛 `data-edit="head"`（不掛 `data-v2`：音節槽由 `.kt` 定）。
  //   `.hz` 排在前面 ⇒ `placeMarkers` 取「文件序第一個」宿主仍落在 `.hz`，批注記號位置不變。
  const knAttrs = `${editAttr('head')}${origAttr(h.kanji + '｜' + kanaTxt + '｜' + h.poj, '')}`;
  const mix = blank ? null : mixKanjiParts(h.kanji_units, h.poj);
  const hzHTML = blank
    ? `<span class="hz pjhz"${hzAttrs}>${esc(h.poj)}${unc}</span><span class="dimk">${esc(h.kanji)}</span>`
    : `<span class="hz"${hzAttrs}>${mix ? mixHTML(mix) : esc(h.kanji_disp || h.kanji)}</span>`;
  return `<div class="entryhead">
    ${hzHTML}
    ${blank ? '' : `<span class="pj"${h.poj_star ? ' title="採校訂值（見原冊區＊註）"' : ''}>${esc(h.poj)}${h.poj_star ? '*' : ''}${unc}</span>`}
    ${h.dial ? `<span class="dial" title="腔口註記：原冊印於釋義處（照印見原冊數位化區）">（${esc(h.dial)}）</span>` : ''}
    ${withKana ? `<span class="kn"${knAttrs}>${headKanaHTML(h)}</span>` : ''}${skelChip}${proofChip}
    <button class="reportbtn hd" data-block="表頭">回報錯誤</button>${commentLink(e)}
    <span class="loc">${esc(locText(e))}</span>
    ${navHTML(e)}
  </div>`;
}

// C332（M050 場 3 之 3）：條目頁顯示留言數（定案 §四 場 3「批注卡或表頭條」⇒ 取表頭條：
//   批注卡無批注不渲染，掛在那裡會讓「有留言、沒批注」的條目看不到）。
//   `e.comments` 由 export 只在 >0 時寫（C321 README §六：寫 0 是假資料）⇒ 沒有就不畫。
function commentLink(e) {
  const n = parseInt(e && e.comments, 10);
  if (!(n > 0)) return '';
  return `<a class="cmtlink" href="comments.html?id=${encodeURIComponent(e.id)}">留言 ${n} 則 →</a>`;
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
  return `<div class="orighead"${attrs}><span class="okn">${headKanaHTML(h)}</span><span class="ohz"${v2Attr('head.kanji')}>【${headKanjiHTML(h)}】</span></div>`;
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
// ══ C332（M050 場 3 之 1）：統一對話框（定案 §二 2／4／9、§四 場 3 之 1）═══════════════
// 四顆區塊鈕留作入口、對話框統一；類別依按鈕預選、可改；類別決定 cls（`feedback_daily.CAT_CLS`）。
// ⚠ 送進 D1 `cat` 的字串必須與 `review_live/feedback_daily.py` 的 `CAT_CLS` 鍵＋`COMMENT_CAT`
//   **逐字相同**（`test_report_dialog.py` 機械對版）。定案 §二 9 稱「留言補充」，D1 值是「留言」（§三）。
const REPORT_CATS = ['表頭', '原冊改錯字', '翻譯意見', '留言'];
const COMMENT_CAT = '留言';
const ANNOT_CAT = '批注';                      // 團隊模式多一類「批注草稿」（定案 §二 9／10）
// 按鈕 → 預選類別。「原冊書影」鈕預選改錯字＝定案 §二 9 明文。
const BLOCK_CAT = { '表頭': '表頭', '原冊數位化': '原冊改錯字', '原冊書影': '原冊改錯字',
                    '現代化對照': '翻譯意見' };
// ⚠ 本表＝`website/build/export_site_data.py` 的 `ANNOT_KINDS`（單一真相）的瀏覽器副本；
//   `test_report_dialog.py` 讀兩邊原始碼斷言相等。批注草稿的 kind 借 D1 `fixkind` 欄送
//   （C330 自裁、`SOP_拉校對` §十 第 2 條）。
const ANNOT_KINDS_UI = ['補充', '異見', '理由'];
const CAT_HINT = {
  // ⚠ 不寫「一小時內」：每小時工作只在有快車道修正時才發布（`fastlane_hourly` 步 11），
  //   留言要等下一次發布（C332 實查）。
  '留言': '留言會在下一次網站更新後出現在「留言」頁。站方不在留言頁回覆、'
        + '不保證回覆；有價值的意見會引用進「做工á人批注」。',
  '批注': '批注草稿進收件匣，經站主核定（可改字）後才上站；卡標題即署名，不標個人。',
};

function catForBlock(block) {
  return BLOCK_CAT[block] || '原冊改錯字';
}

// 批注錨點的資料路徑解析——**與 `export_site_data.annot_path_resolve` 同一套語法**
//   （`鍵` 或 `鍵[n]` 以 `.` 相連）。解析不到回 undefined（站面條目上合法的 null 不算失敗）。
function annResolve(entry, path) {
  let cur = entry;
  for (const seg of String(path || '').split('.')) {
    const m = /^([A-Za-z_]\w*)((?:\[\d+\])*)$/.exec(seg);
    if (!m || cur == null || typeof cur !== 'object' || !(m[1] in cur)) return undefined;
    cur = cur[m[1]];
    for (const n of (m[2].match(/\d+/g) || [])) {
      if (!Array.isArray(cur) || +n >= cur.length) return undefined;
      cur = cur[+n];
    }
  }
  return cur;
}

// 選取文字／雙擊入口 → 批注的 `{path, quote}`（定案 §二 5：path 必填、quote 選填）。
//   `hostPath`＝`[data-edit]` 的值（**版面**詞彙），要換成**資料**路徑才是批注的 path
//   （兩者不是同一組字串，見上方 `AN_DOM_PATH` 的長註）：
//   ・現代化例句欄 `…examples[j].modern`：選在中譯行（`.zhline`）＝`…examples[j].zh`；
//     選在台語行＝在該例句的字串欄裡找含引文者。
//   ・表頭 `head`：`head.kanji` → `head.poj` 依序找含引文者。
//   ・其餘：宿主路徑本身是字串欄就用它；是物件就在**直接子欄**（不含 `*_units`、**不含 `zh`**）裡找
//     含引文者。⚠ 不含 `zh`：原冊層例句的 `tw`／`jp` 是 units 陣列、只有 `zh` 是字串（C332 實查
//     p0092-1-06），在原冊層選了「油」若往 `zh` 找就會錨到現代層的中譯上——選的明明是日文。
//   找不到含引文的字串欄＝退用宿主本身的路徑、丟引文（解析得出、記號落該欄行尾；定案 §二 5 設計內）。
//   路徑全解析不出＝回空，由站主在卡面補（`apply_annots` 的錨點閘擋空路徑，不會寫壞）。
function annDraftAnchor(entry, hostPath, inZh, quote) {
  const q = String(quote || '').trim();
  const hp = String(hostPath || '');
  if (!entry || !hp) return { path: '', quote: q };
  let cands;
  const mm = /^(senses\[\d+\]\.examples\[\d+\])\.modern$/.exec(hp);
  if (mm) cands = inZh ? [mm[1] + '.zh'] : [mm[1]];
  else if (hp === 'head') cands = ['head.kanji', 'head.poj'];
  else cands = [hp];
  let firstOk = '';
  for (const c of cands) {
    const v = annResolve(entry, c);
    if (v === undefined) continue;
    if (typeof v === 'string') {
      if (!firstOk) firstOk = c;
      if (!q || v.indexOf(q) >= 0) return { path: c, quote: q };
      continue;
    }
    if (v && typeof v === 'object' && !Array.isArray(v) && q) {
      for (const k of Object.keys(v)) {
        if (k === 'zh' || /_units$/.test(k) || typeof v[k] !== 'string') continue;
        if (v[k].indexOf(q) >= 0) return { path: c + '.' + k, quote: q };
      }
    }
    if (!firstOk && v !== null && typeof v === 'object') firstOk = c;
  }
  // 解析得出但引文對不上＝留路徑、丟引文（`apply_annots` ③ 要求 quote 在錨點值內，帶著必被擋）
  return firstOk ? { path: firstOk, quote: '' } : { path: '', quote: q };
}

// 對話框內容 → POST 的列（純函式；`test_report_dialog.py` 在 node 實跑）。
//   ・`cat` 一律送（之前完全不送、四類全靠 `block` 判 cls）。
//   ・原冊改錯字：「原文→應為」進 D1 既有的 `before`／`after` 欄。
//   ・批注草稿：`path`／`quote`、kind 借 `fixkind`；暱稱不送（團隊列由伺服器蓋章）。
//   ・團隊帶鑰匙（免驗）；一般讀者帶 Turnstile token（沒有就不帶＝伺服器標 missing、照收）。
function buildReportRec(o) {
  const rec = { source: 'online', ts: o.ts, id: o.eid, block: o.block,
                note: o.note, reporter: o.team ? '' : (o.reporter || ''), cat: o.cat };
  if (o.cat === '原冊改錯字') {
    if (o.before) rec.before = o.before;
    if (o.after) rec.after = o.after;
  }
  if (o.cat === ANNOT_CAT) {
    rec.path = o.path || '';
    rec.quote = o.quote || '';
    rec.fixkind = o.kind || '';
  }
  if (o.team) rec.token = o.token;
  else if (o.cfToken) rec.cf_turnstile = o.cfToken;
  return rec;
}

// 送出前的空檢查：說明必填；原冊改錯字有「應為」也算有內容（伺服器端判準＝note 或 after 非空）。
function reportEmptyWhy(o) {
  if (o.cat === ANNOT_CAT && !o.path) return '批注草稿需要錨點：先選取本文的文字（或雙擊該欄）再開這個框。';
  if (!o.note && !(o.cat === '原冊改錯字' && o.after)) return '請先描述內容。';
  return '';
}

let reportCtx = '';
let reportBlock = '';
let reportEid = '';
let reportAnn = { path: '', quote: '' };
let LAST_SEL = null;          // 最近一次落在條目本文裡的選取（批注草稿的 quote 與錨點來源）
let tsWidget = null;          // Turnstile widget id（render 一次、之後 reset）
let tsToken = '';

function rememberSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = String(sel.toString() || '').trim();
    if (!text || text.length > 200) return;
    const n = sel.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const host = el && el.closest && el.closest('[data-edit]');
    const root = $('#entry');
    if (!host || !root || !root.contains(host)) return;   // 選在對話框裡等＝不覆蓋
    LAST_SEL = { quote: text, hostPath: host.getAttribute('data-edit') || '',
                 inZh: !!el.closest('.zhline') };
  } catch (e) {}
}

function tsRender() {
  const box = $('#rturnstile');
  if (!box) return;
  tsToken = '';
  box.style.display = TEAM.on ? 'none' : '';
  if (TEAM.on) return;                                     // 團隊鑰匙免驗（定案 §二 9）
  try {
    const ts = window.turnstile;
    if (!ts || !window.TURNSTILE_SITEKEY) return;          // 沒載到＝不帶 token、照樣送得出去
    if (tsWidget == null) {
      tsWidget = ts.render(box, {
        sitekey: window.TURNSTILE_SITEKEY,
        callback: t => { tsToken = t || ''; },
        'expired-callback': () => { tsToken = ''; },
        'error-callback': () => { tsToken = ''; return true; },
      });
    } else {
      ts.reset(tsWidget);
    }
  } catch (e) { tsToken = ''; }
}

function setReportCat(cat) {
  document.querySelectorAll('#reportcat input[name=rcat]').forEach(r => { r.checked = (r.value === cat); });
  const rf = $('#rfix'), ra = $('#rann');
  if (rf) rf.classList.toggle('on', cat === '原冊改錯字');
  if (ra) ra.classList.toggle('on', cat === ANNOT_CAT);
  $('#rcathint').textContent = CAT_HINT[cat] || '';
  $('#reporttext').placeholder = cat === COMMENT_CAT ? '想補充或討論的內容（純文字）'
    : cat === ANNOT_CAT ? '批注本文（編者按：補充／異見／理由）'
    : '請描述問題（哪個字、哪個注音／翻譯有誤，正確應為…）';
}

function currentReportCat() {
  const r = document.querySelector('#reportcat input[name=rcat]:checked');
  return r ? r.value : catForBlock(reportBlock);
}

// `pre`：{cat, hostPath, inZh, quote}——雙擊入口「改寫批注草稿」帶進來的錨點。
function openReport(block, eid, pre) {
  reportBlock = block;
  reportEid = eid;
  reportCtx = `【回報】條目 ${eid}／區塊：${block}`;
  $('#reportctx').textContent = reportCtx;
  $('#reporttext').value = '';
  $('#rbefore').value = '';
  $('#rafter').value = '';
  try { $('#reportname').value = localStorage.getItem('tjss_reporter') || ''; } catch (e) {}
  $('#rnamebox').style.display = TEAM.on ? 'none' : '';    // 團隊模式暱稱欄隱藏（定案 §二 9）
  // 批注錨點：雙擊入口帶的優先，其次最近一次本文選取
  const src = (pre && pre.hostPath) ? pre : (LAST_SEL || {});
  reportAnn = annDraftAnchor(ENTRY, src.hostPath, !!src.inZh, (pre && pre.quote) || src.quote || '');
  $('#rannpath').textContent = reportAnn.path
    ? `錨點：${reportAnn.path}` : '錨點：（未定——先選取本文的文字或雙擊該欄）';
  $('#rannquote').value = reportAnn.quote;
  $('#rannkind').innerHTML = ANNOT_KINDS_UI.map(k => `<option>${esc(k)}</option>`).join('');
  let cat = (pre && pre.cat) || catForBlock(block);
  if (cat === ANNOT_CAT && !TEAM.on) cat = COMMENT_CAT;
  setReportCat(cat);
  tsRender();
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
  const cat = currentReportCat();
  const o = {
    ts: new Date().toISOString(), eid: eid || reportEid, block: reportBlock, cat,
    note: $('#reporttext').value.trim(),
    reporter: TEAM.on ? '' : $('#reportname').value.trim(),
    before: $('#rbefore').value.trim(), after: $('#rafter').value.trim(),
    path: reportAnn.path, quote: $('#rannquote').value.trim(), kind: $('#rannkind').value,
    team: TEAM.on, token: TEAM.token, cfToken: tsToken,
  };
  const why = reportEmptyWhy(o);
  if (why) { alert(why); return; }
  if (!TEAM.on) { try { localStorage.setItem('tjss_reporter', o.reporter); } catch (e) {} }
  const rec = buildReportRec(o);
  let j = null;
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, teamAuth()),
      body: JSON.stringify(rec),
    });
    j = r.ok ? await r.json() : null;
  } catch (e) { j = null; }
  if (j && j.ok === true) {
    if (cat === COMMENT_CAT) {
      // 未通過自動驗證的留言照收，但留言頁只在站方看過後才出（export `comment_visible`）
      const unverified = j.turnstile && j.turnstile !== 'ok' && j.turnstile !== 'team';
      alert('已送出，感謝留言！' + (unverified
        ? '\n（這則留言沒有通過自動驗證，站方看過之後才會出現在留言頁。）'
        : '\n下一次網站更新後會出現在「留言」頁。'));
    } else {
      alert('已送出，感謝回報！');
    }
  } else {
    await fallbackCopy(reportCtx + '\n類別：' + cat + '\n回報者：' + o.reporter + '\n說明：' + o.note
      + (o.after ? '\n原文→應為：' + o.before + ' → ' + o.after : ''));
  }
  tsToken = '';
  $('#reportbox').classList.remove('on');
}

// ══ C324：團隊模式的編輯器（定案 §四 場 2 之 3）════════════════════════════
// 舊的本機校對模式（`LOCAL` ＋ 送 `bridge_server :8765 /feedback` ＋剪貼簿退路）整段退場
// （定案 §二 15）：改為團隊鑰匙 ＋ 直送 `/api/feedback`。
// ⚠ **這裡沒有剪貼簿退路了**——舊退路是給「本機伺服器沒開」的，而線上端點沒有那個狀態；
//   送不出去就照實說送不出去。`sendReport()`（一般讀者的回報鈕）那條退路照舊，不受影響。

let editTarget = null;        // 被雙擊的元素
let editSlot = null;          // 本次編輯的槽位描述（見 describeSlot）
let entryId = '';
let ENTRY = null;             // 本頁條目資料（產 op 時的 old 來源之一）

// ── 團隊鑰匙 ───────────────────────────────────────────────────────────────
function teamAuth() {
  return TEAM.on ? { Authorization: 'Bearer ' + TEAM.token } : {};
}

async function teamCheck(token) {
  // `GET /api/team?token=` → {ok,name}；無效一律 401 且不回 name（team.js）
  try {
    const r = await fetch('/api/team?token=' + encodeURIComponent(token),
                          { cache: 'no-store' });
    if (!r.ok) return '';
    const j = await r.json();
    return (j && j.ok && j.name) ? String(j.name) : '';
  } catch (e) { return ''; }
}

function teamPaint() {
  const who = $('#teamwho');
  const btn = $('#teambtn');
  if (!who || !btn) return;
  who.textContent = TEAM.on ? `（${TEAM.name}）` : '';
  btn.textContent = TEAM.on ? '登出' : '團隊登入';
  document.body.classList.toggle('team', TEAM.on);
  // `proof` 是既有的樣式鉤（`body.proof [data-edit]` 的游標與虛線框）——換旗標不換樣式，
  // 免得為了改名而動到一批與本場無關的 CSS。
  document.body.classList.toggle('proof', TEAM.on);
}

async function teamBoot() {
  let tok = '';
  try { tok = localStorage.getItem(TEAM_KEY) || ''; } catch (e) { tok = ''; }
  if (!tok) { teamPaint(); return; }
  const name = await teamCheck(tok);
  if (name) {
    TEAM.on = true; TEAM.name = name; TEAM.token = tok;
  } else {
    // 鑰匙被撤銷（定案 §七：撤那一把重佈署）⇒ 本機那把當場作廢，退回一般讀者
    TEAM.on = false; TEAM.name = ''; TEAM.token = '';
    try { localStorage.removeItem(TEAM_KEY); } catch (e) {}
  }
  teamPaint();
}

async function teamToggle() {
  if (TEAM.on) {
    TEAM.on = false; TEAM.name = ''; TEAM.token = '';
    try { localStorage.removeItem(TEAM_KEY); } catch (e) {}
    teamPaint();
    location.reload();
    return;
  }
  const tok = (prompt('貼上團隊鑰匙（只存在這台瀏覽器）：') || '').trim();
  if (!tok) return;
  const name = await teamCheck(tok);
  if (!name) { alert('這把鑰匙無效。'); return; }
  TEAM.on = true; TEAM.name = name; TEAM.token = tok;
  try { localStorage.setItem(TEAM_KEY, tok); } catch (e) {}
  teamPaint();
  location.reload();
}

// ── 產 op 用的 v2 原值（`data/opsrc/{page}.json`）───────────────────────────
async function loadOpsrc(page) {
  try {
    const r = await fetch(`data/opsrc/${page}.json`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.v !== PATH_SYNTAX_VERSION) {
      // 戳不合＝站上的 opsrc 是別的版本產的 ⇒ 寧可整片退描述模式，不拿舊格式硬產 op
      console.warn('opsrc 版本戳不符', j && j.v, '≠', PATH_SYNTAX_VERSION);
      return null;
    }
    return (j.entries || {})[entryId] || null;
  } catch (e) { return null; }
}

// ── v2 路徑 → 現值（葉型；token 型一律取自 OPSRC）──────────────────────────
// ⚠ **不從 DOM 取**：畫面上的字混著注音盒、†／＊ 上標與 □ 的 POJ 代字，取出來不等於葉值。
//   這裡一律回推到條目資料本身——`textOfUnits` 把單位接回去就是原葉值（`attach_ruby` 不丟字）。
function leafOld(arr) {
  const e = ENTRY;
  if (!e || !arr) return null;
  try {
    if (arr.length === 2 && arr[0] === 'head' && arr[1] === 'kanji') {
      return String(e.head.kanji == null ? '' : e.head.kanji);
    }
    if (arr[0] !== 'senses') return null;
    const sn = (e.senses || [])[arr[1]];
    if (!sn) return null;
    if (arr[2] === 'gloss') {
      const units = sn.gloss || [];
      if (!units.length) return null;          // 整槽參照：gloss 不出文字 ⇒ 產不出 op
      if (arr.length === 4 && arr[3] === 'jp') return textOfUnits(units);
      if (arr[2] === 'gloss' && arr[3] === 'ruby') return rubyLeaf(units, arr[4], arr[5]);
      return null;
    }
    if (arr[2] === 'examples') {
      const x = (sn.examples || [])[arr[3]];
      if (!x) return null;
      if (arr.length === 5 && (arr[4] === 'tw' || arr[4] === 'jp')) {
        return textOfUnits(x[arr[4]]);
      }
      if (arr[4] === 'jp_ruby') return rubyLeaf(x.jp, arr[5], arr[6]);
      return null;
    }
  } catch (err) { return null; }
  return null;
}
// ruby 葉：`k`＝注音本身、`c`＝被注的那個字（`attach_ruby` 掛載時 unit.u 就是 ruby.c）
function rubyLeaf(units, ri, key) {
  let n = 0;
  for (const u of units || []) {
    if (!u.r) continue;
    if (n === ri) return key === 'k' ? String(u.r.k == null ? '' : u.r.k) : String(u.u);
    n += 1;
  }
  return null;
}

// ── 雙擊的元素 → 槽位描述 ──────────────────────────────────────────────────
// 回 {mode, path, old, host}；mode ∈ syl（音節）／leaf（文字葉）／sep（切換鈕）／desc（描述）。
// **產不出 op 一律回 desc**——定案 §四 場 2 之 3 的「自動退描述模式並提示」。
function describeSlot(el) {
  const host = el.closest('[data-edit]');
  const editPath = host ? (host.dataset.edit || '') : '';
  const base = { mode: 'desc', path: '', old: null, editPath, host, why: '' };

  const sep = el.closest('.ksep');
  if (sep) {
    const i = parseInt(sep.dataset.ksep, 10);
    const cur = OPSRC && Array.isArray(OPSRC.sep) ? OPSRC.sep[i] : undefined;
    if (typeof cur !== 'string') {
      return Object.assign(base, { why: '本條目沒有可改的音節分隔（`head.sep` 未建）' });
    }
    return { mode: 'sep', path: `head.sep[${i}]`, old: cur, editPath, host, why: '' };
  }

  const kt = el.closest('.kt');
  if (kt) {
    const i = parseInt(kt.dataset.kt, 10);
    const tok = OPSRC && Array.isArray(OPSRC.kana) ? OPSRC.kana[i] : null;
    if (!tok) return Object.assign(base, { why: '拿不到這個音節的原值（opsrc 未載入）' });
    return { mode: 'syl', path: `head.kana[${i}]`, old: tok, editPath, host, why: '' };
  }

  const rb = el.closest('.rb[data-ri]');
  const rbHost = el.closest('[data-rb]');
  if (rb && rbHost) {
    const ri = parseInt(rb.dataset.ri, 10);
    const rbPath = rbHost.dataset.rb || '';
    if (rbHost.dataset.rbk === 'token') {
      // `senses[i].examples[j].tw_ruby[k]`：整個 token
      const m = /^senses\[(\d+)\]\.examples\[(\d+)\]\.tw_ruby$/.exec(rbPath);
      const toks = (m && OPSRC && OPSRC.twr) ? OPSRC.twr[`${m[1]}.${m[2]}`] : null;
      const tok = toks ? toks[ri] : null;
      if (!tok) return Object.assign(base, { why: '拿不到這個音節的原值（opsrc 未載入）' });
      return { mode: 'syl', path: `${rbPath}[${ri}]`, old: tok, editPath, host, why: '' };
    }
    // `…gloss.ruby[j].k` 與 `…jp_ruby[k].k`：注音本身是字串葉
    const p = `${rbPath}[${ri}].k`;
    const old = leafOld(pathToArr(p));
    if (old == null) return Object.assign(base, { why: '拿不到這個注音的原值' });
    return { mode: 'leaf', path: p, old, editPath, host, why: '', leafLabel: '注音（假名）' };
  }

  const v2el = el.closest('[data-v2]');
  if (v2el) {
    const p = v2el.dataset.v2 || '';
    const old = leafOld(pathToArr(p));
    if (old == null || old === '') {
      return Object.assign(base, { why: '這一欄在資料層沒有對得上的整葉值（例：整槽參照）' });
    }
    if (!opKind(p)) return Object.assign(base, { why: '這個欄位不在 op 白名單內' });
    return { mode: 'leaf', path: p, old, editPath, host, why: '' };
  }

  return Object.assign(base, {
    why: editPath ? '這個欄位不在 op 白名單內（例：中譯、註、參照、書影）' : '',
  });
}

// ── 對話框 ─────────────────────────────────────────────────────────────────
const SYMS = ['□', 'ーー', '〳〵', '、', '。', '・', '「', '」'];

function showPane(mode) {
  for (const id of ['editsyl', 'editleaf', 'editsep', 'editdesc']) {
    const el = $('#' + id);
    if (el) el.classList.toggle('on', id === 'edit' + mode);
  }
}

function openEdit(el) {
  if (!TEAM.on) return;
  editTarget = el;
  editSlot = describeSlot(el);
  const s = editSlot;
  // C326：這一格已有排隊中的修正 ⇒ old 取疊加後的淨結果，不取已發布的原值。
  //   定案 §二 14「疊完可再修（新 op 的 old＝前一筆的 new）」；原本取原值 ⇒ 第二筆的 old
  //   對不上鏈、疊加層靜靜不畫，每小時工作套用時也對不上而退卡。
  const pend = s.path ? PATCHES.find(p => patchPathStr(p.op.path) === s.path) : null;
  if (pend) s.old = pend.op.new;
  $('#editctx').textContent = s.path
    ? `條目 ${entryId}／槽位 ${s.path}`
    : `條目 ${entryId}／欄位 ${s.editPath || '（整條）'}`;
  $('#editnote').value = '';
  $('#editfix').querySelectorAll('input[name=edfix]').forEach(r => { r.checked = false; });
  $('#edithint').textContent = '';

  if (s.mode === 'syl') {
    $('#edkana').value = String(s.old.k || '');
    $('#edtone').value = String(s.old.tone == null ? '' : s.old.tone);
    $('#ednasal').checked = !!s.old.nasal;
    $('#edasp').checked = !!s.old.asp;
    $('#edpoj').value = '';
    sylPreview();
  } else if (s.mode === 'leaf') {
    $('#editleaflab').textContent = s.leafLabel || '整葉值';
    $('#editorig').value = s.old;
    $('#editnew').value = s.old;
    $('#edsyms').innerHTML = SYMS.map(
      c => `<button type="button" class="symbtn" data-sym="${esc(c)}">${esc(c)}</button>`).join('');
  } else if (s.mode === 'sep') {
    const opts = [['', '無（一般連寫）'], ['--', '-- 輕聲'], ['|', '| 詞界']];
    $('#edsepbtns').innerHTML = opts.map(([v, lab]) =>
      `<button type="button" class="sepbtn${v === s.old ? ' cur' : ''}" data-sep="${esc(v)}">${esc(lab)}</button>`
    ).join('');
    $('#edsepnow').textContent = `現值：${s.old === '' ? '（無）' : s.old}`;
  } else {
    // 退描述模式並提示為什麼（定案 §四 場 2 之 3）
    $('#editwhy').textContent = s.why
      ? `這一處產不出機器可讀的改法（${s.why}）⇒ 以文字說明送出，由站主判讀。`
      : '以文字說明送出，由站主判讀。';
    $('#editdesctext').value = '';
  }
  showPane(s.mode);
  $('#editbox').classList.add('on');
  const first = { syl: '#edkana', leaf: '#editnew', sep: '#edsepbtns', desc: '#editdesctext' }[s.mode];
  const f = $(first);
  if (f && f.focus) f.focus();
}

// 音節編輯器的即時預覽（定案 §四 場 2 之 3：POJ 欄 → `pojToKana` 即時預覽站上渲染）
// ⚠ 轉換一律走站上既有的 `poj_converter.js`（`ENGINE_VERSION` 與 `v2_redo/kana_poj.py` 同步）
//   ——不在這裡另寫一份（M033 §0.3：複製即漂移）。
// ⚠ **兩支的回傳形狀是 node 實測的、不是照名字猜的**（C324 自抓，首版兩處都猜錯）：
//   `pojToKana(poj)` → `[假名, 調記字串]`（如 `['タ·ヌ','3']`、`['チ̄ウ','1n']`）或 `null`
//     ——不是物件。送氣記號 `·` 是**寫在假名裡**的，不另外回一個旗標。
//   `kanaToPoj(假名)` → **候選物件陣列**，每個帶 `.display`（帶調號的 POJ）與 `.ascii`；
//     無解時回空陣列。⚠ 空陣列在 JS 裡是 truthy，直接拿來做三元判斷會印出空括號。
function sylPreview() {
  const poj = $('#edpoj').value.trim();
  if (poj && typeof pojToKana === 'function') {
    try {
      const got = pojToKana(poj);
      if (Array.isArray(got) && got[0]) {
        $('#edkana').value = got[0];
        const m = /^([1-8]?)(n?)$/.exec(String(got[1] || ''));
        if (m) {
          // 顯示層第 1 調不標（`display_tn`）⇒ 反推時 '1' 與 '' 都落成空
          $('#edtone').value = (m[1] === '1') ? '' : m[1];
          $('#ednasal').checked = (m[2] === 'n');
        }
      }
    } catch (e) { /* 換不出來就讓使用者自己打假名 */ }
  }
  const tok = sylToken();
  let back = '';
  if (typeof kanaToPoj === 'function') {
    try {
      const cand = kanaToPoj(tokDisp(tok));
      back = (Array.isArray(cand) ? cand : [])
        .map(c => (c && c.display) || '').filter(Boolean).join('／');
    } catch (e) { back = ''; }
  }
  $('#edprev').textContent = `站上會顯示：${tokDisp(tok)}`
    + (back ? `（POJ ${back}）` : '（POJ 換不出來——假名或調號可能不合法）');
}

// 表單 → 新 token。⚠ **鍵組必須與現值完全相同**（`validate_op`：不得增刪欄，note／ed 原樣保留）
function sylToken() {
  const old = (editSlot && editSlot.old) || {};
  const out = {};
  for (const k of Object.keys(old)) out[k] = old[k];
  out.k = $('#edkana').value.trim();
  if ('tone' in out) out.tone = $('#edtone').value;
  if ('nasal' in out) out.nasal = $('#ednasal').checked;
  if ('asp' in out) out.asp = $('#edasp').checked;
  return out;
}

// ── 送出 ───────────────────────────────────────────────────────────────────
function sameToken(a, b) {
  const ka = Object.keys(a || {}).sort();
  const kb = Object.keys(b || {}).sort();
  if (ka.join('\u0001') !== kb.join('\u0001')) return false;
  return ka.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

function buildOp() {
  const s = editSlot;
  if (!s || s.mode === 'desc') return null;
  const arr = pathToArr(s.path);
  const kind = opKind(s.path);
  if (!arr || !kind) return null;
  if (s.mode === 'syl') {
    if (kind !== 'token') return null;
    const nw = sylToken();
    if (!nw.k) return { err: '假名不得為空。' };
    if (sameToken(nw, s.old)) return { err: '沒有改到東西。' };
    return { op: { path: arr, old: s.old, new: nw } };
  }
  const nw = (s.mode === 'sep') ? s.newSep : $('#editnew').value;
  if (typeof nw !== 'string') return { err: '請先選一個值。' };
  if (nw === s.old) return { err: '沒有改到東西。' };
  if (/[\r\n]/.test(nw)) return { err: '修正值不得含換行（整葉值是一行）。' };
  if (nw.length > 300) return { err: '修正值過長（>300 字元）＝疑似整段重寫，請改用文字說明。' };
  return { op: { path: arr, old: s.old, new: nw } };
}

const SENT_HINT = '已送出，頁面已即時顯示（校對中）；正式上站＝下一次整點發布'
                + '（通常一小時內，最慢隔日 08:00）';

// 送出的 note。描述模式＝說明，有備註時另起一行接「備註：…」；其餘模式＝備註。
// C326：原本描述模式只取說明，而對話框在描述模式照樣顯示備註欄 ⇒ 寫在備註欄的判讀依據
//   會靜靜掉（本機 wrangler 實測：中譯、表頭整列、例句整行幾筆的備註皆未入庫）。
function editNoteOf(mode, desc, extra) {
  const d = String(desc == null ? '' : desc).trim();
  const x = String(extra == null ? '' : extra).trim();
  if (mode !== 'desc') return x;
  if (!x) return d;
  return d ? `${d}\n備註：${x}` : `備註：${x}`;
}

async function submitEdit() {
  if (!editSlot || !TEAM.on) return;
  const s = editSlot;
  const fixEl = $('#editfix').querySelector('input[name=edfix]:checked');
  if (!fixEl) { $('#edithint').textContent = '請先選「數位化打錯」或「原書印面本身有誤」。'; return; }
  const fixkind = fixEl.value;

  let op = null;
  let after = '';
  if (s.mode === 'desc') {
    after = '';
  } else {
    const b = buildOp();
    if (!b) { $('#edithint').textContent = '這一處產不出機器可讀的改法。'; return; }
    if (b.err) { $('#edithint').textContent = b.err; return; }
    op = b.op;
    after = (s.mode === 'syl') ? tokDisp(op.new) : String(op.new);
  }
  // 「原書印面本身有誤」永遠走裁決（定案 §二 12）——不是快車道，但 op 照送：
  //   站主看得到機器可讀的改法，只是不自動套。
  if (s.mode === 'desc' && !$('#editdesctext').value.trim()) {
    $('#edithint').textContent = '請先寫說明。'; return;
  }
  const note = editNoteOf(s.mode, $('#editdesctext').value, $('#editnote').value);

  const rec = {
    source: 'website',
    ts: new Date().toISOString(),
    id: entryId,
    block: s.editPath || '',
    path: s.path || s.editPath || '',
    before: (s.mode === 'syl') ? tokDisp(s.old) : (s.old == null ? '' : String(s.old)),
    after,
    note,
    cat: '原冊改錯字',
    fixkind,
    token: TEAM.token,
  };
  if (op) rec.op = JSON.stringify(op);

  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, teamAuth()),
      body: JSON.stringify(rec),
    });
    const j = r.ok ? await r.json() : null;
    if (!j || !j.ok) throw new Error('bad');
    $('#editbox').classList.remove('on');
    if (editTarget) editTarget.classList.add('edited');
    if (op) {
      // 送出即見（定案 §二 14）：不必等下一次整點，也不必重新整理
      paintPatch({ fid: j.fid, op, status: 'queued', reporter: j.reporter }, true);
    }
    alert(SENT_HINT);
    // C326：同一格可能已有排隊中的修正 ⇒ 重新整理，讓疊加層以淨結果重畫（一格一個標記）
    if (op) location.reload();
  } catch (err) {
    $('#edithint').textContent = '送不出去（網路或伺服器問題），請稍後再試。內容還在，不會不見。';
  }
}

// ══ C324：疊加層（定案 §二 14）══════════════════════════════════════════════
// `GET /api/patches?id=` → status ∈ {queued, applied} 且有 op 的團隊列，按 fid 遞增。
// 鏈式套用：新 op 的 old ＝前一筆的 new ⇒ 逐筆比對「目前這一槽是什麼」，對不上就整筆不畫
// （寧可少疊一筆，也不要把別人送的字蓋到對不上的位置上）。
//
// ⚠ **這一層畫得出什麼、畫不出什麼，寫在這裡**：
//   ・注音葉（`…ruby[j].k`）與 token 型音節：直接換那一格注音盒的字＝精準。
//   ・`head.sep[i]`：換那一格分隔符。
//   ・**整段文字葉**（`gloss.jp`／`examples[j].tw|jp`）：換成**純文字**並標「校對中」——
//     不在瀏覽器裡重跑 ruby 掛載（那是 export `attach_ruby` 的事，在這裡另寫一份就是
//     M033 §0.3 說的「複製即漂移」，而且錯了沒有閘看得到）。注音會暫時不顯示，
//     下一次整點發布後由 export 正式重畫。這是**刻意的**，不是漏掉。
const PATCH_LABEL = { queued: '校對中', applied: '待上站' };
let PATCHES = [];

function patchBadge(p) {
  const b = document.createElement('span');
  b.className = 'patch ' + p.status;
  b.textContent = PATCH_LABEL[p.status] || p.status;
  b.title = `${p.reporter || ''}｜${PATCH_LABEL[p.status] || p.status}`
          + `（fid ${p.fid}）；正式上站＝下一次整點發布`;
  if (p.mine && TEAM.on) {                 // C326：只在該槽每一筆都是自己的、且都還 queued 時給
    const w = document.createElement('a');
    w.className = 'patchundo';
    w.href = '#';
    w.textContent = '撤回';
    w.addEventListener('click', ev => { ev.preventDefault(); withdraw(p); });
    b.appendChild(w);
  }
  return b;
}

function pathEls(arr) {
  const p = arr.join('\u0001');
  const root = $('#entry');
  if (!root) return [];
  if (p === 'head\u0001kanji') return Array.from(root.querySelectorAll('[data-v2="head.kanji"]'));
  if (arr[0] === 'head' && arr[1] === 'kana') {
    return Array.from(root.querySelectorAll(`.kt[data-kt="${arr[2]}"]`));
  }
  if (arr[0] === 'head' && arr[1] === 'sep') {
    return Array.from(root.querySelectorAll(`.ksep[data-ksep="${arr[2]}"]`));
  }
  const last = arr[arr.length - 1];
  if (last === 'k' || last === 'c') {                    // ruby 葉
    const ri = arr[arr.length - 2];
    const rbPath = arr.slice(0, -2).join('.').replace(/\.(\d+)/g, '[$1]');
    return Array.from(root.querySelectorAll(`[data-rb="${rbPath}"]`))
      .map(h => h.querySelector(`.rb[data-ri="${ri}"]`)).filter(Boolean);
  }
  if (Number.isInteger(last)) {                          // token 型（tw_ruby[k]）
    const rbPath = arr.slice(0, -1).join('.').replace(/\.(\d+)/g, '[$1]');
    return Array.from(root.querySelectorAll(`[data-rb="${rbPath}"]`))
      .map(h => h.querySelector(`.rb[data-ri="${last}"]`)).filter(Boolean);
  }
  const lp = arr.join('.').replace(/\.(\d+)/g, '[$1]');   // 文字葉
  return Array.from(root.querySelectorAll(`[data-v2="${lp}"]`));
}

function setAnn(rbEl, text) {
  const a = rbEl.querySelector('.ann');
  if (a) a.textContent = text;
}

function paintPatch(p, live) {
  const arr = (p.op && p.op.path) || null;
  if (!arr) return false;
  const els = pathEls(arr);
  if (!els.length) return false;
  const last = arr[arr.length - 1];
  for (const el of els) {
    if (arr[0] === 'head' && arr[1] === 'kana') {
      const em = el.querySelector('sup.em');
      const tn = tnOf(p.op.new);
      el.innerHTML = esc(String(p.op.new.k || '')) + (tn ? `<sup class="tn">${esc(tn)}</sup>` : '');
      if (em) el.appendChild(em);
    } else if (arr[0] === 'head' && arr[1] === 'sep') {
      el.textContent = p.op.new === '--' ? '--' : (p.op.new ? ' ' : '');
    } else if (last === 'k') {
      setAnn(el, String(p.op.new));
    } else if (last === 'c') {
      el.classList.add('patched');                       // 底字換字：只標記，不動 DOM 結構
    } else if (Number.isInteger(last)) {
      setAnn(el, tokDisp(p.op.new));
    } else {
      el.textContent = String(p.op.new);                 // ⚠ 注音暫時不顯示（見上方長註）
    }
    el.classList.add('patched');
    el.appendChild(patchBadge(p));
  }
  if (live) PATCHES.push(p);
  return true;
}

// C326（甲案）：同一槽的多筆排隊修正合成**一個淨結果**再畫。
//   原本每一筆各畫一個標記、各帶一個撤回鈕 ⇒ 撤回（＝再送一筆反向 op）之後同一格變成兩個
//   「校對中」，反向那筆自己又帶撤回鈕，再按就把撤回撤回——標記永遠不消失（本機實測 fid 8–10）。
//   ・淨結果＝第一筆的 old → 最後一筆的 new；**淨結果等於原值（改了又撤回）＝不畫、不留標記**。
//   ・撤回鈕只在該槽每一筆都是自己送的、且都還 queued 時才給（不替別人撤、不撤已在處理的）。
//   ・鏈式比對（新 op 的 old ＝目前值）照舊；對不上的那一筆不算進來。
//   庫裡的列與每小時工作的套用順序都不變——本函式只決定「畫什麼」。
function netPatches(rows, baseOf, same, me) {
  const groups = new Map();
  for (const r of rows) {
    const op = r && r.op;
    if (!op || !Array.isArray(op.path)) continue;
    const key = op.path.join('\u0001');
    const g = groups.get(key);
    const base = g ? g.cur : baseOf(op.path);
    if (base != null && !same(base, op.old)) {
      console.warn('疊加層：old 對不上目前值，該筆不畫', r.fid, op.path.join('.'));
      continue;
    }
    if (g) {
      g.cur = op.new;
      g.rows.push(r);
    } else {
      groups.set(key, { path: op.path, origin: op.old, cur: op.new, rows: [r] });
    }
  }
  const out = [];
  for (const g of groups.values()) {
    if (same(g.origin, g.cur)) continue;
    const last = g.rows[g.rows.length - 1];
    out.push({
      fid: last.fid,
      fids: g.rows.map(r => r.fid),
      op: { path: g.path, old: g.origin, new: g.cur },
      status: g.rows.some(r => r.status === 'queued') ? 'queued' : 'applied',
      reporter: last.reporter,
      mine: !!me && g.rows.every(r => r.status === 'queued' && r.reporter === me),
    });
  }
  return out;
}

function patchPathStr(arr) {
  return arr.join('.').replace(/\.(\d+)/g, '[$1]');
}

function sameVal(a, b) {
  return (typeof a === 'string' || typeof b === 'string') ? a === b : sameToken(a, b);
}

async function loadPatches() {
  let list = [];
  try {
    const r = await fetch('/api/patches?id=' + encodeURIComponent(entryId), { cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    list = (j && j.ok && j.patches) || [];
  } catch (e) { return; }
  const rows = [];
  for (const row of list) {
    let op = null;
    try { op = JSON.parse(row.op); } catch (e) { continue; }
    rows.push({ fid: row.fid, op, status: row.status, reporter: row.reporter });
  }
  const baseOf = path => (opKind(path.join('.').replace(/\.(\d+)/g, '[$1]')) === 'token'
                          ? null : leafOld(path));
  for (const p of netPatches(rows, baseOf, sameVal, TEAM.on ? TEAM.name : '')) {
    if (paintPatch(p, false)) PATCHES.push(p);
  }
}

// 撤回＝送一筆反向 op（定案 §二 14）。只對自己送的、還沒上站（queued）那些開放。
// C326：p 是 netPatches 合成的淨結果 ⇒ 反向 op 一步回到原值（不是只退最後一筆）。
async function withdraw(p) {
  if (!TEAM.on) return;
  const fids = (p.fids || [p.fid]).join('、');
  if (!confirm(`撤回這一格的修正（fid ${fids}）？畫面會回到原值。`)) return;
  const rec = {
    source: 'website', ts: new Date().toISOString(), id: entryId,
    path: p.op.path.join('.').replace(/\.(\d+)/g, '[$1]'),
    before: typeof p.op.new === 'string' ? p.op.new : tokDisp(p.op.new),
    after: typeof p.op.old === 'string' ? p.op.old : tokDisp(p.op.old),
    note: `撤回 fid ${fids}`,
    cat: '原冊改錯字', fixkind: '數位化打錯',
    op: JSON.stringify({ path: p.op.path, old: p.op.new, new: p.op.old }),
    token: TEAM.token,
  };
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, teamAuth()),
      body: JSON.stringify(rec),
    });
    const j = r.ok ? await r.json() : null;
    if (!j || !j.ok) throw new Error('bad');
    alert('撤回已送出，畫面回到原值。');
    location.reload();
  } catch (e) {
    alert('撤回送不出去，請稍後再試。');
  }
}

// C335（U124）：團隊模式下互見連結 `a.reflink` 的單擊**延後跳頁**，讓雙擊有機會開修正框。
//   病灶（M052_X1 第 11 條，站主正式站實操）：連結裡包著可改的單位（注音單位、`refs[i]` 槽），
//   第一下 click 瀏覽器就照 href 跳走、`dblclick` 永遠等不到。
//   修法取「延後跳」不取「Ctrl／⌘＋點擊才跳」：後者要學新手勢，且 Ctrl／⌘＋點擊的瀏覽器預設是
//   開新分頁（不可吃掉）⇒ 同分頁跳轉就沒有手勢了。延後的代價＝團隊成員點連結慢一拍。
//   ・讀者模式（`TEAM.on=false`）一律不攔＝行為不變；`TEAM.on` 在事件當下讀 ⇒ 登入／登出即時生效。
//   ・修飾鍵、非左鍵、鍵盤 Enter（`detail` 0，不可能接第二下）一律放行給瀏覽器預設。
//   ・第二下落在可改單位（`[data-edit]` 內）＝取消跳頁、交給 `dblclick` 開框；落在不可改處＝照樣跳。
//   ・間隔取常數：網頁讀不到作業系統的雙擊間隔設定；Windows 預設 500ms，取同值。
//   ・取消點在**第二下按下**（`mousedown` detail≥2，見 `cancelRefNavOnPress`），不是第二下放開的 click：
//     計時器自第一下放開起算 ⇒ 到點必晚於「第一下按下＋間隔」，而作業系統認雙擊＝兩次按下相隔不超過間隔
//     ⇒ 第二下按下必在到點之前。若只在第二下 click 取消，第二下按久一點就會先跳走
//     （C335 操作者 Edge 實測撞到；自動化測試每下瞬間按放，撞不到）。
const REF_NAV_DELAY = 500;
let refNavTimer = null;
function deferRefClick(ev) {
  if (!TEAM.on) return false;
  const a = ev.target && ev.target.closest && ev.target.closest('a.reflink');
  if (!a) return false;
  if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return false;
  if (!ev.detail) return false;
  ev.preventDefault();
  if (refNavTimer) { clearTimeout(refNavTimer); refNavTimer = null; }
  if (ev.detail >= 2 && ev.target.closest('[data-edit]')) return true;
  const href = a.getAttribute('href');
  refNavTimer = setTimeout(() => { refNavTimer = null; location.href = href; }, REF_NAV_DELAY);
  return true;
}
function cancelRefNavOnPress(ev) {
  if (!TEAM.on || !refNavTimer || !(ev.detail >= 2)) return;
  const t = ev.target;
  if (!(t && t.closest && t.closest('a.reflink') && t.closest('[data-edit]'))) return;
  clearTimeout(refNavTimer);
  refNavTimer = null;
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
  ENTRY = e;
  // C324：`TEAM.on` 決定表頭 chip 與切圖鈕畫不畫 ⇒ **必須在 render 之前定案**。
  //   `opsrc` 只有團隊模式用得到（產 op 的 `old` 來源）⇒ 一般讀者零額外請求。
  await teamBoot();
  if (TEAM.on) OPSRC = await loadOpsrc(id.split('-')[0]);
  const tmix = isBlankKanji(e.head.kanji) ? null
    : mixKanjiParts(e.head.kanji_units, e.head.poj);
  document.title = isBlankKanji(e.head.kanji)
    ? `${e.head.poj}・台日新辭書線上版`
    : `${tmix ? tmix.map(x => x.t).join(' ') : e.head.kanji}（${e.head.poj}）・台日新辭書線上版`;
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
  await loadPatches();                   // C324：疊加層（定案 §二 14）——對所有人可見，含 queued

  root.addEventListener('click', ev => {
    if (deferRefClick(ev)) return;       // C335（U124）：團隊模式互見連結延後跳頁
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
  root.addEventListener('mousedown', cancelRefNavOnPress);   // C335（U124）：第二下按下即取消延後跳頁
  // C324：雙擊入口一律掛上，由 `openEdit` 的 `TEAM.on` 閘決定開不開
  //   ⇒ 一般讀者雙擊什麼都不會發生（與 C323 之前的線上行為相同）。
  // ⚠ 傳進去的是**事件目標**、不是 `[data-edit]` 宿主——音節格／注音格要靠「點到哪一格」
  //   才定得出槽位（`describeSlot` 自己會往上找宿主）。
  root.addEventListener('dblclick', ev => {
    if (!TEAM.on) return;
    if (!ev.target.closest('[data-edit]')) return;
    ev.preventDefault();
    openEdit(ev.target);
  });
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
  // ── C332：統一對話框的類別切換＋批注草稿的兩個錨點入口（選取文字／雙擊）──
  if ($('#reportcat')) {
    $('#reportcat').addEventListener('change', ev => {
      if (ev.target && ev.target.name === 'rcat') setReportCat(ev.target.value);
    });
  }
  document.addEventListener('selectionchange', rememberSelection);
  if ($('#editannot')) {
    // 雙擊入口帶 path（定案 §二 10）：從校對修正框轉成批注草稿，錨點取被雙擊的那一欄
    $('#editannot').addEventListener('click', () => {
      if (!TEAM.on || !editTarget) return;
      const host = editTarget.closest && editTarget.closest('[data-edit]');
      const inSel = LAST_SEL && host && LAST_SEL.hostPath === host.getAttribute('data-edit');
      $('#editbox').classList.remove('on');
      openReport('批注', e.id, {
        cat: ANNOT_CAT,
        hostPath: host ? host.getAttribute('data-edit') : '',
        inZh: !!(editTarget.closest && editTarget.closest('.zhline')),
        quote: inSel ? LAST_SEL.quote : '',
      });
    });
  }
  if ($('#editsend')) {
    $('#editsend').addEventListener('click', submitEdit);
    $('#editcancel').addEventListener('click', () => $('#editbox').classList.remove('on'));
  }
  // ── C324：團隊登入與三種編輯器的接線 ──
  if ($('#teambtn')) $('#teambtn').addEventListener('click', teamToggle);
  if ($('#edsyms')) {
    $('#edsyms').addEventListener('click', ev => {
      const b = ev.target.closest('.symbtn');
      if (!b) return;
      const ta = $('#editnew');
      const a = ta.selectionStart;
      const z = ta.selectionEnd;
      ta.value = ta.value.slice(0, a) + b.dataset.sym + ta.value.slice(z);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = a + b.dataset.sym.length;
    });
  }
  if ($('#edsepbtns')) {
    $('#edsepbtns').addEventListener('click', ev => {
      const b = ev.target.closest('.sepbtn');
      if (!b || !editSlot) return;
      editSlot.newSep = b.dataset.sep;
      $('#edsepbtns').querySelectorAll('.sepbtn')
        .forEach(x => x.classList.toggle('cur', x === b));
    });
  }
  for (const eid of ['edpoj', 'edkana', 'edtone', 'ednasal', 'edasp']) {
    const el = $('#' + eid);
    if (el) el.addEventListener('input', sylPreview);
  }
}
document.addEventListener('DOMContentLoaded', init);
