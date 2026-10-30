// 座席ハンター / SEAT HUNTER
// 3D の満員電車。降りそうな人を見抜いて前に立ち、ドアが開いた瞬間に座る。時間は固定60Hz（performance.now で数える）
import * as THREE from './vendor/three.module.js'
if (!CanvasRenderingContext2D.prototype.roundRect) CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath() }

const D = window.SH_DATA
const $ = s => document.querySelector(s)
const DT = 1 / 60
const clamp = (v, a, b) => v < a ? a : v > b ? b : v
const lerp = (a, b, k) => a + (b - a) * k
const ease = k => k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k)
const isTouch = matchMedia('(pointer:coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0)
const store = { get(k, d) { try { const v = localStorage.getItem('sh.' + k); return v == null ? d : v } catch (e) { return d } }, set(k, v) { try { localStorage.setItem('sh.' + k, v) } catch (e) {} } }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
const vr = Math.random // 見た目だけに使う乱数（結果に影響しない）

// ---------- 時間割（1駅ぶん。秒）
const TL = { INTRO: 1.6, SEG: 11.4, DECEL: 7.2, DOOR: 9.0, RISE: 9.05, VAC: 9.5, EARLY: 0.12, SITDELAY: 0.15, FILL: 10.9, BOARD: 10.0, CLOSE: 10.8, END: 1.6 }
const N = 7, SX = i => (i - 3) * 0.95, SEAT_Z = -1.0, STAND_Z = 0.5, DOOR_X = 4.3, VMAX = 14
const MOVE_T = 0.24, SQUEEZE_T = 0.5, STUN_T = 0.9, LAP_T = 1.1, BLOCK = 0.3
const RIVAL = {
  aunt: { react: 0.15, per: 0.13, range: 3, base: 'none' },
  bag: { react: 0.26, per: 0.12, range: 2, base: 'phone', throws: true },
  stu: { react: 0.45, per: 0.2, range: 1, base: 'sleep' },
}

// ---------- 状態
const S = {
  lang: store.get('lang', (navigator.language || 'ja').toLowerCase().startsWith('ja') ? 'ja' : 'en'),
  muted: store.get('mute', '0') === '1', best: Number(store.get('best', '-1')), tutSeen: store.get('tut', '0') === '1',
  view: 'title', phase: 'idle', t: 0, k: 0, segT: 0, simT: 0, rng: Math.random, brng: Math.random, seed: 1, fast: false, bot: null, dbgPause: false,
  seats: [], persons: [], rivals: [], player: null, plan: null, won: 0, seatT: 0, chi: 0, laps: 0, stumbles: 0, hist: [], result: null,
  shake: 0, lurchK: 0, lurchDir: 1, dist: 0, onsets: [], tutOn: false, endT: 0, botM: {},
}
const T = k => D.TXT[S.lang][k] ?? k

// ---------- 描画の土台
const canvas = $('#gl')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch, powerPreference: 'high-performance', preserveDrawingBuffer: false })
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isTouch ? 1.5 : 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1c2b3a)
const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 120)
scene.add(new THREE.HemisphereLight(0xfffaf0, 0x6a7078, 2.0))
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(2, 9, 6); scene.add(sun)
const fillL = new THREE.DirectionalLight(0xdce8ff, 0.4); fillL.position.set(-5, 3, 5); scene.add(fillL)

function canvasTex(w, h, draw, rep) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]) }
  t.anisotropy = 4; t.userData.canvas = c; return t
}
const MATS = {}
const lam = (c, o) => { const k = c + (o ? JSON.stringify(o) : ''); return MATS[k] || (MATS[k] = new THREE.MeshLambertMaterial({ color: c, ...o })) }
const basic = c => new THREE.MeshBasicMaterial({ color: c })
const box = (w, h, d, m, x, y, z, parent = scene) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o }
const GFONT = '"Hiragino Sans","Yu Gothic","Noto Sans JP",sans-serif'

// ---------- 車内
const car = new THREE.Group(); scene.add(car)
const WALL = 0xe9e4d8, METAL = 0xc3c9d0, SEAT = 0x2f8f6a
// 床
const floorT = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#b9b09c'; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.05)'; for (let i = 0; i < 300; i++) x.fillRect(vr() * w, vr() * h, 2, 2); x.fillStyle = '#a99f8a'; x.fillRect(0, 0, w, 4) }, [6, 3])
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), new THREE.MeshLambertMaterial({ map: floorT })); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, 1.4); car.add(floor)
box(14, 0.02, 0.12, lam(0xffcf3a), 0, 0.01, 2.6, car)
// 座席（ロングシート）
box(6.9, 0.24, 0.72, lam(0x6b6f74), 0, 0.12, -1.0, car)
const cushion = box(6.8, 0.12, 0.72, lam(SEAT), 0, 0.42, -1.0, car)
box(6.8, 0.58, 0.16, lam(SEAT), 0, 0.76, -1.38, car)
for (let i = 0; i <= N; i++) { const x = SX(i) - 0.475; box(0.02, 0.005, 0.7, lam(0x23735a), x, 0.481, -1.0, car) }
// 袖仕切り
for (const s of [-1, 1]) { box(0.08, 0.95, 0.75, lam(METAL), s * 3.46, 0.6, -1.05, car); box(0.06, 1.2, 0.06, lam(METAL), s * 3.46, 1.4, -0.66, car) }
// 壁と窓
const wallM = lam(WALL)
box(9.0, 1.0, 0.1, wallM, 0, 0.5, -1.55, car)
box(9.0, 1.05, 0.1, wallM, 0, 2.5, -1.55, car)
for (const x of [-3.42, -1.14, 1.14, 3.42]) box(0.26, 1.0, 0.12, wallM, x, 1.5, -1.55, car)
for (const s of [-1, 1]) { box(0.3, 3.0, 0.12, wallM, s * 3.65, 1.5, -1.55, car); box(0.3, 3.0, 0.12, wallM, s * 4.9, 1.5, -1.55, car); box(1.0, 0.95, 0.12, wallM, s * 4.3, 2.55, -1.55, car) }
box(9.0, 0.06, 0.14, lam(0x9aa2ab), 0, 1.0, -1.5, car); box(9.0, 0.06, 0.14, lam(0x9aa2ab), 0, 2.0, -1.5, car)
// 網棚
box(6.9, 0.03, 0.48, lam(0xb7bec6, { transparent: true, opacity: 0.85 }), 0, 2.13, -1.29, car)
box(6.9, 0.05, 0.05, lam(METAL), 0, 2.15, -1.05, car)
for (let i = -3; i <= 3; i += 1.5) box(0.04, 0.2, 0.46, lam(METAL), i * 1.13, 2.22, -1.29, car)
// つり革
const barM = lam(METAL)
const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 9, 8), barM); bar.rotation.z = Math.PI / 2; bar.position.set(0, 2.72, STAND_Z); car.add(bar)
const straps = []
const ringGeo = new THREE.TorusGeometry(0.075, 0.018, 6, 14), strapGeo = new THREE.BoxGeometry(0.035, 0.36, 0.012)
for (let i = -1; i <= N; i++) for (const off of [0, 0.475]) {
  if (i === -1 && off === 0) continue; if (i === N && off > 0) continue
  const x = SX(i) + off; if (Math.abs(x) > 3.9) continue
  const g = new THREE.Group(); g.position.set(x, 2.72, STAND_Z); car.add(g)
  const s = new THREE.Mesh(strapGeo, lam(0xe8e2d0)); s.position.y = -0.18; g.add(s)
  const r = new THREE.Mesh(ringGeo, lam(0xffcf3a)); r.position.y = -0.44; g.add(r)
  straps.push({ g, x, i: off === 0 ? i : -1 })
}
// ドア（両端・2枚ずつ）
const doors = []
for (const s of [-1, 1]) {
  for (const h of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(s * DOOR_X + h * 0.27, 0, -1.52); car.add(g)
    box(0.54, 2.05, 0.06, lam(0xd0d6dc), 0, 1.025, 0, g)
    box(0.36, 0.7, 0.07, lam(0x9fc6e0, { transparent: true, opacity: 0.55 }), 0, 1.45, 0, g)
    doors.push({ g, x0: s * DOOR_X + h * 0.27, dir: h })
  }
  box(0.04, 2.05, 0.08, lam(0x555b62), s * DOOR_X, 1.025, -1.47, car)
}
// 案内表示（LED）と広告
const ledT = canvasTex(512, 96, () => {})
const led = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), new THREE.MeshBasicMaterial({ map: ledT })); led.position.set(0, 2.62, -1.49); car.add(led)
box(1.6, 0.36, 0.06, lam(0x2a2e33), 0, 2.62, -1.53, car)
let ledText = null
function drawLed(line1, hot) {
  const key = line1 + (hot ? 1 : 0); if (ledText === key) return; ledText = key
  const c = ledT.userData.canvas, x = c.getContext('2d'); x.fillStyle = '#101214'; x.fillRect(0, 0, 512, 96)
  x.fillStyle = hot ? '#ffb347' : '#ff8a1f'; x.font = `bold 46px ${GFONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(line1, 256, 50, 490)
  x.fillStyle = 'rgba(0,0,0,.35)'; for (let y = 0; y < 96; y += 4) x.fillRect(0, y, 512, 1); ledT.needsUpdate = true
}
function adTex(lines, bg, fg, accent) {
  return canvasTex(256, 128, (x) => {
    x.fillStyle = bg; x.fillRect(0, 0, 256, 128); x.fillStyle = accent; x.fillRect(0, 0, 18, 128)
    x.fillStyle = fg; x.textAlign = 'left'; x.font = `900 30px ${GFONT}`; x.fillText(lines[0], 32, 52); x.font = `700 20px ${GFONT}`; x.fillText(lines[1], 32, 90)
  })
}
const ads = [[-2.3, ['ねむけ吹っとぶ', 'ガム 100円'], '#fff4c8', '#3a2a10', '#e0483a'], [2.3, ['肩こりさよなら', '湿布 まとめ買い'], '#dff1ff', '#16324a', '#2f8f6a']]
for (const [x, l, bg, fg, ac] of ads) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), new THREE.MeshBasicMaterial({ map: adTex(l, bg, fg, ac) })); m.position.set(x, 2.6, -1.49); car.add(m) }

// ---------- 窓の外（遠景・近景・ホーム）
const farT = canvasTex(2048, 512, (x, w, h) => {
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8fc8f0'); g.addColorStop(0.5, '#cfe8f6'); g.addColorStop(1, '#e8f2f0'); x.fillStyle = g; x.fillRect(0, 0, w, h)
  for (let i = 0; i < 40; i++) { const bw = 40 + vr() * 90, bh = 60 + vr() * 160, bx = vr() * w; x.fillStyle = `rgba(110,140,170,${0.35 + vr() * 0.2})`; x.fillRect(bx, 300 - bh, bw, bh + 40) }
  for (let i = 0; i < 26; i++) {
    const bw = 70 + vr() * 120, bh = 80 + vr() * 150, bx = vr() * w, col = ['#d8cbb4', '#c4ccd4', '#e2d6c2', '#b8c0c8', '#d0b8a0'][i % 5]
    x.fillStyle = col; x.fillRect(bx, 340 - bh, bw, bh + 30); x.fillStyle = 'rgba(60,80,110,.45)'
    for (let yy = 340 - bh + 12; yy < 330; yy += 22) for (let xx = bx + 8; xx < bx + bw - 10; xx += 18) x.fillRect(xx, yy, 9, 11)
  }
  x.fillStyle = '#7da35a'; for (let i = 0; i < 60; i++) { x.beginPath(); x.arc(vr() * w, 360 + vr() * 20, 18 + vr() * 22, 0, 7); x.fill() }
  x.fillStyle = '#8c9a7c'; x.fillRect(0, 372, w, 140); x.fillStyle = '#6f6a62'; x.fillRect(0, 430, w, 82)
  x.fillStyle = '#4c4a48'; for (let xx = 0; xx < w; xx += 24) x.fillRect(xx, 440, 14, 60)
}, [1, 1])
const far = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), new THREE.MeshBasicMaterial({ map: farT })); far.position.set(0, -0.6, -6.5); car.add(far)
const nearT = canvasTex(1024, 256, (x, w, h) => {
  x.clearRect(0, 0, w, h)
  for (let xx = 40; xx < w; xx += 340) { x.fillStyle = '#5a5650'; x.fillRect(xx, 0, 16, h); x.fillRect(xx - 40, 30, 96, 8) }
  x.strokeStyle = '#3a3836'; x.lineWidth = 3; for (const y of [20, 34]) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y + 6); x.stroke() }
  x.fillStyle = '#7a8a6a'; x.fillRect(0, 200, w, 56); x.fillStyle = '#9aa080'; for (let xx = 0; xx < w; xx += 30) x.fillRect(xx, 180 + (xx % 60 ? 0 : 6), 20, 30)
}, [1, 1])
const near = new THREE.Mesh(new THREE.PlaneGeometry(20, 5), new THREE.MeshBasicMaterial({ map: nearT, transparent: true })); near.position.set(0, -0.2, -3.2); car.add(near)
const platT = canvasTex(1024, 512, () => {})
const plat = new THREE.Group(); car.add(plat)
const platWall = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshBasicMaterial({ map: platT })); platWall.position.set(0, -0.6, -3.0); plat.add(platWall)
let platName = ''
function drawPlatform(name) {
  if (platName === name) return; platName = name
  const c = platT.userData.canvas, x = c.getContext('2d')
  x.fillStyle = '#d9d4c8'; x.fillRect(0, 0, 1024, 512)
  x.fillStyle = '#c9c3b5'; for (let yy = 0; yy < 330; yy += 32) x.fillRect(0, yy, 1024, 2)
  for (const px of [150, 512, 874]) { x.fillStyle = '#9aa2ab'; x.fillRect(px - 14, 0, 28, 340) }
  for (const sx of [300, 724]) {
    x.fillStyle = '#fff'; x.fillRect(sx - 140, 110, 280, 96); x.fillStyle = SEAT_CSS; x.fillRect(sx - 140, 186, 280, 20)
    x.fillStyle = '#1a1e24'; x.font = `900 46px ${GFONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(name, sx, 150, 260)
  }
  x.fillStyle = '#e9e4d6'; x.fillRect(0, 330, 1024, 182); x.fillStyle = '#ffcf3a'; x.fillRect(0, 360, 1024, 14)
  x.fillStyle = 'rgba(0,0,0,.08)'; for (let xx = 0; xx < 1024; xx += 40) x.fillRect(xx, 380, 20, 132)
  platT.needsUpdate = true
}
const SEAT_CSS = '#2f8f6a'
// 窓ガラスの映り込み（うすく）
for (const [a, b] of [[-3.29, -1.27], [-1.01, 1.01], [1.27, 3.29]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.94), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false })); m.position.set((a + b) / 2, 1.5, -1.5); car.add(m) }

