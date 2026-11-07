// 手早くスクショを撮る（開発用）。node shot.mjs [幅] [高さ]
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
const ROOT = import.meta.dirname; mkdirSync(ROOT + '/shots', { recursive: true })
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '0' } })
const port = await new Promise(r => server.stdout.on('data', d => { const m = String(d).match(/:(\d+)/); if (m) r(m[1]) }))
const W = +(process.argv[2] || 390), H = +(process.argv[3] || 844), tag = `${W}x${H}`
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: W, height: H }, locale: 'ja-JP' })
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__shReady, null, { timeout: 15000 })
await p.waitForTimeout(800)
await p.screenshot({ path: `${ROOT}/shots/dev-${tag}-title.png` })
await p.evaluate(() => { sh.dbg.pause(true); sh.start(7); sh.force.toSeg(); sh.dbg.step(60 * 4.5); sh.dbg.snap(); sh.dbg.render() })
await p.screenshot({ path: `${ROOT}/shots/dev-${tag}-play.png` })
await p.evaluate(() => { sh.dbg.step(60 * 3.4); sh.dbg.render() })
await p.screenshot({ path: `${ROOT}/shots/dev-${tag}-decel.png` })
await p.evaluate(() => { sh.dbg.step(Math.round(60 * (sh.TL.VAC - sh.S.segT + 0.2))); sh.dbg.render() })
await p.screenshot({ path: `${ROOT}/shots/dev-${tag}-vac.png` })
const info = await p.evaluate(() => ({ seg: sh.S.segT, k: sh.S.k, seats: sh.S.seats.map(s => s.state), leavers: sh.S.plan.leavers, slot: sh.S.player.slot, rivals: sh.S.rivals.map(r => [r.type, r.slot]) }))
console.log(JSON.stringify(info)); console.log('errs', errs)
await b.close(); server.kill()
