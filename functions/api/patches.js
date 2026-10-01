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
// 單一真相＝`feedback.js` 匯出的 `json`（M033 §0.3；理由同 `team.js` 檔頭）。
import { json } from './feedback.js';

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
    return json({ ok: true, id, patches: rs.results || [] }, 200, NO_STORE);
  } catch (e) {
    return json({ ok: false, err: 'server' }, 500, NO_STORE);
  }
}
