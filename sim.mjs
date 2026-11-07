// ボットで結果の分布を測る。node sim.mjs [回数]
import './mute-auto.mjs'  // テスト中は絶対に音を出さない（playwright を無音に差し替え）
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ROOT = import.meta.dirname
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '0' } })
const port = await new Promise(r => server.stdout.on('data', d => { const m = String(d).match(/:(\d+)/); if (m) r(m[1]) }))
const N = +(process.argv[2] || 40), SEED0 = +(process.argv[3] || 1000)
const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' })
await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__shReady)
const out = await p.evaluate(([N, SEED0]) => {
  sh.dbg.pause(true); const res = {}
  for (const bot of ['good', 'normal', 'sloppy', 'none']) {
    const seats = Array(6).fill(0), tiers = {}; let laps = 0, stand = 0, chi = 0
    for (let i = 0; i < N; i++) { const r = sh.simulate(SEED0 + i, bot); seats[r.seats]++; tiers[r.tier] = (tiers[r.tier] || 0) + 1; laps += r.laps; stand += r.stand; chi += r.chi }
    res[bot] = { seats: seats.join(' '), tiers, avgStand: +(stand / N).toFixed(1), laps, avgChi: +(chi / N).toFixed(1) }
  }
  return res
}, [N, SEED0])
for (const [k, v] of Object.entries(out)) console.log(k.padEnd(7), JSON.stringify(v))
await b.close(); server.kill()