// ---------- 人（ちびキャラ）。顔は Canvas の表情テクスチャを差し替える
const INK = '#1e1a18'
function drawFace(x, expr, kind) {
  x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = INK; x.fillStyle = INK; x.lineWidth = 4.5
  const dot = (cx, cy, r = 6.5) => { x.fillStyle = INK; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(cx + 2, cy - 2, r * 0.32, 0, 7); x.fill(); x.fillStyle = INK }
  const blush = (a = 0.45, y = 80) => { x.fillStyle = `rgba(255,110,110,${a})`; for (const cx of [28, 100]) { x.beginPath(); x.ellipse(cx, y, 11, 7, 0, 0, 7); x.fill() } x.fillStyle = INK }
  const big = (cx, cy, r = 13, pr = 3.5) => { x.fillStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); x.stroke(); x.fillStyle = INK; x.beginPath(); x.arc(cx, cy, pr, 0, 7); x.fill() }
  const arcEye = (cx, cy, up) => { x.lineWidth = 5; x.beginPath(); if (up) x.arc(cx, cy + 4, 9, Math.PI + 0.35, -0.35); else x.arc(cx, cy - 4, 9, 0.35, Math.PI - 0.35); x.stroke() }
  const brow = (l, r, y = 40) => { x.lineWidth = 4.5; x.beginPath(); x.moveTo(32, y + l); x.lineTo(54, y - l); x.stroke(); x.beginPath(); x.moveTo(74, y - r); x.lineTo(96, y + r); x.stroke() }
  switch (expr) {
    case 'normal': dot(44, 62); dot(84, 62); blush(0.3); x.lineWidth = 4; x.beginPath(); x.arc(64, 80, 9, 0.3, Math.PI - 0.3); x.stroke(); break
    case 'phone': x.lineWidth = 5; for (const cx of [44, 84]) { x.beginPath(); x.moveTo(cx - 10, 62); x.lineTo(cx + 10, 62); x.stroke(); x.beginPath(); x.arc(cx, 66, 4.5, 0, Math.PI); x.fill() } x.lineWidth = 4; x.beginPath(); x.moveTo(56, 88); x.lineTo(72, 88); x.stroke()
      x.fillStyle = 'rgba(120,200,255,.18)'; x.fillRect(16, 60, 96, 50); break
    case 'sleep': arcEye(44, 62, false); arcEye(84, 62, false); x.fillStyle = INK; x.beginPath(); x.ellipse(64, 90, 6, 7, 0, 0, 7); x.fill(); x.strokeStyle = '#7fc8ff'; x.lineWidth = 3; x.beginPath(); x.moveTo(72, 92); x.quadraticCurveTo(76, 102, 72, 110); x.stroke(); blush(0.25); break
    case 'wake': big(44, 60); big(84, 60); x.fillStyle = INK; x.beginPath(); x.ellipse(64, 92, 7, 9, 0, 0, 7); x.fill(); x.lineWidth = 3; for (const a of [-0.7, -0.35, 0]) { x.beginPath(); x.moveTo(64 + Math.sin(a) * 52, 30 - Math.cos(a) * 6); x.lineTo(64 + Math.sin(a) * 60, 20 - Math.cos(a) * 6); x.stroke() } break
    case 'happy': arcEye(44, 62, true); arcEye(84, 62, true); blush(0.55); x.fillStyle = '#c0392b'; x.beginPath(); x.moveTo(48, 80); x.quadraticCurveTo(64, 104, 80, 80); x.closePath(); x.fill(); x.lineWidth = 4; x.stroke(); break
    case 'bliss': x.lineWidth = 5; for (const cx of [44, 84]) { x.beginPath(); x.moveTo(cx - 11, 60); x.quadraticCurveTo(cx, 68, cx + 11, 60); x.stroke() } blush(0.8, 78)
      x.lineWidth = 4; x.beginPath(); x.moveTo(46, 88); x.quadraticCurveTo(55, 96, 64, 88); x.quadraticCurveTo(73, 96, 82, 88); x.stroke()
      x.fillStyle = '#ffd84a'; for (const [sx, sy, r] of [[14, 30, 9], [112, 24, 7], [104, 106, 6]]) { x.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r; x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr) } x.fill() } break
    case 'cry': x.lineWidth = 5; x.beginPath(); x.moveTo(34, 54); x.lineTo(52, 61); x.lineTo(34, 68); x.stroke(); x.beginPath(); x.moveTo(94, 54); x.lineTo(76, 61); x.lineTo(94, 68); x.stroke()
      x.fillStyle = '#fff'; x.beginPath(); x.roundRect(42, 80, 44, 20, 6); x.fill(); x.lineWidth = 3.5; x.stroke(); x.beginPath(); x.moveTo(42, 90); x.lineTo(86, 90); for (let i = 1; i < 5; i++) { x.moveTo(42 + i * 8.8, 80); x.lineTo(42 + i * 8.8, 100) } x.stroke()
      x.fillStyle = '#6fc3ff'; x.beginPath(); x.moveTo(30, 70); x.quadraticCurveTo(22, 96, 30, 104); x.quadraticCurveTo(38, 96, 30, 70); x.fill(); x.beginPath(); x.moveTo(98, 70); x.quadraticCurveTo(90, 96, 98, 104); x.quadraticCurveTo(106, 96, 98, 70); x.fill(); break
    case 'shock': big(44, 58, 14, 2.5); big(84, 58, 14, 2.5); x.fillStyle = INK; x.beginPath(); x.ellipse(64, 94, 11, 15, 0, 0, 7); x.fill(); x.strokeStyle = 'rgba(80,100,200,.75)'; x.lineWidth = 3; for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(34 + i * 15, 8); x.lineTo(34 + i * 15, 28); x.stroke() } break
    case 'annoyed': x.lineWidth = 5; for (const cx of [44, 84]) { x.beginPath(); x.moveTo(cx - 11, 58); x.lineTo(cx + 11, 58); x.stroke(); x.beginPath(); x.arc(cx + 5, 62, 4.5, 0, Math.PI); x.fill() }
      x.lineWidth = 4; x.beginPath(); x.moveTo(52, 90); x.lineTo(78, 84); x.stroke(); x.strokeStyle = '#e0483a'; x.lineWidth = 4; x.beginPath(); for (const [a, b] of [[96, 20], [108, 32]]) { x.moveTo(a - 6, b); x.quadraticCurveTo(a, b + 2, a + 6, b) } x.moveTo(102, 14); x.quadraticCurveTo(100, 26, 102, 38); x.stroke(); break
    case 'smug': x.lineWidth = 5; for (const cx of [44, 84]) { x.beginPath(); x.moveTo(cx - 11, 60); x.lineTo(cx + 11, 60); x.stroke(); x.beginPath(); x.arc(cx, 63, 4.5, 0, Math.PI); x.fill() } blush(0.4)
      x.lineWidth = 4; x.beginPath(); x.moveTo(50, 86); x.quadraticCurveTo(66, 94, 80, 80); x.stroke(); break
    case 'dead': x.fillStyle = 'rgba(80,60,120,.28)'; for (const cx of [44, 84]) { x.beginPath(); x.ellipse(cx, 70, 14, 8, 0, 0, 7); x.fill() }
      x.fillStyle = INK; x.lineWidth = 4.5; for (const cx of [44, 84]) { x.beginPath(); x.moveTo(cx - 11, 60); x.lineTo(cx + 11, 60); x.stroke(); x.beginPath(); x.arc(cx, 61, 4, 0, Math.PI); x.fill() }
      x.lineWidth = 4; x.beginPath(); x.moveTo(48, 92); for (let i = 0; i < 5; i++) x.lineTo(52 + i * 6, i % 2 ? 88 : 94); x.stroke(); break
    case 'kind': arcEye(44, 62, true); arcEye(84, 62, true); blush(0.4); x.lineWidth = 2.5; x.strokeStyle = 'rgba(30,26,24,.5)'; for (const cx of [26, 102]) { x.beginPath(); x.moveTo(cx - 5, 58); x.lineTo(cx + 5, 54); x.stroke() }
      x.strokeStyle = INK; x.lineWidth = 4; x.beginPath(); x.arc(64, 82, 8, 0.3, Math.PI - 0.3); x.stroke(); break
    case 'fierce': x.fillStyle = '#fff'; for (const s of [-1, 1]) { const cx = 64 + s * 20; x.beginPath(); x.moveTo(cx - 13, 58 - s * 0); x.lineTo(cx + 13, 58); x.lineTo(cx + s * 10, 70); x.closePath(); x.fill(); x.lineWidth = 3; x.stroke() }
      x.fillStyle = INK; x.beginPath(); x.arc(46, 62, 3.5, 0, 7); x.arc(82, 62, 3.5, 0, 7); x.fill(); brow(-7, -7, 44); x.lineWidth = 4; x.beginPath(); x.moveTo(52, 90); x.lineTo(76, 90); x.stroke(); break
  }
  if (kind === 'bag') { x.strokeStyle = '#333'; x.lineWidth = 3.5; x.beginPath(); x.arc(44, 62, 15, 0, 7); x.stroke(); x.beginPath(); x.arc(84, 62, 15, 0, 7); x.stroke(); x.beginPath(); x.moveTo(59, 60); x.lineTo(69, 60); x.stroke() }
  if (kind === 'aunt') { x.fillStyle = 'rgba(214,40,90,.0)'; }
}
const FACE_CACHE = {}
function faceMat(expr, kind) {
  const k = (kind === 'bag' ? 'bag' : 'x') + ':' + expr
  if (!FACE_CACHE[k]) FACE_CACHE[k] = new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, x => drawFace(x, expr, kind)), transparent: true, alphaTest: 0.05, depthWrite: false })
  return FACE_CACHE[k]
}
// 頭の上の記号（zzz・！・汗・キラキラ）
const EMO = {}
function emoMat(kind) {
  if (EMO[kind]) return EMO[kind]
  const t = canvasTex(128, 128, (x) => {
    x.lineCap = 'round'; x.lineJoin = 'round'
    if (kind === 'zzz') { x.fillStyle = '#fff'; x.strokeStyle = '#3a5a8a'; x.lineWidth = 7; x.font = `900 44px ${GFONT}`; for (const [s, xx, yy] of [[1, 30, 100], [0.8, 64, 66], [0.6, 92, 38]]) { x.save(); x.translate(xx, yy); x.scale(s, s); x.strokeText('Z', 0, 0); x.fillText('Z', 0, 0); x.restore() } }
    if (kind === '!') { x.fillStyle = '#ffcf3a'; x.strokeStyle = '#1a1e24'; x.lineWidth = 6; x.beginPath(); x.moveTo(52, 12); x.lineTo(76, 12); x.lineTo(70, 82); x.lineTo(58, 82); x.closePath(); x.fill(); x.stroke(); x.beginPath(); x.arc(64, 104, 11, 0, 7); x.fill(); x.stroke() }
    if (kind === 'sweat') { x.fillStyle = '#8fd4ff'; x.strokeStyle = '#2a5a8a'; x.lineWidth = 5; x.beginPath(); x.moveTo(64, 14); x.quadraticCurveTo(100, 76, 64, 104); x.quadraticCurveTo(28, 76, 64, 14); x.fill(); x.stroke() }
    if (kind === 'spark') { x.fillStyle = '#ffd84a'; x.strokeStyle = '#a8820f'; x.lineWidth = 4; for (const [sx, sy, r] of [[40, 50, 30], [92, 84, 20], [96, 30, 14]]) { x.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r; x.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr) } x.closePath(); x.fill(); x.stroke() } }
    if (kind === 'vein') { x.strokeStyle = '#e0483a'; x.lineWidth = 12; x.beginPath(); for (const [a, b, c, d] of [[30, 40, 54, 54], [98, 40, 74, 54], [30, 88, 54, 74], [98, 88, 74, 74]]) { x.moveTo(a, b); x.quadraticCurveTo(64, 64, c === 54 ? a + 34 : a - 34, b === 40 ? b + 4 : b - 4) } x.stroke() }
  })
  return EMO[kind] = new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })
}
const GEO = {
  torso: new THREE.CylinderGeometry(0.25, 0.3, 0.56, 12).translate(0, 0.28, 0), head: new THREE.SphereGeometry(0.34, 18, 14),
  hair: new THREE.SphereGeometry(0.36, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), arm: new THREE.CylinderGeometry(0.065, 0.058, 1, 8).translate(0, -0.5, 0),
  hand: new THREE.SphereGeometry(0.085, 10, 8), thigh: new THREE.CylinderGeometry(0.1, 0.09, 0.42, 8).translate(0, -0.21, 0), shin: new THREE.CylinderGeometry(0.085, 0.07, 0.44, 8).translate(0, -0.22, 0),
  shoe: new THREE.BoxGeometry(0.13, 0.08, 0.24), face: new THREE.PlaneGeometry(0.58, 0.58), ball: new THREE.SphereGeometry(1, 10, 8),
}
const SKINS = [0xffdcbc, 0xf2c8a0, 0xffe4cc, 0xe6b48c]
const SHIRTS = [0x3d5a80, 0x8a5a44, 0xe8e2d0, 0x5a7d5a, 0xb04a5a, 0x6a6a7a, 0xd8a040, 0x4a8aa0, 0x9a7ab0, 0x2e2e38]
const HAIRS = [0x2a1d18, 0x4a3020, 0x1a1a1a, 0x7a5030, 0x5a4a40]
function randSpec() {
  const pick = a => a[Math.floor(vr() * a.length)]
  return { kind: 'pass', skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick([0x2e3440, 0x4a4038, 0x2a2a30, 0x5a5a62]), hair: pick(HAIRS), style: pick(['short', 'short', 'long', 'bun', 'bald', 'cap']), w: 0.9 + vr() * 0.25, glasses: vr() < 0.25, bag: pick([0x8a5a3a, 0x3a4a6a, 0xc04a3a, 0xd8b040, 0x5a8a5a]) }
}
const SPECS = {
  me: { kind: 'me', skin: 0xffdcbc, shirt: 0xf4f4f0, pants: 0x2e3440, hair: 0x2a1d18, style: 'ahoge', w: 1.0, tie: 0x3949ab, bag: 0x2a2a30 },
  aunt: { kind: 'aunt', skin: 0xf2c8a0, shirt: 0x8a3fa0, pants: 0x4a3a50, hair: 0x9a8aa8, style: 'curly', w: 1.28, bag: 0xd8b040, leek: true },
  bag: { kind: 'bag', skin: 0xffe4cc, shirt: 0x2a3550, pants: 0x2a3550, hair: 0x1a1a1a, style: 'short', w: 1.0, tie: 0xc0392b, brief: true },
  stu: { kind: 'stu', skin: 0xffdcbc, shirt: 0x1e2230, pants: 0x1e2230, hair: 0x1a1a1a, style: 'messy', w: 0.95, phones: true },
  gran: { kind: 'gran', skin: 0xf2d0b0, shirt: 0xc8a0a0, pants: 0x6a5a5a, hair: 0xe0e0e0, style: 'bun', w: 1.0, scale: 0.86, cane: true },
}
function buildMesh(sp) {
  const root = new THREE.Group(), sc = sp.scale || 1; root.scale.setScalar(sc)
  const hips = new THREE.Group(); root.add(hips)
  const torso = new THREE.Mesh(GEO.torso, lam(sp.shirt)); torso.scale.set(sp.w, 1, sp.w * 0.82); hips.add(torso)
  if (sp.tie) box(0.08, 0.36, 0.03, lam(sp.tie), 0, 0.32, 0.24 * sp.w, hips)
  if (sp.kind === 'stu') for (let i = 0; i < 3; i++) box(0.035, 0.035, 0.02, lam(0xd8b040), 0, 0.46 - i * 0.12, 0.255 * sp.w, hips)
  const head = new THREE.Group(); head.position.y = 0.84; hips.add(head)
  head.add(new THREE.Mesh(GEO.head, lam(sp.skin)))
  const hm = lam(sp.hair)
  if (sp.style !== 'bald') { const h = new THREE.Mesh(GEO.hair, hm); h.rotation.x = -0.42; h.position.set(0, 0.03, -0.04); head.add(h) }
  else for (const s of [-1, 1]) { const t = new THREE.Mesh(GEO.ball, hm); t.scale.set(0.1, 0.14, 0.18); t.position.set(s * 0.31, 0.02, -0.06); head.add(t) }
  if (sp.style === 'long') box(0.62, 0.5, 0.2, hm, 0, -0.12, -0.2, head)
  if (sp.style === 'bun') { const b = new THREE.Mesh(GEO.ball, hm); b.scale.setScalar(0.15); b.position.set(0, 0.34, -0.16); head.add(b) }
  if (sp.style === 'cap') { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.37, 0.18, 16), lam(sp.bag)); c.position.y = 0.26; head.add(c); box(0.36, 0.03, 0.22, lam(sp.bag), 0, 0.18, 0.36, head) }
  if (sp.style === 'curly') for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2, b = new THREE.Mesh(GEO.ball, hm); b.scale.setScalar(0.15); b.position.set(Math.cos(a) * 0.3, 0.2 + Math.sin(i * 1.7) * 0.06, Math.sin(a) * 0.3 - 0.04); head.add(b); if (i < 5) { const c = b.clone(); c.position.y = 0.36; c.position.x *= 0.5; c.position.z *= 0.5; head.add(c) } }
  if (sp.style === 'ahoge') { const a = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 5, 10, Math.PI * 1.2), hm); a.position.set(0.02, 0.43, 0); a.rotation.set(0, 0, -0.3); head.add(a) }
  if (sp.style === 'messy') for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 5), hm); const a = i / 6 * Math.PI * 2; s.position.set(Math.cos(a) * 0.2, 0.34, Math.sin(a) * 0.2 - 0.05); s.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); head.add(s) }
  if (sp.phones) { const p = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.035, 6, 16, Math.PI), lam(0xe0483a)); p.position.y = 0.04; head.add(p); for (const s of [-1, 1]) box(0.06, 0.16, 0.14, lam(0xe0483a), s * 0.36, 0, 0, head) }
  if (sp.glasses) { const g = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 5, 12), lam(0x222222)); for (const s of [-1, 1]) { const c = g.clone(); c.position.set(s * 0.11, 0.02, 0.33); head.add(c) } }
  const face = new THREE.Mesh(GEO.face, faceMat('normal', sp.kind)); face.position.set(0, -0.03, 0.352); face.renderOrder = 2; head.add(face)
  const arms = []
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * (0.26 * sp.w + 0.05), 0.48, 0); hips.add(a)
    const up = new THREE.Mesh(GEO.arm, lam(sp.shirt)); a.add(up)
    const hand = new THREE.Mesh(GEO.hand, lam(sp.skin)); a.add(hand)
    arms.push({ g: a, up, hand })
  }
  const legs = []
  for (const s of [-1, 1]) {
    const th = new THREE.Group(); th.position.set(s * 0.12 * sp.w, 0, 0); root.add(th)
    th.add(new THREE.Mesh(GEO.thigh, lam(sp.pants)))
    const kn = new THREE.Group(); kn.position.y = -0.42; th.add(kn)
    kn.add(new THREE.Mesh(GEO.shin, lam(sp.pants)))
    const sh = new THREE.Mesh(GEO.shoe, lam(0x2a2420)); sh.position.set(0, -0.45, 0.05); kn.add(sh)
    legs.push({ th, kn })
  }
  // 持ち物
  const phone = new THREE.Group(); box(0.08, 0.14, 0.02, lam(0x1a1e24), 0, 0, 0, phone); const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.11), basic(0x8fd8ff)); scr.position.z = -0.012; scr.rotation.y = Math.PI; phone.add(scr); hips.add(phone); phone.visible = false
  const lapBag = box(0.42, 0.24, 0.16, lam(sp.bag || 0x8a5a3a), 0, 0.12, 0.3, root); lapBag.visible = false
  const held = new THREE.Group(); hips.add(held)
  if (sp.leek) { box(0.3, 0.32, 0.14, lam(0xf4f0e6), 0, -0.16, 0, held); const lk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 6), lam(0xe8f0d8)); lk.position.set(0.06, 0.12, 0); lk.rotation.z = 0.25; held.add(lk); const lt = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.3, 6), lam(0x4a9a3a)); lt.position.set(0.14, 0.48, 0); lt.rotation.z = 0.25; held.add(lt) }
  if (sp.brief) box(0.36, 0.26, 0.08, lam(0x6a4a2a), 0, -0.14, 0, held)
  if (sp.cane) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.85, 6), lam(0x6a4a2a)); c.position.y = -0.42; held.add(c) }
  const emo = new THREE.Sprite(emoMat('zzz')); emo.scale.set(0.42, 0.42, 1); emo.position.set(0.32, 0.5, 0); head.add(emo); emo.visible = false
  scene.add(root)
  return { root, hips, head, face, arms, legs, phone, lapBag, held, emo, torso }
}
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, -1, 0), _w = new THREE.Vector3()
function setArm(M, i, x, y, z) { const a = M.arms[i]; _v.set(x, y, z); const len = Math.max(0.05, _v.length()); _v.multiplyScalar(1 / len); a.up.quaternion.setFromUnitVectors(_up, _v); a.up.scale.set(1, len, 1); a.hand.position.set(x, y, z) }
function reachWorld(M, i, wx, wy, wz) { const a = M.arms[i].g; _w.set(wx, wy, wz); a.worldToLocal(_w); setArm(M, i, _w.x, _w.y, _w.z) }

