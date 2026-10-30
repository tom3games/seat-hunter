// 自分で壊す検証。node verify.mjs（全部 pass で 0 終了）。サーバーは空いているポートを自動で取る
import { chromium, webkit } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
const ROOT = import.meta.dirname
mkdirSync(ROOT + '/shots', { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '0' } })
const PORT = await new Promise(r => server.stdout.on('data', d => { const m = String(d).match(/:(\d+)/); if (m) r(m[1]) }))
const URL0 = `http://localhost:${PORT}/`
let pass = 0, fail = 0
const results = []
async function t(name, fn) {
  try { const r = await fn(); if (r === false) throw new Error('false'); pass++; results.push(`ok   ${name}${r && r !== true ? '  ' + JSON.stringify(r) : ''}`) }
  catch (e) { fail++; results.push(`FAIL ${name}  ${String(e.message).split('\n')[0]}`) }
}
const expect = (c, msg) => { if (!c) throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) }
async function open(browser, opts = {}, init) {
  const ctx = await browser.newContext({ locale: 'ja-JP', viewport: { width: 390, height: 844 }, acceptDownloads: true, ...opts })
  await ctx.addInitScript(init || (() => { try { localStorage.clear() } catch (e) {} }))
  const p = await ctx.newPage(); p.errs = []
  p.on('pageerror', e => p.errs.push('pageerror ' + e.message))
  p.on('console', m => { if (m.type() === 'error') p.errs.push('console ' + m.text()) })
  p.on('requestfailed', r => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) p.errs.push('reqfail ' + r.url()) })
  await p.goto(URL0); await p.waitForFunction(() => window.__shReady, null, { timeout: 30000 })
  return p
}
const overflow = p => p.evaluate(() => {
  const W = document.documentElement.clientWidth, bad = []
  for (const el of document.querySelectorAll('main:not([hidden]) *, #corner *')) {
    if (el.closest('[hidden]') || el.closest('#fx') || el.closest('.cut') || (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true }))) continue
    const r = el.getBoundingClientRect(); if (r.width && (r.right > W + 1 || r.left < -1)) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.left) + '-' + Math.round(r.right))
  }
  return { sw: document.documentElement.scrollWidth, W, bad: bad.slice(0, 5) }
})
const fit = q => q.evaluate(() => {
  const H = innerHeight, de = document.documentElement, over = []
  if (de.scrollHeight > H + 1) over.push('page:' + de.scrollHeight)
  const vis = el => el.offsetParent && !el.closest('[hidden]')
  for (const el of document.querySelectorAll('main:not([hidden]) button, #corner button')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push((el.id || el.className) + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  for (const el of document.querySelectorAll('main:not([hidden]) .howCard, main:not([hidden]) .ticket, main:not([hidden]) .rWrap, main:not([hidden]) .logo, main:not([hidden]) .hud, main:not([hidden]) .led, main:not([hidden]) .tut')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.bottom > H + 1 || r.top < -1) over.push(el.className + ':' + Math.round(r.top) + '-' + Math.round(r.bottom)) }
  // ボタン同士・HUD・LED・説明が重ならない
  const bs = [...document.querySelectorAll('main:not([hidden]) button, #corner button, main:not([hidden]) .hud, main:not([hidden]) .led, main:not([hidden]) .tut')].filter(vis).map(b => [b.id || b.className, b.getBoundingClientRect()])
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i][1], b = bs[j][1]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push('overlap ' + bs[i][0] + '/' + bs[j][0]) }
  for (const el of document.querySelectorAll('main:not([hidden]) .howList, main:not([hidden]) .ticket')) if (el.scrollHeight > el.clientHeight + 2) over.push('clip ' + el.className + ' ' + el.scrollHeight + '>' + el.clientHeight)
  return { H, over: over.slice(0, 6) }
})
const glVariance = p => p.evaluate(() => {
  sh.dbg.render(); const src = document.querySelector('#gl'), c = document.createElement('canvas'); c.width = 200; c.height = 200
  const x = c.getContext('2d'); x.drawImage(src, 0, 0, 200, 200); const d = x.getImageData(0, 0, 200, 200).data
  let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 7) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ }
  return Math.round(s2 / n - (s / n) ** 2)
})
// 台本どおりの場面を作る: 種 seed で始め、最初の駅を「降りる人 leavers・ライバル rivals・自分の位置 slot」にする
const scene = (q, seed, leavers, rivals, slot, opts = {}) => q.evaluate(([seed, leavers, rivals, slot, opts]) => {
  sh.dbg.pause(true); sh.start(seed); sh.force.toSeg(); sh.force.plan(leavers, opts); sh.force.rivals(rivals); sh.force.slot(slot)
}, [seed, leavers, rivals, slot, opts])
const toT = (q, t) => q.evaluate(t => { const n = Math.round((t - sh.S.segT) * 60); sh.dbg.step(Math.max(0, n)) }, t)
const SIZES = [[360, 640, 'small'], [390, 844, 'phone'], [844, 390, 'land'], [667, 375, 'land-se'], [768, 1024, 'tab'], [1440, 900, 'pc']]
const GPU = { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }

