// /api/team — 團隊鑰匙 → 名字（M050 定案 §四 場 2 之 2：`GET ?token=` → `{name}`）
// 用途：站面「團隊登入」貼一次鑰匙、存 localStorage 之前，先問伺服器這把有效嗎、是誰。
//   有效 → 200 `{ok:true, name}`；無效或沒帶 → 401 `{ok:false}`。
//   亦接受 `Authorization: Bearer`（頁面走 query、機器走標頭，兩條都通）。
// ⚠ 本端點回的 `name` 就是場 2 起被蓋進 `reporter` 欄的那個值——它不是機密
//   （會署名在收件匣、後審表與採納率統計上），但 token 本身不回、也不入任何紀錄。
// ⚠ 鑰匙不賦予直接發布或繞過驗證的權力（定案 §二 3）：本端點只回名字，不發任何權杖。
//
// 單一真相＝`feedback.js` 匯出的 `teamNameFor`／`json`（M033 §0.3「不要在別處另抄一份
//   ——複製即漂移」）。刻意 import 自同層那支路由檔、不另立一個 `_lib` 模組檔：
//   `functions/` 底下每多一個檔就多一條可被打到的路徑，而純模組檔沒有 onRequest*
//   匯出、本機又驗不到 Pages 的路由行為 ⇒ 不新增檔比較保險。
import { teamNameFor, bearer, json } from './feedback.js';

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || bearer(request);
    const name = teamNameFor(env, token);
    if (!name) return json({ ok: false }, 401, { 'cache-control': 'no-store' });
    return json({ ok: true, name }, 200, { 'cache-control': 'no-store' });
  } catch (e) {
    return json({ ok: false, err: 'server' }, 500);
  }
}