// 手前の乗客（満員の雰囲気。動きには関わらない）
const extras = []
for (const [x, z] of [[-3.25, 2.05], [-1.95, 2.25], [-0.62, 2.0], [0.7, 2.2], [2.0, 2.0], [3.3, 2.25]]) {
  const sp = randSpec(); if (sp.style === 'cap') sp.style = 'short'; const M = buildMesh(sp); M.root.position.set(x, 0, z); M.root.rotation.y = Math.PI + (vr() - 0.5) * 0.4
  M.hips.position.y = 0.92; for (const L of M.legs) { L.th.position.y = 0.92; L.th.rotation.x = 0; L.kn.rotation.x = 0 } M.held.visible = false
  setArm(M, 0, -0.05, -0.48, 0.05); setArm(M, 1, 0.02, 0.6, 0.05); M.face.material = faceMat('dead'); extras.push({ M, x, ph: vr() * 6 })
}
// ---------- 人の論理データ
function newPerson(spec, role) {
  const P = { spec, kind: spec.kind, role, seat: -1, slot: -1, x: 0, z: STAND_Z, base: 'none', f: { phone: false, sleep: false, look: 0, bagLap: false, stretch: false, scoot: false },
    expr: 'normal', exprT: 0, emo: null, emoT: 0, hasRack: false, rackMesh: null, M: null, gone: false, vx: 0, vz: STAND_Z, vry: Math.PI, vstand: 1, sitT: -9, riseT: -9, walk: null, sinceK: -1, wob: 0 }
  if (!S.fast) { P.M = buildMesh(spec); P.M.root.position.set(0, 0, STAND_Z) }
  S.persons.push(P); return P
}
function setBase(P, b) { P.base = b; P.f.phone = b === 'phone'; P.f.sleep = b === 'sleep'; P.f.look = 0; P.f.bagLap = false; P.f.stretch = false; P.f.scoot = false }
function setExpr(P, e, sec = 0) { P.expr = e; P.exprT = sec }
function setEmo(P, e, sec) { P.emo = e; P.emoT = sec }
function removePerson(P) { P.gone = true; if (P.M) { scene.remove(P.M.root); P.M = null } if (P.rackMesh) { scene.remove(P.rackMesh); P.rackMesh = null } }
function seatPerson(P, i, instant) {
  P.role = 'seated'; P.seat = i; P.slot = -1; P.sitT = instant ? -9 : S.simT; P.walk = null
  S.seats[i].P = P; S.seats[i].state = 'sit'; S.seats[i].claimT = S.t
}

// ---------- ゲームの流れ
function freeSlots(excl = []) { const out = []; for (let i = 0; i < N; i++) { if (S.player && (S.player.slot === i || (S.player.seat === i))) continue; if (S.rivals.some(r => r.slot === i)) continue; if (excl.includes(i)) continue; out.push(i) } return out }
function rivalAt(i) { return S.rivals.find(r => r.slot === i && !r.go) }
function spawnRival(type, walkIn) {
  const fs = freeSlots(); if (!fs.length) return null
  const slot = fs[Math.floor(S.rng() * fs.length)]
  const P = newPerson(SPECS[type], 'rival'); P.slot = slot
  const r = { P, type, slot, go: null, ...RIVAL[type] }
  if (type === 'stu') { setExpr(P, 'sleep'); setEmo(P, 'zzz', 999) }
  if (walkIn && P.M) { const dx = SX(slot) < 0 ? -DOOR_X : DOOR_X; P.vx = dx; P.vz = -0.9 } else { P.vx = SX(slot); P.vz = STAND_Z }
  S.rivals.push(r); return r
}
function topUpRivals(k, walkIn) {
  const want = D.STATIONS[k].rivals
  while (S.rivals.length < want) {
    const have = S.rivals.map(r => r.type), order = ['aunt', 'bag', 'stu'].filter(t => !have.includes(t))
    const type = order.length ? order[0] : ['aunt', 'bag', 'stu'][Math.floor(S.rng() * 3)]
    if (!spawnRival(type, walkIn)) break
  }
}
function startGame(seed) {
  for (const P of S.persons) removePerson(P)
  S.persons = []; S.rivals = []; S.seats = []; S.onsets = []
  S.seed = seed ?? Math.floor(Math.random() * 1e9); S.rng = mulberry(S.seed); S.brng = mulberry(S.seed * 7 + 3)
  S.t = 0; S.k = 0; S.segT = 0; S.won = 0; S.seatT = 0; S.chi = 0; S.laps = 0; S.stumbles = 0; S.hist = []; S.result = null; S.endT = 0; S.botM = {}
  S.phase = 'intro'; S.view = 'play'; S.plan = null; S.lurchK = 0
  for (let i = 0; i < N; i++) {
    S.seats.push({ P: null, state: 'sit', claimT: -9 })
    const P = newPerson(randSpec(), 'seated'); const u = S.rng(); setBase(P, u < 0.5 ? 'phone' : u < 0.8 ? 'sleep' : 'none')
    P.hasRack = S.rng() < 0.4; seatPerson(P, i, true); P.vx = SX(i); P.vz = SEAT_Z; P.vry = 0; P.vstand = 0
    if (P.hasRack && P.M) { P.rackMesh = box(0.46, 0.22, 0.3, lam(P.spec.bag), SX(i), 2.27, -1.3); }
  }
  const pl = newPerson(SPECS.me, 'player'); pl.slot = 3; pl.vx = SX(3); S.player = pl
  Object.assign(pl, { moving: null, queue: 0, stun: 0, pending: null, lapT: -9 })
  topUpRivals(0, false)
  S.tutOn = !S.tutSeen
  if (!S.fast) { clearFx(); show('vPlay'); $('#bPause').hidden = false; buildLine(); Snd.setTrack('play'); flashMsg(T('introLine'), 1.5, 'small'); camSnap = true; drawPlatform(D.STATIONS[0][S.lang]) }
  last = performance.now(); acc = 0
}
function goTitle() {
  revealTimers.forEach(clearTimeout)
  for (const P of S.persons) removePerson(P); for (const f of flying) scene.remove(f.m); flying.length = 0
  S.persons = []; S.rivals = []; S.result = null; S.plan = null; S.k = 0; S.hist = []; S.won = 0; S.segT = 0; S.lurchK = 0
  S.view = 'title'; S.phase = 'idle'; show('vTitle'); $('#bPause').hidden = true; clearFx(); Snd.setTrack('title')
  startTitleScene(); applyLang(); drawLed(`${T('next')} ${D.STATIONS[0][S.lang]}`, false); camSnap = true
}
// タイトル用の車内（7人が座り、主人公が立っている）
function startTitleScene() {
  S.seats = []
  for (let i = 0; i < N; i++) {
    S.seats.push({ P: null, state: 'sit', claimT: -9 })
    const P = newPerson(randSpec(), 'seated'); setBase(P, ['phone', 'sleep', 'phone', 'none', 'sleep', 'phone', 'phone'][i]); seatPerson(P, i, true); P.vx = SX(i); P.vz = SEAT_Z; P.vry = 0; P.vstand = 0
    if (P.f.sleep) setEmo(P, 'zzz', 999)
  }
  const pl = newPerson(SPECS.me, 'player'); pl.slot = 3; pl.vx = SX(3); S.player = pl; Object.assign(pl, { moving: null, queue: 0, stun: 0, pending: null }); setExpr(pl, 'dead', 999)
  const a = newPerson(SPECS.aunt, 'rival'); a.slot = 1; a.vx = SX(1); S.rivals = [{ P: a, type: 'aunt', slot: 1, go: null, ...RIVAL.aunt }]
  const b = newPerson(SPECS.bag, 'rival'); b.slot = 5; b.vx = SX(5); S.rivals.push({ P: b, type: 'bag', slot: 5, go: null, ...RIVAL.bag })
}

