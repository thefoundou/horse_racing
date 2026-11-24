// A player's phone: bet, see what you'd win, follow the race, check the
// leaderboard. The host's big screen runs the game.

import { HORSES, horseTotals, START_BALANCE, sum, type Bets } from '../shared/game';
import type { PublicPlayer, PublicState } from '../shared/protocol';
import { dice, raceStatus, track } from './race';
import { roundAwards } from '../shared/awards';
import { awardChips, liveLeaderboard, spotlight } from './awards-view';
import { avatar, betsTable, cls, esc, horse, leaderboard, money, oddsText, playerList, r2 } from './ui';

export interface PlayerCtx {
  draft: Bets | null;
  draftText: string[];
  showRace: boolean;
  slideFrom: number[] | null;
  celebrate: boolean;
}

const bigScreen = '<span class="tag tv-tag">big screen</span>';

export function playerScreen(s: PublicState, me: PublicPlayer, c: PlayerCtx): string {
  if (s.phase === 'lobby') return lobby(s, me);
  if (s.phase === 'betting') return betting(s, me, c);
  if (s.phase === 'review') return review(s, me);
  if (c.showRace) return s.mode === 'manual' ? manual(s) : race(s, c);
  if (s.phase === 'results') return results(s, me, c);
  return finished(s, me);
}

function lobby(s: PublicState, me: PublicPlayer) {
  return `
    <div class="card center">
      <button class="avatar-btn" id="changePhoto" aria-label="${me.avatar ? 'Change your photo' : 'Add a photo'}">
        ${avatar(s.code, me, 'xl')}
        <span class="avatar-edit">${me.avatar ? 'Change photo' : 'Add a photo'}</span>
      </button>
      <h2>You're in, ${esc(me.name)}!</h2>
      <p class="muted">You have ${money(START_BALANCE)} to bet. Watch the ${bigScreen}: the game starts from there.</p>
      ${s.hideOdds ? '<p class="note">Odds are hidden until everyone has locked in their bets.</p>' : ''}
    </div>
    <div class="card">
      <h2>Players (${s.players.length})</h2>
      ${playerList(s, () => '', me.id)}
    </div>`;
}

