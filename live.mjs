// 公開URLの確認。node live.mjs（ログインしていないブラウザで見る）。SKIPGH=1 で GitHub ページの確認を省く
// 公開版で通しプレイ（上手いボット）→ 結果まで、og.png の配信、GitHub に個人IDが出ていないかを確かめる
import { chromium, webkit } from 'playwright'
const URL0 = 'https://tom3games.github.io/seat-hunter/'
const out = []
const ID = ['tmk', '4men'].join('')  // 個人IDは文字列を分けて持つ
for (const [name, bt, opts] of [['chromium', chromium, {}], ['webkit', webkit, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
  const b = await bt.launch(), ctx = await b.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, ...opts }), p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
  p.on('requestfailed', r => errs.push('fail ' + r.url()))
  await p.goto(URL0 + '?t=' + Date.now(), { waitUntil: 'networkidle' })
  await p.waitForFunction(() => window.__shReady, null, { timeout: 15000 })
  await p.click('#bStart'); await p.evaluate(() => { sh.dbg.pause(true); sh.S.bot = 'good'; let n = 0; while (sh.S.view === 'play' && n < 6000) { sh.dbg.step(1); n++ } sh.S.bot = null; sh.fillResult(true); sh.dbg.render() })
  await p.screenshot({ path: `shots/live-${name}.png` })
  const og = await p.evaluate(async () => { const r = await fetch(document.querySelector('meta[property="og:image"]').content); return r.status + ' ' + r.headers.get('content-type') })
  out.push(`${name}: og=${og} errors=${errs.length ? errs.join(' | ') : 'none'}`)
  await b.close()
}
if (process.env.SKIPGH) { console.log(out.join('\n')); process.exit(0) }
// ログアウト状態でリポジトリ・更新履歴に個人のIDが出ていないか
const b = await chromium.launch(), p = await b.newPage()
for (const u of ['https://github.com/tom3games/seat-hunter', 'https://github.com/tom3games/seat-hunter/commits/main']) {
  const res = await p.goto(u, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500)
  out.push(`${u} status=${res.status()} id=${new RegExp(ID, 'i').test(await p.content()) ? 'FOUND' : 'none'}`)
}
await b.close()
console.log(out.join('\n'))