// 1駅ぶんの台本（降りる人・ひっかけ・揺れ）を種から作る
function makePlan(k) {
  const r = S.rng, st = D.STATIONS[k], pl = S.player
  const ok = i => { const P = S.seats[i].P; return P && P !== pl && P.kind !== 'gran' }
  let cand = []; for (let i = 0; i < N; i++) if (ok(i)) cand.push(i)
  const fresh = cand.filter(i => S.seats[i].P.sinceK < k - 1 || S.seats[i].P.sinceK === -1)
  if (fresh.length >= st.leavers) cand = fresh
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1));[cand[i], cand[j]] = [cand[j], cand[i]] }
  const leavers = cand.slice(0, st.leavers), ev = []
  const add = (t, seat, act) => ev.push({ t, seat, act, P: S.seats[seat].P, done: false })
  const late = k >= 2
  for (const L of leavers) {
    const P = S.seats[L].P, t1 = late ? 3.2 + r() * 2.6 : 1.4 + r() * 3.4
    if (P.base === 'sleep') { add(t1, L, 'wake'); add(t1 + 0.7 + r() * 0.8, L, 'lookSign') }
    else if (P.base === 'phone') { add(t1, L, 'phoneAway'); add(t1 + 0.8 + r() * 1.2, L, P.hasRack ? 'lookRack' : 'lookSign') }
    else { add(t1, L, 'lookSign'); add(t1 + 1.0 + r() * 0.8, L, 'bagLap') }
    add(7.35 + r() * 0.35, L, 'bagLap'); add(7.85 + r() * 0.3, L, 'scoot')
  }
  const others = cand.slice(st.leavers)
  const nf = Math.min(others.length, k === 0 ? 1 : k < 3 ? 2 : 3)
  for (let n = 0; n < nf; n++) {
    const F = others[n], P = S.seats[F].P, tf = 1.0 + r() * 5.0
    const opts = P.base === 'phone' ? ['phoneFake', 'phoneFake', 'stretch', 'signFake'] : P.base === 'sleep' ? ['wakeFake', 'wakeFake', 'stretch'] : ['stretch', 'signFake']
    const o = opts[Math.floor(r() * opts.length)]
    if (o === 'phoneFake') { add(tf, F, 'phoneAway'); add(tf + 1.3 + r() * 0.9, F, 'phoneOut') }
    if (o === 'wakeFake') { add(tf, F, 'wake'); if (r() < 0.5) add(tf + 0.5, F, 'lookSign'); add(tf + 1.4 + r() * 0.8, F, 'doze') }
    if (o === 'stretch') { add(tf, F, 'stretch'); add(tf + 1.1, F, 'unstretch') }
    if (o === 'signFake') { add(tf, F, 'lookSign'); add(tf + 1.4 + r() * 0.8, F, 'lookBack') }
  }
  // 終盤のひっかけ（ドア直前にスマホをしまう・伸びをする）
  if (k >= 3 && others.length > nf) {
    const F = others[nf], P = S.seats[F].P
    if (P.base === 'phone') { add(7.1, F, 'phoneAway'); add(8.45 + r() * 0.3, F, 'phoneOut') } else { add(7.4, F, 'stretch'); add(8.4, F, 'unstretch') }
  }
  ev.sort((a, b) => a.t - b.t)
  const lurches = [{ t: 0.35, dur: 0.45, dir: -1 }]
  const nl = 1 + (k >= 2 ? 1 : 0) + (r() < 0.5 ? 1 : 0)
  let lt = 1.8 + r() * 0.8
  for (let i = 0; i < nl && lt < 6.6; i++) { lurches.push({ t: lt, dur: 0.5, dir: r() < 0.5 ? -1 : 1 }); lt += 1.3 + r() * 1.5 }
  lurches.push({ t: 7.7, dur: 0.7, dir: 1 })
  const auntT = [7.0 + r() * 0.4]; if (k >= 1) auntT.push(8.1 + r() * 0.3)
  return { leavers, ev, lurches, auntT, gran: pl.seat >= 0 ? { t: 3.4, sit: 4.8, P: null, seat: pl.seat } : null, vacDone: false, riseDone: false, doorDone: false, decelDone: false, fillDone: false, boardDone: false }
}
function startSeg(k) {
  S.k = k; S.segT = 0; S.onsets = []; S.phase = 'seg'
  if (k > 0) topUpRivals(k, false)
  // 降りずに残った人は元の様子に戻す
  for (const st of S.seats) if (st.P && st.P.role === 'seated' && st.P !== S.player) { const P = st.P; const b = P.base; setBase(P, b); if (P.kind === 'stu' || b === 'sleep') { setExpr(P, 'sleep'); setEmo(P, 'zzz', 999) } else { setExpr(P, b === 'phone' ? 'phone' : P.kind === 'gran' ? 'kind' : 'normal'); setEmo(P, null, 0) } }
  S.plan = makePlan(k)
  if (!S.fast) { drawPlatform(D.STATIONS[k][S.lang]); if (k > 0) { flashMsg(T('depart'), 1.0); Snd.sfx('go') } updateLine() }
}
function applyEvent(e) {
  const P = e.P; if (!P || P.gone || P.role !== 'seated' || S.seats[e.seat].P !== P) return
  const f = P.f, on = () => S.onsets.push({ t: S.segT, seat: e.seat, act: e.act })
  switch (e.act) {
    case 'phoneAway': f.phone = false; setExpr(P, 'normal'); on(); break
    case 'phoneOut': f.phone = true; setExpr(P, 'phone'); break
    case 'wake': f.sleep = false; setExpr(P, 'wake', 0.8); setEmo(P, '!', 0.8); on(); break
    case 'doze': f.sleep = true; f.look = 0; setExpr(P, 'sleep'); setEmo(P, 'zzz', 999); break
    case 'lookSign': f.look = 1; on(); break
    case 'lookRack': f.look = 2; on(); break
    case 'lookBack': f.look = 0; break
    case 'bagLap': if (!f.bagLap) { f.bagLap = true; if (P.rackMesh) P.rackMesh.visible = false; on() } break
    case 'stretch': f.stretch = true; setExpr(P, 'happy', 1.0); on(); break
    case 'unstretch': f.stretch = false; break
    case 'scoot': f.scoot = true; f.look = 0; f.phone = false; f.sleep = false; setEmo(P, null, 0); on(); break
  }
  if (!S.fast && e.act !== 'unstretch') Snd.sfx('tell')
}
function stepPlay() {
  const pl = S.player
  if (S.phase === 'intro') { S.t += DT; stepPlayer(); if (S.t >= TL.INTRO) startSeg(0); return }
  if (S.phase === 'end') { S.t += DT; S.endT += DT; if (pl.seat >= 0) S.seatT += DT; stepPlayer(); if (S.endT >= TL.END) finish(); return }
  if (S.bot) botStep()
  S.t += DT; S.segT += DT; const t = S.segT, P = S.plan
  if (pl.seat >= 0) S.seatT += DT
  for (const e of P.ev) if (!e.done && e.t <= t) { e.done = true; applyEvent(e) }
  // 揺れ
  let lk = 0
  for (const L of P.lurches) {
    if (!L.warned && t >= L.t - 0.7) { L.warned = true; if (!S.fast) Snd.sfx('warn') }
    if (!L.hit && t >= L.t) { L.hit = true; S.shake = 0.45; S.lurchDir = L.dir; if (!S.fast) Snd.sfx('lurch') }
    if (t >= L.t && t < L.t + L.dur) lk = 1
  }
  S.lurchK = lk
  if (lk && pl.moving) stumble()
  // おばちゃんは降りる人を読んで寄ってくる
  for (const at of P.auntT) if (!P['a' + at] && t >= at) { P['a' + at] = true; auntRead() }
  // おばあちゃん（座っていたら譲る）
  if (P.gran) stepGran(P.gran, t)
  if (!P.decelDone && t >= TL.DECEL) { P.decelDone = true; if (!S.fast) { Snd.sfx('announce'); Snd.sfx('brake') } }
  if (!P.doorDone && t >= TL.DOOR) { P.doorDone = true; if (!S.fast) { Snd.sfx('chime'); Snd.sfx('door') } }
  if (!P.riseDone && t >= TL.RISE) { P.riseDone = true; for (const L of P.leavers) { const st = S.seats[L]; if (st.P && st.P.role === 'seated') { st.state = 'rising'; st.P.riseT = S.simT; if (!S.fast) Snd.sfx('stand') } } }
  if (!P.vacDone && t >= TL.VAC) { P.vacDone = true; vacate() }
  if (P.vacDone) resolveClaims()
  if (!P.boardDone && t >= TL.BOARD) { P.boardDone = true; if (S.k < 4) topUpRivals(S.k + 1, true) }
  if (!P.fillDone && t >= TL.FILL) { P.fillDone = true; fillSeats() }
  stepPlayer()
  if (t >= TL.SEG) { if (S.k < 4) startSeg(S.k + 1); else { S.phase = 'end'; S.endT = 0; if (!S.fast) { flashMsg(T('goal'), 1.4, 'small') } } }
}
function stepPlayer() {
  const pl = S.player
  if (pl.stun > 0) pl.stun = Math.max(0, pl.stun - DT)
  if (pl.moving) {
    const m = pl.moving; m.k += DT / m.dur
    if (m.k >= 1) { pl.slot = m.to; if (m.rv) { m.rv.slot = m.from } pl.moving = null; if (pl.queue) { const q = pl.queue; pl.queue = 0; move(q) } }
  }
}
function stumble() {
  const pl = S.player, m = pl.moving; pl.moving = null; pl.queue = 0; pl.stun = STUN_T; S.stumbles++; S.chi++
  const tgt = m.rv ? m.rv.P : (S.seats[m.to] && S.seats[m.to].P)
  if (!S.fast) { Snd.sfx('stumble'); setTimeout(() => Snd.sfx('chi'), 280); say(pl, T('oops'), 1.0, 'me'); if (tgt) { say(tgt, T('chi'), 1.2, 'chi'); setExpr(tgt, 'annoyed', 1.4); setEmo(tgt, 'vein', 1.2) } setExpr(pl, 'shock', 1.0) }
  pl.wob = 1
}
function auntRead() {
  const pl = S.player
  for (const r of S.rivals) {
    if (r.type !== 'aunt' || r.go) continue
    let best = null; for (const L of S.plan.leavers) { const d = Math.abs(L - r.slot); if (d > 0 && d <= 3 && (best === null || d < Math.abs(best - r.slot))) best = L }
    if (best === null) continue
    const to = r.slot + Math.sign(best - r.slot)
    const blocked = (pl.slot === to && pl.seat < 0) || pl.seat === to || (pl.moving && pl.moving.to === to) || S.rivals.some(o => o !== r && o.slot === to)
    if (!blocked) { r.slot = to; if (!S.fast) { Snd.sfx('step') } }
  }
}
function stepGran(g, t) {
  const pl = S.player
  if (!g.P && t >= g.t) {
    g.P = newPerson(SPECS.gran, 'walk'); setExpr(g.P, 'kind'); setBase(g.P, 'none'); g.P.sinceK = 99
    const dx = SX(g.seat) < 0 ? -DOOR_X : DOOR_X; g.P.vx = dx; g.P.vz = -0.9; g.P.walk = { x: SX(g.seat), z: STAND_Z + 0.12, ry: Math.PI }
    if (!S.fast) say(g.P, '…', 1.0)
  }
  if (g.P && !g.done && t >= g.sit) {
    g.done = true
    if (pl.seat === g.seat) {
      pl.seat = -1; pl.slot = g.seat; pl.role = 'player'; pl.riseT = S.simT; pl.moving = null
      const bump = S.rivals.find(r => r.slot === g.seat); if (bump) { const fs = freeSlots(); if (fs.length) bump.slot = fs[0] }
      seatPerson(g.P, g.seat)
      if (!S.fast) { Snd.sfx('yield'); say(pl, T('yieldMe'), 1.6, 'me'); setExpr(pl, 'cry', 1.6); setEmo(pl, 'spark', 1.4); setTimeout(() => { if (g.P.M) say(g.P, T('yieldGran'), 1.5) }, 500) }
    } else { g.P.role = 'walk'; g.P.walk = { x: DOOR_X, z: -0.9, ry: Math.PI / 2, gone: true } }
  }
}
function vacate() {
  const pl = S.player, P = S.plan
  for (const L of P.leavers) {
    const st = S.seats[L]; if (!st.P || st.state !== 'rising') continue
    const lv = st.P; lv.role = 'walk'; lv.seat = -1; lv.walk = { x: SX(L) < 0 ? -DOOR_X : DOOR_X, z: -0.05, ry: SX(L) < 0 ? -Math.PI / 2 : Math.PI / 2, gone: true }
    if (lv.rackMesh) { scene.remove(lv.rackMesh); lv.rackMesh = null }
    st.P = null; st.state = 'vacant'; st.claimT = -9
    if (!S.fast && L === P.leavers[0]) say(lv, T('leave'), 1.0)
  }
  // ライバルが空いた席を狙う
  const pf = pl.seat < 0 && !pl.moving ? pl.slot : -1
  for (const r of S.rivals) {
    let best = null
    for (let i = 0; i < N; i++) {
      if (S.seats[i].state !== 'vacant') continue
      const d = Math.abs(r.slot - i); if (d > r.range) continue
      const at = TL.VAC + r.react + r.per * d + (pf === i && d > 0 && !r.throws ? BLOCK : 0)
      if (!best || at < best.at) best = { seat: i, at }
    }
    if (best) { r.go = { seat: best.seat, at: best.at, t0: TL.VAC + r.react, said: false, x0: SX(r.slot) } }
  }
}
function resolveClaims() {
  const pl = S.player, t = S.segT
  for (let i = 0; i < N; i++) {
    const st = S.seats[i]; if (st.state !== 'vacant') continue
    let who = null, at = Infinity
    if (pl.pending && pl.pending.seat === i) { who = 'me'; at = pl.pending.t }
    for (const r of S.rivals) if (r.go && r.go.seat === i && r.go.at < at) { who = r; at = r.go.at }
    if (who === null || at > t) continue
    if (who === 'me') winSeat(i); else rivalWins(who, i)
  }
  // ライバルの「動き出し」の一言
  if (!S.fast) for (const r of S.rivals) if (r.go && !r.go.said && t >= r.go.t0) {
    r.go.said = true
    if (r.type === 'aunt') { say(r.P, T('auntGo'), 0.9); Snd.sfx('dash') }
    if (r.type === 'bag') { say(r.P, T('bagThrow'), 0.9); Snd.sfx('throw'); throwBag(r) }
    if (r.type === 'stu') { say(r.P, T('stuWake'), 0.8); setExpr(r.P, 'fierce', 2); setEmo(r.P, '!', 0.6); Snd.sfx('wake') }
  }
}
function winSeat(i) {
  const pl = S.player; pl.pending = null; pl.queue = 0
  seatPerson(pl, i); pl.role = 'player'; pl.seat = i
  S.won++; S.hist[S.k] = 'won'
  for (const r of S.rivals) if (r.go && r.go.seat === i) { r.go = null; S.chi++; if (!S.fast) { say(r.P, T('chi'), 1.2, 'chi'); setEmo(r.P, 'vein', 1.2) } if (r.type === 'stu') { setExpr(r.P, 'sleep'); setEmo(r.P, 'zzz', 999) } }
  if (!S.fast) { Snd.sfx('sit'); setTimeout(() => Snd.sfx('bliss'), 200); setExpr(pl, 'bliss', 3); setEmo(pl, 'spark', 2.2); say(pl, T('win'), 1.8, 'me'); cutIn('win'); updateLine() }
}
function rivalWins(r, i) {
  const pl = S.player
  S.rivals.splice(S.rivals.indexOf(r), 1)
  const P = r.P; seatPerson(P, i); P.sinceK = S.k; setBase(P, r.base)
  for (const o of S.rivals) if (o.go && o.go.seat === i) { o.go = null; if (!S.fast) say(o.P, T('chi2'), 1.0, 'chi') }
  const mine = (pl.pending && pl.pending.seat === i) || (pl.seat < 0 && pl.slot === i && !pl.moving)
  if (pl.pending && pl.pending.seat === i) pl.pending = null
  if (mine && S.hist[S.k] !== 'won') S.hist[S.k] = 'lost'
  if (!S.fast) {
    const line = r.type === 'aunt' ? T('auntWin') : r.type === 'bag' ? T('bagWin') : T('stuWin')
    setTimeout(() => { if (P.M) say(P, line, 1.6) }, 250); setExpr(P, r.type === 'stu' ? 'sleep' : 'smug', r.type === 'stu' ? 999 : 2.5); if (r.type === 'stu') setEmo(P, 'zzz', 999)
    Snd.sfx('sit'); if (mine) { setExpr(pl, 'cry', 2); setTimeout(() => Snd.sfx('grr'), 300); setTimeout(() => say(pl, T('lose'), 1.4, 'me'), 300); cutIn('lose'); Snd.sfx('lose') }
  }
}
function fillSeats() {
  const pl = S.player
  for (let i = 0; i < N; i++) {
    const st = S.seats[i]; if (st.state !== 'vacant') continue
    const P = newPerson(randSpec(), 'seated'); const u = S.rng(); setBase(P, u < 0.6 ? 'phone' : 'sleep'); P.hasRack = false; P.sinceK = S.k
    seatPerson(P, i)
    if (P.M) { P.vx = SX(i) < 0 ? -DOOR_X : DOOR_X; P.vz = -0.3; P.vstand = 1 }
    if (P.f.sleep) setEmo(P, 'zzz', 999); else setExpr(P, 'phone')
    const mine = (pl.pending && pl.pending.seat === i) || (pl.seat < 0 && pl.slot === i)
    if (pl.pending && pl.pending.seat === i) pl.pending = null
    if (mine && S.hist[S.k] !== 'won') { S.hist[S.k] = 'lost'; if (!S.fast) { setExpr(pl, 'cry', 1.6); cutIn('lose', T('boarders')); Snd.sfx('lose') } }
    if (!S.fast) say(P, T('board'), 0.9)
  }
  for (const r of S.rivals) r.go = null
}
// 操作
function canAct() { return S.view === 'play' && (S.phase === 'seg' || S.phase === 'intro') }
function move(dir) {
  const pl = S.player; if (!canAct() || pl.seat >= 0 || pl.stun > 0 || pl.pending) return false
  if (pl.moving) { pl.queue = dir; return true }
  const to = pl.slot + dir; if (to < 0 || to >= N) return false
  const rv = rivalAt(to)
  pl.moving = { from: pl.slot, to, k: 0, dur: rv ? SQUEEZE_T : MOVE_T, rv }
  if (S.tutOn && S.phase === 'seg') { /* 1回動けば説明は消してよい */ }
  if (!S.fast) { Snd.sfx(rv ? 'squeeze' : 'step'); if (rv) { say(pl, T('squeeze'), 0.8, 'me') } }
  if (rv) { S.chi++; if (!S.fast) { setTimeout(() => { if (rv.P.M) say(rv.P, T('chi'), 1.0, 'chi') }, 200); setEmo(rv.P, 'vein', 1.0) } }
  return true
}
function sit() {
  const pl = S.player; if (!canAct() || S.phase !== 'seg' || pl.seat >= 0 || pl.stun > 0 || pl.moving || pl.pending) return false
  const st = S.seats[pl.slot], t = S.segT
  if (st.state === 'vacant' || (st.state === 'rising' && t >= TL.VAC - TL.EARLY)) { pl.pending = { seat: pl.slot, t: Math.max(t, TL.VAC) + TL.SITDELAY }; if (!S.fast) Snd.sfx('tap'); return true }
  if (st.state === 'sit' && S.t - st.claimT < 0.7 && st.claimT > 0) { pl.stun = 0.25; if (!S.fast) { say(pl, '…!', 0.6, 'me') } return false }
  // 座っている人（立ち上がる途中も）に座る＝ひざの上
  pl.stun = LAP_T; S.laps++; S.chi++; pl.lapT = S.simT
  if (!S.fast) { const v = st.P; Snd.sfx('lap'); setTimeout(() => Snd.sfx('chi'), 400); say(pl, T('lapMe'), 1.2, 'me'); setExpr(pl, 'shock', 1.2); if (v) { say(v, T('lapThem'), 1.2, 'chi'); setExpr(v, 'shock', 1.0); setTimeout(() => { if (v.M) setExpr(v, 'annoyed', 1.0) }, 1000) } cutIn('lap') }
  return false
}
function finish() {
  S.phase = 'done'; S.result = computeResult()
  if (!S.fast) {
    S.view = 'result'; show('vResult'); $('#bPause').hidden = true; clearFx(); fillResult(false)
    if (S.result.seats > S.best) { S.best = S.result.seats; store.set('best', String(S.best)) }
    if (!S.tutSeen) { S.tutSeen = true; store.set('tut', '1') }
  } else S.view = 'result'
}
function computeResult() {
  const seats = S.won, total = TL.SEG * 5, stand = Math.round((total - S.seatT) * 10) / 10
  let tier = D.TIERS.find(t => seats >= t.min)
  if (S.laps >= 2 && seats <= 2) tier = D.LAP
  return { seats, stand, seatT: Math.round(S.seatT * 10) / 10, chi: S.chi, laps: S.laps, stumbles: S.stumbles, tier: tier.id, hist: S.hist.slice() }
}
const tierOf = id => id === 'lap' ? D.LAP : D.TIERS.find(t => t.id === id)

