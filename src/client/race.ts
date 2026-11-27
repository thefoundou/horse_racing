// The digital race: a turf track with a galloping horse per lane.

import { FINISH, HORSES, sum } from '../shared/game';
import type { PublicState } from '../shared/protocol';
import type { Outfit, Runner } from '../shared/lineup';
import { avatar, esc, oddsText } from './ui';

const COAT = ['#8a4b25', '#5e3a22', '#a0602f', '#3f2a1c', '#7b4a2c', '#6b3d1f'];
const MANE = ['#2e1b0f', '#1f130b', '#3a2213', '#120c07', '#2a180c', '#24150b'];

/** Horse coats for the lineup: [coat, mane]. */
const COATS: [string, string][] = [
  ['#8a4b25', '#2e1b0f'], // bay
  ['#a8632e', '#6b3416'], // chestnut
  ['#2f2620', '#120c07'], // black
  ['#a7a39b', '#5f5b55'], // grey
  ['#d6a64c', '#f4e6bf'], // palomino
  ['#5e3a22', '#1f130b'], // dark bay
];

/** Jockeys in fancy dress wear their own colours, not the horse's silks. */
const OUTFIT_SILK: Partial<Record<Outfit, string>> = { santa: '#c8102e', bunny: '#f4c6d6', chef: '#f4f1ea', wizard: '#5b3a8c' };

/** Headgear for each outfit, drawn over the jockey's head (centred at 56,8). */
function hat(outfit: Outfit, silk: string): string {
  const helmet = `<path ${silk} d="M52.3 7.6 A3.8 3.8 0 0 1 59.8 7 L61.5 7.6 L52.3 8.4 Z"/>`;
  switch (outfit) {
    case 'santa': return `
      <path d="M54 9.5 Q57 15 60 9.6 Z" fill="#fff"/>
      <path d="M52 7.8 Q54.5 1 62 -1.5 L60.6 1.6 Q58.6 4 60.2 7.4 Z" fill="#c8102e"/>
      <path d="M51.6 8.8 L60.8 7.8 L60.6 6.3 L51.4 7.3 Z" fill="#fff"/><circle cx="62.2" cy="-1.4" r="1.4" fill="#fff"/>`;
    case 'bunny': return `${helmet}
      <ellipse cx="54.6" cy="0.6" rx="1.4" ry="5" fill="#fff" stroke="#e8b4c4" stroke-width="0.4" transform="rotate(-14 54.6 0.6)"/>
      <ellipse cx="54.6" cy="0.8" rx="0.6" ry="3.6" fill="#f4a6bd" transform="rotate(-14 54.6 0.8)"/>
      <ellipse cx="57.8" cy="0.4" rx="1.4" ry="5" fill="#fff" stroke="#e8b4c4" stroke-width="0.4" transform="rotate(10 57.8 0.4)"/>
      <ellipse cx="57.8" cy="0.6" rx="0.6" ry="3.6" fill="#f4a6bd" transform="rotate(10 57.8 0.6)"/>`;
    case 'cowboy': return `
      <path d="M53.2 6.4 Q53.4 1.6 56.2 1.9 Q58.9 1.6 59.2 6.2 Z" fill="#7a4a24"/>
      <ellipse cx="56.2" cy="6.5" rx="6.4" ry="1.3" fill="#5e3818"/><path d="M53.3 5 L59.1 4.8 L59.1 5.8 L53.3 6 Z" fill="#2b1a0c"/>`;
    case 'tophat': return `
      <rect x="53.2" y="-2.6" width="6" height="8.6" fill="#141414"/><rect x="53.2" y="3.4" width="6" height="1.3" fill="#c8442f"/>
      <rect x="51" y="5.6" width="10.4" height="1.3" rx="0.6" fill="#141414"/>`;
    case 'crown': return `
      <path d="M52.2 6.8 L52.4 1.4 L54.4 4 L56.2 0.4 L58 4 L60 1.4 L60.2 6.8 Z" fill="#e3a92b" stroke="#a87512" stroke-width="0.4"/>
      <circle cx="56.2" cy="5.2" r="0.8" fill="#c8102e"/><circle cx="53.6" cy="5.6" r="0.5" fill="#2f5d8a"/><circle cx="58.8" cy="5.6" r="0.5" fill="#3f7d4a"/>`;
    case 'pirate': return `
      <path d="M50.2 7 Q56 0.6 62.2 7 Q56 4.4 50.2 7 Z" fill="#141414"/><circle cx="56.2" cy="4.6" r="0.8" fill="#fff"/>
      <path d="M57 7.4 L59.4 10.4" stroke="#141414" stroke-width="0.5"/><circle cx="58.2" cy="8.6" r="0.9" fill="#141414"/>`;
    case 'chef': return `
      <path d="M53 7.2 L53 1.6 Q51.2 -1 53.8 -2.2 Q56 -4.6 58.4 -2.2 Q61 -1 59.4 1.6 L59.4 7 Z" fill="#fff" stroke="#cfc6b4" stroke-width="0.4"/>`;
    case 'viking': return `
      <path d="M52.2 7.8 A3.9 3.9 0 0 1 60 7.4 Z" fill="#9aa0a6"/>
      <path d="M52.8 5.6 Q50 4.2 50.6 0.4 Q51.6 3.4 53.6 4.2 Z" fill="#f1e6c8"/>
      <path d="M59.4 5.2 Q62.2 3.6 61.6 -0.2 Q60.8 2.8 58.6 3.8 Z" fill="#f1e6c8"/>`;
    case 'wizard': return `
      <path d="M52 7.8 L56.4 -7 L60.6 7.4 Z" fill="#5b3a8c"/><ellipse cx="56.3" cy="7.6" rx="5.4" ry="1.1" fill="#4a2e73"/>
      <path d="M56.6 0.4 l0.5 1 1.1 0.2 -0.8 0.8 0.2 1.1 -1 -0.5 -1 0.5 0.2 -1.1 -0.8 -0.8 1.1 -0.2 Z" fill="#e3a92b"/>`;
    default: return helmet;
  }
}