function betting(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const locked = me.locked || !me.playing;
  const mine = locked ? me.bets ?? Array(HORSES).fill(0) : c.draft!;
  // Live odds with my unsent edits folded in (unless the host hid them).
  const hidden = s.totals === null;
  const totals = (s.totals ?? Array(HORSES).fill(0)).map((t, h) => t - (me.bets?.[h] ?? 0) + (me.playing ? mine[h] : 0));
  const p = sum(totals);
  const od = totals.map((t) => (t === 0 ? 0 : p / t));
  const staked = sum(mine);
  const left = me.balance - staked;
  const waitingOn = s.players.filter((x) => x.playing && !x.locked).length;

  const cards = Array.from({ length: HORSES }, (_, h) => `
    <div class="bet-card ${mine[h] > 0 ? 'backed' : ''}">
      <div class="bet-head">
        ${horse(h + 1, 'lg')}
        <div class="bet-odds">
          ${hidden ? '<span class="odds muted">?</span><span class="muted small">Odds hidden</span>' : `
          <span class="odds">${oddsText(od[h])}</span>
          <span class="muted small">${money(totals[h])} on #${h + 1}</span>`}
        </div>
      </div>
      <div class="bet-input">
        <button class="secondary sm" data-step="${h}" data-d="-5" ${locked || mine[h] <= 0 ? 'disabled' : ''} aria-label="Bet $5 less on ${h + 1}">−5</button>
        <span class="dollar">$<input id="bet${h}" data-bet="${h}" inputmode="decimal" value="${esc(locked ? (mine[h] ? String(r2(mine[h])) : '') : c.draftText[h] ?? '')}" placeholder="0" ${locked ? 'disabled' : ''} aria-label="Bet on horse ${h + 1}" /></span>
        <button class="secondary sm" data-step="${h}" data-d="5" ${locked || left <= 0.004 ? 'disabled' : ''} aria-label="Bet $5 more on ${h + 1}">+5</button>
      </div>
    </div>`).join('');

  return `
    ${!me.playing ? '<p class="note">You joined after betting started, so you sit this round out.</p>' : ''}
    <div class="bet-summary">
      <div><span class="muted small">Staked</span><b>${money(staked)}</b></div>
      <div><span class="muted small">Left</span><b>${money(left)}</b></div>
      <div><span class="muted small">Pool</span><b>${hidden ? '?' : money(p)}</b></div>
    </div>
    <div class="bet-grid">${cards}</div>
    ${hidden ? '<p class="note">Odds are hidden until everyone has locked in.</p>' : ''}
    <p class="muted small center">Odds pay the whole pool to whoever backed the winner, split by stake. If nobody backed the winner, everyone loses their bets.</p>
    ${me.playing ? (me.locked
      ? `<button class="secondary big" id="unlock" ${me.balance < 0.01 ? 'disabled' : ''}>${me.balance < 0.01 ? "You're out of money" : 'Change my bets'}</button>`
      : `<button class="primary big" id="lock">Lock in ${money(staked)}</button>`) : ''}
    <div class="card">
      <h2>Waiting on ${waitingOn} ${waitingOn === 1 ? 'player' : 'players'}</h2>
      ${playerList(s, (x) => !x.playing ? 'sitting out' : x.locked ? '<span class="ok">✓ locked in</span>' : 'betting…', me.id)}
    </div>`;
}

function review(s: PublicState, me: PublicPlayer) {
  const totals = horseTotals(s.players.filter((p) => p.playing).map((p) => p.bets ?? []));
  const p = sum(totals);
  const mine = me.bets ?? Array(HORSES).fill(0);
  const myStake = sum(mine);
  const rows = Array.from({ length: HORSES }, (_, h) => {
    const o = totals[h] === 0 ? 0 : p / totals[h];
    const back = o * mine[h];
    const n = back - myStake;
    return `<tr class="${mine[h] > 0 ? 'backed' : ''}">
      <td>${horse(h + 1)}</td><td>${oddsText(o)}</td><td>${mine[h] ? money(mine[h]) : '–'}</td>
      <td>${money(back)}</td><td class="${cls(n)}">${me.playing ? money(n, true) : '–'}</td></tr>`;
  }).join('');
  return `
    <div class="card">
      <h2>Bets are in · pool ${money(p)}</h2>
      ${me.playing ? `<p class="muted">You staked ${money(myStake)}. If this horse wins, you get back:</p>` : '<p class="muted">You\'re sitting this round out.</p>'}
      <div class="scroll"><table class="table">
        <thead><tr><th>Horse</th><th>Odds</th><th>Your bet</th><th>You get</th><th>Net</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <details class="card"><summary><h2>Everyone's bets</h2></summary>${betsTable(s)}</details>
    <p class="waiting">The race starts on the ${bigScreen}…</p>`;
}

function race(s: PublicState, c: PlayerCtx) {
  return `
    <div class="card race">
      <div class="race-top">${dice(s.lastRoll)}<span class="muted small">Roll ${s.rollCount}</span></div>
      ${track(s, { from: c.slideFrom })}
      ${raceStatus(s)}
    </div>
    ${s.winner ? '' : `<p class="waiting">Watch the ${bigScreen}!</p>`}`;
}

function manual(s: PublicState) {
  return `
    <div class="card center">
      <div class="logo" aria-hidden="true">🏁</div>
      <h2>${s.manualFinished ? 'Race over' : "They're off!"}</h2>
      <p class="waiting">${s.manualFinished ? 'The host is picking the winner…' : 'Watch the race!'}</p>
    </div>`;
}

function results(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const aw = roundAwards(s);
  const w = s.winner!;
  const myNet = me.history[me.history.length - 1];
  const nobody = horseTotals(s.players.filter((p) => p.playing).map((p) => p.bets ?? []))[w - 1] === 0;
  return `
    <div class="banner h${w}-bg big">Horse ${w} wins!</div>
    ${nobody ? `<p class="note">Nobody backed horse ${w}, so every stake is lost.</p>` : ''}
    <div class="card center">
      <p class="muted">Your result this round</p>
      <div class="result ${cls(myNet ?? 0)}">${myNet == null ? 'Sat out' : money(myNet, true)}</div>
      ${awardChips(s, aw.awards, { only: me.id })}
    </div>
    ${spotlight(s, aw)}
    <div class="card"><h2>Leaderboard</h2>${liveLeaderboard(s, me.id, { animate: c.celebrate })}</div>
    <p class="waiting">${s.round >= s.rounds ? 'That was the last race!' : 'The next round starts from the big screen.'}</p>`;
}

function finished(s: PublicState, me: PublicPlayer) {
  const top = s.players.slice().sort((a, b) => b.balance - a.balance)[0];
  return `
    <div class="card center">
      <div class="logo" aria-hidden="true">🏆</div>
      <h2>${esc(top.name)} wins with ${money(top.balance)}</h2>
      <p class="muted">${me.id === top.id ? 'Nice betting!' : `You finished with ${money(me.balance)}.`}</p>
    </div>
    <div class="card"><h2>Final standings</h2>${leaderboard(s, me.id, false)}</div>
    <button class="link" id="home">Leave lobby</button>`;
}