// ---------- 台本のボット（難しさの分布を測る）
function seatScore(i, naive) {
  const st = S.seats[i]; if (!st.P || st.P === S.player || st.state !== 'sit' && st.state !== 'rising') return 0
  const P = st.P, f = P.f; if (P.kind === 'gran') return 0
  let s = 0; if (P.base === 'phone' && !f.phone) s++; if (P.base === 'sleep' && !f.sleep) s++; if (f.look) s++; if (f.bagLap) s++; if (f.scoot) s += 2; if (naive && f.stretch) s++
  return s
}
function lurchSoon(t, pad) { return S.plan.lurches.some(L => t >= L.t - 0.75 && t < L.t + L.dur + pad) }
function botStep() {
  const pl = S.player, t = S.segT, M = S.botM, r = S.brng, b = S.bot
  if (M.k !== S.k) { M.k = S.k; M.target = null; M.next = 0; M.tapAt = null; M.distract = b === 'good' && r() < 0.15; M.early = (b === 'normal' && r() < 0.12) || (b === 'sloppy' && r() < 0.3); M.seen = 0; M.react = null }
  if (pl.seat >= 0 || pl.stun > 0 || b === 'none') return
  if (b === 'good') {
    if (t >= M.next) {
      M.next = t + 0.2
      const minT = M.distract ? 6.6 : 3.2
      if (t >= minT) {
        let best = null, bs = 0
        for (let i = 0; i < N; i++) {
          let s = seatScore(i, false); if (s < 2 && !(s >= 1 && t >= 7.6)) continue
          const rv = rivalAt(i); if (rv) s -= 1.5
          if (S.rivals.some(o => o.throws && Math.abs(o.slot - i) <= 1)) s -= 0.8
          s -= Math.abs(i - pl.slot) * 0.12
          if (best === null || s > bs) { best = i; bs = s }
        }
        if (best !== null) M.target = best
      }
    }
    if (M.target !== null && !pl.moving && pl.slot !== M.target && !lurchSoon(t, 0.05)) move(Math.sign(M.target - pl.slot))
  } else if (b === 'normal') {
    while (M.seen < S.onsets.length) { const o = S.onsets[M.seen++]; M.react = { at: o.t + 0.6, seat: o.seat } }
    if (M.react && t >= M.react.at) { M.target = M.react.seat; M.react = null }
    if (M.target !== null && !pl.moving && pl.slot !== M.target) move(Math.sign(M.target - pl.slot))
  } else if (b === 'sloppy') {
    if (t >= M.next) { M.next = t + 1.2 + r() * 0.8; if (!M.target || r() < 0.6) M.target = Math.floor(r() * N) }
    while (M.seen < S.onsets.length) { const o = S.onsets[M.seen++]; if (o.act === 'scoot' && r() < 0.5) M.react = { at: o.t + 1.2, seat: o.seat } }
    if (M.react && t >= M.react.at) { M.target = M.react.seat; M.react = null; M.next = 99 }
    if (M.target !== null && !pl.moving && pl.slot !== M.target) move(Math.sign(M.target - pl.slot))
  }
  // 座る
  const st = S.seats[pl.slot]
  if (!pl.moving && !pl.pending) {
    if (M.early && t >= TL.RISE + 0.05 && t < TL.VAC - 0.2 && st.state === 'rising') { M.early = false; sit(); return }
    if (st.state === 'rising' || st.state === 'vacant') {
      if (M.tapAt === null) M.tapAt = TL.VAC + (b === 'good' ? 0.2 + Math.abs(gauss(r)) * 0.1 : b === 'normal' ? 0.3 + Math.abs(gauss(r)) * 0.15 : 0.6 + Math.abs(gauss(r)) * 0.3)
      if (t >= M.tapAt) { M.tapAt = null; sit() }
    }
  }
}

