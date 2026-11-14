// Every sound is synthesised with WebAudio: filtered noise bursts for gunfire
// and explosions, short oscillator blips for the interface. No audio file is
// ever fetched, so the game stays fully offline. The context is created on the
// first user gesture; every call is a no-op until then.
export function createAudio() {
  let ctx = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      return false;
    }
  }

  function noise(dur, filterFreq, gain, type) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type || 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SHOTS = {
    pistol: { freq: 900, gain: 0.5, dur: 0.12, tone: 220 },
    smg: { freq: 1200, gain: 0.35, dur: 0.09, tone: 300 },
    rifle: { freq: 700, gain: 0.55, dur: 0.14, tone: 170 },
    dmr: { freq: 500, gain: 0.7, dur: 0.22, tone: 120 },
  };

  return {
    resume() {
      if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shoot(weapon, distant) {
      if (!ensure()) return;
      const s = SHOTS[weapon] || SHOTS.rifle;
      const g = distant ? s.gain * 0.25 : s.gain;
      noise(s.dur, s.freq, g);
      tone(s.tone, 0.08, g * 0.5, 'square', s.tone * 0.5);
    },
    dryFire() {
      if (!ensure()) return;
      tone(1400, 0.04, 0.15, 'square');
    },
    reload() {
      if (!ensure()) return;
      tone(500, 0.05, 0.2, 'square');
      setTimeout(() => tone(750, 0.05, 0.2, 'square'), 120);
    },
    hit(kill) {
      if (!ensure()) return;
      tone(kill ? 1180 : 880, 0.07, 0.25, 'sine');
      if (kill) setTimeout(() => tone(1560, 0.09, 0.25, 'sine'), 70);
    },
    hurt() {
      if (!ensure()) return;
      tone(140, 0.15, 0.4, 'sawtooth', 70);
    },
    throwGrenade() {
      if (!ensure()) return;
      tone(600, 0.06, 0.2, 'sine', 900);
    },
    explosion() {
      if (!ensure()) return;
      noise(0.8, 220, 0.9);
      tone(60, 0.6, 0.6, 'sine', 30);
    },
    smoke() {
      if (!ensure()) return;
      noise(0.7, 2400, 0.25, 'highpass');
    },
    flash() {
      if (!ensure()) return;
      noise(0.15, 3000, 0.6, 'highpass');
      tone(2400, 0.9, 0.12, 'sine', 1800);
    },
    plant() {
      if (!ensure()) return;
      tone(980, 0.09, 0.3, 'square');
      setTimeout(() => tone(980, 0.09, 0.3, 'square'), 150);
    },
    beep() {
      if (!ensure()) return;
      tone(1240, 0.06, 0.22, 'square');
    },
    roundWin(win) {
      if (!ensure()) return;
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.3, 'triangle'), i * 140));
    },
    buy() {
      if (!ensure()) return;
      tone(1046, 0.08, 0.25, 'triangle');
      setTimeout(() => tone(1318, 0.1, 0.25, 'triangle'), 80);
    },
    click() {
      if (!ensure()) return;
      tone(700, 0.04, 0.15, 'sine');
    },
  };
}
