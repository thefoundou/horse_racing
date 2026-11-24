// End-of-round celebration: the biggest winner (laurels, sunburst, confetti)
// and the biggest loser (a rain cloud), award badges, and a leaderboard that
// slides in in the old order and then shuffles into the new one.

import { rankChanges, type Award, type RoundAwards, type Spotlight } from '../shared/awards';
import type { PublicState } from '../shared/protocol';
import { avatar, cls, esc, money } from './ui';

const CONFETTI = ['#c8442f', '#e3a92b', '#2f5d8a', '#3f7d4a', '#f6f1e4'];

/** A laurel wreath: two branches of leaves curving up from the bottom. */
function laurels(): string {
  const leaf = (deg: number, r: number, tilt: number, mirror: boolean) => {
    const a = (deg * Math.PI) / 180;
    let x = 100 + r * Math.cos(a);
    const y = 100 + r * Math.sin(a);
    let rot = deg + 90 + tilt; // along the branch, angled outwards
    if (mirror) { x = 200 - x; rot = 180 - rot; }
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="12" ry="5" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  };
  const branch = (mirror: boolean) => Array.from({ length: 9 }, (_, i) => {
    const deg = 104 + i * 16; // from the bottom, round the left side, towards the top
    return leaf(deg, 88, 35, mirror) + leaf(deg + 8, 76, -35, mirror);
  }).join('');
  const stem = (mirror: boolean) => `<path d="M92 182 A82 82 0 0 1 24 70"${mirror ? ' transform="matrix(-1 0 0 1 200 0)"' : ''} fill="none" stroke="#9c7520" stroke-width="2.5"/>`;
  return `<svg class="laurels" viewBox="0 0 200 200" aria-hidden="true">${stem(false)}${stem(true)}<g fill="#b8862a">${branch(false)}${branch(true)}</g></svg>`;
}

function sunburst(): string {
  const rays = Array.from({ length: 18 }, (_, i) => {
    const a = (i * 20 * Math.PI) / 180, b = ((i * 20 + 10) * Math.PI) / 180;
    return `<path d="M100 100 L${100 + 140 * Math.cos(a)} ${100 + 140 * Math.sin(a)} L${100 + 140 * Math.cos(b)} ${100 + 140 * Math.sin(b)} Z"/>`;
  }).join('');
  return `<svg class="sunburst" viewBox="0 0 200 200" aria-hidden="true"><g fill="#fff" opacity="0.28">${rays}</g></svg>`;
}

function raincloud(): string {
  const drops = Array.from({ length: 7 }, (_, i) =>
    `<line class="drop" x1="${44 + i * 18}" y1="66" x2="${40 + i * 18}" y2="80" style="animation-delay:${(i * 0.17).toFixed(2)}s"/>`).join('');
  return `
    <svg class="raincloud" viewBox="0 0 200 120" aria-hidden="true">
      <g class="drops" stroke="#5b8db3" stroke-width="4" stroke-linecap="round">${drops}</g>
      <g fill="#7d8a91"><circle cx="70" cy="48" r="24"/><circle cx="102" cy="36" r="30"/><circle cx="136" cy="50" r="22"/><rect x="50" y="46" width="106" height="24" rx="12"/></g>
    </svg>`;
}

function confetti(): string {
  return `<div class="confetti" aria-hidden="true">${Array.from({ length: 22 }, (_, i) => {
    const left = (i * 37) % 100, delay = ((i * 0.23) % 2.4).toFixed(2), dur = (2.4 + (i % 5) * 0.35).toFixed(2);
    return `<i style="left:${left}%;background:${CONFETTI[i % CONFETTI.length]};animation-delay:-${delay}s;animation-duration:${dur}s"></i>`;
  }).join('')}</div>`;
}