// ---------- 画面の文字・演出（DOM）
function show(id) { for (const v of document.querySelectorAll('main.view')) v.hidden = v.id !== id }
function applyLang() {
  document.documentElement.lang = S.lang
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.dataset.t)
  $('#bLang').textContent = S.lang === 'ja' ? 'EN' : 'JA'
  $('#ctrlLine').textContent = isTouch ? T('ctrlTouch') : T('ctrlPc')
  $('#tutTxt').textContent = isTouch ? T('tutTouch') : T('tutPc')
  $('#hSeatsL').textContent = T('seated'); $('#hStandL').textContent = T('standing') + (S.lang === 'ja' ? '' : '')
  document.title = S.lang === 'ja' ? '座席ハンター | SEAT HUNTER' : 'SEAT HUNTER'
  const bl = $('#bestLine'); bl.hidden = !(S.best >= 0); if (S.best >= 0) bl.textContent = `${T('best')}  ${S.best} / 5`
  if (S.view === 'result' && S.result) fillResult(true)
  if (S.k !== undefined && S.seats.length) drawPlatform(D.STATIONS[S.k || 0][S.lang])
  ledText = null; buildLine()
}
function applyMute() { Snd.setMute(S.muted); const b = $('#bMute'); b.querySelector('.on').style.display = S.muted ? 'none' : ''; b.querySelector('.off').style.display = S.muted ? '' : 'none' }
const fxBox = $('#fx'), FX = { bub: [] }
const tmpV = new THREE.Vector3()
function toScreen(x, y, z) { tmpV.set(x, y, z).project(camera); return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight } }
function say(P, txt, sec, cls) {
  if (S.fast || !P) return
  for (const b of FX.bub) if (b.P === P) b.el.remove()
  FX.bub = FX.bub.filter(b => b.P !== P)
  const el = document.createElement('div'); el.className = 'bub' + (cls ? ' ' + cls : ''); el.textContent = txt; fxBox.appendChild(el)
  FX.bub.push({ P, el, until: S.simT + sec })
}
function clearFx() { fxBox.innerHTML = ''; FX.bub = []; $('#msg').hidden = true; $('#warn').hidden = true; for (const c of document.querySelectorAll('.cut')) c.remove() }
const _hp = new THREE.Vector3()
function placeBubbles() {
  for (let i = FX.bub.length - 1; i >= 0; i--) {
    const b = FX.bub[i]
    if (S.simT > b.until || !b.P.M) { b.el.remove(); FX.bub.splice(i, 1); continue }
    b.P.M.head.getWorldPosition(_hp); _hp.y += 0.5
    const p = toScreen(_hp.x, _hp.y, _hp.z), w = b.el.offsetWidth / 2 + 4
    b.el.style.left = clamp(p.x, w, innerWidth - w) + 'px'; b.el.style.top = clamp(p.y, 50 + b.el.offsetHeight, innerHeight - 10) + 'px'
  }
}
let msgUntil = 0
function flashMsg(txt, sec, small) { if (S.fast) return; const m = $('#msg'); m.hidden = false; m.textContent = txt; m.style.fontSize = small ? 'clamp(16px,4.6vw,26px)' : ''; m.style.webkitTextStroke = small ? '4px #1a1e24' : ''; m.style.animation = 'none'; void m.offsetWidth; m.style.animation = ''; msgUntil = S.simT + sec }
// 漫画のコマ
function cutIn(kind, sub) {
  if (S.fast) return
  for (const c of document.querySelectorAll('.cut')) c.remove()
  const d = document.createElement('div'); d.className = 'cut ' + kind
  const cv = document.createElement('canvas'); cv.width = 184; cv.height = 184; drawHead(cv.getContext('2d'), kind === 'win' ? 'bliss' : kind === 'lap' ? 'shock' : 'cry', 92, 100, 1.15)
  const tx = document.createElement('div'); const b = document.createElement('b'); b.textContent = T(kind === 'win' ? 'cutWin' : kind === 'lap' ? 'cutLap' : 'cutLose'); const s = document.createElement('small'); s.textContent = sub || T(kind === 'win' ? 'win' : kind === 'lap' ? 'lapMe' : 'lose')
  tx.appendChild(b); tx.appendChild(s); d.appendChild(cv); d.appendChild(tx); $('#vPlay').appendChild(d)
  setTimeout(() => d.remove(), 1500)
}
// 主人公の頭（コマと結果画像で使う）
function drawHead(x, expr, cx, cy, s) {
  x.save(); x.translate(cx, cy); x.scale(s, s)
  x.fillStyle = '#ffdcbc'; x.strokeStyle = INK; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 66, 0, 7); x.fill(); x.stroke()
  x.fillStyle = '#2a1d18'; x.beginPath(); x.arc(0, -6, 70, Math.PI * 1.05, Math.PI * 1.95); x.quadraticCurveTo(30, -34, 0, -30); x.quadraticCurveTo(-34, -30, -68, -18); x.fill()
  x.strokeStyle = '#2a1d18'; x.lineWidth = 6; x.beginPath(); x.arc(10, -86, 14, Math.PI * 0.9, Math.PI * 2.1); x.stroke()
  x.translate(-64, -50); drawFace(x, expr, 'me'); x.restore()
}
// 路線図（5駅）
function buildLine() {
  const el = $('#line'); if (!el) return; el.innerHTML = ''
  for (let i = 0; i < 5; i++) { if (i) el.appendChild(document.createElement('s')); el.appendChild(document.createElement('i')) }
  updateLine()
}
function updateLine() {
  const dots = document.querySelectorAll('#line i'), bars = document.querySelectorAll('#line s')
  dots.forEach((d, i) => { d.className = (i < S.k ? 'done' : i === S.k && S.phase !== 'intro' ? 'cur' : '') + (S.hist[i] === 'won' ? ' won' : '') })
  bars.forEach((b, i) => { b.className = i < S.k ? 'done' : '' })
}
const H = { last: {} }
function setText(id, v) { if (H.last[id] !== v) { H.last[id] = v; $('#' + id).textContent = v } }
function hud() {
  if (S.simT > msgUntil && !$('#msg').hidden) $('#msg').hidden = true
  if (S.view !== 'play') return
  const pl = S.player
  setText('hSeats', S.won + '/5')
  const elapsed = S.phase === 'intro' ? 0 : S.phase === 'end' ? TL.SEG * 5 : S.k * TL.SEG + S.segT
  setText('hStand', (Math.max(0, elapsed - S.seatT)).toFixed(1) + T('sec'))
  // LED（次は／まもなく／ドアが開きます）
  const stn = D.STATIONS[S.k][S.lang], led = $('#led')
  let txt = null, hot = false
  if (S.phase === 'seg') { const t = S.segT; if (t < TL.DECEL) txt = `${T('next')} <b>${stn}</b>`; else if (t < TL.DOOR) { txt = `${T('soon')} <b>${stn}</b>`; hot = true } else if (t < TL.CLOSE) txt = `<b>${stn}</b>  ${T('doorOpen')}`; else txt = T('depLine') }
  if (txt) { led.hidden = false; if (H.last.led !== txt) { H.last.led = txt; led.innerHTML = txt } } else led.hidden = true
  drawLed(S.phase === 'seg' ? (S.segT < TL.DECEL ? `${T('next')} ${stn}` : S.segT < TL.CLOSE ? `${T('soon')} ${stn}` : T('depart')) : `${T('soon')} ${D.STATIONS[S.k || 0][S.lang]}`, hot)
  // 揺れの予告
  const w = $('#warn'); let warn = false, hit = false
  if (S.phase === 'seg') for (const L of S.plan.lurches) { if (S.segT >= L.t - 0.7 && S.segT < L.t + L.dur) { warn = true; if (S.segT >= L.t) hit = true } }
  w.hidden = !warn; if (warn) { setText('warnTxt', T('lurch')); w.classList.toggle('hit', hit) }
  // 座るボタン
  const st = S.seats[pl.slot], ready = S.phase === 'seg' && pl.seat < 0 && !pl.moving && st && (st.state === 'vacant' || (st.state === 'rising' && S.segT >= TL.VAC - TL.EARLY))
  const sb = $('#bSit'); sb.classList.toggle('ready', !!ready); sb.classList.toggle('off', pl.seat >= 0 || pl.stun > 0)
  $('#tut').hidden = !(S.tutOn && (S.phase === 'intro' || (S.phase === 'seg' && S.k === 0)))
}

