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
    noise = makeNoise(ctx);
    ac = ctx;
    out = master;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

const ready = () => !!ctx && !!master && enabled && ctx.state === 'running';

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
 * A whinny. What makes it a horse rather than a trumpet:
 * - two voices at once (horses really do this): a high, thin squeal and a
 *   low rough voice underneath;
 * - soft tones (sine and triangle), not a buzzy sawtooth, with lots of
 *   breath mixed in;
 * - a wobbly, uneven pitch that leaps up, shakes as it falls, then breaks
 *   into slowing "hee-hee-huh-huh" pulses;
 * - the loudness pulsing with that shake.
 */
function whinny(t: number) {
  const a = ac!;
  const dur = 1.5 + Math.random() * 0.5;
  const top = 1050 + Math.random() * 250; // peak of the squeal (Hz)
  const N = 240;
  const pitch = new Float32Array(N), low = new Float32Array(N), amp = new Float32Array(N);
  let wobble = 0, phase = 0;
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1); // 0..1 through the call
    // The shape of the call: leap up, hold and shake, then fall away.
    const contour = x < 0.12 ? 0.62 + 0.38 * (x / 0.12)
      : x < 0.55 ? 1 - 0.18 * ((x - 0.12) / 0.43)
      : 0.82 - 0.5 * ((x - 0.55) / 0.45);
    // The shake: fast at first, slowing into separate pulses at the end.
    const rate = 15 - 7 * x;
    phase += (rate * dur) / N;
    const shake = Math.sin(2 * Math.PI * phase);
    wobble += (Math.random() - 0.5) * 0.02; // a little unsteadiness
    wobble *= 0.94;
    pitch[i] = top * contour * (1 + 0.06 * shake + wobble);
    low[i] = pitch[i] * 0.36;
    // Pulsing loudness that gets choppier towards the end.
    const depth = 0.35 + 0.55 * x;
    const pulse = 1 - depth * (0.5 - 0.5 * shake);
    const env = Math.min(1, x / 0.04) * (x > 0.85 ? (1 - x) / 0.15 : 1);
    amp[i] = Math.max(0.0001, env * pulse);
  }

  const shaper = a.createGain(); // the pulsing loudness, shared by every part
  shaper.gain.value = 0;
  shaper.gain.setValueCurveAtTime(amp, t, dur);

  // The high squeal: a sine with a little triangle for edge.
  const hi = a.createOscillator(); hi.type = 'sine';
  const hi2 = a.createOscillator(); hi2.type = 'triangle';
  hi.frequency.setValueCurveAtTime(pitch, t, dur);
  hi2.frequency.setValueCurveAtTime(pitch, t, dur);
  const hiGain = a.createGain(); hiGain.gain.value = 0.32;
  const hi2Gain = a.createGain(); hi2Gain.gain.value = 0.2;
  hi.connect(hiGain).connect(shaper);
  hi2.connect(hi2Gain).connect(shaper);

  // The low rough voice underneath, softened so it doesn't buzz.
  const lo = a.createOscillator(); lo.type = 'triangle';
  lo.frequency.setValueCurveAtTime(low, t, dur);
  const loF = a.createBiquadFilter(); loF.type = 'lowpass'; loF.frequency.value = 1200; loF.Q.value = 0.5;
  const loGain = a.createGain(); loGain.gain.value = 0.22;
  lo.connect(loF).connect(loGain).connect(shaper);

  // Breath: air rushing through the nose and throat, pulsing with the call.
  const br = a.createBufferSource(); br.buffer = noise; br.loop = true;
  const brF = a.createBiquadFilter(); brF.type = 'bandpass'; brF.frequency.value = 2000; brF.Q.value = 0.45;
  const brGain = a.createGain(); brGain.gain.value = 0.5;
  br.connect(brF).connect(brGain).connect(shaper);

  // Roughness: a fast, uneven flutter (the gravel in a horse's voice).
  const rough = a.createGain(); rough.gain.value = 0.75;
  const flutter = a.createOscillator(); flutter.type = 'triangle';
  flutter.frequency.setValueAtTime(34 + Math.random() * 10, t);
  flutter.frequency.linearRampToValueAtTime(48 + Math.random() * 10, t + dur);
  const flutterDepth = a.createGain(); flutterDepth.gain.value = 0.3;
  flutter.connect(flutterDepth).connect(rough.gain);
  flutter.start(t); flutter.stop(t + dur + 0.05);

  // A gentle "nasal" colour, and nothing too shrill or too boomy.
  const nasal = a.createBiquadFilter(); nasal.type = 'peaking'; nasal.frequency.value = 1500; nasal.gain.value = 5; nasal.Q.value = 1;
  const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
  const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
  const level = a.createGain(); level.gain.value = 0.35; // about as loud as the other sounds
  shaper.connect(rough).connect(nasal).connect(hp).connect(lp).connect(level).connect(out!);

  for (const src of [hi, hi2, lo]) { src.start(t); src.stop(t + dur + 0.05); }
  br.start(t, Math.random()); br.stop(t + dur + 0.05);
  // A snort of breath to finish, as horses often do.
  noiseBurst(t + dur + 0.05, 0.16, { type: 'bandpass', freq: 600, q: 1.2, gain: 0.18, attack: 0.01, freqEnd: 380 });
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
export function renderOffline(a: BaseAudioContext, voice: 'whinny' | 'nicker' | 'snort', at: number): void {
  const prev = [ac, out, noise] as const;
  ac = a; out = a.destination; noise = makeNoise(a);
  ({ whinny, nicker, snort })[voice](at);
  [ac, out, noise] = prev;
}
