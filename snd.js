// 音のエンジン（素材なし・WebAudio）。bakage の templates/snd.js を土台に、曲と効果音を座席ハンター用に書いたもの
const Snd = {
  ctx: null, muted: false, next: 0, step: 0, track: null, want: null, switchAt: 0, played: {}, lastBrush: 0,
  TEMPO: { title: 132, play: 144, result: 128, sad: 72 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return
    try {
      this.ctx = new AC()
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7
      this.an = this.ctx.createAnalyser(); this.an.fftSize = 2048; this.master.connect(this.an); this.an.connect(this.ctx.destination)
      this.bgm = this.ctx.createGain(); this.bgm.gain.value = 0.0001; this.bgm.connect(this.master)
      const len = this.ctx.sampleRate; this.noiseBuf = this.ctx.createBuffer(1, len, len)
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      if (this.want) { const w = this.want; this.want = null; this.setTrack(w) }
    } catch (e) { this.ctx = null }
  },
  setMute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7 },
  tone(f, t0, dur, type = 'square', vol = 0.2, dest, f2) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain()
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur)
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g); g.connect(dest || this.master); o.start(t0); o.stop(t0 + dur + 0.02)
  },
  noise(t0, dur, vol, freq, type = 'highpass', dest, q) {
    if (!this.ctx) return; const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
    s.buffer = this.noiseBuf; f.type = type; f.frequency.value = freq; if (q) f.Q.value = q
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    s.connect(f); f.connect(g); g.connect(dest || this.master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02)
  },
  now() { return this.ctx ? this.ctx.currentTime : 0 },
  level() { if (!this.an) return 0; const d = new Float32Array(this.an.fftSize); this.an.getFloatTimeDomainData(d); let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); return m },
  mtof: m => 440 * Math.pow(2, (m - 69) / 12),
  mark(n) { this.played[n] = (this.played[n] || 0) + 1 },
  setTrack(name) {
    if (this.want === name) return
    this.want = name; if (!this.ctx) return
    const now = this.ctx.currentTime, g = this.bgm.gain
    g.cancelScheduledValues(now); g.setValueAtTime(Math.max(0.0001, g.value), now); g.linearRampToValueAtTime(0.0001, now + 0.25)
    this.switchAt = now + 0.27
  },
  tick() {
    if (!this.ctx) return; const c = this.ctx
    if (this.switchAt && c.currentTime >= this.switchAt) {
      this.track = this.want; this.step = 0; this.next = c.currentTime + 0.05; this.switchAt = 0
      const g = this.bgm.gain; g.cancelScheduledValues(c.currentTime); g.setValueAtTime(0.0001, c.currentTime); g.linearRampToValueAtTime(0.26, c.currentTime + 0.35)
      if (this.track) this.mark('bgm:' + this.track)
    }
    if (!this.track || this.switchAt) return
    const spb = 60 / this.TEMPO[this.track] / 4
    if (this.next < c.currentTime) this.next = c.currentTime + 0.05
    while (this.next < c.currentTime + 0.25) { this['p_' + this.track](this.step, this.next); this.next += spb; this.step++ }
  },
  kick(t, v = 0.7) { this.tone(150, t, 0.16, 'sine', v, this.bgm, 42) },
  clap(t, v = 0.2) { for (const d of [0, 0.012, 0.024]) this.noise(t + d, 0.09, v, 1500, 'bandpass', this.bgm) },
  hat(t, v = 0.06, open) { this.noise(t, open ? 0.12 : 0.03, v, 8000, 'highpass', this.bgm) },
  bass(n, t, dur = 0.18, vol = 0.45, type = 'triangle') { this.tone(this.mtof(n), t, dur, type, vol, this.bgm) },
  pad(n, t, dur, vol = 0.04) { this.tone(this.mtof(n), t, dur, 'sine', vol, this.bgm); this.tone(this.mtof(n) * 2.005, t, dur * 0.6, 'sine', vol * 0.3, this.bgm) },
  stab(ns, t, dur = 0.14, vol = 0.04) {
    if (!this.ctx) return; const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain()
    f.type = 'lowpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(600, t + dur)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    for (const n of ns) for (const d of [-8, 8]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(n); o.detune.value = d; o.connect(f); o.start(t); o.stop(t + dur + 0.02) }
    f.connect(g); g.connect(this.bgm)
  },
  // 声っぽい音（のこぎり波を2つのバンドパスに通す。f0 は始まりと終わりの高さ）
  voice(t, dur, f0, f1, vol = 0.18, formant = [800, 1200]) {
    if (!this.ctx) return; const c = this.ctx, o = c.createOscillator(), g = c.createGain(), out = c.createGain()
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur)
    const vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 7; vg.gain.value = f0 * 0.04; vib.connect(vg); vg.connect(o.frequency)
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    for (const f of formant) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 6; o.connect(bp); bp.connect(g) }
    g.connect(out); out.gain.value = 2.2; out.connect(this.master); o.start(t); vib.start(t); o.stop(t + dur + 0.02); vib.stop(t + dur + 0.02)
  },
  // ガタンゴトン（レールの継ぎ目）
  clack(t, v = 0.12) { this.noise(t, 0.05, v, 900, 'bandpass', this.bgm, 3); this.tone(70, t, 0.08, 'sine', v * 2, this.bgm, 50) },
  // タイトル: のどかな通勤ポップ（C - Am - F - G）
  p_title(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16
    const root = [36, 33, 41, 43][bar], ch = [[60, 64, 67], [57, 60, 64], [57, 60, 65], [55, 59, 62]][bar]
    if (s % 8 === 0) this.kick(t, 0.5); if (s === 4 || s === 12) this.clap(t, 0.08); if (s % 2 === 0) this.hat(t, 0.03)
    if (s === 0 || s === 6 || s === 10) this.bass(root, t, 0.2, 0.36)
    if (s === 2 || s === 10) this.stab(ch, t, 0.12, 0.028)
    const mel = [[72, 74, 76, 79], [76, 74, 72, 69], [72, 69, 72, 77], [74, 72, 71, 67]][bar]
    if (s % 4 === 0) this.tone(this.mtof(mel[s / 4]), t, 0.22, 'square', 0.03, this.bgm)
    if (s % 8 === 3) this.clack(t, 0.05)
  },
  // プレイ: そわそわした急ぎ足（Dm - Bb - C - A）＋ガタンゴトン
  p_play(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16
    const root = [38, 34, 36, 33][bar], ch = [[62, 65, 69], [62, 65, 70], [60, 64, 67], [61, 64, 69]][bar]
    if (s % 4 === 0) this.kick(t, 0.55); if (s === 4 || s === 12) this.clap(t, 0.1); if (s % 2 === 1) this.hat(t, 0.035)
    if (s % 2 === 0) this.bass(root + (s % 8 === 6 ? 12 : 0), t, 0.1, 0.34, 'square')
    if (s === 0 || s === 7 || s === 11) this.stab(ch, t, 0.1, 0.025)
    if (s === 0 || s === 3) this.clack(t, 0.09)
    const mel = [74, 77, 76, 74, 72, 74, 69, -1]
    if (Math.floor(i / 64) % 2 && s % 2 === 0) { const n = mel[(s / 2 + bar) % 8]; if (n > 0) this.tone(this.mtof(n), t, 0.1, 'triangle', 0.04, this.bgm) }
  },
  // 結果: 明るいファンファーレ風（F - G - Em - Am）
  p_result(i, t) {
    const bar = Math.floor(i / 16) % 4, s = i % 16
    const root = [41, 43, 40, 45][bar], ch = [[65, 69, 72], [67, 71, 74], [64, 67, 71], [64, 69, 72]][bar]
    if (s % 4 === 0) this.kick(t, 0.6); if (s === 4 || s === 12) this.clap(t, 0.13); if (s % 4 === 2) this.hat(t, 0.06, true)
    if (s % 4 === 0 || s === 14) this.bass(root, t, 0.16, 0.4)
    if (s === 0 || s === 8) for (const n of ch) this.tone(this.mtof(n), t, 0.3, 'square', 0.022, this.bgm)
    const mel = [[77, 76, 77, 81], [79, 77, 79, 83], [79, 76, 74, 76], [76, 77, 79, 81]][bar]
    if (s % 4 === 0) this.tone(this.mtof(mel[s / 4]), t, 0.2, 'triangle', 0.05, this.bgm)
  },
  // 残念: とぼとぼワルツ（Am - Dm - E - Am）
  p_sad(i, t) {
    const bar = Math.floor(i / 12) % 4, s = i % 12
    const ch = [[57, 60, 64], [57, 62, 65], [56, 59, 64], [57, 60, 64]][bar], root = [33, 38, 40, 33][bar]
    if (s === 0) this.bass(root, t, 0.8, 0.3, 'sine'); if (s === 4 || s === 8) for (const n of ch) this.tone(this.mtof(n), t, 0.4, 'triangle', 0.02, this.bgm)
    const mel = [[76, 74, 72], [74, 72, 69], [71, 69, 68], [69, -1, -1]][bar]
    if (s % 4 === 0) { const n = mel[s / 4]; if (n > 0) this.tone(this.mtof(n), t, 0.5, 'sine', 0.06, this.bgm) }
  },
  sfx(name, v = 1) {
    if (!this.ctx) return; const t = this.ctx.currentTime; this.mark(name)
    switch (name) {
      case 'tap': this.tone(880, t, 0.06, 'triangle', 0.12 * v); break
      case 'step': this.tone(520, t, 0.05, 'triangle', 0.08); this.noise(t, 0.04, 0.05, 2500, 'bandpass', null, 2); break
      case 'squeeze': this.noise(t, 0.25, 0.08, 1200, 'bandpass', null, 1.5); this.voice(t, 0.25, 260, 200, 0.08, [500, 1500]); break
      case 'chi': this.noise(t, 0.025, 0.5, 3500, 'highpass'); this.tone(2400, t, 0.02, 'square', 0.12); break
      case 'stumble': this.voice(t, 0.45, 340, 520, 0.16, [700, 1100]); this.noise(t + 0.1, 0.2, 0.25, 400, 'lowpass'); this.tone(120, t + 0.1, 0.2, 'sine', 0.4, null, 60); break
      case 'lurch': this.noise(t, 0.35, 0.3, 300, 'lowpass'); this.tone(60, t, 0.35, 'sine', 0.5, null, 35); this.noise(t + 0.12, 0.08, 0.2, 1400, 'bandpass', null, 2); break
      case 'warn': this.tone(1320, t, 0.07, 'square', 0.05); this.tone(1320, t + 0.11, 0.07, 'square', 0.05); break
      case 'chime': this.tone(this.mtof(81), t, 0.6, 'sine', 0.2); this.tone(this.mtof(76), t + 0.32, 0.8, 'sine', 0.2); break
      case 'door': this.noise(t, 0.5, 0.25, 1800, 'bandpass', null, 0.7); this.tone(200, t + 0.35, 0.12, 'sine', 0.3, null, 120); break
      case 'brake': this.tone(2600, t, 1.1, 'sine', 0.025, null, 1800); this.noise(t, 1.1, 0.06, 3500, 'bandpass', null, 6); break
      case 'announce': this.voice(t, 0.3, 200, 210, 0.08, [600, 1600]); this.voice(t + 0.32, 0.5, 210, 170, 0.08, [500, 1400]); break
      case 'stand': this.tone(300, t, 0.15, 'triangle', 0.1, null, 520); break
      case 'sit': this.noise(t, 0.18, 0.4, 500, 'lowpass'); this.tone(180, t, 0.18, 'sine', 0.4, null, 90); break
      case 'bliss': this.voice(t, 1.1, 420, 220, 0.16, [700, 1200]); for (let k = 0; k < 4; k++) this.tone(this.mtof(84 + [0, 4, 7, 12][k]), t + k * 0.07, 0.4, 'sine', 0.06); break
      case 'grr': this.voice(t, 0.7, 150, 120, 0.2, [500, 900]); this.noise(t, 0.7, 0.05, 300, 'lowpass'); break
      case 'lose': for (let k = 0; k < 3; k++) this.tone(this.mtof(55 - k), t + k * 0.28, 0.3, 'sawtooth', 0.07); this.tone(this.mtof(51), t + 0.84, 0.8, 'sawtooth', 0.07, null, this.mtof(49)); break
      case 'lap': this.tone(300, t, 0.3, 'sine', 0.4, null, 900); this.voice(t + 0.05, 0.4, 600, 900, 0.18, [900, 1500]); break
      case 'throw': this.noise(t, 0.3, 0.1, 900, 'bandpass', null, 2); this.noise(t + 0.3, 0.1, 0.3, 300, 'lowpass'); this.tone(110, t + 0.3, 0.12, 'sine', 0.4, null, 60); break
      case 'dash': for (let k = 0; k < 5; k++) this.noise(t + k * 0.06, 0.04, 0.2, 700, 'bandpass', null, 2); this.voice(t, 0.35, 500, 700, 0.1, [900, 1300]); break
      case 'wake': this.tone(500, t, 0.12, 'square', 0.08, null, 1500); break
      case 'yield': for (let k = 0; k < 6; k++) this.tone(this.mtof(88 + [0, 3, 7, 10, 12, 15][k]), t + k * 0.06, 0.3, 'sine', 0.05); this.voice(t + 0.1, 0.6, 300, 260, 0.1, [600, 1100]); break
      case 'tell': this.tone(990, t, 0.05, 'triangle', 0.04); break
      case 'go': this.tone(this.mtof(79), t, 0.12, 'square', 0.06); this.tone(this.mtof(84), t + 0.12, 0.25, 'square', 0.06); break
      case 'drum': for (let k = 0; k < 22; k++) this.noise(t + k * 0.045, 0.05, 0.05 + k * 0.004, 1800, 'bandpass'); break
      case 'stamp': this.tone(90, t, 0.25, 'sine', 0.6, null, 40); this.noise(t, 0.12, 0.3, 1500, 'lowpass'); break
      case 'cheer': this.noise(t, 1.8, 0.14, 1200, 'bandpass', null, 0.6); for (let k = 0; k < 4; k++) this.tone(1800, t + k * 0.3, 0.3, 'sine', 0.05, null, 2600); break
      case 'boo': this.voice(t, 1.0, 220, 140, 0.14, [500, 800]); this.noise(t, 1.0, 0.08, 400, 'lowpass'); break
      case 'result': for (let k = 0; k < 3; k++) this.tone(this.mtof(72 + k * 4), t + k * 0.09, 0.2, 'square', 0.06); break
    }
  },
}
