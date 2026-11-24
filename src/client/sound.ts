// Race-day sound for the big screen, all synthesised live with the Web Audio
// API (no recordings to load or license): a bugle fanfare for the start,
// galloping hooves and huffs as horses move, whinnies and snorts now and
// then, and a crowd cheering the winner.
//
// Browsers only allow sound after the page has been clicked or tapped, so
// the context is created on the first click (the host clicks plenty).

import { store } from './ui';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = store.get<boolean>('hr:sound') ?? true;

export const soundOn = () => enabled;

export function setSound(on: boolean): void {
  enabled = on;
  store.set('hr:sound', on);
  if (master && ctx) master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.05);
  if (!on) stopRaceAmbience();
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
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

const ready = () => !!ctx && !!master && enabled && ctx.state === 'running';

// ---- Building blocks ------------------------------------------------------

/** A burst of filtered noise. */
function noiseBurst(t: number, dur: number, opts: { type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; freqEnd?: number }) {
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx!.createBiquadFilter();
  f.type = opts.type;
  f.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + dur);
  f.Q.value = opts.q ?? 1;
  const g = ctx!.createGain();
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(opts.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

/** A low thump: a hoof on packed dirt. */
function thump(t: number, gain: number) {
  const o = ctx!.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(110 + Math.random() * 25, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.09);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + 0.15);
  noiseBurst(t, 0.07, { type: 'lowpass', freq: 700, gain: gain * 0.7 }); // the dirt
}

// ---- Race start: a bugle fanfare -------------------------------------------

/** A brass note: sawtooth through a filter that opens as the note speaks. */
function brass(t: number, freq: number, dur: number) {
  const o = ctx!.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq * 0.97, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.04); // lip up to pitch
  const vib = ctx!.createOscillator();
  const vibGain = ctx!.createGain();
  vib.frequency.value = 5.5;
  vibGain.gain.value = freq * 0.006;
  vib.connect(vibGain).connect(o.frequency);
  const f = ctx!.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(freq * 1.5, t);
  f.frequency.linearRampToValueAtTime(freq * 6, t + 0.05);
  f.frequency.linearRampToValueAtTime(freq * 3.5, t + dur);
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
  g.gain.setValueAtTime(0.2, t + Math.max(0.04, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(master!);
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
  let t = ctx!.currentTime + 0.05;
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
  const now = ctx!.currentTime + 0.02;
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

/** A whinny: a high, shaking call that rises then falls away. */
function whinny(t: number) {
  const dur = 1.1 + Math.random() * 0.5;
  const base = 520 + Math.random() * 160;
  const o = ctx!.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(base * 0.8, t);
  o.frequency.linearRampToValueAtTime(base * 1.7, t + 0.18);
  o.frequency.linearRampToValueAtTime(base * 1.1, t + dur * 0.6);
  o.frequency.linearRampToValueAtTime(base * 0.6, t + dur);
  // The shake: fast wobble in pitch and loudness.
  const lfo = ctx!.createOscillator();
  lfo.frequency.setValueAtTime(14, t);
  lfo.frequency.linearRampToValueAtTime(24, t + dur);
  const pitchWobble = ctx!.createGain();
  pitchWobble.gain.value = base * 0.12;
  lfo.connect(pitchWobble).connect(o.frequency);
  const amp = ctx!.createGain();
  amp.gain.value = 0.5;
  const ampWobble = ctx!.createGain();
  ampWobble.gain.value = 0.45;
  lfo.connect(ampWobble).connect(amp.gain);
  // Nasal formants.
  const f1 = ctx!.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 1300; f1.Q.value = 3;
  const f2 = ctx!.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 2700; f2.Q.value = 4;
  const env = ctx!.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.5, t + 0.06);
  env.gain.setValueAtTime(0.45, t + dur * 0.7);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(amp);
  amp.connect(f1).connect(env);
  amp.connect(f2).connect(env);
  env.connect(master!);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  noiseBurst(t, dur * 0.8, { type: 'bandpass', freq: 2200, q: 2, gain: 0.05, attack: 0.05 }); // breathiness
}

/** A low nicker: a soft, rumbling chuckle. */
function nicker(t: number) {
  const dur = 0.6;
  const o = ctx!.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(140, t);
  o.frequency.linearRampToValueAtTime(110, t + dur);
  const trem = ctx!.createOscillator();
  trem.frequency.value = 11;
  const tremGain = ctx!.createGain();
  tremGain.gain.value = 0.35;
  const amp = ctx!.createGain();
  amp.gain.value = 0.4;
  trem.connect(tremGain).connect(amp.gain);
  const env = ctx!.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.6, t + 0.04);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(amp).connect(env).connect(master!);
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
        const t = ctx!.currentTime + 0.02;
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

// ---- The finish: the crowd goes wild --------------------------------------------

export function playCheer(): void {
  if (!ready()) return;
  const t = ctx!.currentTime + 0.02;
  const dur = 4.5;
  // Many voices at once: noise shaped into an "aah", swelling then fading.
  for (const [freq, q, gain] of [[750, 1.2, 0.5], [1150, 1.4, 0.35], [2500, 2, 0.15]] as const) {
    const src = ctx!.createBufferSource();
    src.buffer = noise; src.loop = true;
    const f = ctx!.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.6);
    g.gain.setValueAtTime(gain, t + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master!);
    src.start(t, Math.random()); src.stop(t + dur + 0.1);
  }
  // Whoops and whistles from the stands.
  for (let i = 0; i < 9; i++) {
    const s = t + 0.2 + Math.random() * 2.6;
    const o = ctx!.createOscillator();
    o.type = Math.random() < 0.5 ? 'sine' : 'triangle';
    const f0 = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, s);
    o.frequency.exponentialRampToValueAtTime(f0 * (1.4 + Math.random() * 0.6), s + 0.18);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.9, s + 0.45);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.07, s + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(g).connect(master!);
    o.start(s); o.stop(s + 0.55);
  }
  // Applause: lots of tiny claps.
  for (let i = 0; i < 140; i++) {
    const s = t + 0.3 + Math.random() * 3.6;
    noiseBurst(s, 0.035, { type: 'highpass', freq: 1400 + Math.random() * 1200, gain: 0.05 + Math.random() * 0.05 });
  }
}
