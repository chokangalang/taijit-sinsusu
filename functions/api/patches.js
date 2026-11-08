// /api/patches — 疊加層資料（M050 定案 §四 場 2 之 2：`GET ?id=` → 該條目 status ∈ {queued, applied} 的列）
// 用途：條目頁載入時讀本端點、把未上站的團隊修正 byte-exact 疊在畫面上（定案 §二 14）：
//   `queued` 標「校對中」、`applied` 標「待上站」；發布後那些列轉 `published`，本端點
//   自然就不再回它們＝疊加自動失效。
// **公開端點、不需鑰匙**（定案 §二 14「疊加層對所有人可見、含 queued」）。
//
// ⚠ 三道篩各有理由，缺一都會把不該露出的東西送到讀者畫面上：
//   ① `status IN ('queued','applied')`＝定案原句。已 published／rejected／reverted 的不再疊。
//   ② `op` 非空＝疊加是拿 op 逐位元組套。沒有 op 的描述型回報（翻譯意見、留言、
//      表頭類問題）疊不了，也不該把別人送的文字露在條目上。
//   ③ `role='team'`＝op 只有團隊鑰匙蓋章的列算數。`feedback.js` 的 POST 端已不收
//      public 的 op，這一道是第二層；留兩層是因為 D1 裡可能有本次改動**之前**寫進去的舊列，
//      而那時候的 POST 對 op 零把關。兩道各自獨立、任一道單獨都足以擋住。
// ⚠ 排序用 `fid`（＝寫入序），**不用 `ts`**——`ts` 是前端送來的、可被寫錯或偽造
//   （`docs/清單_Cloudflare三件設定…` §三之七）。鏈式套用要照寫入序才對得上
//   「新 op 的 old ＝前一筆的 new」（定案 §二 14）。
// ⚠ `cache-control: no-store`：疊加層的存在前提是「重新整理即見」（定案 §二 14），
//   被邊緣快取住就等於沒有。
//
//
// ── C427（站主 M065 §二.4① 准；M050 §二 14 但書）：多回 `reported`＝「已有人回報（校對中）」記號 ──
//   該條目**團隊、queued、沒有 op** 的列。**只回位置（path／block）、類別（cat）、fid，不回送件文字**
//   ——欄位白名單寫死在下面那句 `SELECT`（不是取全列再刪欄：刪欄那一步一漏，文字就上了讀者畫面）。
//   `note`／`before`／`after`／`reporter`／`quote`／`fixkind`／`op` 一律不在選單上。
//   全員可見（記號無文字）。上面第 ② 道「不把別人送的文字露在條目上」照舊成立。
//   ⚠ 排除 `批注`（未上站批注只限團隊模式＝M050 §二 14 但書，另一條路）與 `留言`（不是待校的錯）；
//     `cat` 在 C332 之前的舊列可能是 NULL ⇒ `COALESCE`，否則 `NOT IN` 碰 NULL 整列消失。
//   ⚠ 這一句出錯只讓 `reported` 退空陣列，**不拖垮**上面那句疊加層（兩件事各自獨立）。
//   只收 `queued`：`applied` 是快車道已套、等發布的（有 op 才會被套），無 op 列不會停在 applied；
//     裁完的件由丁場回寫交辦檔改 status，記號自然消失。
export const REPORTED_SQL = 'SELECT fid,path,block,cat FROM feedback'
  + " WHERE id = ? AND role = 'team' AND status = 'queued'"
  + " AND (op IS NULL OR op = '')"
  + " AND COALESCE(cat,'') NOT IN ('批注','留言')"
  + ' ORDER BY fid LIMIT 200';

//
// ── C427（站主 M065 §二.3②；M050 §二 14 但書「批注類未上站只限團隊模式顯示」）：`annots` ──
//   **只在請求帶有效團隊鑰匙（`Authorization: Bearer`）時**多回該條目團隊、queued、`cat=批注` 的列
//   ＝前端團隊模式把未上站批注畫成「校對中」。不帶鑰匙／鑰匙無效＝回應**根本沒有 `annots` 鍵**
//   （不是空陣列）——一般讀者的回應與 C427 之前逐鍵相同（`patches`／`reported` 兩鍵＋`ok`／`id`）。
//   鑰匙只收標頭、不收 query（鑰匙不進存取紀錄的 URL；`team.js` 收 query 是登入那一下的既有例外）。
//   回的欄＝畫面要用的：`fid,path,quote,fixkind,note,before,reporter`（note＝批注本文／刪除理由；
//   before＝修改／刪除的目標 nid 或取消件的目標 fid；reporter＝團隊暱稱，用來判斷「自己的才給撤回」）。
//   這一句出錯＝`annots` 退空陣列、其餘照回。
export const TEAM_ANNOT_SQL = 'SELECT fid,path,quote,fixkind,note,before,reporter FROM feedback'
  + " WHERE id = ? AND role = 'team' AND status = 'queued' AND cat = '批注'"
  + ' ORDER BY fid LIMIT 200';

// 單一真相＝`feedback.js` 匯出的 `json`／`teamNameFor`／`bearer`（M033 §0.3；理由同 `team.js` 檔頭）。
import { json, teamNameFor, bearer } from './feedback.js';

const NO_STORE = { 'cache-control': 'no-store' };

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ ok: false, err: 'no-binding' }, 500, NO_STORE);
    const url = new URL(request.url);
    const id = String(url.searchParams.get('id') || '').slice(0, 40);
    if (!id) return json({ ok: false, err: 'no-id' }, 400, NO_STORE);
    const rs = await env.DB.prepare(
      'SELECT fid,id,path,op,status,reporter,received FROM feedback'
      + " WHERE id = ? AND role = 'team' AND status IN ('queued','applied')"
      + " AND op IS NOT NULL AND op <> ''"
      + ' ORDER BY fid LIMIT 200'
    ).bind(id).all();
    let reported = [];
    try {
      const r2 = await env.DB.prepare(REPORTED_SQL).bind(id).all();
      reported = r2.results || [];
    } catch (e) {
      reported = [];
    }
    const body = { ok: true, id, patches: rs.results || [], reported };
    if (teamNameFor(env, bearer(request))) {
      try {
        const r3 = await env.DB.prepare(TEAM_ANNOT_SQL).bind(id).all();
        body.annots = r3.results || [];
      } catch (e) {
        body.annots = [];
      }
    }
    return json(body, 200, NO_STORE);
  } catch (e) {
    return json({ ok: false, err: 'server' }, 500, NO_STORE);
  }
}