// ---------- 結果
let revealTimers = []
function fillResult(instant) {
  const R = S.result, tier = tierOf(R.tier)
  revealTimers.forEach(clearTimeout); revealTimers = []
  const later = (ms, f) => { if (instant) f(); else revealTimers.push(setTimeout(f, ms)) }
  const now = new Date(), pad = n => String(n).padStart(2, '0')
  $('#tkDate').textContent = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`
  const row = $('#rSeatRow'); row.innerHTML = ''; for (let i = 0; i < 5; i++) { const s = document.createElement('i'); if (R.hist[i] === 'won') s.className = 'on'; row.appendChild(s) }
  $('#rSeats').innerHTML = `${R.seats}<small>/ 5${S.lang === 'ja' ? ' 回' : ''}</small>`
  $('#rStand').innerHTML = `${R.stand.toFixed(1)}<small>${T('sec')}</small>`
  $('#rChi').innerHTML = `${R.chi}<small>${T('times')}</small>`
  $('#rLine').textContent = tier.line[S.lang]
  const st = $('#rStamp'); st.style.visibility = 'hidden'; st.classList.remove('show')
  for (const id of ['#rr1', '#rSeatRow', '#rr2', '#rr3', '#rLine', '#rBtns']) $(id).classList.toggle('on', !!instant)
  later(300, () => { $('#rr1').classList.add('on'); $('#rSeatRow').classList.add('on'); if (!instant) Snd.sfx('result') })
  later(900, () => { $('#rr2').classList.add('on'); if (!instant) { Snd.sfx('drum'); const t0 = performance.now(); const tick = () => { const k = Math.min(1, (performance.now() - t0) / 900); $('#rStand').innerHTML = `${(R.stand * (1 - Math.pow(1 - k, 3))).toFixed(1)}<small>${T('sec')}</small>`; if (k < 1 && S.view === 'result') requestAnimationFrame(tick) }; tick() } })
  later(1700, () => { $('#rr3').classList.add('on'); if (!instant) Snd.sfx('tap') })
  later(2500, () => {
    st.innerHTML = ''; const sm = document.createElement('small'); sm.textContent = T('title'); st.appendChild(sm); st.appendChild(document.createTextNode(tier[S.lang]))
    st.style.color = tier.color; st.style.visibility = 'visible'; $('#rLine').classList.add('on')
    if (!instant) { st.classList.add('show'); Snd.sfx('stamp'); if (R.seats >= 3) { Snd.setTrack('result'); Snd.sfx('cheer') } else { Snd.setTrack('sad'); Snd.sfx('boo') } }
    resultFace()
  })
  later(2900, () => $('#rBtns').classList.add('on'))
}
function resultFace() { const pl = S.player, R = S.result; if (!pl || !R) return; setExpr(pl, R.seats >= 4 ? 'bliss' : R.seats >= 2 ? 'happy' : R.tier === 'lap' ? 'shock' : 'dead', 999); setEmo(pl, R.seats >= 4 ? 'spark' : R.seats === 0 ? 'sweat' : null, 999) }

// ---------- 結果を1枚の画像に（1080x1350）
async function makeCard() {
  const R = S.result, tier = tierOf(R.tier), ja = S.lang === 'ja'
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350; const x = c.getContext('2d')
  resultFace(); updateVisuals(true)
  const pr = renderer.getPixelRatio(); renderer.setPixelRatio(1); renderer.setSize(1080, 760, false)
  const cp = camera.position.clone(), cq = camera.quaternion.clone(), fov = camera.fov
  camera.aspect = 1080 / 760; camera.fov = 44; camera.updateProjectionMatrix()
  const fr = frameAt(S.player.vx * 0.8, 2.9, 1080 / 760, { y0: 0.18, y1: 0.98 }, 0.95)
  camera.position.copy(fr.pos); camera.lookAt(fr.look); camera.updateMatrixWorld()
  renderer.render(scene, camera)
  x.fillStyle = '#1c2b3a'; x.fillRect(0, 0, 1080, 1350)
  x.drawImage(renderer.domElement, 0, 0, 1080, 760)
  camera.position.copy(cp); camera.quaternion.copy(cq); camera.fov = fov; renderer.setPixelRatio(pr); resize()
  try { await Promise.all(['56px "Dela Gothic One"', '30px "DotGothic16"', '900 30px "M PLUS Rounded 1c"'].map(f => document.fonts.load(f))); await document.fonts.ready } catch (e) {}
  const g = x.createLinearGradient(0, 0, 0, 760); g.addColorStop(0, 'rgba(28,43,58,.92)'); g.addColorStop(0.2, 'rgba(28,43,58,0)'); g.addColorStop(0.82, 'rgba(28,43,58,0)'); g.addColorStop(1, 'rgba(28,43,58,1)'); x.fillStyle = g; x.fillRect(0, 0, 1080, 760)
  // LED の帯とタイトル
  x.fillStyle = '#121417'; x.beginPath(); x.roundRect(48, 40, 520, 64, 10); x.fill(); x.strokeStyle = '#3a3f46'; x.lineWidth = 5; x.stroke()
  x.fillStyle = '#ff9b2f'; x.font = "34px 'DotGothic16',monospace"; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(T('cardSub'), 70, 74, 480); x.textBaseline = 'alphabetic'
  x.font = "84px 'Dela Gothic One',sans-serif"; x.lineJoin = 'round'; x.lineWidth = 14; x.strokeStyle = '#1b5a41'; x.fillStyle = '#fff'
  x.strokeText(T('cardTitle'), 48, 196, 700); x.fillText(T('cardTitle'), 48, 196, 700)
  // 主人公の顔（大きく）
  drawHead(x, R.seats >= 4 ? 'bliss' : R.seats >= 2 ? 'happy' : R.tier === 'lap' ? 'shock' : R.seats === 1 ? 'dead' : 'cry', 900, 150, 0.95)
  // きっぷ
  const TX = 70, TY = 760, TW = 940, TH = 470
  x.save(); x.translate(540, TY + TH / 2); x.rotate(-0.015); x.translate(-540, -(TY + TH / 2))
  x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 30; x.shadowOffsetY = 12
  x.fillStyle = '#fbf7ee'; x.beginPath(); x.roundRect(TX, TY, TW, TH, 26); x.fill(); x.shadowColor = 'transparent'
  x.fillStyle = '#2f8f6a'; x.beginPath(); x.roundRect(TX, TY, 34, TH, [26, 0, 0, 26]); x.fill()
  x.fillStyle = '#1c2b3a'; for (const yy of [TY + TH * 0.3, TY + TH * 0.62]) { x.beginPath(); x.arc(TX + TW, yy, 18, 0, 7); x.fill() }
  x.fillStyle = '#1a1e24'; x.textAlign = 'left'
  const rowY = [TY + 92, TY + 238, TY + 385]
  x.font = "900 34px 'M PLUS Rounded 1c',sans-serif"; x.fillStyle = '#55524a'; x.fillText(T('resSeats'), TX + 70, rowY[0])
  x.font = "110px 'Dela Gothic One',sans-serif"; x.fillStyle = '#1a1e24'; x.textAlign = 'right'; x.fillText(`${R.seats}`, TX + 470, rowY[0] + 30); x.font = "900 40px 'M PLUS Rounded 1c',sans-serif"; x.textAlign = 'left'; x.fillText(ja ? '/ 5 回' : '/ 5', TX + 484, rowY[0] + 28)
  for (let i = 0; i < 5; i++) { x.fillStyle = R.hist[i] === 'won' ? '#2f8f6a' : '#d9d1bf'; x.beginPath(); x.roundRect(TX + 70 + i * 120, rowY[0] + 62, 104, 34, [10, 10, 5, 5]); x.fill() }
  x.font = "900 34px 'M PLUS Rounded 1c',sans-serif"; x.fillStyle = '#55524a'; x.fillText(T('resStand'), TX + 70, rowY[1])
  x.font = "76px 'Dela Gothic One',sans-serif"; x.fillStyle = '#1a1e24'; x.textAlign = 'left'; x.fillText(R.stand.toFixed(1), TX + 70, rowY[1] + 92); const sw = x.measureText(R.stand.toFixed(1)).width; x.font = "900 36px 'M PLUS Rounded 1c',sans-serif"; x.fillText(T('sec'), TX + 84 + sw, rowY[1] + 90)
  x.font = "900 30px 'M PLUS Rounded 1c',sans-serif"; x.fillStyle = '#55524a'; x.fillText(`${T('resChi')}  ${R.chi}${T('times')}`, TX + 70, rowY[2]); if (R.laps) x.fillText(`${T('resLap')}  ${R.laps}${T('times')}`, TX + 470, rowY[2])
  x.font = "900 30px 'M PLUS Rounded 1c',sans-serif"; x.fillStyle = '#7d7a72'; x.textAlign = 'center'; x.fillText(tier.line[S.lang], TX + TW / 2, TY + TH - 36, TW - 100)
  x.restore()
  // ハンコ（称号）
  x.save(); x.translate(800, 1060); x.rotate(-0.16)
  let fs = 66; x.font = `${fs}px 'Dela Gothic One',sans-serif`; const name = tier[S.lang]
  while (x.measureText(name).width > 330 && fs > 30) { fs -= 4; x.font = `${fs}px 'Dela Gothic One',sans-serif` }
  const tw = x.measureText(name).width + 70
  x.fillStyle = 'rgba(251,247,238,.92)'; x.beginPath(); x.roundRect(-tw / 2, -92, tw, 146, 22); x.fill()
  x.strokeStyle = tier.color; x.lineWidth = 11; x.beginPath(); x.roundRect(-tw / 2 + 10, -82, tw - 20, 126, 16); x.stroke()
  x.fillStyle = tier.color; x.textAlign = 'center'; x.font = "900 24px 'M PLUS Rounded 1c',sans-serif"; x.fillText('TITLE', 0, -46)
  x.font = `${fs}px 'Dela Gothic One',sans-serif`; x.fillText(name, 0, 22); x.restore()
  x.textAlign = 'center'; x.font = "800 26px 'M PLUS Rounded 1c',sans-serif"; x.fillStyle = '#c8d6e0'; x.fillText('tom3games.github.io/seat-hunter', 540, 1318)
  return c
}
// 共有の本文（結果）。Xでポストは URL を url パラメータで渡すので本文に入れない
const GAME_URL = 'https://tom3games.github.io/seat-hunter/'
function shareBody() { const R = S.result, tier = tierOf(R.tier); return T('shareText').replace('{t}', tier[S.lang]).replace('{n}', R.seats).replace('{s}', R.stand.toFixed(1)) }
function xText() { if (!S.result) return ''; return shareBody() + ' ' + T('xTag') }
function xIntent() { return 'https://x.com/intent/post?text=' + encodeURIComponent(xText()) + '&url=' + encodeURIComponent(GAME_URL) }
function postX() { if (!S.result) return; window.open(xIntent(), '_blank', 'noopener') }
async function saveImage() {
  const c = await makeCard(), blob = await new Promise(r => c.toBlob(r, 'image/png'))
  const file = new File([blob], 'seat-hunter.png', { type: 'image/png' })
  const text = shareBody() + ' ' + GAME_URL
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], text }); return blob } catch (e) { if (e && e.name === 'AbortError') return blob } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'seat-hunter.png'; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast(T('saved')); return blob
}
function toast(s) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = s; document.body.appendChild(d); setTimeout(() => d.remove(), 1600) }
// 投げられたカバン
const flying = []
function throwBag(r) {
  if (!r.P.M || !r.go) return
  const m = box(0.34, 0.24, 0.1, lam(0x6a4a2a), SX(r.slot), 1.4, STAND_Z); r.P.M.held.visible = false
  flying.push({ m, x0: SX(r.slot), x1: SX(r.go.seat), t0: S.simT, dur: Math.max(0.15, r.go.at - r.go.t0), seat: r.go.seat, r })
}
function stepFlying() {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i], k = (S.simT - f.t0) / f.dur
    if (k < 1) { f.m.position.set(lerp(f.x0, f.x1, k), 1.4 + Math.sin(k * Math.PI) * 0.7 - k * 0.8, lerp(STAND_Z, SEAT_Z + 0.1, k)); f.m.rotation.z = k * 6 }
    else if (k < 4) { f.m.position.set(f.x1, 0.62, SEAT_Z + 0.1); f.m.rotation.z = 0 }
    else { scene.remove(f.m); if (f.r.P.M) f.r.P.M.held.visible = true; flying.splice(i, 1) }
  }
}

// ---------- 見た目の更新（毎ステップ）
function updateVisuals(snap) {
  const k = snap ? 1 : 0.25, lean = S.lurchK * S.lurchDir * 0.12
  const pl = S.player
  for (const P of S.persons) {
    if (!P.M) continue
    const M = P.M
    if (P.exprT > 0 && P.exprT < 900) { P.exprT -= DT; if (P.exprT <= 0) P.expr = defaultExpr(P) }
    if (P.emoT > 0 && P.emoT < 900) { P.emoT -= DT; if (P.emoT <= 0) P.emo = P.f.sleep && P.role === 'seated' ? 'zzz' : null }
    let tx = P.vx, tz = P.vz, try_ = P.vry, stand = 1
    if (P.role === 'seated') { tx = SX(P.seat); tz = SEAT_Z + (P.f.scoot ? 0.14 : 0); try_ = 0; const r = S.seats[P.seat]; stand = 0; if (r && r.state === 'rising') stand = ease((S.simT - P.riseT) / 0.45) * 1 }
    else if (P.role === 'rival') {
      const r = S.rivals.find(o => o.P === P); tx = SX(r ? r.slot : 0); tz = STAND_Z; try_ = Math.PI
      if (r && r.go && S.segT >= r.go.t0) { const kk = clamp((S.segT - r.go.t0) / Math.max(0.1, r.go.at - r.go.t0), 0, 1); if (!r.throws) { tx = lerp(SX(r.slot), SX(r.go.seat), kk); tz = lerp(STAND_Z, STAND_Z - 0.3, kk) } }
    } else if (P.role === 'player') {
      if (P.seat >= 0) { tx = SX(P.seat); tz = SEAT_Z; try_ = 0; stand = 0 }
      else {
        const m = P.moving; tx = m ? lerp(SX(m.from), SX(m.to), ease(m.k)) : SX(P.slot); tz = STAND_Z; try_ = S.view === 'result' ? 0.25 : Math.PI
        if (P.pending) { const kk = clamp((S.segT - (P.pending.t - TL.SITDELAY)) / TL.SITDELAY, 0, 1); tz = lerp(STAND_Z, SEAT_Z + 0.4, kk) }
        if (S.simT - P.lapT < LAP_T) { const kk = S.simT - P.lapT; tz = STAND_Z - Math.sin(Math.min(1, kk / 0.3) * Math.PI / 2) * 0.9 * (1 - clamp((kk - 0.6) / 0.5, 0, 1)) }
      }
    } else if (P.role === 'walk' && P.walk) {
      const w = P.walk, dx = w.x - P.vx, dz = w.z - P.vz, d = Math.hypot(dx, dz), sp = 2.6 * DT
      if (d > sp) { tx = P.vx + dx / d * sp; tz = P.vz + dz / d * sp; try_ = Math.atan2(dx, dz) } else { tx = w.x; tz = w.z; try_ = w.ry; if (w.gone) { removePerson(P); continue } }
      P.walkPh = (P.walkPh || 0) + DT * 9
    }
    // 座る・立つ
    const sitting = P.role === 'seated' || (P.role === 'player' && P.seat >= 0)
    if (sitting && P.role === 'seated' && S.seats[P.seat] && S.seats[P.seat].state === 'rising') { /* 立ち上がり中 */ }
    else stand = sitting ? 0 : 1
    if (sitting && S.simT - P.sitT < 0.35) stand = Math.max(stand, 1 - (S.simT - P.sitT) / 0.35)
    if (P === pl && pl.seat < 0 && S.simT - pl.riseT < 0.4) stand = (S.simT - pl.riseT) / 0.4
    const walking = P.role === 'walk'
    P.vx = walking ? tx : lerp(P.vx, tx, snap ? 1 : 0.22); P.vz = walking ? tz : lerp(P.vz, tz, snap ? 1 : 0.22)
    let dr = try_ - P.vry; while (dr > Math.PI) dr -= Math.PI * 2; while (dr < -Math.PI) dr += Math.PI * 2; P.vry += dr * (snap ? 1 : 0.2)
    P.vstand = snap ? stand : lerp(P.vstand, stand, 0.3)
    const sd = P.vstand
    M.root.position.set(P.vx, 0, P.vz); M.root.rotation.y = P.vry
    const hipY = lerp(0.53, 0.92, sd); M.hips.position.y = hipY
    let hrx = 0, hrz = 0
    // 揺れで立っている人はよろめく
    if (!sitting) { hrz = -lean * 1.2 * Math.cos(P.vry) ; if (P === pl && pl.stun > 0 && pl.wob > 0) { hrz += Math.sin(S.simT * 22) * 0.25 * (pl.stun / STUN_T) } }
    else if (P.f.scoot) hrx = 0.32
    M.hips.rotation.set(hrx, 0, hrz)
    for (const [i, L] of M.legs.entries()) {
      let th = lerp(-Math.PI / 2, 0, sd)
      if (walking) th += Math.sin((P.walkPh || 0) + i * Math.PI) * 0.5
      if (P === pl && pl.moving) th += Math.sin(pl.moving.k * Math.PI * 2 + i * Math.PI) * 0.35
      L.th.position.y = hipY; L.th.rotation.x = th; L.kn.rotation.x = -th * (1 - sd * 0.0) + (walking ? Math.max(0, Math.sin((P.walkPh || 0) + i * Math.PI)) * 0.4 : 0)
    }
    // 頭と腕
    const f = P.f, H_ = M.head
    let hx = 0, hy = 0, hz = 0
    const sleeping = (sitting && f.sleep && P.role === 'seated') || (P.kind === 'stu' && P.expr === 'sleep')
    if (sitting && P.role === 'seated') {
      if (f.phone) hx = 0.35
      if (sleeping) { hx = 0.42; hz = 0.33 + Math.sin(S.simT * 1.3 + P.seat) * 0.05 }
      if (f.look === 1) { hy = Math.abs(SX(P.seat)) < 0.3 ? 0 : -Math.sign(SX(P.seat)) * 0.75; hx = -0.42 }
      if (f.look === 2) { hx = -0.75 }
      if (f.scoot) hx = 0.1
    } else if (P.kind === 'stu') { hx = 0.35; hz = 0.25 }
    if (P === pl && pl.seat < 0 && S.view !== 'result' && S.phase !== 'idle') { hx = 0.15 }
    H_.rotation.x = lerp(H_.rotation.x, hx, snap ? 1 : 0.15); H_.rotation.y = lerp(H_.rotation.y, hy, snap ? 1 : 0.15); H_.rotation.z = lerp(H_.rotation.z, hz, snap ? 1 : 0.15)
    // 腕
    M.phone.visible = false; M.lapBag.visible = false; M.held.visible = !sitting || P.kind === 'gran' ? !flying.some(q => q.r.P === P) : false
    if (sitting) {
      if (P.role === 'seated' && f.stretch) { setArm(M, 0, -0.12, 0.62, 0.02); setArm(M, 1, 0.12, 0.62, 0.02) }
      else if (P.role === 'seated' && f.phone) { setArm(M, 0, 0.22, -0.22, 0.32); setArm(M, 1, -0.22, -0.22, 0.32); M.phone.visible = true; M.phone.position.set(0, 0.28, 0.36); M.phone.rotation.x = -0.6 }
      else if (P.role === 'seated' && (f.bagLap || f.scoot)) { M.lapBag.visible = true; M.lapBag.position.set(0, 0.68, P.f.scoot ? 0.36 : 0.3); setArm(M, 0, 0.14, -0.28, 0.36); setArm(M, 1, -0.14, -0.28, 0.36) }
      else if (P.base === 'none' && P.role === 'seated' && !sleeping) { setArm(M, 0, 0.4, -0.22, 0.2); setArm(M, 1, -0.4, -0.16, 0.22) }
      else { setArm(M, 0, 0.06, -0.42, 0.24); setArm(M, 1, -0.06, -0.42, 0.24) }
      if (P === pl && P.seat >= 0) { setArm(M, 0, -0.15, -0.38, 0.2); setArm(M, 1, 0.15, -0.38, 0.2) }
    } else if (walking || P.kind === 'gran') {
      const sw = Math.sin(P.walkPh || 0) * 0.25; setArm(M, 0, -0.05, -0.5, sw); setArm(M, 1, 0.05, -0.5, -sw)
      M.held.position.set(0.32, 0.0, 0.12)
    } else {
      // つり革を持つ
      M.root.updateMatrixWorld()
      const hx2 = P.vx + (P.vry > 1 ? -0.0 : 0.0)
      const flail = P === pl && pl.stun > 0 && pl.wob > 0
      if (flail) { setArm(M, 0, -0.5, 0.3 + Math.sin(S.simT * 25) * 0.2, 0.1); setArm(M, 1, 0.5, 0.3 + Math.cos(S.simT * 25) * 0.2, 0.1) }
      else if (P.role === 'rival' && P.kind === 'aunt' && S.rivals.find(o => o.P === P && o.go && S.segT >= o.go.t0)) { setArm(M, 0, -0.3, 0.1, 0.4); setArm(M, 1, 0.3, 0.1, 0.4) }
      else {
        const sx = P === pl && pl.moving ? lerp(SX(pl.moving.from), SX(pl.moving.to), clamp(pl.moving.k * 1.4, 0, 1)) : hx2
        reachWorld(M, 1, sx + 0.08 * Math.cos(P.vry), 2.27 + (S.lurchK ? 0.03 : 0), STAND_Z)
        setArm(M, 0, -0.04, -0.48, 0.06)
      }
      M.held.position.set(-0.36, -0.02, 0.02)
    }
    if (P.kind === 'gran') M.held.position.set(0.34, 0.0, 0.18)
    // 顔
    const want = faceMat(P.expr, P.kind); if (M.face.material !== want) M.face.material = want
    if (P.emo) { const em = emoMat(P.emo); if (M.emo.material !== em) M.emo.material = em; M.emo.visible = true; M.emo.position.y = 0.5 + Math.sin(S.simT * 3) * 0.04 } else M.emo.visible = false
  }
  const wide = innerWidth / innerHeight >= 0.9; for (const e of extras) e.M.root.visible = !wide || Math.abs(e.x) > 2.5
  for (const e of extras) e.M.hips.rotation.z = lean * 1.2 + Math.sin(S.simT * 1.6 + e.ph) * 0.03
  // つり革の揺れ
  for (const s of straps) s.g.rotation.z = lerp(s.g.rotation.z, lean * 2.5 + Math.sin(S.simT * 2 + s.x) * 0.03, 0.2)
  // 走る景色・ホーム・ドア
  const sp = trainSpeed(); S.dist += sp * DT
  farT.offset.x = (S.dist * 0.012) % 1; nearT.offset.x = (S.dist * 0.05) % 1
  plat.position.x = platformX(); plat.visible = Math.abs(plat.position.x) < 20
  const open = doorOpenK()
  for (const d of doors) d.g.position.x = d.x0 + d.dir * 0.54 * open
  stepFlying()
}
function defaultExpr(P) {
  if (P.role === 'seated') { if (P.kind === 'stu') return 'sleep'; if (P.kind === 'gran') return 'kind'; if (P.f.sleep) return 'sleep'; if (P.f.phone) return 'phone'; return 'normal' }
  if (P.kind === 'stu') return 'sleep'; if (P === S.player) return S.view === 'result' && S.result ? (S.result.seats >= 2 ? 'happy' : 'dead') : 'normal'; return 'normal'
}
function trainSpeed() {
  if (S.view === 'title') return VMAX * 0.8
  if (S.phase === 'intro') return VMAX
  if (S.phase !== 'seg') return 0
  const t = S.segT
  if (t >= TL.DOOR) return 0
  if (t >= TL.DECEL) return VMAX * (TL.DOOR - t) / (TL.DOOR - TL.DECEL)
  if (S.k > 0 && t < 1.5) return VMAX * t / 1.5
  return VMAX
}
function platformX() {
  if (S.view === 'title' || S.phase === 'intro' || S.phase === 'idle') return 99
  const t = S.segT, dd = TL.DOOR - TL.DECEL
  if (S.phase === 'end' || S.phase === 'done') return 0
  if (t >= TL.DOOR) return 0
  if (t >= TL.DECEL) return VMAX * (TL.DOOR - t) ** 2 / (2 * dd) * 0.35
  if (S.k > 0 && t < 3) { const d = t < 1.5 ? VMAX * t * t / 3 : VMAX * 0.75 + VMAX * (t - 1.5); return -d * 0.35 }
  return 99
}
function doorOpenK() {
  if (S.phase !== 'seg' && S.phase !== 'end' && S.phase !== 'done') return 0
  if (S.phase === 'end' || S.phase === 'done') return 1
  const t = S.segT; if (t < TL.DOOR) return 0; if (t < TL.DOOR + 0.4) return ease((t - TL.DOOR) / 0.4); if (t < TL.CLOSE) return 1; return 1 - ease((t - TL.CLOSE) / 0.4)
}

// ---------- カメラ
let camSnap = true
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3()
const PITCH = 0.62
// 中心 cx、横の半幅 halfW を画面いっぱいに。縦は画面の区画 rg（上から 0〜1）に車内（床〜LED）を収める
function frameAt(cx, halfW, aspect, rg = { y0: 0, y1: 1 }, zoom = 1, nx = 0) {
  const f = Math.tan(camera.fov * Math.PI / 360)
  const look = new THREE.Vector3(cx, 1.05, -0.35)
  const dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH))
  const dh = halfW / (f * aspect), dv = 2.45 / ((rg.y1 - rg.y0) * f)
  const d = Math.max(dh, dv, 5) * zoom, hv = d * f
  const ncy = 1 - (rg.y0 + rg.y1) // 区画の中心（-1〜1、上が+）
  const up = new THREE.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH))
  look.addScaledVector(up, -ncy * hv); look.x -= nx * hv * aspect
  return { look, pos: look.clone().addScaledVector(dir, d) }
}
function uiRegion() {
  const H = innerHeight, portrait = innerWidth / H < 0.9, short = H < 560
  if (S.view === 'play') return portrait ? { y0: 150 / H, y1: 1 - 110 / H } : short ? { y0: 0.0, y1: 1.0 } : { y0: 90 / H, y1: 1 - 90 / H }
  if (S.view === 'result') return portrait ? { y0: 0.06, y1: resultTop() } : { y0: 0.05, y1: 0.95 }
  return portrait ? { y0: 0.34, y1: 0.78 } : { y0: 0.1, y1: 0.95 }
}
let rtop = 0.45
function resultTop() { return rtop }
function measureResult() { const el = document.querySelector('.rWrap'); if (!el || S.view !== 'result') return; rtop = clamp((el.getBoundingClientRect().top - 4) / innerHeight, 0.22, 0.75) }
function stepCamera() {
  const asp = innerWidth / innerHeight, portrait = asp < 0.9
  let fr
  if (S.view === 'result') {
    const px = S.player ? S.player.vx : 0
    fr = portrait ? frameAt(px, 1.7, asp, uiRegion(), 1) : frameAt(px, 1.5, asp * 0.5, { y0: 0.05, y1: 0.95 }, 1)
    if (!portrait) { const f = Math.tan(camera.fov * Math.PI / 360), d = fr.pos.distanceTo(fr.look), hw = d * f * asp; fr.look.x += hw * 0.5; fr.pos.x += hw * 0.5 }
  } else {
    const rg = uiRegion()
    fr = frameAt(S.view === 'title' ? Math.sin(S.simT * 0.2) * 0.4 : (S.player ? S.player.vx * 0.08 : 0), portrait ? 3.3 : 4.2, asp, rg)
  }
  if (camSnap) { camPos.copy(fr.pos); camLook.copy(fr.look); camSnap = false } else { camPos.lerp(fr.pos, 0.06); camLook.lerp(fr.look, 0.07) }
  camera.position.copy(camPos)
  if (S.shake > 0) { S.shake = Math.max(0, S.shake - DT * 1.4); camera.position.x += Math.sin(S.simT * 40) * S.shake * 0.12; camera.position.y += Math.cos(S.simT * 33) * S.shake * 0.08 }
  camera.lookAt(camLook)
}

// ---------- 1ステップ
function step() {
  S.simT += DT
  if (S.view === 'play') stepPlay()
  if (!S.fast) { updateVisuals(false); stepCamera() }
}

// ---------- 画面遷移・入力
function pauseGame(on) {
  if (on && S.view === 'play') { S.view = 'pause'; show('vPause') }
  else if (!on && S.view === 'pause') { S.view = 'play'; show('vPlay'); last = performance.now(); acc = 0 }
}
function startFromUI() { Snd.sfx('tap'); revealTimers.forEach(clearTimeout); startGame() }
document.addEventListener('pointerdown', () => Snd.init(), { capture: true })
document.addEventListener('keydown', () => Snd.init(), { capture: true })
$('#bStart').onclick = startFromUI
$('#bHow').onclick = () => { Snd.sfx('tap'); S.view = 'how'; show('vHow') }
$('#bHowBack').onclick = () => { Snd.sfx('tap'); goTitle() }
$('#bHowGo').onclick = startFromUI
$('#bAgain').onclick = startFromUI
$('#bTitle').onclick = () => { Snd.sfx('tap'); revealTimers.forEach(clearTimeout); goTitle() }
$('#bSave').onclick = () => { Snd.sfx('tap'); saveImage() }
$('#bX').onclick = () => { Snd.sfx('tap'); postX() }
$('#bPause').onclick = () => pauseGame(true)
$('#bResume').onclick = () => pauseGame(false)
$('#bQuit').onclick = () => { S.view = 'title'; goTitle() }
$('#bMute').onclick = () => { S.muted = !S.muted; store.set('mute', S.muted ? '1' : '0'); applyMute() }
$('#bLang').onclick = () => { S.lang = S.lang === 'ja' ? 'en' : 'ja'; store.set('lang', S.lang); H.last = {}; applyLang() }
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(true) })
const press = (id, fn) => { const b = $(id); b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fn(); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 120) }) }
press('#bL', () => move(-1)); press('#bR', () => move(1)); press('#bSit', () => sit())
// 画面: スワイプで移動、タップで座る
let sw = null
const onDown = e => { if (S.view !== 'play' || e.target.closest('button')) return; sw = { x: e.clientX, y: e.clientY, t: performance.now() } }
const onUp = e => {
  if (!sw || S.view !== 'play') { sw = null; return }
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null
  if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1); else if (Math.hypot(dx, dy) < 16) sit()
}
canvas.addEventListener('pointerdown', onDown); $('#vPlay').addEventListener('pointerdown', onDown)
addEventListener('pointerup', onUp)
addEventListener('keydown', e => {
  const k = e.key
  if (S.view === 'play') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); move(-1) }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); move(1) }
    else if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'Enter') { e.preventDefault(); if (!e.repeat) sit() }
    else if (k === 'p' || k === 'P' || k === 'Escape') pauseGame(true)
  } else if (S.view === 'pause' && (k === 'p' || k === 'P' || k === 'Escape')) pauseGame(false)
  else if (S.view === 'title' && (k === 'Enter' || k === ' ')) { e.preventDefault(); startGame() }
})

// ---------- ループ
function resize() {
  const W = innerWidth, Hh = innerHeight
  renderer.setSize(W, Hh, false); camera.aspect = W / Hh; camera.fov = W / Hh < 0.8 ? 50 : 42; camera.updateProjectionMatrix(); measureResult()
}
addEventListener('resize', resize)
let acc = 0, last = performance.now(), frames = 0, lastView = ''
function frame() {
  requestAnimationFrame(frame)
  const now = performance.now(); let d = (now - last) / 1000; last = now; if (d > 0.25) d = 0.25
  if (!S.dbgPause && S.view !== 'pause') { acc += d; let n = 0; while (acc >= DT && n < 8) { step(); acc -= DT; n++ } if (n === 8) acc = 0 }
  render()
}
function render() {
  if (lastView !== S.view) { lastView = S.view; resize() }
  Snd.tick(); hud(); placeBubbles(); if (S.view === 'result') measureResult()
  renderer.render(scene, camera); frames++
}

// ---------- 検証用の窓口
window.sh = {
  S, D, TL, renderer, camera, scene, SX,
  start: seed => startGame(seed), title: goTitle, finish, move, sit, saveImage, xText, xIntent, postX, GAME_URL, makeCard, fillResult, computeResult, seatScore,
  setBot: b => { S.bot = b },
  // 種とボットを決めて最後まで一気に回す（分布と再現性の検証）
  simulate(seed, bot) {
    const keepPause = S.dbgPause; S.fast = true; startGame(seed); S.bot = bot; let n = 0
    while (S.view === 'play' && n < 60 * 80) { step(); n++ }
    S.bot = null; S.fast = false; S.dbgPause = keepPause; const r = { ...S.result, steps: n }
    return r
  },
  force: {
    // 降りる人だけにした台本（ひっかけ・揺れなし）
    plan(leavers, opts = {}) {
      const P = S.plan; P.leavers = leavers; P.ev = []; P.lurches = opts.lurches || []; P.auntT = opts.aunt ? [7.0] : []
      for (const L of leavers) { P.ev.push({ t: 2.0, seat: L, act: 'phoneAway', P: S.seats[L].P, done: false }, { t: 7.6, seat: L, act: 'scoot', P: S.seats[L].P, done: false }) }
    },
    rivals(list) { for (const r of S.rivals) removePerson(r.P); S.rivals = []; for (const [type, slot] of list) { const P = newPerson(SPECS[type], 'rival'); P.slot = slot; P.vx = SX(slot); S.rivals.push({ P, type, slot, go: null, ...RIVAL[type] }) } },
    slot(n) { S.player.slot = n; S.player.vx = SX(n); S.player.moving = null },
    segT(t) { S.segT = t },
    toSeg() { while (S.phase === 'intro') step() },
  },
  dbg: { pause(b = true) { S.dbgPause = b; if (!b) { last = performance.now(); acc = 0 } }, step(n = 1) { for (let i = 0; i < n; i++) step() }, render() { updateVisuals(false); stepCamera(); render() }, snap() { updateVisuals(true); camSnap = true; stepCamera() } },
  fps: () => new Promise(res => { const f0 = frames, t0 = performance.now(); setTimeout(() => res(Math.round((frames - f0) / ((performance.now() - t0) / 1000))), 2000) }),
}
applyLang(); applyMute(); resize(); goTitle(); updateVisuals(true); stepCamera()
requestAnimationFrame(frame)
window.__shReady = true
