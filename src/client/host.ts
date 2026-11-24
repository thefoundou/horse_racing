// The host's screen: the shared "big screen" everyone watches (a laptop,
// usually AirPlayed to a TV). The host runs the game from here but doesn't
// play; players bet on their phones.

import { FINISH, horseTotals, sum } from '../shared/game';
import { MAX_ROUNDS, type PublicState } from '../shared/protocol';
import { joinUrl, qrSvg } from './qr';
import { dice, horseSvg, HORSE_NUMBERS, raceStatus, track } from './race';
import { betsTable, esc, historyTable, leaderboard, money, oddsText } from './ui';

export interface HostCtx {
  autoRoll: boolean;
  manualPick: number | null;
  showRace: boolean;
}

export function hostScreen(s: PublicState, c: HostCtx): string {
  if (s.phase === 'lobby') return lobby(s);
  if (s.phase === 'betting') return betting(s);
  if (s.phase === 'review') return review(s);
  if (c.showRace) return s.mode === 'manual' ? manual(s, c) : race(s, c);
  if (s.phase === 'results') return results(s);
  return finished(s);
}

function lobby(s: PublicState) {
  const n = s.players.length;
  return `
    <div class="tv-lobby">
      <div class="card center join-panel">
        <h1>Join the race</h1>
        <div class="qr large" role="img" aria-label="QR code to join lobby ${s.code}">${qrSvg(joinUrl(s.code))}</div>
        <p class="muted">Scan with your phone camera, or go to</p>
        <p class="join-url">${esc(location.host)}</p>
        <p class="muted">and enter</p>
        <div class="room-code">${s.code}</div>
      </div>
      <div>
        <div class="card">
          <h2>Players (${n})</h2>
          ${n ? `<div class="name-chips">${s.players.map((p) =>
            `<span class="name-chip ${p.connected ? '' : 'away'}">${esc(p.name)}</span>`).join('')}</div>`
            : '<p class="muted">Waiting for players to scan in…</p>'}
        </div>
        <div class="card">
          <h2>Game settings</h2>
          <div class="setting">
            <span>Rounds</span>
            <div class="stepper">
              <button class="secondary" id="roundsDown" ${s.rounds <= 1 ? 'disabled' : ''} aria-label="Fewer rounds">−</button>
              <span class="value">${s.rounds}</span>
              <button class="secondary" id="roundsUp" ${s.rounds >= MAX_ROUNDS ? 'disabled' : ''} aria-label="More rounds">+</button>
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" id="hideOdds" ${s.hideOdds ? 'checked' : ''} />
            <span><b>Hide odds until all bets are in</b><br /><span class="muted small">Players bet blind: no live odds or pool totals while betting.</span></span>
          </label>
          <button class="primary big" id="start" ${n ? '' : 'disabled'}>${n ? `Start game with ${n} ${n === 1 ? 'player' : 'players'}` : 'Waiting for players…'}</button>
        </div>
      </div>
    </div>`;
}

/** One board per horse: the horse, its odds and the money on it. */
function oddsBoard(totals: number[] | null) {
  const p = totals ? sum(totals) : 0;
  return `<div class="odds-board">${HORSE_NUMBERS.map((h) => {
    const t = totals?.[h - 1] ?? 0;
    const o = t === 0 ? 0 : p / t;
    return `
      <div class="odds-card">
        <div class="odds-horse">${horseSvg(h)}</div>
        <div class="odds-big">${totals ? oddsText(o) : '?'}</div>
        <div class="muted">${totals ? `${money(t)} on #${h}` : 'Odds hidden'}</div>
      </div>`;
  }).join('')}</div>
  <p class="pool">${totals ? `Pool <b>${money(p)}</b>` : 'Odds and pool are revealed when everyone has locked in.'}</p>`;
}

function betting(s: PublicState) {
  const waiting = s.players.filter((p) => p.playing && !p.locked).length;
  return `
    <h1 class="tv-title">Place your bets on your phone</h1>
    ${oddsBoard(s.totals)}
    <div class="card">
      <div class="row-between">
        <h2>${waiting ? `Waiting on ${waiting} ${waiting === 1 ? 'player' : 'players'}` : 'Everyone is locked in'}</h2>
        <button class="secondary" id="closeBetting">Close betting now</button>
      </div>
      <div class="name-chips">${s.players.map((p) => `
        <span class="name-chip ${p.connected ? '' : 'away'} ${p.locked ? 'locked' : ''}">
          ${esc(p.name)} ${!p.playing ? '· sitting out' : p.locked ? '✓' : '…'}
        </span>`).join('')}</div>
    </div>`;
}