function spotCard(s: PublicState, spot: Spotlight, kind: 'best' | 'worst', large: boolean): string {
  const best = kind === 'best';
  return `
    <div class="spot ${kind} ${large ? 'large' : ''}">
      ${best ? sunburst() + confetti() : ''}
      <div class="spot-face">
        ${best ? laurels() : raincloud()}
        ${avatar(s.code, spot.player, 'spot-avatar')}
      </div>
      <div class="spot-text">
        <div class="spot-label">${best ? '🏆 Biggest winner' : '☔ Biggest loser'}</div>
        <div class="spot-name">${esc(spot.player.name)}</div>
        <div class="spot-net">${money(spot.net, true)}</div>
        <div class="spot-quip">${best ? 'Drinks are on them!' : 'Better luck next race…'}</div>
      </div>
    </div>`;
}

export function spotlight(s: PublicState, r: RoundAwards, large = false): string {
  if (!r.best && !r.worst) return '';
  return `<div class="spotlight">${r.best ? spotCard(s, r.best, 'best', large) : ''}${r.worst ? spotCard(s, r.worst, 'worst', large) : ''}</div>`;
}

export function awardChips(s: PublicState, awards: Award[], opts: { only?: string; large?: boolean } = {}): string {
  const list = opts.only ? awards.filter((a) => a.playerId === opts.only) : awards;
  if (!list.length) return '';
  return `<div class="award-chips ${opts.large ? 'large' : ''}">${list.map((a, i) => {
    const p = s.players.find((x) => x.id === a.playerId);
    if (!p) return '';
    return `
      <div class="award ${a.tone}" style="--i:${i}">
        <span class="award-emoji" aria-hidden="true">${a.emoji}</span>
        ${opts.only ? '' : avatar(s.code, p)}
        <span class="award-text"><b>${a.title}</b><span>${opts.only ? '' : `${esc(p.name)} · `}${a.detail}</span></span>
      </div>`;
  }).join('')}</div>`;
}

/**
 * The leaderboard after a round. With `animate`, rows slide in from the left
 * in the old order, then move to their new places while the balances count
 * up or down (see runCountUps).
 */
export function liveLeaderboard(s: PublicState, you: string, opts: { animate: boolean; large?: boolean }): string {
  const { before, after } = rankChanges(s);
  const order = (m: Map<string, number>) => s.players.slice().sort((a, b) => (m.get(a.id)! - m.get(b.id)!) || a.name.localeCompare(b.name));
  const oldIndex = new Map(order(before).map((p, i) => [p.id, i]));
  const rows = order(after).map((p, i) => {
    const last = p.history[p.history.length - 1];
    const moved = before.get(p.id)! - after.get(p.id)!;
    const arrow = moved > 0 ? `<span class="move up">▲${moved}</span>` : moved < 0 ? `<span class="move down">▼${-moved}</span>` : '<span class="move">–</span>';
    const prevBal = p.balance - (last ?? 0);
    return `
      <li class="${p.id === you ? 'me' : ''}" style="--i:${oldIndex.get(p.id)};--n:${i};--shift:${oldIndex.get(p.id)! - i}">
        <span class="rank">${after.get(p.id)! + 1}</span>
        ${avatar(s.code, p)}
        <span class="name">${esc(p.name)}</span>
        ${arrow}
        <span class="delta ${cls(last ?? 0)}">${last == null ? '–' : money(last, true)}</span>
        <span class="bal"${opts.animate ? ` data-count-from="${prevBal}" data-count-to="${p.balance}"` : ''}>${money(opts.animate ? prevBal : p.balance)}</span>
      </li>`;
  }).join('');
  return `<ol class="leaders ${opts.animate ? 'live' : ''} ${opts.large ? 'large' : ''}" style="--rows:${s.players.length}">${rows}</ol>`;
}

/** Count balances from their old value to the new one once the rows have moved. */
export function runCountUps(root: ParentNode, rows: number): void {
  const els = [...root.querySelectorAll<HTMLElement>('[data-count-to]')];
  const start = performance.now() + 700 + rows * 90;
  const dur = 1100;
  const tick = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / dur));
    const e = 1 - (1 - t) ** 3;
    for (const el of els) {
      if (!el.isConnected) continue;
      const a = Number(el.dataset.countFrom), b = Number(el.dataset.countTo);
      el.textContent = money(a + (b - a) * e);
    }
    if (t < 1 && els.some((el) => el.isConnected)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
