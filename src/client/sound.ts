// Race-day sound for the big screen, all synthesised live with the Web Audio
// API (no recordings to load or license): a bugle fanfare for the start,
// galloping hooves and huffs as horses move, whinnies and snorts now and
// then, a crowd cheering the winner, and a cash register as bets go in.
// The whinnies, cash registers and coins are real recordings (public/sounds,
// credits in its CREDITS.md); everything else is synthesised.
//
// Browsers only allow sound after the page has been clicked or tapped, so
// the context is created on the first click (the host clicks plenty).

import { store } from './ui';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
// What the voices below play into: the live context, or an offline one (renderOffline).
let ac: BaseAudioContext | null = null;
let out: AudioNode | null = null;

function makeNoise(a: BaseAudioContext): AudioBuffer {
  const buf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
let enabled = store.get<boolean>('hr:sound') ?? true;

export const soundOn = () => enabled;

export function setSound(on: boolean): void {
  enabled = on;
  store.set('hr:sound', on);
  if (master && ctx) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
  if (!on) { stopRaceAmbience(); stopCrowd(0.1); }
}

/** Create or wake the audio context. Call from a click handler. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.8 : 0;
    // A gentle limiter so overlapping hooves and cheers don't clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    noise = makeNoise(ctx);
    ac = ctx;
    out = master;
    loadAll(); // fetch the recordings: whinnies for the race, registers and coins for bets
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

const ready = () => !!ctx && !!master && enabled && ctx.state === 'running';

// ---- Recordings ---------------------------------------------------------------

/** The recordings in public/sounds (see its CREDITS.md). */
const FILES = {
  neigh: 'neigh.m4a', stallion1: 'stallion1.m4a', stallion2: 'stallion2.m4a', stallion3: 'stallion3.m4a', stallion4: 'stallion4.m4a',
  till: 'register.m4a', clunk: 'register-clunk.m4a', coins: 'coins.m4a',
} as const;
type Rec = keyof typeof FILES;
const WHINNIES: Rec[] = ['neigh', 'stallion1', 'stallion2', 'stallion3', 'stallion4'];
const STALLIONS: Rec[] = ['stallion1', 'stallion2', 'stallion3', 'stallion4'];
/** Where the sound starts in recordings with a quiet lead-in (seconds). */
const LEAD_IN: Partial<Record<Rec, number>> = { coins: 0.4, stallion4: 0.55 };
const buffers = new Map<Rec, AudioBuffer>();
const loading = new Set<Rec>();

function load(name: Rec): void {
  if (buffers.has(name) || loading.has(name) || !ac) return;
  loading.add(name);
  fetch('/sounds/' + FILES[name])
    .then((r) => r.arrayBuffer())
    .then((b) => ac!.decodeAudioData(b))
    .then((buf) => { buffers.set(name, buf); })
    .catch(() => { loading.delete(name); }); // try again next time
}
function loadAll(): void { (Object.keys(FILES) as Rec[]).forEach(load); }

/** Play a recording at time t; false if it hasn't loaded yet. */
function play(name: Rec, t: number, opts: { rate?: number; gain?: number } = {}): boolean {
  const buf = buffers.get(name);
  if (!buf) { load(name); return false; }
  const src = ac!.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate ?? 1;
  const g = ac!.createGain();
  g.gain.value = opts.gain ?? 0.7;
  src.connect(g).connect(out!);
  src.start(t, LEAD_IN[name] ?? 0);
  return true;
}
const pick = <T,>(xs: T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)];
/** Are all these recordings loaded? (Starts loading any that aren't.) */
const has = (...names: Rec[]) => names.every((n) => buffers.has(n) || (load(n), false));

// ---- Building blocks ------------------------------------------------------

/** A burst of filtered noise. */
function noiseBurst(t: number, dur: number, opts: { type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; freqEnd?: number }) {
  const src = ac!.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ac!.createBiquadFilter();
  f.type = opts.type;
  f.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
  f.Q.value = opts.q ?? 1;
  const g = ac!.createGain();
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out!);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

/** A low thump: a hoof on packed dirt. */
function thump(t: number, gain: number) {
  const o = ac!.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(110 + Math.random() * 25, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
  const g = ac!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + 0.15);
  noiseBurst(t, 0.07, { type: 'lowpass', freq: 700, gain: gain * 0.7 }); // the dirt
}

// ---- Race start: a bugle fanfare -------------------------------------------

