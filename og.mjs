// SNS用サムネ og.png（1200x630）。ドアが開いた瞬間、おばちゃんが飛び込みカバンが飛ぶ席の奪い合い＋タイトル。node og.mjs
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const ROOT = import.meta.dirname
const server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: '0' } })
const port = await new Promise(r => server.stdout.on('data', d => { const m = String(d).match(/:(\d+)/); if (m) r(m[1]) }))
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, locale: 'ja-JP' })
await p.addInitScript(() => { try { localStorage.setItem('sh.tut', '1') } catch (e) {} })
await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__shReady)
await p.evaluate(() => Promise.all(['60px "Dela Gothic One"', '30px "DotGothic16"', '900 30px "M PLUS Rounded 1c"'].map(f => document.fonts.load(f))))
await p.evaluate(() => {
  sh.dbg.pause(true); sh.start(41); sh.force.toSeg(); sh.force.plan([2]); sh.force.rivals([['aunt', 1], ['bag', 4]]); sh.force.slot(2)
  sh.dbg.step(Math.round((9.5 - sh.S.segT) * 60)); sh.dbg.snap(); sh.dbg.step(Math.round(0.42 * 60))
})
await p.addStyleTag({ content: `#corner,.hud,#led,#msg,#warn,#tut,.pad,.cut,#fx{display:none!important}
  #gl{transform:translateX(-250px) scale(1.12);transform-origin:50% 60%}
  body::after{content:'';position:fixed;inset:0 0 0 50%;background:linear-gradient(90deg,rgba(28,43,58,0),rgba(28,43,58,.94) 24%);z-index:30;pointer-events:none}` })
await p.evaluate(() => {
  const S = sh.S, cam = sh.camera, fx = document.createElement('div'); fx.style.cssText = 'position:fixed;inset:0;z-index:20'; document.body.appendChild(fx)
  // 画面上の位置（#gl を左へずらして拡大した分を足す）
  const at = (P, dy = 0.55) => { const v = P.M.head.getWorldPosition(new sh.camera.position.constructor()); v.y += dy; v.project(cam); const x = (v.x + 1) / 2 * 1200, y = (1 - v.y) / 2 * 630; return { x: (x - 600) * 1.12 + 600 - 250, y: (y - 378) * 1.12 + 378 } }
  const bub = (P, txt, cls, dx = 0) => { const q = at(P); const d = document.createElement('div'); d.className = 'bub ' + (cls || ''); d.textContent = txt; d.style.cssText += `left:${q.x + dx}px;top:${q.y}px;animation:none;font-size:22px;padding:6px 14px`; fx.appendChild(d) }
  bub(S.player, 'ま、まって！', 'me', 75)
  bub(S.rivals.find(r => r.type === 'aunt').P, 'ちょっと失礼！', '', -70)
  bub(S.rivals.find(r => r.type === 'bag').P, 'そこだ！', '', 20)
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;right:30px;top:0;bottom:0;width:500px;z-index:31;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;color:#fff;text-align:center'
  d.innerHTML = `<div style="font-family:'DotGothic16';font-size:30px;color:#ff9b2f;background:#14161a;padding:6px 18px;border-radius:8px;box-shadow:0 0 0 4px #3a3f46,0 0 18px rgba(255,155,47,.5);text-shadow:0 0 8px rgba(255,155,47,.8);letter-spacing:.1em">満員電車バトル</div>
  <div style="font-family:'Dela Gothic One';font-size:104px;line-height:1.05;-webkit-text-stroke:3px #1b5a41;paint-order:stroke fill;text-shadow:0 7px 0 #1b5a41,0 12px 0 rgba(0,0,0,.35);transform:rotate(-2deg);white-space:nowrap">座席<br>ハンター</div>
  <div style="font-weight:900;font-size:30px;font-family:'M PLUS Rounded 1c';line-height:1.5;margin-top:4px">次の駅で降りる人の前に立て。<br><span style="color:#ffcf3a">早すぎると、ひざの上。</span></div>`
  document.body.appendChild(d)
})
await p.waitForTimeout(300)
await p.screenshot({ path: ROOT + '/og.png' })
await b.close(); server.kill()
console.log('ok')
