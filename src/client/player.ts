// A player's phone: bet, see what you'd win, follow the race, check the
// leaderboard. The host's big screen runs the game.

import { floorCents, HORSES, horseTotals, START_BALANCE, sum, type Bets } from '../shared/game';
import { MAX_NAME, type PublicPlayer, type PublicState } from '../shared/protocol';
import { dice, photoFinish, raceStatus, track } from './race';
import { roundAwards } from '../shared/awards';
import { gameRecap } from '../shared/recap';
import { finalLeaderboard, moments, podium } from './recap-view';
import { awardChips, liveLeaderboard, spotlight } from './awards-view';
import { avatar, betsTable, cls, esc, horse, money, oddsText, playerList, r2 } from './ui';

export interface PlayerCtx {
  draft: Bets | null;
  draftText: string[];
  showRace: boolean;
  slideFrom: number[] | null;
  closeUp: boolean;
  /** Lobby: the name being edited, or null when not editing. */
  nameDraft?: string | null;
  celebrate: boolean;
}

const bigScreen = '<span class="tag tv-tag">big screen</span>';

export function playerScreen(s: PublicState, me: PublicPlayer, c: PlayerCtx): string {
  if (s.phase === 'lobby') return lobby(s, me, c);
  if (s.phase === 'betting') return betting(s, me, c);
  if (s.phase === 'review') return review(s, me);
  if (c.showRace) return s.mode === 'manual' ? manual(s) : race(s, me, c);
  if (s.phase === 'results') return results(s, me, c);
  return finished(s, me, c);
}

function lobby(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const editing = c.nameDraft != null;
  return `
    <div class="card center">
      <button class="avatar-btn" id="changePhoto" aria-label="${me.avatar ? 'Change your photo' : 'Add a photo'}">
        ${avatar(s.code, me, 'xl')}
        <span class="avatar-edit">${me.avatar ? 'Change photo' : 'Add a photo'}</span>
      </button>
      ${editing ? `
      <form class="name-edit" id="nameEditForm" autocomplete="off">
        <label for="nameEdit" class="muted small">Your display name</label>
        <input id="nameEdit" maxlength="${MAX_NAME}" value="${esc(c.nameDraft!)}" />
        <div class="two">
          <button type="button" class="secondary" id="cancelName">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>` : `
      <h2>You're in, ${esc(me.name)}!</h2>
      <button class="link edit-name" id="editName">✏️ Edit name</button>`}
      <p class="muted">You have ${money(START_BALANCE)} to bet. Watch the ${bigScreen}: the game starts from there.</p>
      <p class="note">Odds stay hidden until everyone has locked in their bets.</p>
    </div>
    <div class="card">
      <h2>Players (${s.players.length})</h2>
      ${playerList(s, () => '', me.id)}
    </div>`;
}

/** Everything on the betting screen that changes as bets come in. */
function bettingModel(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const locked = me.locked || !me.playing;
  const mine = locked ? me.bets ?? Array(HORSES).fill(0) : c.draft!;
  // Live odds with my unsent edits folded in (unless the host hid them).
  const hidden = s.totals === null;
  const totals = (s.totals ?? Array(HORSES).fill(0)).map((t, h) => t - (me.bets?.[h] ?? 0) + (me.playing ? mine[h] : 0));
  const pool = sum(totals);
  const odds = totals.map((t) => (t === 0 ? 0 : pool / t));
  const staked = r2(sum(mine));
  const left = floorCents(me.balance - staked);
  const waitingOn = s.players.filter((x) => x.playing && !x.locked).length;
  return { locked, mine, hidden, totals, pool, odds, staked, left, waitingOn };
}

const statusList = (s: PublicState, me: PublicPlayer) =>
  playerList(s, (x) => !x.playing ? 'sitting out' : x.locked ? '<span class="ok">✓ locked in</span>' : 'betting…', me.id);
const waitingText = (n: number) => `Waiting on ${n} ${n === 1 ? 'player' : 'players'}`;

/**
 * Key for the betting screen's layout. While it stays the same, updates
 * patch the numbers in place (patchBetting) instead of rebuilding the page,
 * so the box you're typing in is never replaced mid-keystroke.
 */
export const bettingKey = (s: PublicState, me: PublicPlayer) =>
  `${s.round}|${me.locked}|${me.playing}|${s.totals === null}|${s.hostConnected}|${s.players.length}`;

