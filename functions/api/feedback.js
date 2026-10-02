// /api/feedback — 線上回報 API（Cloudflare Pages Functions＋D1）
// POST：回報寫入 D1（欄位長度上限、prepared statement）。
//   **團隊鑰匙由伺服器蓋章**（M050 定案 §二 3／§四 場 2 之 2）：
//     帶有效 token → `reporter` 取自 TEAM_TOKENS 的 name、`role='team'`；
//     無 token 或 token 不在清單 → `reporter` 沿用前端暱稱、`role='public'`，**照收不拒**。
//   ⚠ 「不拒收」是硬要求，不是寬鬆：匿名回報是絕大多數（實量 `review_live/feedback.jsonl`
//     8,302 列中 6,701 列無署名＝80.7%；其中 6,508 列**連 reporter 鍵都沒有**、193 列空字串）。
//     把 token 寫成必填會當場斷掉外部讀者的回報，而且斷了不會有人來說——外部讀者
//     不會回報「我送不出去」。兩條負向路徑（完全無 token／token 不在清單）是不同的
//     程式分支，`website/build/test_team_api.py` 兩條各測一筆。
// PATCH：每小時工作回寫 `status`（憑證＝`env.ADMIN_TOKEN`）。
//   憑證走 `Authorization: Bearer` 標頭或 body 的 `token` 欄，**不走 query string**
//   ——寫入型端點的憑證落進 URL 會一併落進存取紀錄。
//   `status` 只收定案 §三 那五個值，其餘一律 400（fail-closed）。
// GET ?token=&since=：管理者增量拉取（JSONL；token 比對 env.ADMIN_TOKEN）
// 綁定需求：D1 binding 變數名 DB＋Secret ADMIN_TOKEN 與 TEAM_TOKENS（Pages 專案 Settings）
// 2026-08-05 多把制：ADMIN_TOKEN 值＝逗號分隔的 token 清單（一人一把；
//   撤某人＝從清單刪該把＋重佈署，其餘把不受影響）。單一值仍相容（清單長度 1）。
//
// D1 `feedback` 現行 schema＝16 欄（單一真相＝`docs/清單_Cloudflare三件設定…` §三之七，
// 操作者 2026-09-29 實跑 `PRAGMA table_info` 後落檔；⚠ 讀本檔的 INSERT 推不出完整 schema）：
//   pk `fid`／`received`（伺服器端 `DEFAULT datetime('now')`）兩欄由 D1 自己填，
//   其餘 14 欄由本檔 POST 寫入。`ts` 與 `id` 是唯二 `notnull=1` 的欄，不可漏。
//   ＋C332（M050 場 3）第 17 欄 `turnstile TEXT`（操作者在瀏覽器 `ALTER TABLE … ADD COLUMN`，
//   前測 16 後驗 17）＝本檔寫 15 欄。值域見下方 `TS_VALUES`。
// ⚠ 排序與去重一律用 `received`／`fid`，**不要用 `ts`**——`ts` 是前端送來的、可被寫錯或偽造。
//
// ── C332：Turnstile（定案 §二 9、§九「開；團隊免驗；失敗仍送出並標記」）─────────────
//   ⚠ **驗證結果只寫進 `turnstile` 欄，從不拒收**（上面「不拒收」那條硬要求照舊）：
//   定案 §四 場 3 完成定義「Turnstile 擋住無 token 的機器 POST」讀作「標記為未驗、下游可濾」
//   （操作者 2026-10-03 裁；交件通報請站主確認）。下游＝留言頁 export 不出未驗列
//   （`export_site_data.comment_visible`）、拉校對卡面標「未驗」。
//   ⚠ secret 讀不到、siteverify 逾時或回非 JSON＝`error`（我方的問題，不是讀者的）；
//   讀者沒帶 token＝`missing`；Cloudflare 判失敗＝`fail`。三者都照收。

// TEAM_TOKENS 格式＝`name1:token1,name2:token2`（定案 §二 3）。
// 解析紀律（`docs/清單_Cloudflare三件設定…` §1.2-2）：以 `,` 切段、每段只切**第一個** `:`
//   ⇒ token 可以含冒號，name 不可以。name 是半公開值（場 2 起被蓋進 `reporter`，
//   會出現在收件匣、後審表、採納率統計），拼法必須沿用該人既有的拼法。
export function parseTeamTokens(raw) {
  const map = new Map();
  for (const seg of String(raw == null ? '' : raw).split(',')) {
    const s = seg.trim();
    if (!s) continue;
    const i = s.indexOf(':');
    if (i <= 0) continue;               // 無冒號、或冒號在最前（name 空）＝該段格式壞，整段丟掉
    const name = s.slice(0, i).trim();
    const tok = s.slice(i + 1).trim();
    if (!name || !tok) continue;
    if (!map.has(tok)) map.set(tok, name);   // 同一把重複列出＝取先出現的 name，不讓後面的蓋掉
  }
  return map;
}