/** A brass note: sawtooth through a filter that opens as the note speaks. */
function brass(t: number, freq: number, dur: number) {
  const o = ac!.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq * 0.97, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.04); // lip up to pitch
  const vib = ac!.createOscillator();
  const vibGain = ac!.createGain();
  vib.frequency.value = 5.5;
  vibGain.gain.value = freq * 0.006;
  vib.connect(vibGain).connect(o.frequency);
  const f = ac!.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(freq * 1.5, t);
  f.frequency.linearRampToValueAtTime(freq * 6, t + 0.05);
  f.frequency.linearRampToValueAtTime(freq * 3.5, t + dur);
  const g = ac!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
  g.gain.setValueAtTime(0.2, t + Math.max(0.04, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(out!);
  o.start(t); vib.start(t);
  o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
}

/** An original fanfare on the bugle's natural notes, in the style of a call to the post. */
export function playBugle(): void {
  if (!ready()) return;
  const G4 = 392, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
  const e = 0.15; // an eighth note
  const tune: [number, number][] = [
    [G4, 1], [C5, 1], [E5, 1], [G5, 2], [E5, 1], [G5, 3],
    [E5, 1], [C5, 1], [E5, 1], [G5, 1], [E5, 1], [C5, 3],
    [G4, 1], [C5, 1], [E5, 1], [G5, 1], [E5, 1], [G5, 1], [C6, 6],
  ];
  let t = ac!.currentTime + 0.05;
  for (const [f, beats] of tune) {
    const dur = beats * e;
    brass(t, f, dur * 0.92);
    t += dur;
  }
}

// ---- Movement: hooves and huffs ----------------------------------------------

/**
 * Galloping while the horses slide to their new spots (about 1.4 s): the
 * three-beat da-da-DUM of a gallop for each moving horse, a little out of
 * step with each other, and a huff of breath now and then.
 */
export function playGallop(horsesMoving: number, seconds = 1.4): void {
  if (!ready() || horsesMoving <= 0) return;
  const now = ac!.currentTime + 0.02;
  for (let h = 0; h < Math.min(horsesMoving, 3); h++) {
    const offset = h * 0.07 + Math.random() * 0.03;
    const stride = 0.34 + Math.random() * 0.04;
    for (let t = offset; t < seconds; t += stride) {
      thump(now + t, 0.32);
      thump(now + t + 0.07, 0.26);
      thump(now + t + 0.15, 0.4);
    }
    // A huff or two: a horse breathing hard.
    for (let t = offset + 0.2; t < seconds; t += 0.6 + Math.random() * 0.3) {
      noiseBurst(now + t, 0.22, { type: 'bandpass', freq: 900 + Math.random() * 400, q: 0.9, gain: 0.12, attack: 0.03, freqEnd: 500 });
    }
  }
}

// ---- Now and then: whinnies, nickers, snorts ----------------------------------

/**
 * A whinny: a real recording (public domain, see public/sounds/CREDITS.md),
 * played a little faster or slower each time so repeats don't sound the same.
 */
function whinny(t: number) {
  // A real recording (one of several horses), a little faster or slower each time.
  const horse = pick(WHINNIES.filter((n) => buffers.has(n)));
  if (!horse) { WHINNIES.forEach(load); return nicker(t); } // not loaded yet: a nicker instead
  play(horse, t, { rate: 0.88 + Math.random() * 0.24, gain: 0.55 + Math.random() * 0.25 });
}

/** A low nicker: a soft, rumbling chuckle. */
function nicker(t: number) {
  const dur = 0.6;
  const o = ac!.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(140, t);
  o.frequency.linearRampToValueAtTime(110, t + dur);
  const trem = ac!.createOscillator();
  trem.frequency.value = 11;
  const tremGain = ac!.createGain();
  tremGain.gain.value = 0.35;
  const amp = ac!.createGain();
  amp.gain.value = 0.4;
  trem.connect(tremGain).connect(amp.gain);
  const env = ac!.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.6, t + 0.04);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(amp).connect(env).connect(out!);
  o.start(t); trem.start(t);
  o.stop(t + dur + 0.05); trem.stop(t + dur + 0.05);
}

/** A snort: a sharp blast of air through the nose. */
function snort(t: number) {
  noiseBurst(t, 0.18, { type: 'bandpass', freq: 650, q: 1.4, gain: 0.35, attack: 0.01, freqEnd: 350 });
  noiseBurst(t + 0.2, 0.12, { type: 'bandpass', freq: 800, q: 1.2, gain: 0.2, attack: 0.01 });
}

let ambience = 0;

