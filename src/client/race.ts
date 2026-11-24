// The digital race: a turf track with a galloping horse per lane.

import { FINISH, HORSES, isTiedAtLine } from '../shared/game';
import type { PublicState } from '../shared/protocol';

const COAT = ['#8a4b25', '#5e3a22', '#a0602f', '#3f2a1c', '#7b4a2c', '#6b3d1f'];
const MANE = ['#2e1b0f', '#1f130b', '#3a2213', '#120c07', '#2a180c', '#24150b'];

/**
 * An original side-view racehorse with its jockey, facing right. The jockey's
 * silks and the saddle cloth are in the horse's colour, with its number.
 * The legs are separate groups so CSS can make them gallop.
 */
export function horseSvg(h: number): string {
  const coat = COAT[h - 1], mane = MANE[h - 1];
  const leg = (cls: string, x: number, fill: string) => `
    <g class="leg ${cls}"><path d="M${x - 2.4} 36 L${x + 2.4} 36 L${x + 1.6} 54 L${x + 3.4} 58 L${x - 2} 58 L${x - 1.6} 54 Z" fill="${fill}"/></g>`;
  return `
  <svg class="steed steed-${h}" viewBox="0 0 100 62" aria-hidden="true">
    <g class="bob">
      ${leg('fh', 31, mane)}${leg('ff', 66, mane)}
      <path class="tail" d="M22 27 C12 25 6 31 3 43 C9 39 14 37 21 34 Z" fill="${mane}"/>
      <ellipse cx="44" cy="31" rx="25" ry="11" fill="${coat}"/>
      <path d="M60 26 L72 9 L81 13 L71 37 Z" fill="${coat}"/>
      <path d="M71 7 Q77 2 83 6 L94 15 Q97 19 92 21 L82 19 Q75 17 71 13 Z" fill="${coat}"/>
      <path d="M74 6 L76 -1 L79 5 Z" fill="${coat}"/>
      <path d="M61 25 L72 7 L69 6 L58 23 Z" fill="${mane}"/>
      <circle cx="81" cy="10" r="1.1" fill="#111"/>
      ${leg('nh', 26, coat)}${leg('nf', 61, coat)}
      <rect class="cloth" x="35" y="25" width="17" height="14" rx="2"/>
      <text class="cloth-num" x="43.5" y="35.6" text-anchor="middle">${h}</text>
      <path class="silk" d="M41 24 L46 11 Q51 8 55 12 L52 22 Z"/>
      <path class="silk" d="M51 13 L62 19 L60 21.5 L50 17 Z"/>
      <path d="M43 21 L56 24 L54 27.5 L42 25 Z" fill="#f4f1ea"/>
      <path d="M54 24.5 L57.5 25.5 L54.5 32 L52 31 Z" fill="#1c1c1c"/>
      <circle cx="56" cy="8" r="3.6" fill="#e9b48a"/>
      <path class="silk" d="M52.3 7.6 A3.8 3.8 0 0 1 59.8 7 L61.5 7.6 L52.3 8.4 Z"/>
    </g>
  </svg>`;
}

/** The track; `running` makes the horses gallop. */
export function track(s: PublicState, opts: { big?: boolean } = {}): string {
  const running = s.phase === 'racing' && !s.winner;
  const lead = Math.max(...s.positions);
  const marks = Array.from({ length: FINISH }, (_, i) => `<span>${i + 1}</span>`).join('');
  const lanes = s.positions.map((pos, i) => {
    const h = i + 1;
    const pct = (Math.min(pos, FINISH) / FINISH) * 100;
    const won = s.winner === h;
    return `
      <div class="lane h${h}-lane ${won ? 'won' : ''} ${pos === lead && pos > 0 && !s.winner ? 'leading' : ''}">
        <span class="gate h${h}">${h}</span>
        <div class="turf">
          <div class="runner" style="left: calc(${pct}% - ${pct / 100} * var(--steed-w))">${horseSvg(h)}</div>
        </div>
        <span class="lane-pos">${pos}</span>
      </div>`;
  }).join('');
  return `
    <div class="track ${opts.big ? 'large' : ''} ${running ? 'running' : ''}">
      <div class="ruler"><span class="gate-sp"></span><div class="marks">${marks}</div><span class="lane-pos"></span></div>
      ${lanes}
    </div>`;
}

export function dice(roll: number[] | null, big = false): string {
  if (!roll) return `<div class="dice ${big ? 'large' : ''} muted">Roll to start the race</div>`;
  return `<div class="dice ${big ? 'large' : ''}">${roll.map((d) => `<span class="die h${d}">${d}</span>`).join('')}</div>`;
}

export function raceStatus(s: PublicState): string {
  if (s.winner) return `<div class="banner h${s.winner}-bg">Horse ${s.winner} wins!</div>`;
  if (isTiedAtLine(s.positions)) return '<div class="banner warn">Photo finish! Tied at the line, keep rolling…</div>';
  return '';
}

export const HORSE_NUMBERS = Array.from({ length: HORSES }, (_, i) => i + 1);