// token → name；查不到回空字串（＝非團隊）。空 token 一律非團隊。
export function teamNameFor(env, token) {
  if (!token) return '';
  return parseTeamTokens(env && env.TEAM_TOKENS).get(token) || '';
}

// ADMIN_TOKEN 多把制清單（GET 與 PATCH 共用；原本這三行只長在 GET 裡）
export function adminTokens(env) {
  return String((env && env.ADMIN_TOKEN) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// `Authorization: Bearer <token>`；沒有就回空字串
export function bearer(request) {
  const h = String((request && request.headers && request.headers.get('authorization')) || '');
  const m = /^Bearer[ \t]+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

// 定案 §三 的 status 值域。PATCH 只收這五個，其餘 400（未知值寫進去會讓疊加層與
// 後審表兩邊都判不出狀態，寧可當場拒收）。
export const STATUS_VALUES = ['queued', 'applied', 'rejected', 'published', 'reverted'];

// C332：`turnstile` 欄的值域（舊列＝NULL＝本欄加入前收的，不是未驗）。
export const TS_VALUES = ['ok', 'fail', 'missing', 'error', 'team'];
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const SITEVERIFY_TIMEOUT_MS = 3000;

// → TS_VALUES 之一。**永不丟例外**（任何意外都落 `error`，呼叫端照收）。
//   `fetchImpl` 只給測試換掉網路；正式路徑用全域 fetch。
export async function verifyTurnstile(env, cfToken, ip, fetchImpl) {
  if (!cfToken) return 'missing';
  const secret = String((env && env.TURNSTILE_SECRET) || '');
  if (!secret) return 'error';
  const doFetch = fetchImpl || ((typeof fetch === 'function') ? fetch : null);
  if (!doFetch) return 'error';
  const ctl = (typeof AbortController === 'function') ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), SITEVERIFY_TIMEOUT_MS) : null;
  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', cfToken);
    if (ip) form.set('remoteip', ip);
    const r = await doFetch(SITEVERIFY_URL, {
      method: 'POST', body: form, signal: ctl ? ctl.signal : undefined,
    });
    if (!r || !r.ok) return 'error';
    const j = await r.json();
    return (j && j.success === true) ? 'ok' : 'fail';
  } catch (e) {
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// 第 17 欄還沒加（操作者的 ALTER 尚未跑、或發布順序弄反）時 D1 回的錯誤字樣。
//   遇到就改用不含該欄的舊句再寫一次——寧可少一個標記，也不拒收一筆回報。
export function isMissingColumnErr(e) {
  const m = String((e && e.message) || e || '');
  return /no such column|has no column named/i.test(m) && /turnstile/i.test(m);
}

export function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers),
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ ok: false, err: 'no-binding' }, 500);
    const raw = await request.text();
    if (raw.length > 8192) return json({ ok: false, err: 'too-large' }, 413);
    let b;
    try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, err: 'bad-json' }, 400); }
    const f = (v, n) => String(v == null ? '' : v).slice(0, n);

    // 伺服器蓋章：鑰匙決定 reporter 與 role，前端送的 role／reporter 在團隊列一律不算
    const token = f(b.token, 200) || bearer(request);
    const name = teamNameFor(env, token);
    const team = !!name;

    const rec = {
      ts: f(b.ts, 40), id: f(b.id, 40), block: f(b.block, 60), path: f(b.path, 200),
      before: f(b.before, 2000), after: f(b.after, 2000), note: f(b.note, 2000),
      reporter: team ? name : f(b.reporter, 60),
      role: team ? 'team' : 'public',
      cat: f(b.cat, 40),
      fixkind: f(b.fixkind, 40),
      quote: f(b.quote, 200),
      // op 只收團隊列。外部讀者只有對話框、產不出 op（定案 §二 4），而 op 會被疊加層
      // byte-exact 套到**所有讀者**的畫面上 ⇒ 在寫入口就不收，比事後過濾安全。
      // 要放寬成照收 public 的 op：把這一行的三元運算拿掉即可（`/api/patches`
      // 那一側另有 `role='team'` 一道，兩道各自獨立）。
      op: team ? f(b.op, 4000) : '',
      status: 'queued',
    };
    // 空檢查：原本是 `!note && !after`。加上 `!op` 是**放寬**（多收「只有 op、
    // 沒有文字」那一型＝雙擊編輯器產出的樣子），不會多拒收任何原本收得下的列。
    if (!rec.id || (!rec.note && !rec.after && !rec.op)) {
      return json({ ok: false, err: 'empty' }, 400);
    }
    // C332：團隊鑰匙免驗（定案 §二 9）；空檢查之後才驗＝被 400 擋下的列不必打一次 siteverify。
    rec.turnstile = team ? 'team'
      : await verifyTurnstile(env, f(b.cf_turnstile, 2048),
                              (request.headers && request.headers.get('cf-connecting-ip')) || '');
    const vals = [rec.ts, rec.id, rec.block, rec.path, rec.before, rec.after, rec.note,
                  rec.reporter, rec.role, rec.cat, rec.fixkind, rec.quote, rec.op, rec.status];
    let res;
    try {
      res = await env.DB.prepare(
        'INSERT INTO feedback (ts,id,block,path,before,after,note,reporter,role,cat,fixkind,quote,op,status,turnstile)'
        + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(...vals, rec.turnstile).run();
    } catch (e) {
      if (!isMissingColumnErr(e)) throw e;
      res = await env.DB.prepare(
        'INSERT INTO feedback (ts,id,block,path,before,after,note,reporter,role,cat,fixkind,quote,op,status)'
        + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).bind(...vals).run();
    }
    const fid = (res && res.meta && res.meta.last_row_id) || 0;
    // 回傳 role／reporter／fid：前端要靠 role 決定要不要顯示「校對中」疊加，
    // 靠 fid 做「撤回」。三者都不是機密（reporter 本來就會署名在站面上）。
    // C332：多回 `turnstile`——前端據以告訴留言者「未通過驗證＝要等站方看過才會出現在留言頁」。
    return json({ ok: true, role: rec.role, reporter: rec.reporter, fid, turnstile: rec.turnstile });
  } catch (e) {
    return json({ ok: false, err: 'server' }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    if (!env.DB) return json({ ok: false, err: 'no-binding' }, 500);
    const raw = await request.text();
    if (raw.length > 65536) return json({ ok: false, err: 'too-large' }, 413);
    let b;
    try { b = JSON.parse(raw); } catch (e) { return json({ ok: false, err: 'bad-json' }, 400); }
    const token = bearer(request) || String(b.token == null ? '' : b.token);
    const valid = adminTokens(env);
    if (!token || !valid.includes(token)) {
      return json({ ok: false, err: 'unauthorized' }, 401);
    }
    const items = Array.isArray(b.updates) ? b.updates
      : (b.fid == null ? [] : [{ fid: b.fid, status: b.status }]);
    if (!items.length) return json({ ok: false, err: 'empty' }, 400);
    if (items.length > 500) return json({ ok: false, err: 'too-many' }, 413);
    const stmt = env.DB.prepare('UPDATE feedback SET status = ? WHERE fid = ?');
    const binds = [];
    for (const it of items) {
      const fid = parseInt(it && it.fid, 10);
      const st = String((it && it.status) || '');
      if (!Number.isInteger(fid) || fid <= 0) return json({ ok: false, err: 'bad-fid' }, 400);
      if (!STATUS_VALUES.includes(st)) return json({ ok: false, err: 'bad-status' }, 400);
      binds.push(stmt.bind(st, fid));
    }
    // 一批一次送（D1 batch＝同一交易）；每小時工作一輪會回寫一串 fid。
    await env.DB.batch(binds);
    return json({ ok: true, n: binds.length });
  } catch (e) {
    return json({ ok: false, err: 'server' }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const valid = adminTokens(env);             // 多把制：逗號分隔清單
  if (!token || !valid.includes(token)) {
    return new Response('unauthorized', { status: 401 });
  }
  if (!env.DB) return new Response('no-binding', { status: 500 });
  const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
  const rs = await env.DB.prepare(
    'SELECT * FROM feedback WHERE fid > ? ORDER BY fid LIMIT 500'
  ).bind(since).all();
  const lines = (rs.results || []).map(r => JSON.stringify(r)).join('\n');
  return new Response(lines, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  });
}