/** While a race runs, a horse calls out every few seconds. */
export function startRaceAmbience(): void {
  if (ambience) return;
  const next = () => {
    ambience = window.setTimeout(() => {
      if (ready()) {
        const t = ac!.currentTime + 0.02;
        const r = Math.random();
        if (r < 0.45) whinny(t);
        else if (r < 0.75) snort(t);
        else nicker(t);
      }
      next();
    }, 3500 + Math.random() * 5500);
  };
  next();
}

export function stopRaceAmbience(): void {
  clearTimeout(ambience);
  ambience = 0;
}

// ---- Photo finish: camera shutters and explosions ------------------------------

/** A few camera shutters going off, each with a flash-gun whine. */
export function playShutters(count = 3): void {
  if (!ready()) return;
  const now = ac!.currentTime + 0.02;
  for (let i = 0; i < count; i++) {
    const t = now + i * 0.16 + Math.random() * 0.08;
    noiseBurst(t, 0.025, { type: 'highpass', freq: 3000, gain: 0.25 }); // the shutter opening
    noiseBurst(t + 0.05, 0.03, { type: 'bandpass', freq: 1800, q: 2, gain: 0.2 }); // and closing
    const o = ac!.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(2200, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(5200, t + 0.4);
    const g = ac!.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.015, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(out!);
    o.start(t + 0.06); o.stop(t + 0.45);
  }
}

/** A cartoon explosion: a deep boom and a rush of noise, once per losing horse. */
export function playBoom(count = 1): void {
  if (!ready()) return;
  const now = ac!.currentTime + 0.02;
  for (let i = 0; i < Math.min(count, 4); i++) {
    const t = now + i * 0.12;
    const o = ac!.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const g = ac!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    o.connect(g).connect(out!);
    o.start(t); o.stop(t + 0.85);
    noiseBurst(t, 0.9, { type: 'lowpass', freq: 2400, freqEnd: 180, gain: 0.45 });
    noiseBurst(t + 0.02, 0.25, { type: 'highpass', freq: 2500, gain: 0.12 }); // crackle
  }
}

// ---- Betting: a mechanical cash register ---------------------------------------

/** A bell partial: a sine that rings and dies away. */
function ring(t: number, freq: number, gain: number, decay: number) {
  const o = ac!.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const g = ac!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + decay + 0.05);
}

/** A hard little click of metal on metal. */
function clack(t: number, gain: number, freq = 2600) {
  noiseBurst(t, 0.018, { type: 'bandpass', freq, q: 3, gain });
  noiseBurst(t, 0.006, { type: 'highpass', freq: 5000, gain: gain * 0.6 });
}

/**
 * "Cha-ching": the key goes down and the lever ratchets round ("cha"), then
 * the bell rings and the cash drawer slides out with a thunk ("ching").
 */
function register(t: number) {
  // Cha: the key, then the mechanism ratcheting.
  clack(t, 0.5, 1800);
  thump(t, 0.12);
  for (let i = 0; i < 6; i++) clack(t + 0.04 + i * 0.022 + Math.random() * 0.004, 0.22 + i * 0.02, 2800 + i * 150);
  // Ching: a small bright bell (inharmonic partials, the high ones dying first).
  const b = t + 0.2, f = 1760 * (0.97 + Math.random() * 0.06);
  for (const [ratio, gain, decay] of [[1, 0.16, 1.6], [2.32, 0.08, 1.0], [4.25, 0.05, 0.55], [5.4, 0.035, 0.35], [0.5, 0.03, 0.9]] as const) {
    ring(b, f * ratio, gain, decay);
  }
  clack(b, 0.35, 4200); // the hammer striking it
  // The drawer: rolling out, then hitting its stop.
  noiseBurst(b + 0.01, 0.2, { type: 'bandpass', freq: 900, q: 0.8, gain: 0.1, attack: 0.03, freqEnd: 500 });
  thump(b + 0.2, 0.35);
  clack(b + 0.2, 0.25, 1200);
}

/** A bell struck once: bright partials ringing out. */
function ding(t: number, f: number, gain: number) {
  for (const [ratio, g, decay] of [[1, 1, 1.2], [2.32, 0.5, 0.7], [4.25, 0.3, 0.4]] as const) ring(t, f * ratio, gain * g, decay);
}