function betting(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const m = bettingModel(s, me, c);
  const cards = Array.from({ length: HORSES }, (_, h) => `
    <div class="bet-card ${m.mine[h] > 0 ? 'backed' : ''}" id="betcard${h}">
      <div class="bet-head">
        ${horse(h + 1, 'lg')}
        <div class="bet-odds">
          ${m.hidden ? '<span class="odds muted">?</span><span class="muted small">Odds hidden</span>' : `
          <span class="odds" id="odds${h}">${oddsText(m.odds[h])}</span>
          <span class="muted small" id="total${h}">${money(m.totals[h])} on #${h + 1}</span>`}
        </div>
      </div>
      <div class="bet-input">
        <button class="secondary sm" data-step="${h}" data-d="-5" id="down${h}" ${m.locked || m.mine[h] <= 0 ? 'disabled' : ''} aria-label="Bet $5 less on ${h + 1}">−5</button>
        <span class="dollar">$<input id="bet${h}" data-bet="${h}" type="text" inputmode="decimal" autocomplete="off" value="${esc(m.locked ? (m.mine[h] ? String(r2(m.mine[h])) : '') : c.draftText[h] ?? '')}" placeholder="0" ${m.locked ? 'disabled' : ''} aria-label="Bet on horse ${h + 1}" /></span>
        <button class="secondary sm" data-step="${h}" data-d="5" id="up${h}" ${m.locked || m.left <= 0.004 ? 'disabled' : ''} aria-label="Bet $5 more on ${h + 1}">+5</button>
      </div>
    </div>`).join('');

  return `
    <div id="betForm" data-key="${esc(bettingKey(s, me))}">
    ${!me.playing ? '<p class="note">You joined after betting started, so you sit this round out.</p>' : ''}
    <div class="bet-summary">
      <div><span class="muted small">Staked</span><b id="sumStaked">${money(m.staked)}</b></div>
      <div><span class="muted small">Left</span><b id="sumLeft">${money(m.left)}</b></div>
    </div>
    <div class="bet-grid">${cards}</div>
    ${m.hidden ? '<p class="note">Odds are hidden until everyone has locked in.</p>' : ''}
    <p class="muted small center">Odds pay the whole pool to whoever backed the winner, split by stake. If nobody backed the winner, everyone loses their bets.</p>
    ${me.playing ? (me.locked
      ? `<div class="locked-summary">✓ Locked in ${money(m.staked)}</div>
         <button class="secondary big" id="unlock" ${me.balance < 0.01 ? 'disabled' : ''}>${me.balance < 0.01 ? "You're out of money" : 'Change my bets'}</button>`
      : `<button class="primary big" id="lock">Lock in ${money(m.staked)}</button>`) : ''}
    <div class="card">
      <h2 id="waitingOn">${waitingText(m.waitingOn)}</h2>
      <div id="betStatus">${statusList(s, me)}</div>
    </div>
    </div>`;
}

/** Update the betting numbers in place; inputs are left alone. */
export function patchBetting(s: PublicState, me: PublicPlayer, c: PlayerCtx): void {
  const m = bettingModel(s, me, c);
  const set = (id: string, text: string) => { const el = document.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
  for (let h = 0; h < HORSES; h++) {
    if (!m.hidden) { set(`odds${h}`, oddsText(m.odds[h])); set(`total${h}`, `${money(m.totals[h])} on #${h + 1}`); }
    document.getElementById(`betcard${h}`)?.classList.toggle('backed', m.mine[h] > 0);
    const down = document.getElementById(`down${h}`) as HTMLButtonElement | null;
    const up = document.getElementById(`up${h}`) as HTMLButtonElement | null;
    if (down) down.disabled = m.locked || m.mine[h] <= 0;
    if (up) up.disabled = m.locked || m.left <= 0.004;
  }
  set('sumStaked', money(m.staked));
  set('sumLeft', money(m.left));
  set('lock', `Lock in ${money(m.staked)}`);
  set('waitingOn', waitingText(m.waitingOn));
  const status = document.getElementById('betStatus');
  const html = statusList(s, me);
  if (status && status.innerHTML !== html) status.innerHTML = html;
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

function race(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const backed = (me.bets ?? []).some((b) => b > 0);
  if (s.photo && c.closeUp) {
    const inIt = s.photo.horses.some((h) => (me.bets?.[h - 1] ?? 0) > 0);
    return `
      ${photoFinish(s, { mine: me.bets })}
      ${inIt && !s.winner ? '<p class="mine-note">✨ Your horse is in the photo!</p>' : ''}
      ${s.winner ? '' : `<p class="waiting">Watch the ${bigScreen}!</p>`}`;
  }
  return `
    <div class="card race">
      <div class="race-top">${dice(s.lastRoll)}<span class="muted small">Roll ${s.rollCount}</span></div>
      ${backed ? '<p class="mine-note">✨ Your horses are glowing</p>' : ''}
      ${track(s, { from: c.slideFrom, mine: me.bets })}
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

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st … */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return n + (teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}

function finished(s: PublicState, me: PublicPlayer, c: PlayerCtx) {
  const recap = gameRecap(s);
  const place = recap.ranked.findIndex((p) => p.id === me.id) + 1;
  const mine = recap.moments.filter((m) => m.playerIds.includes(me.id));
  const profit = me.balance - START_BALANCE;
  return `
    <div class="card center">
      <p class="muted">You finished</p>
      <div class="result">${place === 1 ? '🏆 ' : ''}${ordinal(place)} <span class="muted small">of ${recap.ranked.length}</span></div>
      <p class="${cls(profit)}"><b>${money(me.balance)}</b> (${money(profit, true)} on the day)</p>
    </div>
    ${podium(s, recap, { animate: c.celebrate })}
    ${mine.length ? `<h2 class="section-title">Your moments</h2>${moments(s, mine, { animate: c.celebrate })}` : ''}
    <div class="card"><h2>Final leaderboard</h2>${finalLeaderboard(s, recap, me.id)}</div>
    ${recap.moments.length > mine.length ? `<details class="card"><summary><h2>All the big moments</h2></summary>${moments(s, recap.moments, { animate: false })}</details>` : ''}
    <button class="link" id="home">Leave lobby</button>`;
}