const browser = await chromium.launch(GPU)
const p = await open(browser)
await t('起動時にエラーが出ない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await t('ブラウザの拡大が起きない（viewport・ピンチ・Ctrl+ホイール・Ctrl+プラス）', async () => {
  const r = await p.evaluate(() => {
    const vp = document.querySelector('meta[name=viewport]').content
    const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g)
    const w = new WheelEvent('wheel', { ctrlKey: true, deltaY: -10, bubbles: true, cancelable: true }); window.dispatchEvent(w)
    const k = new KeyboardEvent('keydown', { key: '+', ctrlKey: true, bubbles: true, cancelable: true }); window.dispatchEvent(k)
    return { vp, gesture: g.defaultPrevented, wheel: w.defaultPrevented, key: k.defaultPrevented, ta: getComputedStyle(document.documentElement).touchAction, us: getComputedStyle(document.body).userSelect }
  })
  expect(/user-scalable=no/.test(r.vp) && r.gesture && r.wheel && r.key && r.ta === 'manipulation' && r.us === 'none', r)
})
await t('OGP 一式がある（og:image は ?v= 付きの公開URL）', async () => {
  const r = await p.evaluate(() => Object.fromEntries(['og:title', 'og:description', 'og:image', 'og:url', 'og:type'].map(k => [k, document.querySelector(`meta[property="${k}"]`)?.content]).concat([['tw', document.querySelector('meta[name="twitter:card"]')?.content]])))
  expect(Object.values(r).every(Boolean) && r['og:image'] === 'https://tom3games.github.io/seat-hunter/og.png?v=1' && r['og:url'] === 'https://tom3games.github.io/seat-hunter/' && r.tw === 'summary_large_image', r)
})
await t('3D の車内が描けている（輝度の散らばり）', async () => { const v = await glVariance(p); expect(v > 300, v); return v })
await t('タイトル → 遊び方 → もどる → 遊び方から乗車', async () => {
  await p.click('#bHow'); expect(await p.isVisible('#vHow'), 'how')
  const ctrl = await p.textContent('#ctrlLine'); expect(/スペース/.test(ctrl), ctrl)
  await p.click('#bHowBack'); expect(await p.isVisible('#vTitle'), 'title')
  await p.click('#bHow'); await p.click('#bHowGo'); expect(await p.isVisible('#vPlay'), 'play')
  const r = await p.evaluate(() => ({ view: sh.S.view, phase: sh.S.phase, seated: sh.S.seats.filter(s => s.P).length, rivals: sh.S.rivals.length })); expect(r.view === 'play' && r.seated === 7 && r.rivals === 1, r); return r
})
await t('リアルタイムで時計が進む（固定60Hz・実時間と一致）', async () => {
  const r = await p.evaluate(async () => { const t0 = sh.S.t, w0 = performance.now(); await new Promise(r => setTimeout(r, 2500)); return { game: sh.S.t - t0, real: (performance.now() - w0) / 1000 } })
  expect(Math.abs(r.game - r.real) < 0.35, r); return r
})
await t('つり革の持ち替え: 左右に1つずつ、端で止まる', async () => {
  const r = await p.evaluate(() => {
    sh.dbg.pause(true); sh.start(11); sh.force.rivals([]); sh.force.slot(1)
    sh.move(-1); sh.dbg.step(20); const a = sh.S.player.slot; const edge = sh.move(-1); sh.move(1); sh.dbg.step(20); return { a, edge, b: sh.S.player.slot }
  })
  expect(r.a === 0 && r.edge === false && r.b === 1, r); return r
})
await t('ライバルの所へ動くと押しのけて入れ替わり「チッ」', async () => {
  const r = await p.evaluate(() => { sh.dbg.pause(true); sh.start(12); sh.force.rivals([['aunt', 4]]); sh.force.slot(3); const c0 = sh.S.chi; sh.move(1); const dur = sh.S.player.moving.dur; sh.dbg.step(40); return { slot: sh.S.player.slot, aunt: sh.S.rivals[0].slot, chi: sh.S.chi - c0, dur } })
  expect(r.slot === 4 && r.aunt === 3 && r.chi === 1 && r.dur > 0.4, r); return r
})
await t('「ガタン」の最中に動くとよろけて戻され、動けなくなる', async () => {
  await scene(p, 13, [5], [], 3, { lurches: [{ t: 2.0, dur: 0.5, dir: 1 }] })
  const r = await p.evaluate(() => { const n = Math.round((2.1 - sh.S.segT) * 60); sh.dbg.step(n); const c0 = sh.S.chi; sh.move(1); sh.dbg.step(3); const st = { stun: sh.S.player.stun, slot: sh.S.player.slot, moving: !!sh.S.player.moving, chi: sh.S.chi - c0, again: sh.move(1) }; return st })
  expect(r.stun > 0.5 && r.slot === 3 && !r.moving && r.chi === 1 && r.again === false, r); return r
})
await t('揺れていない時は普通に動ける', async () => {
  await scene(p, 14, [5], [], 3, { lurches: [{ t: 2.0, dur: 0.5, dir: 1 }] })
  const r = await p.evaluate(() => { sh.dbg.step(Math.round((3.0 - sh.S.segT) * 60)); sh.move(1); sh.dbg.step(20); return { slot: sh.S.player.slot, st: sh.S.stumbles } })
  expect(r.slot === 4 && r.st === 0, r); return r
})
await t('降りる人の前でドアが開いて立った瞬間に座る → 座れた', async () => {
  await scene(p, 15, [3], [], 3); await toT(p, 9.55)
  const r = await p.evaluate(() => { const ok = sh.sit(); sh.dbg.step(15); sh.dbg.render(); return { ok, won: sh.S.won, seat: sh.S.player.seat, hist: sh.S.hist[0], cut: document.querySelector('.cut')?.textContent || '' } })
  await p.screenshot({ path: ROOT + '/shots/04-win.png' })
  expect(r.ok && r.won === 1 && r.seat === 3 && r.hist === 'won' && /すわれた/.test(r.cut), r); return r
})
await t('降りる前の人に座ろうとすると「ひざの上」で動けなくなる', async () => {
  await scene(p, 16, [3], [], 3); await toT(p, 8.2)
  const r = await p.evaluate(() => { const ok = sh.sit(); sh.dbg.render(); return { ok, laps: sh.S.laps, stun: sh.S.player.stun, cut: document.querySelector('.cut')?.textContent || '' } })
  await p.screenshot({ path: ROOT + '/shots/05-lap.png' })
  expect(!r.ok && r.laps === 1 && r.stun > 0.9 && /ひざ/.test(r.cut), r); return r
})
await t('立ち上がり始め（0.12秒前まで）はセーフ、それより前はひざ', async () => {
  await scene(p, 17, [3], [], 3); await toT(p, 9.4)
  const a = await p.evaluate(() => { const ok = sh.sit(); return { ok, laps: sh.S.laps } })
  await scene(p, 17, [3], [], 3); await toT(p, 9.2)
  const b = await p.evaluate(() => { const ok = sh.sit(); return { ok, laps: sh.S.laps } })
  expect(a.ok && a.laps === 0 && !b.ok && b.laps === 1, { a, b }); return { a, b }
})
await t('前に立って素早く座れば、隣のおばちゃんに勝てる（立ちふさがり）', async () => {
  await scene(p, 18, [3], [['aunt', 2]], 3); await toT(p, 9.7)
  const r = await p.evaluate(() => { sh.sit(); sh.dbg.step(40); return { won: sh.S.won, auntStanding: sh.S.rivals.some(x => x.type === 'aunt' && x.slot === 2), chi: sh.S.chi } })
  expect(r.won === 1 && r.auntStanding && r.chi >= 1, r); return r
})
await t('もたもたすると、おばちゃんに取られる（悔し顔）', async () => {
  await scene(p, 19, [3], [['aunt', 2]], 3); await toT(p, 10.2)
  const r = await p.evaluate(() => { const ok = sh.sit(); sh.dbg.step(5); sh.dbg.render(); const s = sh.S.seats[3].P; return { ok, won: sh.S.won, who: s && s.kind, hist: sh.S.hist[0], expr: sh.S.player.expr, cut: document.querySelector('.cut')?.textContent || '' } })
  await p.screenshot({ path: ROOT + '/shots/06-lose.png' })
  expect(r.won === 0 && r.who === 'aunt' && r.hist === 'lost' && r.expr === 'cry' && /とられた/.test(r.cut), r); return r
})
await t('カバンを投げる人は2つ先からでも速い（立ちふさがりが効かない）', async () => {
  await scene(p, 20, [3], [['bag', 5]], 3); await toT(p, 9.9)
  const r = await p.evaluate(() => { sh.sit(); sh.dbg.step(30); const s = sh.S.seats[3].P; return { won: sh.S.won, who: s && s.kind } })
  expect(r.won === 0 && r.who === 'bag', r); return r
})
await t('寝たふりの学生は隣の席にしか反応しない', async () => {
  await scene(p, 21, [5], [['stu', 3]], 0); await toT(p, 11.0)
  const r = await p.evaluate(() => { const s = sh.S.seats[5].P; return { who: s && s.kind, stu: sh.S.rivals.some(x => x.type === 'stu' && x.slot === 3) } })
  expect(r.who === 'pass' && r.stu, r); return r
})
await t('誰も来ない席は、乗ってきた人が座る', async () => {
  await scene(p, 22, [6], [], 0); await toT(p, 11.0)
  const r = await p.evaluate(() => { const s = sh.S.seats[6]; return { st: s.state, kind: s.P && s.P.kind } })
  expect(r.st === 'sit' && r.kind === 'pass', r); return r
})
await t('座ったら次の区間でおばあちゃんに譲る（座っていた時間が数えられる）', async () => {
  await scene(p, 23, [3], [], 3); await toT(p, 9.55)
  const r = await p.evaluate(() => {
    sh.sit(); const n = Math.round((sh.TL.SEG - sh.S.segT) * 60) + 2; sh.dbg.step(n); const k1 = sh.S.k, gran = !!sh.S.plan.gran
    sh.dbg.step(Math.round(5.0 * 60)); sh.dbg.render()
    return { k1, gran, seat: sh.S.player.seat, slot: sh.S.player.slot, who: sh.S.seats[3].P.kind, seatT: sh.S.seatT }
  })
  await p.screenshot({ path: ROOT + '/shots/07-yield.png' })
  expect(r.k1 === 1 && r.gran && r.seat === -1 && r.slot === 3 && r.who === 'gran' && r.seatT > 6 && r.seatT < 7.5, r); return r
})
await t('5駅で約60秒 → 結果。称号はハンコが押されるまで見せない', async () => {
  const r = await p.evaluate(async () => {
    sh.dbg.pause(true); sh.start(24); let n = 0; while (sh.S.view === 'play' && n < 6000) { sh.dbg.step(1); n++ }
    const hidden0 = getComputedStyle(document.querySelector('#rStamp')).visibility, view = sh.S.view, game = n / 60
    await new Promise(r => setTimeout(r, 3300))
    return { game, view, hidden0, after: getComputedStyle(document.querySelector('#rStamp')).visibility, stamp: document.querySelector('#rStamp').textContent, R: sh.S.result, btn: getComputedStyle(document.querySelector('#rBtns')).opacity }
  })
  expect(r.game > 57 && r.game < 63 && r.view === 'result' && r.hidden0 === 'hidden' && r.after === 'visible' && r.R.tier === 'forever' && /一生つり革/.test(r.stamp) && r.R.stand === 57 && r.btn === '1', r)
  await p.screenshot({ path: ROOT + '/shots/08-result-forever.png' }); return { game: r.game, stamp: r.stamp }
})
await t('同じ種・同じボットなら同じ結果（再現性）', async () => {
  const r = await p.evaluate(() => { const a = sh.simulate(777, 'normal'), b = sh.simulate(777, 'normal'), c = sh.simulate(778, 'good'); return { a: [a.seats, a.stand, a.chi], b: [b.seats, b.stand, b.chi], c: [c.seats, c.stand] } })
  expect(JSON.stringify(r.a) === JSON.stringify(r.b) && r.c[0] > 0, r); return r
})
await t('難しさの分布（上手い=5回はたまに / ふつう=中間 / 雑=0〜1回 / 何もしない=0回）', async () => {
  const r = await p.evaluate(() => {
    const N = 30, out = {}
    for (const bot of ['good', 'normal', 'sloppy', 'none']) { const c = [0, 0, 0, 0, 0, 0]; for (let i = 0; i < N; i++) c[sh.simulate(9000 + i, bot).seats]++; out[bot] = c }
    return out
  })
  const { good: g, normal: n, sloppy: s, none: z } = r
  expect(g[5] >= 2 && g[5] <= 14 && g[4] + g[5] >= 15, 'good ' + g)
  expect(n[2] + n[3] >= 14 && n[5] <= 3, 'normal ' + n)
  expect(s[0] + s[1] >= 24 && s[4] + s[5] === 0, 'sloppy ' + s)
  expect(z[0] === 30, 'none ' + z)
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.join(' ')]))
})
await t('キー操作: ←→で移動・スペースで座る・Pで一時停止と再開', async () => {
  await scene(p, 25, [4], [], 3); await p.evaluate(() => { sh.dbg.step(Math.round((9.5 - sh.S.segT) * 60)) })
  await p.keyboard.press('ArrowRight'); await p.evaluate(() => sh.dbg.step(20))
  await p.keyboard.press('Space'); await p.evaluate(() => sh.dbg.step(20))
  const a = await p.evaluate(() => ({ seat: sh.S.player.seat, won: sh.S.won }))
  await p.evaluate(() => sh.dbg.pause(false)); await p.keyboard.press('p'); const v1 = await p.evaluate(() => sh.S.view); const t1 = await p.evaluate(() => sh.S.t); await p.waitForTimeout(400); const t2 = await p.evaluate(() => sh.S.t)
  await p.keyboard.press('p'); const v2 = await p.evaluate(() => sh.S.view)
  expect(a.seat === 4 && a.won === 1 && v1 === 'pause' && t1 === t2 && v2 === 'play', { a, v1, t1, t2, v2 }); return a
})
await t('画面ボタン: 左右と「座る」（立った人の前で光る）', async () => {
  await scene(p, 26, [2], [], 3); await p.evaluate(() => sh.dbg.step(Math.round((9.5 - sh.S.segT) * 60)))
  await p.click('#bL'); await p.evaluate(() => { sh.dbg.step(20); sh.dbg.render() })
  const ready = await p.evaluate(() => document.querySelector('#bSit').classList.contains('ready'))
  await p.click('#bSit'); await p.evaluate(() => sh.dbg.step(20))
  const r = await p.evaluate(() => ({ seat: sh.S.player.seat })); expect(ready && r.seat === 2, { ready, r }); return { ready, ...r }
})
await t('降りる人だけが「降りる仕草」を残す（ひっかけは元に戻る）', async () => {
  const r = await p.evaluate(() => {
    sh.dbg.pause(true); sh.start(27); sh.force.toSeg(); sh.dbg.step(Math.round(8.3 * 60))
    const L = sh.S.plan.leavers, sc = [0, 1, 2, 3, 4, 5, 6].map(i => sh.seatScore(i, false))
    const fakeActs = sh.S.plan.ev.filter(e => !L.includes(e.seat)).length
    return { L, sc, fakeActs }
  })
  expect(r.L.every(i => r.sc[i] >= 3) && r.sc.every((v, i) => r.L.includes(i) || v <= 1) && r.fakeActs >= 2, r); return r
})
await t('音を全部鳴らしてもエラーが出ない（曲・効果音・声）', async () => {
  const r = await p.evaluate(async () => {
    Snd.init(); for (const tr of ['title', 'play', 'result', 'sad']) { Snd.setTrack(tr); await new Promise(r => setTimeout(r, 380)); Snd.tick() }
    const names = ['tap', 'step', 'squeeze', 'chi', 'stumble', 'lurch', 'warn', 'chime', 'door', 'brake', 'announce', 'stand', 'sit', 'bliss', 'grr', 'lose', 'lap', 'throw', 'dash', 'wake', 'yield', 'tell', 'go', 'drum', 'stamp', 'cheer', 'boo', 'result']
    for (const n of names) Snd.sfx(n)
    await new Promise(r => setTimeout(r, 300)); return { state: Snd.ctx && Snd.ctx.state, played: Object.keys(Snd.played).filter(k => !k.startsWith('bgm')).length, want: names.length, level: Snd.level() }
  })
  expect(r.played >= r.want && p.errs.length === 0, { r, errs: p.errs }); return r
})
await t('ミュートで音量0・状態が残る', async () => {
  await p.evaluate(() => { sh.dbg.pause(true); sh.title() }); await p.click('#bMute')
  const r = await p.evaluate(() => ({ g: Snd.master && Snd.master.gain.value, ls: localStorage.getItem('sh.mute') })); await p.click('#bMute')
  expect(r.g === 0 && r.ls === '1', r)
})
await t('結果を1枚の画像（1080x1350）にして保存できる', async () => {
  await p.evaluate(() => { sh.dbg.pause(true); sh.simulate(31, 'good'); sh.S.fast = false; sh.start(31); sh.S.bot = 'good'; let n = 0; while (sh.S.view === 'play' && n < 6000) { sh.dbg.step(1); n++ } sh.S.bot = null; sh.fillResult(true); sh.dbg.render() })
  const card = await p.evaluate(async () => { const c = await sh.makeCard(); const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data; let s = 0, s2 = 0, n = 0; for (let i = 0; i < d.length; i += 4 * 97) { const v = d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; s += v; s2 += v * v; n++ } return { w: c.width, h: c.height, v: Math.round(s2 / n - (s / n) ** 2), url: c.toDataURL('image/png'), seats: sh.S.result.seats } })
  writeFileSync(ROOT + '/shots/card-ja.png', Buffer.from(card.url.split(',')[1], 'base64'))
  await p.screenshot({ path: ROOT + '/shots/09-result-good.png' })
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }), p.click('#bSave')])
  expect(card.w === 1080 && card.h === 1350 && card.v > 500 && dl.suggestedFilename() === 'seat-hunter.png', { w: card.w, h: card.h, v: card.v }); return { v: card.v, seats: card.seats, file: dl.suggestedFilename() }
})
await t('英語に切り替えると全画面が英語（結果・画像も）', async () => {
  await p.click('#bLang')
  const r = await p.evaluate(async () => {
    const res = { stamp: document.querySelector('#rStamp').textContent, again: document.querySelector('#bAgain').textContent, seats: document.querySelector('[data-t=resSeats]').textContent }
    const c = await sh.makeCard(); const url = c.toDataURL('image/png'); sh.title()
    return { ...res, l2: document.querySelector('[data-t=title2]').textContent, start: document.querySelector('#bStart').textContent, lang: document.documentElement.lang, url, jp: /[ぁ-んァ-ン一-龥]/.test(document.querySelector('#vTitle').textContent) }
  })
  writeFileSync(ROOT + '/shots/card-en.png', Buffer.from(r.url.split(',')[1], 'base64'))
  expect(r.l2 === 'SEAT HUNTER' && r.lang === 'en' && !r.jp && r.seats === 'Seats won' && /Ride again/.test(r.again) && /Prophet|Hunter|Pro|Seated|Regular|Forever|Lap/.test(r.stamp), r)
  await p.screenshot({ path: ROOT + '/shots/en-title.png' }); await p.click('#bLang')
  return { stamp: r.stamp }
})
await t('fps（GPU 有効のヘッドレス Chromium・プレイ中）', async () => {
  await p.evaluate(() => { sh.dbg.pause(false); sh.start(53); sh.setBot('normal') })
  await p.waitForTimeout(3500); const f = await p.evaluate(() => sh.fps()); await p.evaluate(() => sh.setBot(null))
  expect(f >= 40, f); return f
})
await t('全体でエラーが出ていない', async () => { expect(p.errs.length === 0, p.errs.join('|')) })
await p.close()