/** A slot-machine jackpot: ding-ding-ding and a shower of coins. */
function jackpot(t: number) {
  [1568, 1976, 2349, 1568, 1976, 2349, 3136].forEach((f, i) => ding(t + i * 0.11, f, 0.12));
  for (let i = 0; i < 45; i++) {
    const c = t + 0.15 + Math.random() * 1.6;
    ring(c, 3200 + Math.random() * 3200, 0.03 + Math.random() * 0.04, 0.12 + Math.random() * 0.15);
    clack(c, 0.08, 5000);
  }
}

/**
 * The sounds a bet can make, picked at random (never the same twice running):
 * real cash registers and coins, a horse having its say, and some deliberately
 * over-the-top ones. Each returns false if its recording hasn't loaded yet.
 */
const BET_SOUNDS: ((t: number) => boolean)[] = [
  (t) => play('till', t, { rate: 0.95 + Math.random() * 0.1, gain: 0.95 }), // cha-ching
  (t) => play('clunk', t, { gain: 1 }), // an old register's clatter and clunk
  (t) => play('coins', t, { gain: 1 }), // coins into a tin
  (t) => has('till') && play('till', t, { gain: 1 }) && play('till', t + 0.32, { rate: 1.26, gain: 0.9 }), // cha-ching-CHING!
  (t) => has('till', 'coins') && play('till', t, { gain: 1 }) && play('coins', t + 0.3, { gain: 1 }), // big spender
  (t) => { jackpot(t); return true; }, // slot-machine jackpot
  (t) => { register(t); return true; }, // the synthesised register
  (t) => play(pick(STALLIONS)!, t, { rate: 0.95 + Math.random() * 0.15, gain: 1 }), // a horse approves
  (t) => { const h = pick(STALLIONS)!; return has(h, 'till') && play(h, t, { rate: 1.55 + Math.random() * 0.2, gain: 0.9 }) && play('till', t + 0.9, { gain: 0.9 }); }, // horse cackles, then cha-ching
];
let lastBetSound = -1;

/** Cha-ching (or something sillier)! Someone's bet is in. */
export function playRegister(): void {
  if (!ready()) return;
  const t = ac!.currentTime + 0.02;
  let i = Math.floor(Math.random() * BET_SOUNDS.length);
  if (i === lastBetSound) i = (i + 1) % BET_SOUNDS.length;
  lastBetSound = i;
  if (!BET_SOUNDS[i](t)) register(t); // recording not loaded yet: the synthesised one
}

// ---- Photo finish: the crowd, the die, the crash ---------------------------------

let crowd: { bus: GainNode; srcs: AudioScheduledSourceNode[]; timer: number } | null = null;

/** A whoop or whistle from the stands. */
function whoop(s: number, gain = 0.07) {
  const o = ac!.createOscillator();
  o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
  const f0 = 900 + Math.random() * 900;
  o.frequency.setValueAtTime(f0, s);
  o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.6), s + 0.18);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.9, s + 0.45);
  const g = ac!.createGain();
  g.gain.setValueAtTime(0.0001, s);
  g.gain.exponentialRampToValueAtTime(gain, s + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
  o.connect(g).connect(out!);
  o.start(s); o.stop(s + 0.55);
}

/** The grandstand roaring the horses home: a crowd that keeps going until stopCrowd(). */
export function startCrowd(): void {
  if (crowd || !ready()) return;
  const t = ac!.currentTime;
  const bus = ac!.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(1, t + 1.5);
  bus.connect(out!);
  const srcs: AudioScheduledSourceNode[] = [];
  for (const [freq, q, gain, rate] of [[520, 1.1, 0.3, 0.23], [950, 1.3, 0.2, 0.31], [1700, 1.6, 0.08, 0.17]] as const) {
    const src = ac!.createBufferSource();
    src.buffer = noise; src.loop = true;
    const f = ac!.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac!.createGain(); g.gain.value = gain;
    // The roar rises and falls.
    const lfo = ac!.createOscillator(); lfo.frequency.value = rate;
    const depth = ac!.createGain(); depth.gain.value = gain * 0.45;
    lfo.connect(depth).connect(g.gain);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random()); lfo.start(t);
    srcs.push(src, lfo);
  }
  const timer = window.setInterval(() => {
    if (!ready()) return;
    const now = ac!.currentTime;
    for (let i = 0; i < 1 + Math.floor(Math.random() * 3); i++) whoop(now + Math.random() * 0.6, 0.05);
  }, 900);
  crowd = { bus, srcs, timer };
}

/** The crowd draws breath ("ooooh") as the die is shaken. */
export function crowdSwell(seconds = 3): void {
  if (!crowd || !ready()) return;
  const t = ac!.currentTime, g = crowd.bus.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(0.0001, g.value), t);
  g.linearRampToValueAtTime(2.2, t + seconds * 0.9);
  g.linearRampToValueAtTime(1, t + seconds + 0.8);
}