function review(s: PublicState) {
  const totals = horseTotals(s.players.filter((p) => p.playing).map((p) => p.bets ?? []));
  return `
    <h1 class="tv-title">Bets are in!</h1>
    ${oddsBoard(totals)}
    <div class="tv-two">
      <div class="card"><h2>Everyone's bets</h2>${betsTable(s)}</div>
      <div class="card">
        <h2>Start the race</h2>
        <div class="two">
          <button class="primary big" data-race="digital">🎲 Digital race</button>
          <button class="secondary big" data-race="manual">🏁 Manual race</button>
        </div>
        <p class="muted small">Digital: roll 3 dice at a time; each die moves that horse one space; first to ${FINISH} wins. Manual: race for real, then press Finish and pick the winner.</p>
      </div>
    </div>`;
}

function race(s: PublicState, c: HostCtx) {
  return `
    <div class="race-head">
      ${dice(s.lastRoll, true)}
      <span class="muted">Roll ${s.rollCount}</span>
      ${!s.winner ? `
        <div class="race-controls">
          <button class="primary" id="roll" ${c.autoRoll ? 'disabled' : ''}>🎲 Roll dice</button>
          <button class="secondary" id="auto">${c.autoRoll ? '⏸ Stop' : '⏩ Auto-roll'}</button>
        </div>` : ''}
    </div>
    ${track(s, { big: true })}
    ${raceStatus(s)}`;
}

function manual(s: PublicState, c: HostCtx) {
  if (!s.manualFinished) {
    return `
      <div class="card center tv-hero">
        <div class="logo" aria-hidden="true">🏁</div>
        <h1>They're off!</h1>
        <p class="muted">Press Finish when the race is over.</p>
        <button class="primary big narrow" id="finish">Finish</button>
      </div>`;
  }
  return `
    <div class="card center tv-hero">
      <h1>Which horse won?</h1>
      <div class="pick large">${HORSE_NUMBERS.map((h) =>
        `<button class="pick-btn ${c.manualPick === h ? 'on' : ''}" data-pick="${h}" aria-label="Horse ${h}">${horseSvg(h)}</button>`).join('')}</div>
      <button class="primary big narrow" id="confirmWinner" ${c.manualPick ? '' : 'disabled'}>${c.manualPick ? `Horse ${c.manualPick} won` : 'Pick a horse'}</button>
    </div>`;
}

function results(s: PublicState) {
  const w = s.winner!;
  const totals = horseTotals(s.players.filter((p) => p.playing).map((p) => p.bets ?? []));
  const last = s.round >= s.rounds;
  return `
    <div class="winner-hero h${w}-bg">
      <div class="winner-horse">${horseSvg(w)}</div>
      <div><div class="winner-title">Horse ${w} wins!</div>
      ${totals[w - 1] === 0 ? `<div>Nobody backed horse ${w}, so every stake is lost.</div>` : ''}</div>
    </div>
    <div class="tv-two">
      <div class="card"><h2>Leaderboard</h2>${leaderboard(s, '')}</div>
      <div class="card"><h2>This round's bets</h2>${betsTable(s, w)}</div>
    </div>
    <button class="primary big narrow" id="next">${last ? 'Final standings' : `Next round (${s.round + 1} of ${s.rounds})`}</button>`;
}

function finished(s: PublicState) {
  const ranked = s.players.slice().sort((a, b) => b.balance - a.balance);
  const top = ranked[0];
  return `
    <div class="card center tv-hero">
      <div class="logo" aria-hidden="true">🏆</div>
      <h1>${top ? `${esc(top.name)} wins with ${money(top.balance)}` : 'Game over'}</h1>
    </div>
    <div class="tv-two">
      <div class="card"><h2>Final standings</h2>${leaderboard(s, '', false)}</div>
      <div class="card"><h2>Round by round</h2>${historyTable(s)}</div>
    </div>
    <button class="primary big narrow" id="playAgain">Play again</button>
    <button class="link" id="home">Close lobby</button>`;
}