// ---- 6サイズ × 全画面で一画面に収まる（日英・結果の上下）
for (const [w, h, name] of SIZES) {
  const q = await open(browser, { viewport: { width: w, height: h } })
  const views = {}
  await q.evaluate(() => sh.dbg.pause(true))
  await q.evaluate(() => sh.dbg.render()); views.title = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-title.png` })
  await q.click('#bHow'); views.how = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-how.png` })
  await q.click('#bHowGo')
  await q.evaluate(() => { sh.dbg.pause(true); sh.force.toSeg(); sh.force.plan([2], { lurches: [{ t: 7.9, dur: 0.7, dir: 1 }] }); sh.dbg.step(Math.round(8.0 * 60)); sh.dbg.snap(); sh.dbg.render() })
  views.play = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-play.png` })
  await q.evaluate(() => { sh.force.slot(2); sh.dbg.step(Math.round(1.55 * 60)); sh.sit(); sh.dbg.step(12); sh.dbg.render() })
  views.win = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-win.png` })
  await q.keyboard.press('p'); views.pause = await fit(q); await q.keyboard.press('p')
  await q.evaluate(() => { sh.dbg.pause(true); let n = 0; while (sh.S.view === 'play' && n < 6000) { sh.dbg.step(1); n++ } sh.fillResult(true); sh.dbg.step(60); sh.dbg.render() })
  views.result = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result.png` })
  await q.click('#bLang'); await q.evaluate(() => { sh.fillResult(true); sh.dbg.step(30); sh.dbg.render() })
  views.resultEn = await fit(q); await q.screenshot({ path: `${ROOT}/shots/fit-${name}-result-en.png` })
  await q.evaluate(() => { sh.title(); sh.dbg.render() }); views.titleEn = await fit(q)
  await q.click('#bLang')
  for (const [v, r] of Object.entries(views)) await t(`一画面に収まる ${name} ${w}x${h} ${v}`, async () => { expect(!r.over.length, r) })
  await t(`${name}: はみ出し・エラーなし`, async () => { const o = await overflow(q); expect(o.sw <= o.W && !o.bad.length && !q.errs.length, JSON.stringify(o) + q.errs.join('|')) })
  await q.close()
}
await browser.close()

// ---- WebKit（iPhone 相当）でタッチの通し
const wb = await webkit.launch()
for (const [w, h, name] of [[390, 844, 'p'], [844, 390, 'l']]) {
  const wp = await open(wb, { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await t(`WebKit ${name}: 2本指の touchmove を止める`, async () => {
    const r = await wp.evaluate(() => { const e = new Event('touchmove', { cancelable: true, bubbles: true }); Object.defineProperty(e, 'touches', { value: [{}, {}] }); document.body.dispatchEvent(e); return e.defaultPrevented })
    expect(r, r)
  })
  await t(`WebKit ${name}: タップで乗車、ボタンで移動、立った人の前で画面タップして座る`, async () => {
    await wp.tap('#bStart'); await wp.waitForTimeout(300)
    const tut = await wp.evaluate(() => document.querySelector('#tutTxt').textContent)
    await wp.evaluate(() => { sh.dbg.pause(true); sh.force.toSeg(); sh.force.plan([2]); sh.force.rivals([]); sh.force.slot(3) })
    await wp.tap('#bL'); await wp.evaluate(() => { sh.dbg.step(20); sh.dbg.step(Math.round((9.55 - sh.S.segT) * 60)) })
    await wp.touchscreen.tap(w / 2, h * 0.45); await wp.evaluate(() => { sh.dbg.step(20); sh.dbg.render() })
    const r = await wp.evaluate(() => ({ slot: sh.S.seats[2].P === sh.S.player, won: sh.S.won })); await wp.screenshot({ path: `${ROOT}/shots/webkit-${name}.png` })
    expect(r.slot && r.won === 1 && /タップ/.test(tut), { r, tut }); return r
  })
  await t(`WebKit ${name}: 3D が描けている`, async () => { const v = await glVariance(wp); expect(v > 300, v); return v })
  await t(`WebKit ${name}: エラーなし`, async () => { expect(wp.errs.length === 0, wp.errs.join('|')) })
  await wp.close()
}
await wb.close()
server.kill()
console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