/** A disappointed "aww" when the die misses. */
export function playAww(): void {
  if (!ready()) return;
  const t = ac!.currentTime + 0.02;
  noiseBurst(t, 1.1, { type: 'bandpass', freq: 750, freqEnd: 380, q: 1.4, gain: 0.3, attack: 0.15 });
  noiseBurst(t, 1.1, { type: 'bandpass', freq: 1300, freqEnd: 650, q: 1.6, gain: 0.15, attack: 0.15 });
}

export function stopCrowd(fade = 1.5): void {
  if (!crowd) return;
  const c = crowd;
  crowd = null;
  clearInterval(c.timer);
  if (!ac) return;
  const t = ac.currentTime;
  c.bus.gain.cancelScheduledValues(t);
  c.bus.gain.setValueAtTime(Math.max(0.0001, c.bus.gain.value), t);
  c.bus.gain.exponentialRampToValueAtTime(0.0001, t + fade);
  c.srcs.forEach((n) => n.stop(t + fade + 0.1));
}

/** The die rattling in a cupped hand, then bouncing across the table until it settles. */
export function playDieRoll(shake = 1, bounce = 2): void {
  if (!ready()) return;
  const t0 = ac!.currentTime + 0.02;
  for (let t = 0; t < shake; t += 0.035 + Math.random() * 0.03) clack(t0 + t, 0.1 + Math.random() * 0.1, 2000 + Math.random() * 1500);
  const hits = [0, 0.42, 0.78, 1.06, 1.3, 1.48, 1.62, 1.72, 1.8, 1.86];
  hits.forEach((h, i) => {
    const at = t0 + shake + h * (bounce / 2);
    const gain = 0.5 * (1 - i / hits.length) + 0.08;
    clack(at, gain, 1500 + Math.random() * 1200);
    thump(at, gain * 0.25);
  });
}

/** A horse going down hard: hooves, thuds and a slide in the dirt. */
export function playTumble(seconds = 2): void {
  if (!ready()) return;
  const t0 = ac!.currentTime + 0.02;
  [0.15, 0.45, 0.8, 1.1, 1.4, 1.65, 1.85].forEach((h, i) => {
    const at = t0 + h * (seconds / 2);
    thump(at, 0.35 + (i % 2) * 0.15);
    noiseBurst(at, 0.25, { type: 'lowpass', freq: 900, gain: 0.25 }); // dirt flying
  });
  noiseBurst(t0 + seconds * 0.6, seconds * 0.4, { type: 'bandpass', freq: 600, q: 0.7, gain: 0.15, attack: 0.05, freqEnd: 300 }); // the skid
}

// ---- The finish: the crowd goes wild --------------------------------------------

export function playCheer(): void {
  if (!ready()) return;
  const t = ac!.currentTime + 0.02;
  const dur = 4.5;
  // Many voices at once: noise shaped into an "aah", swelling then fading.
  for (const [freq, q, gain] of [[750, 1.2, 0.5], [1150, 1.4, 0.35], [2500, 2, 0.15]] as const) {
    const src = ac!.createBufferSource();
    src.buffer = noise; src.loop = true;
    const f = ac!.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.6);
    g.gain.setValueAtTime(gain, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out!);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }
  // Whoops and whistles from the stands.
  for (let i = 0; i < 9; i++) {
    const s = t + 0.2 + Math.random() * 2.6;
    const o = ac!.createOscillator();
    o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
    const f0 = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, s);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.6), s + 0.18);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, s + 0.45);
    const g = ac!.createGain();
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.07, s + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(g).connect(out!);
    o.start(s); o.stop(s + 0.55);
  }
  // Applause: lots of tiny claps.
  for (let i = 0; i < 140; i++) {
    const s = t + 0.3 + Math.random() * 3.6;
    noiseBurst(s, 0.035, { type: 'highpass', freq: 1400 + Math.random() * 1200, gain: 0.05 + Math.random() * 0.05 });
  }
}

/**
 * Render one of the voices into an offline context (for listening tests and
 * tuning; not used by the game).
 */
export function renderOffline(a: BaseAudioContext, voice: 'nicker' | 'snort' | 'register', at: number): void {
  const prev = [ac, out, noise] as const;
  ac = a; out = a.destination; noise = makeNoise(a);
  ({ nicker, snort, register })[voice](at);
  [ac, out, noise] = prev;
}
