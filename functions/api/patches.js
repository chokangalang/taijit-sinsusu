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
// ── C438（U246 ②；站主 M069_X4 §三.2「取消件擴到修正件」）：已有取消件排隊的列＝本端點**不再回**
//   取消件＝團隊、queued、`fixkind=取消`、`before`＝被取消那筆 fid（純數字）；每小時工作受理後兩筆轉
//   reverted／superseded，這裡是那一小時之間的空窗——撤回一按，疊加層、記號、中譯提議當場就收（全員皆同）。
//   ⚠ 取消件自己也不得出現在任何一句（它沒有 op、cat 可能是原冊改錯字＝會被 REPORTED_SQL 當成「已有人回報」）。
//   `NOT_CANCELLED`＝接在各句 WHERE 後的同一段（綁值多一個 id）；只看同條目（取消件受理條件之一＝同條目）。
export const NOT_CANCELLED = " AND fid NOT IN (SELECT CAST(before AS INTEGER) FROM feedback"
  + " WHERE id = ? AND role = 'team' AND status = 'queued' AND fixkind = '取消')";
export const NOT_CANCEL_ROW = " AND COALESCE(fixkind,'') <> '取消'";

export const REPORTED_SQL = 'SELECT fid,path,block,cat FROM feedback'
  + " WHERE id = ? AND role = 'team' AND status = 'queued'"
  + " AND (op IS NULL OR op = '')"
  + " AND COALESCE(cat,'') NOT IN ('批注','留言')"
  + NOT_CANCEL_ROW + NOT_CANCELLED
  + ' ORDER BY fid LIMIT 200';

export const PATCHES_SQL = 'SELECT fid,id,path,op,status,reporter,received FROM feedback'
  + " WHERE id = ? AND role = 'team' AND status IN ('queued','applied')"
  + " AND op IS NOT NULL AND op <> ''"
  + NOT_CANCELLED
  + ' ORDER BY fid LIMIT 200';

//
// ── C438（U246 ④；站主 M069_X4 §三.4）：`trans`＝中譯提議與翻譯意見（**只在帶有效團隊鑰匙時**回）──
//   該條目 queued、沒有 op 的翻譯類列：`cat=翻譯意見`，或 C332 之前的舊列（`cat` 空／NULL 且 `block=現代化對照`；
//   這批舊列 `role` 是 NULL＝送件當時還沒有鑰匙制，故**不篩 role**）。積壓約 405 筆（站主口徑）同一通道顯示。
//   回的欄＝畫面要用的：path（現代卡中譯行＝`senses[i].zh`／`…examples[j].zh`；舊列多半空）、before／after
//   （提議＝舊值全文／新值全文）、note、reporter、received（「意見 月-日」）、role（自己的團隊列才給撤回）。
//   不帶鑰匙＝回應**根本沒有 `trans` 鍵**（同 `annots`）。這一句出錯＝`trans` 退空陣列、其餘照回。
export const TEAM_TRANS_SQL = 'SELECT fid,path,block,before,after,note,reporter,received,role FROM feedback'
  + " WHERE id = ? AND COALESCE(status,'queued') = 'queued' AND (op IS NULL OR op = '')"
  + " AND (cat = '翻譯意見' OR (COALESCE(cat,'') = '' AND block = '現代化對照'))"
  + NOT_CANCEL_ROW + NOT_CANCELLED
  + ' ORDER BY fid LIMIT 200';

//
// ── C441（U250；站主 M069_X4 §四之二.1–.3）：灰字區三段式＝提議／AI 複核／裁定 ──
//   同一批翻譯類列，多回三欄 `status`、`ai_note`、`verdict_note`（D1 第 18、19 欄），並多收**已裁定**的列：
//   `status` ∈ published／rejected／superseded **且帶 `verdict_note`**（＝裁定工具寫的；撤回、重複件、積壓回寫的
//   superseded／rejected 沒有它＝照舊不回），裁定日（`verdict_note.at`）在 44 天內（不准／改裁 14 天全顯＋30 天摺成
//   小記號；准 3 天由前端判）。過期與摺疊的分界由前端 `transPhase` 算，這裡只收最長的那一窗。
//   ⚠ 兩欄還沒加（操作者 ALTER 未跑）＝這一句「no such column」⇒ 退回上面 U246 那句（`TEAM_TRANS_SQL`），
//     團隊模式照舊看得到提議與意見、只是沒有 AI／裁定兩行——不得因 ALTER 還沒跑就讓灰字區整個消失。
export const VERDICT_WINDOW_DAYS = 44;
export const TEAM_TRANS_SQL_U250 = 'SELECT fid,path,block,before,after,note,reporter,received,role,'
  + 'status,ai_note,verdict_note FROM feedback'
  + " WHERE id = ? AND (op IS NULL OR op = '')"
  + " AND (cat = '翻譯意見' OR (COALESCE(cat,'') = '' AND block = '現代化對照'))"
  + " AND (COALESCE(status,'queued') = 'queued'"
  + "   OR (status IN ('published','rejected','superseded') AND verdict_note IS NOT NULL"
  + "       AND json_extract(verdict_note, '$.at') >= date('now', '-" + VERDICT_WINDOW_DAYS + " days')))"
  + NOT_CANCEL_ROW + NOT_CANCELLED
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
    const rs = await env.DB.prepare(PATCHES_SQL).bind(id, id).all();
    let reported = [];
    try {
      const r2 = await env.DB.prepare(REPORTED_SQL).bind(id, id).all();
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
      // C438（U246 ④）：中譯提議＋翻譯意見（團隊模式限定）；C441（U250）：先試三段式那句，出錯退回 U246 那句
      body.trans = [];
      for (const sql of [TEAM_TRANS_SQL_U250, TEAM_TRANS_SQL]) {
        try {
          const r4 = await env.DB.prepare(sql).bind(id, id).all();
          body.trans = r4.results || [];
          break;
        } catch (e) {
          body.trans = [];
        }
      }
    }
    return json(body, 200, NO_STORE);
  } catch (e) {
    return json({ ok: false, err: 'server' }, 500, NO_STORE);
  }
}