/**
 * An original side-view racehorse with its jockey, facing right. The jockey's
 * silks and the saddle cloth are in the horse's colour, with its number.
 * The legs are separate groups so CSS can make them gallop. With a runner
 * from the round's lineup, it may be a different animal (a zebra, giraffe,
 * donkey, cow or unicorn) and the jockey may be in fancy dress.
 */
export function horseSvg(h: number, runner?: Runner | null): string {
  const animal = runner?.animal ?? 'horse', outfit = runner?.outfit ?? 'silks';
  const uid = `${h}${animal[0]}${runner?.coat ?? 'd'}`;
  let [coat, mane] = runner ? COATS[runner.coat % COATS.length] : [COAT[h - 1], MANE[h - 1]];
  let muzzle = '#f6f1e4';
  if (animal === 'zebra') [coat, mane] = ['#f4f1ea', '#1b1b1b'];
  if (animal === 'giraffe') [coat, mane] = ['#e3b459', '#7b4a1e'];
  if (animal === 'donkey') [coat, mane, muzzle] = ['#8e867a', '#3f3a34', '#ddd5c8'];
  if (animal === 'cow') [coat, mane, muzzle] = ['#f5f2ec', '#2a2a2a', '#e8a0a8'];
  if (animal === 'unicorn') [coat, mane] = ['#fbf8f2', `url(#rb-${uid})`];
  const silkFill = OUTFIT_SILK[outfit] ? `class="silk" style="fill:${OUTFIT_SILK[outfit]}"` : 'class="silk"';
  const leg = (cls: string, x: number, fill: string) => `
    <g class="leg ${cls}"><path d="M${x - 2.4} 36 L${x + 2.4} 36 L${x + 1.6} 54 L${x + 3.4} 58 L${x - 2} 58 L${x - 1.6} 54 Z" fill="${fill}"/></g>`;
  const farLeg = animal === 'zebra' || animal === 'cow' || animal === 'unicorn' ? coat : mane;

  // A giraffe's neck is much longer: its head sits higher up.
  const giraffe = animal === 'giraffe';
  const neck = giraffe ? 'M60 26 L67 -9 L77 -5 L71 37 Z' : 'M60 26 L72 9 L81 13 L71 37 Z';
  const headAt = giraffe ? ' transform="translate(-4 -17)"' : '';
  const ear = animal === 'donkey' ? 'M73 6 L71.5 -9 L76.5 -8.5 L78 5 Z'
    : giraffe ? '' : 'M74 6 L76 -1 L79 5 Z';
  const headShape = 'M71 7 Q77 2 83 6 L94 15 Q97 19 92 21 L82 19 Q75 17 71 13 Z';

  // Markings, clipped to the animal's body, neck and head.
  const clip = `<clipPath id="cl-${uid}"><ellipse cx="44" cy="31" rx="25" ry="11"/><path d="${neck}"/><path d="${headShape}"${headAt}/></clipPath>`;
  let marks = '';
  if (animal === 'zebra') {
    marks = Array.from({ length: 16 }, (_, i) => `<path d="M${18 + i * 5} -24 l-5 64 l2.6 0 l5 -64 Z"/>`).join('');
    marks = `<g clip-path="url(#cl-${uid})" fill="#1b1b1b">${marks}</g>`;
  } else if (giraffe) {
    const spots = [[30, 27], [40, 33], [50, 27], [36, 22], [56, 34], [26, 34], [64, 22], [68, 10], [66, -2], [70, 30], [46, 38], [60, 14]];
    marks = `<g clip-path="url(#cl-${uid})" fill="#8a5524">${spots.map(([x, y]) => `<path d="M${x} ${y} l3.4 -1.6 l2.6 2.2 l-0.6 3.4 l-3.4 1 l-2.4 -2.2 Z"/>`).join('')}</g>`;
  } else if (animal === 'cow') {
    marks = `<g clip-path="url(#cl-${uid})" fill="#2a2a2a"><ellipse cx="34" cy="27" rx="6" ry="4.4"/><ellipse cx="52" cy="35" rx="5" ry="3.6"/><ellipse cx="66" cy="18" rx="3" ry="4"/><ellipse cx="22" cy="34" rx="3" ry="2.4"/></g>`;
  }
  const extras = animal === 'unicorn'
    ? `<path d="M79 5 L85.5 -11 L82.6 6 Z" fill="#e3a92b" stroke="#b07d14" stroke-width="0.4"/><path d="M80.4 2 L83.2 1 M81 -1.6 L84 -2.6 M81.8 -5.2 L84.6 -6" stroke="#b07d14" stroke-width="0.4"/>`
    : animal === 'cow' ? '<path d="M74.5 5.5 Q72.6 1 75.6 0 Q74.6 2.6 76.2 5 Z" fill="#efe3c2"/><path d="M78.4 5.4 Q78.8 0.8 82 0.6 Q79.8 2.4 80 5.2 Z" fill="#efe3c2"/>'
    : giraffe ? '<path d="M75 4 L74.4 -1.6" stroke="#7b4a1e" stroke-width="1.2"/><circle cx="74.4" cy="-2" r="1" fill="#4a2c10"/><path d="M78 4 L78.4 -1.6" stroke="#7b4a1e" stroke-width="1.2"/><circle cx="78.4" cy="-2" r="1" fill="#4a2c10"/>'
    : '';
  const rainbow = animal === 'unicorn'
    ? `<linearGradient id="rb-${uid}" x1="0" y1="0" x2="1" y2="1">${['#e8473f', '#f39a2b', '#f5d33f', '#58b85c', '#3f8fd6', '#8a5ac8'].map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/>`).join('')}</linearGradient>`
    : '';

  return `
  <svg class="steed steed-${h} animal-${animal} outfit-${outfit}" viewBox="0 0 100 62" aria-hidden="true">
    <defs>${clip}${rainbow}</defs>
    <g class="bob">
      ${leg('fh', 31, farLeg)}${leg('ff', 66, farLeg)}
      <path class="tail" d="M22 27 C12 25 6 31 3 43 C9 39 14 37 21 34 Z" fill="${mane}"/>
      <ellipse cx="44" cy="31" rx="25" ry="11" fill="${coat}"/>
      <path d="${neck}" fill="${coat}"/>
      <g${headAt}>
        <path d="${headShape}" fill="${coat}"/>
        ${ear ? `<path d="${ear}" fill="${coat}"/>` : ''}
        <path d="M84 8.5 L92 15.5 Q93.5 17.5 91.5 18 L86.5 12.5 Z" fill="${muzzle}" opacity="0.9"/>
        <circle cx="81" cy="10" r="1.1" fill="#111"/>
        ${extras}
      </g>
      ${marks}
      <path d="M24 28 Q40 19 62 24 Q46 23 28 31 Z" fill="#fff" opacity="0.16"/>
      ${giraffe ? '<path d="M61 25 L67.4 -8 L66 -8.4 L58.6 23 Z" fill="#7b4a1e"/>' : '<path d="M61 25 L72 7 L69 6 L58 23 Z" fill="' + mane + '"/>'}
      ${leg('nh', 26, coat)}${leg('nf', 61, coat)}
      <rect class="cloth" x="35" y="25" width="17" height="14" rx="2"/>
      <text class="cloth-num" x="43.5" y="35.6" text-anchor="middle">${h}</text>
      <path ${silkFill} d="M41 24 L46 11 Q51 8 55 12 L52 22 Z"/>
      <path ${silkFill} d="M51 13 L62 19 L60 21.5 L50 17 Z"/>
      ${outfit === 'santa' ? '<path d="M42.2 21.6 L53.4 22.8 L53 24.2 L41.8 23 Z" fill="#fff"/>' : ''}
      <path d="M43 21 L56 24 L54 27.5 L42 25 Z" fill="#f4f1ea"/>
      <path d="M54 24.5 L57.5 25.5 L54.5 32 L52 31 Z" fill="#1c1c1c"/>
      <circle cx="56" cy="8" r="3.6" fill="#e9b48a"/>
      ${outfit === 'silks' ? hat(outfit, silkFill) : `<g transform="translate(56 9) scale(1.5) translate(-56 -9)">${hat(outfit, silkFill)}</g>`}
    </g>
  </svg>`;
}

/** The track; `running` makes the horses gallop. */
/** Where a runner sits for a position: 0 at the gate, the nose on the line at FINISH. */
/** Where a runner sits: `pos` squares past the start, so its nose is on the far edge of space `pos`. */
const runnerLeft = (pos: number) => `calc(var(--follow-w) + ${Math.min(pos, FINISH)} * var(--unit))`;

/** The photos of everyone who backed a horse, biggest stake nearest the horse. All of them, however many. */
function followers(s: PublicState, h: number): string {
  const backers = s.players
    .filter((p) => p.playing && (p.bets?.[h - 1] ?? 0) > 0)
    .sort((a, b) => (b.bets![h - 1] - a.bets![h - 1]) || a.name.localeCompare(b.name));
  if (!backers.length) return '';
  return `<div class="followers" style="--n:${backers.length}" aria-label="Backed by ${esc(backers.map((p) => p.name).join(', '))}">${
    backers.map((p, k) => `<span class="follower" style="--k:${k}">${avatar(s.code, p)}</span>`).join('')
  }</div>`;
}

/**
 * The track; `running` makes the horses gallop. Pass `from` (the positions
 * before the latest roll) and each runner is drawn there with its target in
 * data-to; slideRunners() then moves them so they glide instead of jumping.
 */
export function track(
  s: PublicState,
  opts: { big?: boolean; from?: number[] | null; followers?: boolean; mine?: number[] | null; zoomOn?: number[] | null } = {},
): string {
  const running = s.phase === 'racing' && !s.winner;
  const lead = Math.max(...s.positions);
  const marks = '<span class="start-label">Start</span>' + Array.from({ length: FINISH }, (_, i) => `<span>${i + 1}</span>`).join('');
  // Each horse's odds (pool ÷ money on it), known once betting has closed.
  const pool = s.totals ? sum(s.totals) : 0;
  const odds = (i: number) => (s.totals && s.totals[i] > 0 ? oddsText(pool / s.totals[i]) : '—');
  const lanes = s.positions.map((pos, i) => {
    const h = i + 1;
    const from = opts.from?.[i] ?? pos;
    const won = s.winner === h;
    return `
      <div class="lane h${h}-lane ${won ? 'won' : ''} ${pos === lead && pos > 0 && !s.winner ? 'leading' : ''} ${(opts.mine?.[i] ?? 0) > 0 ? 'mine' : ''}">
        <span class="gate h${h}">${h}</span>
        <div class="turf">
          <div class="runner" style="left: ${runnerLeft(from)}; --pos: ${Math.min(from, pos, FINISH)}"${from !== pos ? ` data-to="${runnerLeft(pos)}"` : ''}>${opts.followers ? followers(s, h) : ''}${horseSvg(h, s.lineup?.[i])}</div>
        </div>
        <span class="lane-pos">${pos}</span>
        <span class="lane-odds" title="Odds for horse ${h}">${odds(i)}</span>
      </div>`;
  }).join('');
  // Zooming in on a photo finish: frame the finish line and every horse in the photo.
  const zoom = opts.zoomOn?.length ? opts.zoomOn : null;
  let zoomStyle = '';
  if (zoom) {
    const lane = 92 / HORSES; // each lane's share of the track's height, in %, below an 8% ruler
    const top = 8 + (Math.min(...zoom) - 1) * lane, bottom = 8 + Math.max(...zoom) * lane;
    const k = Math.max(1.6, Math.min(3.4, 92 / (bottom - top + 10))); // as close as fits them all
    // With transform-origin o and scale k, the middle of the view lands on o + (50 - o) / k:
    // choose o so that's the finish line (88% across) and the horses' midpoint, kept far
    // enough from the edges that the view never runs off the track.
    const origin = (target: number) => {
      const t = Math.max(50 / k, Math.min(100 - 50 / k, target));
      return (t * k - 50) / (k - 1);
    };
    zoomStyle = ` style="--zx:${origin(88).toFixed(1)}%; --zy:${origin((top + bottom) / 2).toFixed(1)}%; --zk:${k.toFixed(2)}"`;
  }
  const html = `
    <div class="track ${opts.big ? 'large' : ''} ${opts.followers ? 'followers-on' : ''} ${running ? 'running' : ''} ${zoom ? 'pf-zoom' : ''}"${zoomStyle}>
      <div class="ruler"><span class="gate-sp"></span><div class="marks">${marks}</div><span class="lane-pos"></span><span class="lane-odds">Odds</span></div>
      ${lanes}
    </div>`;
  return zoom ? `<div class="zoom-frame">${html}<div class="zoom-vignette" aria-hidden="true"><span>📸 Photo finish!</span></div></div>` : html;
}

/** Start the slides set up by track({ from }); call right after rendering. */
export function slideRunners(root: ParentNode): void {
  const runners = [...root.querySelectorAll<HTMLElement>('.runner[data-to]')];
  if (!runners.length) return;
  runners[0].getBoundingClientRect(); // commit the start position first
  requestAnimationFrame(() => runners.forEach((el) => {
    el.classList.add('moving'); // bounces while it slides
    el.style.left = el.dataset.to!;
    el.addEventListener('transitionend', () => el.classList.remove('moving'), { once: true });
  }));
}

export function dice(roll: number[] | null, big = false): string {
  if (!roll) return `<div class="dice ${big ? 'large' : ''} muted">Roll to start the race</div>`;
  return `<div class="dice ${big ? 'large' : ''}">${roll.map((d) => `<span class="die h${d}">${d}</span>`).join('')}</div>`;
}

export function raceStatus(s: PublicState): string {
  if (s.winner) return `<div class="banner h${s.winner}-bg">Horse ${s.winner} wins!</div>`;
  if (s.photo) return '<div class="banner warn">📸 Photo finish!</div>';
  return '';
}

const listOr = (xs: number[]) => xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;
const listAnd = (xs: number[]) => xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * The photo finish, up close: the horses that hit the line together, neck and
 * neck, with camera flashes. One die at a time decides it; once it shows one
 * of them, that horse surges ahead and the others blow up.
 */
export function photoFinish(
  s: PublicState,
  opts: { big?: boolean; mine?: number[] | null; intro?: boolean; rolling?: 'shake' | 'bounce' | null } = {},
): string {
  const pf = s.photo!;
  // While the latest die is still being shaken and thrown, the result stays secret.
  const rolls = opts.rolling ? pf.rolls.slice(0, -1) : pf.rolls;
  const w = !opts.rolling && s.winner && pf.horses.includes(s.winner) ? s.winner : null;
  const last = rolls[rolls.length - 1] ?? null;
  const caption = opts.rolling === 'shake' ? `Shaking the die… <b>needs a ${listOr(pf.horses)}!</b>`
    : opts.rolling === 'bounce' ? 'Rolling… <b>come on…</b>'
    : w ? `Rolled a ${w}! <b>Horse ${w} wins by a nose!</b>`
    : last ? `Rolled a ${last}: not in the photo. <b>Roll again!</b>`
    : `Horses ${listAnd(pf.horses)} hit the line together! <b>One die decides it: a ${listOr(pf.horses)} wins.</b>`;
  // The die tray: shaking, bouncing, or showing where it landed.
  const tray = opts.rolling
    ? `<span class="die pf-die ${opts.rolling} h1">?</span>`
    : last ? `<span class="die pf-die landed h${last} ${pf.horses.includes(last) ? 'hit' : 'miss'}">${last}</span>`
    : '<span class="die pf-die idle">?</span>';
  const dust = Array.from({ length: 5 }, (_, k) => `<i style="--d:${(0.25 + k * 0.35).toFixed(2)}s; --x:${-k * 4}cqw"></i>`).join('');
  const debris = Array.from({ length: 12 }, (_, k) => `<i style="--a:${k * 30 + (k % 3) * 9}deg; --d:${0.7 + (k % 4) * 0.22}"></i>`).join('');
  const lanes = pf.horses.map((h, i) => {
    const state = w === null ? '' : h === w ? 'pf-win' : 'pf-lose';
    return `
      <div class="pf-lane ${state} ${(opts.mine?.[h - 1] ?? 0) > 0 ? 'mine' : ''}" style="--i:${i}">
        <span class="gate h${h}">${h}</span>
        <span class="lane-odds pf-odds">${s.totals && s.totals[h - 1] > 0 ? oddsText(sum(s.totals) / s.totals[h - 1]) : '—'}</span>
        <div class="pf-runner">${horseSvg(h, s.lineup?.[h - 1])}</div>
        ${state === 'pf-lose' ? `<div class="pf-dust" aria-hidden="true">${dust}</div><div class="pf-boom" aria-hidden="true"><span>💥</span>${debris}</div>` : ''}
      </div>`;
  }).join('');
  const tries = rolls.map((d) =>
    `<span class="die h${d} ${pf.horses.includes(d) ? '' : 'miss'}" style="animation:none">${d}</span>`).join('');
  return `
    <div class="photo-finish ${opts.big ? 'large' : ''} ${w ? 'decided' : ''} ${opts.intro ? 'intro' : ''} ${opts.rolling ? 'rolling' : ''}" role="group" aria-label="Photo finish">
      <div class="pf-flash" aria-hidden="true"></div>
      <div class="pf-bulbs" aria-hidden="true">${'<i></i>'.repeat(6)}</div>
      <div class="pf-title">📸 Photo finish!</div>
      <div class="pf-stage running ${pf.horses.some((h) => s.lineup?.[h - 1]?.animal === 'giraffe') ? 'tall' : ''}">
        <div class="pf-line" aria-hidden="true"></div>
        ${lanes}
      </div>
      <p class="pf-caption" aria-live="polite">${caption}</p>
      ${opts.intro ? '' : `<div class="pf-tray" aria-hidden="true">${tray}</div>`}
      ${tries ? `<div class="dice pf-tries">${tries}</div>` : ''}
    </div>`;
}

export const HORSE_NUMBERS = Array.from({ length: HORSES }, (_, i) => i + 1);
