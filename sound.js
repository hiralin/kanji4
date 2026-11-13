// Sound for the cabinet: synthesized SE (lever, stop, bet, payout, notices, fanfares) and looping BGM files for the hall, BIG and REG.
// The SE are synthesized with Web Audio, so they need no files. They run through a small hall reverb and a compressor.
// The context is created on the first user action, as browsers require.
let ac = null;
let master = null;
let noiseBuf = null;
let hum = null;
let bgm = null;
let enabled = true;

// Decaying stereo noise: the impulse response of a small hall.
function impulse(sec) {
  const n = Math.floor(ac.sampleRate * sec);
  const b = ac.createBuffer(2, n, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
  }
  return b;
}

function ctx() {
  if (!ac) {
    ac = new AudioContext();
    // Layered SE can stack past 0 dBFS; the compressor keeps them from clipping.
    const comp = ac.createDynamicsCompressor();
    comp.connect(ac.destination);
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(comp);
    const verb = ac.createConvolver();
    verb.buffer = impulse(1.6);
    const wet = ac.createGain();
    wet.gain.value = 0.22;
    master.connect(verb).connect(wet).connect(comp);
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

function tone(type, f0, f1, dur, gain, delay = 0, pan = 0) {
  if (!enabled) return;
  const a = ctx();
  // High partials (sparkle, clink) can pass Nyquist: inaudible, and Chrome warns about them.
  if (Math.max(f0, f1) >= a.sampleRate / 2) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  const p = a.createStereoPanner();
  p.pan.value = pan;
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(p).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, gain, type, freq, delay = 0, q = 1) {
  if (!enabled) return;
  const a = ctx();
  const t0 = a.currentTime + delay;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = a.createBufferSource();
  s.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

// Sustained detuned-saw chord with a soft attack and an opening filter.
function pad(freqs, dur, gain, delay = 0) {
  if (!enabled) return;
  const a = ctx();
  const t0 = a.currentTime + delay;
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(700, t0);
  f.frequency.linearRampToValueAtTime(3200, t0 + dur * 0.5);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  f.connect(g).connect(master);
  for (const fr of freqs) {
    for (const cents of [-7, 7]) {
      const o = a.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = cents;
      o.connect(f);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
  }
}

// Miyako-bushi scale (E F A B C) for a Japanese feel.
const N = { E3: 164.8, B3: 246.9, E4: 329.6, F4: 349.2, A4: 440, B4: 493.9, C5: 523.3, E5: 659.3, F5: 698.5, A5: 880, B5: 987.8, C6: 1046.5, E6: 1318.5 };

// One lead note: two detuned voices spread left and right, plus a soft octave on top.
const voice = (f, dur, gain, delay, type = 'triangle') => {
  tone(type, f * 0.997, f * 0.996, dur, gain, delay, -0.3);
  tone(type, f * 1.003, f * 1.002, dur, gain, delay, 0.3);
  tone('sine', f * 2, f * 2, dur * 0.6, gain * 0.3, delay);
};
const melody = (notes, step, type = 'triangle', gain = 0.1) => notes.forEach((f, i) => voice(f, step * 1.8, gain, i * step, type));

// Metal: inharmonic partials with short decays (medals, springs).
const clink = (f, gain, delay = 0, pan = 0) => [1, 2.4, 4.1, 6.3].forEach((r, i) => tone('sine', f * r, f * r * 0.995, 0.22 / (i + 1), gain / (i + 1), delay, pan));
// Temple bell: inharmonic partials with a long tail.
const bell = (f, gain, delay = 0) => [1, 2.76, 5.4, 8.93].forEach((r, i) => tone('sine', f * r, f * r * 0.998, 2.6 / (i + 1), gain / (i + 1), delay));
const taiko = (delay, gain = 0.7) => {
  tone('sine', 120, 48, 0.5, gain, delay);
  noise(0.08, gain * 0.4, 'lowpass', 500, delay);
};
const cymbal = (delay, gain = 0.12) => noise(1.4, gain, 'highpass', 6500, delay);
const sparkle = (count, span, gain, delay = 0) => {
  for (let i = 0; i < count; i++) clink(2500 + Math.random() * 2500, gain, delay + (i / count) * span, Math.random() * 1.6 - 0.8);
};
const coinAt = (delay) => clink(3200, 0.06, delay, Math.random() * 0.6 - 0.3);

// BGM made with Suno. The files are in web/audio/.
// Keys match the role names in kanji4.ts: big7 = 七 BIG, bigKan = 漢 BIG. 'big' (role unknown) picks one at random.
const BGM = { big7: ['audio/big-1.m4a'], bigKan: ['audio/big-2.m4a'], big: ['audio/big-1.m4a', 'audio/big-2.m4a'], reg: ['audio/reg.m4a'], hall: ['audio/hall.m4a'] };
const BGM_VOLUME = { big7: 0.5, bigKan: 0.5, big: 0.5, reg: 0.5, hall: 0.3 };

export const sound = {
  get enabled() {
    return enabled;
  },
  set enabled(v) {
    enabled = v;
    if (!v) {
      this.humOff();
      this.bgmStop();
    }
  },
  lever() {
    noise(0.05, 0.7, 'bandpass', 1800);
    tone('sine', 160, 45, 0.22, 0.8);
    noise(0.14, 0.12, 'bandpass', 700, 0.03, 6); // spring rattle
    clink(2100, 0.04, 0.05);
  },
  stop() {
    tone('square', 1100, 480, 0.035, 0.08);
    tone('sine', 110, 60, 0.09, 0.45);
    noise(0.03, 0.3, 'highpass', 3000);
    clink(2900, 0.02, 0.01);
  },
  // Medal insertion: one click per medal.
  bet(n = 3) {
    for (let i = 0; i < n; i++) {
      noise(0.025, 0.3, 'bandpass', 4200, i * 0.07);
      clink(1900 + i * 70, 0.06, i * 0.07, (i - 1) * 0.3);
    }
    tone('sine', 140, 70, 0.08, 0.3, n * 0.07);
  },
  coin() {
    coinAt(0);
  },
  // Pays out n medals one by one. Returns the seconds it takes, so the caller can wait for it.
  payout(n) {
    const gap = 0.07;
    for (let i = 0; i < n; i++) coinAt(i * gap);
    return n * gap;
  },
  replay() {
    voice(N.A5, 0.12, 0.1, 0);
    voice(N.E6, 0.22, 0.1, 0.08);
    sparkle(3, 0.15, 0.02, 0.1);
  },
  // Pre-notice at the lever.
  notice() {
    tone('sine', 300, 2600, 0.5, 0.18);
    tone('triangle', 600, 5200, 0.5, 0.05, 0, 0.4);
    tone('sine', 80, 40, 0.6, 0.6);
    sparkle(8, 0.5, 0.025, 0.1);
  },
  // Post-notice: the 吉兆 lamp lights after the third stop.
  kitchou() {
    bell(660, 0.25);
    bell(330, 0.1, 0.01);
  },
  big() {
    taiko(0);
    pad([N.E4, N.A4, N.B4], 1.1, 0.05);
    melody([N.E5, N.F5, N.A5, N.B5, N.C6, N.E6, N.C6, N.E6], 0.12, 'square', 0.06);
    taiko(0.96, 0.8);
    pad([N.E3, N.B3, N.E4, N.B4, N.E5], 1.8, 0.07, 0.96);
    cymbal(0.96);
    sparkle(10, 1, 0.02, 1);
  },
  reg() {
    taiko(0, 0.5);
    melody([N.A4, N.C5, N.E5, N.A5], 0.13);
    pad([N.A4, N.C5, N.E5], 1.3, 0.04, 0.39);
    bell(880, 0.08, 0.39);
  },
  jacin() {
    melody([N.B5, N.E6], 0.09, 'square', 0.05);
    sparkle(4, 0.25, 0.02, 0.09);
  },
  // A JAC game win.
  jac() {
    melody([N.E6, N.B5, N.E6], 0.06, 'square', 0.045);
    coinAt(0.12);
  },
  // Bonus end. 'big' plays a closing fanfare (run up, ta-ta-taaa, held chord); otherwise a short gentle jingle.
  // Returns the seconds it takes, so the caller can start the next music after it.
  end(kind) {
    if (kind !== 'big') {
      melody([N.A5, N.E5, N.C5, N.B4, N.A4], 0.14, 'sine', 0.1);
      pad([N.A4, N.C5, N.E5], 1.6, 0.035, 0.56);
      bell(440, 0.08, 0.56);
      return 1.6;
    }
    taiko(0, 0.6);
    melody([N.B4, N.E5, N.A5, N.B5], 0.11, 'square', 0.055);
    for (const t of [0.55, 0.7]) {
      taiko(t, 0.5);
      voice(N.E6, 0.12, 0.07, t, 'square');
    }
    taiko(0.85, 0.85);
    voice(N.E6, 1.8, 0.07, 0.85, 'square');
    voice(N.B5, 1.8, 0.05, 0.85);
    pad([N.E3, N.B3, N.E4, N.B4, N.E5], 2.2, 0.08, 0.85);
    cymbal(0.85, 0.15);
    sparkle(12, 1.2, 0.02, 0.9);
    bell(1320, 0.06, 0.85);
    return 2.8;
  },
  // Walking over to another machine.
  move() {
    noise(0.3, 0.2, 'bandpass', 900);
    voice(660, 0.12, 0.06, 0.12);
    voice(990, 0.16, 0.06, 0.2);
  },
  // Closing the hall and going to the next day: shutter down, then a morning bell.
  nextDay() {
    noise(0.7, 0.3, 'lowpass', 500);
    tone('sawtooth', 90, 50, 0.7, 0.05);
    taiko(0.7, 0.4);
    bell(880, 0.2, 0.9);
    pad([N.E4, N.A4, N.B4], 2, 0.03, 0.9);
  },
  // Starts the looping BGM ('big7', 'bigKan', 'big', 'reg' or 'hall'), replacing any BGM already playing.
  // shortcut: loops the whole Suno track (intro and ending included); cut loop points if the restart sounds abrupt.
  bgm(name) {
    this.bgmStop();
    if (!enabled || !BGM[name]) return;
    const files = BGM[name];
    bgm = new Audio(new URL(files[Math.floor(Math.random() * files.length)], import.meta.url));
    bgm.loop = true;
    bgm.volume = BGM_VOLUME[name];
    // A quick switch to another BGM interrupts play(); that rejection is expected.
    bgm.play().catch(() => {});
  },
  bgmStop() {
    if (!bgm) return;
    bgm.pause();
    bgm = null;
  },
  // Reel spin: a quiet, soft low hum (triangle plus its octave, filtered), fading in and out.
  humOn() {
    if (!enabled || hum) return;
    const a = ctx();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    f.type = 'lowpass';
    f.frequency.value = 180;
    g.gain.setValueAtTime(0, a.currentTime);
    g.gain.setTargetAtTime(0.012, a.currentTime, 0.08);
    const oscs = [
      ['triangle', 62],
      ['sine', 124],
    ].map(([type, hz]) => {
      const o = a.createOscillator();
      o.type = type;
      o.frequency.value = hz;
      o.connect(f);
      o.start();
      return o;
    });
    f.connect(g).connect(master);
    hum = { oscs, g };
  },
  humOff() {
    if (!hum) return;
    hum.g.gain.setTargetAtTime(0, ac.currentTime, 0.08);
    for (const o of hum.oscs) o.stop(ac.currentTime + 0.5);
    hum = null;
  },
};
