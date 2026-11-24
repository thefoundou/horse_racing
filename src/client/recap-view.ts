// End of game: a podium for the top three, the game's biggest moments as
// cards, and the final leaderboard.

import { START_BALANCE } from '../shared/game';
import type { PublicPlayer, PublicState } from '../shared/protocol';
import type { GameRecap, Moment } from '../shared/recap';
import { horseSvg } from './race';
import { avatar, cls, esc, money } from './ui';

const PLACE = ['1st', '2nd', '3rd'];

export function podium(s: PublicState, recap: GameRecap, opts: { animate: boolean; large?: boolean }): string {
  const top = recap.ranked.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top[i]); // 2nd, 1st, 3rd
  return `
    <div class="podium ${opts.large ? 'large' : ''} ${opts.animate ? 'animate' : ''}">
      ${order.map((i) => {
        const p = top[i];
        return `
          <div class="place place-${i + 1}" style="--d:${[2, 1, 0][i]}">
            ${i === 0 ? '<div class="crown" aria-hidden="true">👑</div>' : ''}
            ${avatar(s.code, p, 'podium-avatar')}
            <div class="place-name">${esc(p.name)}</div>
            <div class="place-bal">${money(p.balance)}</div>
            <div class="plinth"><span>${PLACE[i]}</span></div>
          </div>`;
      }).join('')}
    </div>`;
}

export function gameStats(recap: GameRecap): string {
  const { rounds, wagered, digital, manual } = recap.stats;
  const races = [digital && `${digital} digital`, manual && `${manual} manual`].filter(Boolean).join(' · ');
  return `
    <div class="game-stats">
      <div><b>${rounds}</b><span>${rounds === 1 ? 'race' : 'races'}</span></div>
      <div><b>${money(wagered)}</b><span>wagered</span></div>
      <div><b>${recap.ranked.length}</b><span>players</span></div>
      ${races ? `<div><b>${races}</b><span>race modes</span></div>` : ''}
    </div>`;
}

function momentCard(s: PublicState, m: Moment, i: number, animate: boolean): string {
  const people = m.playerIds.map((id) => s.players.find((p) => p.id === id)).filter((p): p is PublicPlayer => !!p);
  const who = people.length
    ? `<div class="moment-who">${people.slice(0, 4).map((p) => avatar(s.code, p)).join('')}</div>`
    : m.horse ? `<div class="moment-horse">${horseSvg(m.horse)}</div>` : '';
  return `
    <div class="moment ${m.tone} ${animate ? 'animate' : ''}" style="--i:${i}">
      <div class="moment-top"><span class="moment-emoji" aria-hidden="true">${m.emoji}</span><span class="moment-title">${m.title}</span></div>
      ${who}
      <div class="moment-headline">${esc(m.headline)}</div>
      <div class="moment-detail">${esc(m.detail)}</div>
    </div>`;
}

export function moments(s: PublicState, list: Moment[], opts: { animate: boolean }): string {
  if (!list.length) return '';
  return `<div class="moments">${list.map((m, i) => momentCard(s, m, i, opts.animate)).join('')}</div>`;
}

/** Final standings with each player's profit or loss over the whole game. */
export function finalLeaderboard(s: PublicState, recap: GameRecap, you: string, large = false): string {
  let rank = 0, prev = Infinity;
  return `<ol class="leaders final ${large ? 'large' : ''}">${recap.ranked.map((p, i) => {
    if (p.balance < prev - 1e-9) { rank = i + 1; prev = p.balance; }
    const profit = p.balance - START_BALANCE;
    return `
      <li class="${p.id === you ? 'me' : ''}">
        <span class="rank">${rank}</span>
        ${avatar(s.code, p)}
        <span class="name">${esc(p.name)}</span>
        <span class="delta ${cls(profit)}">${money(profit, true)}</span>
        <span class="bal">${money(p.balance)}</span>
      </li>`;
  }).join('')}</ol>`;
}
