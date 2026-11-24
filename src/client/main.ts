// The browser side: a landing page, then one screen per game phase, all
// rendered from the state the lobby's Durable Object broadcasts.

import {
  FINISH, HORSES, horseTotals, isTiedAtLine, START_BALANCE, sum, type Bets,
} from '../shared/game';
import {
  isRoomCode, MAX_NAME, MAX_ROUNDS,
  type ClientMsg, type PublicPlayer, type PublicState, type RaceMode, type ServerMsg,
} from '../shared/protocol';
import { joinUrl, qrSvg } from './qr';

const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;

// ---- Small helpers ------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const r2 = (n: number) => Math.round(n * 100) / 100;
function money(n: number, signed = false): string {
  const v = r2(Math.abs(n));
  const s = '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
  if (n < -0.004) return '−' + s;
  return signed && n > 0.004 ? '+' + s : s;
}
const oddsText = (o: number) => (o === 0 ? '—' : '×' + o.toFixed(2));
const cls = (n: number) => (n > 0.004 ? 'pos' : n < -0.004 ? 'neg' : '');

const horse = (h: number, extra = '') => `<span class="horse h${h} ${extra}">${h}</span>`;

const store = {
  get<T>(k: string): T | null {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

interface Identity { playerId: string; name: string | null }
const identityKey = (code: string) => `hr:room:${code}`;
const newId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3200);
}

// Re-rendering replaces the DOM; keep the focused text box focused.
function render(html: string) {
  const a = document.activeElement as HTMLInputElement | null;
  const id = a?.id;
  const sel = a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
  app.innerHTML = html;
  if (id) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (sel && sel[0] !== null) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not text */ }
    }
  }
}

// ---- Routing ------------------------------------------------------------

function route() {
  const code = location.pathname.slice(1).toUpperCase();
  if (isRoomCode(code)) enterRoom(code);
  else { leaveRoom(); renderLanding(); }
}
function go(path: string) { history.pushState(null, '', path); route(); }
window.addEventListener('popstate', route);

// ---- Landing ------------------------------------------------------------

function renderLanding(error = '') {
  render(`
    <section class="landing">
      <div class="hero">
        <div class="logo" aria-hidden="true">🏇</div>
        <h1>Horse Race</h1>
        <p>Everyone starts with ${money(START_BALANCE)} of play money. Bet on horses 1–6, race them, richest player wins.</p>
      </div>
      <div class="card">
        <h2>Start a lobby</h2>
        <p class="muted">You'll be the host and get a room code for friends.</p>
        <button class="primary big" id="create">Start a lobby</button>
      </div>
      <form class="card" id="joinForm" autocomplete="off">
        <h2>Join a lobby</h2>
        <label for="joinCode" class="muted">Room code</label>
        <input id="joinCode" class="code-input" maxlength="4" placeholder="ABCD" autocapitalize="characters" spellcheck="false" />
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="secondary big" type="submit">Join</button>
      </form>
    </section>`);

  document.getElementById('create')!.onclick = async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    const playerId = newId();
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hostId: playerId }),
      });
      const body = (await res.json()) as { code?: string; error?: string };
      if (!body.code) throw new Error(body.error ?? 'Could not start a lobby.');
      store.set(identityKey(body.code), { playerId, name: null } satisfies Identity);
      go('/' + body.code);
    } catch (err) {
      btn.disabled = false;
      toast(err instanceof Error ? err.message : 'Could not start a lobby.');
    }
  };

  const codeInput = document.getElementById('joinCode') as HTMLInputElement;
  codeInput.oninput = () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  document.getElementById('joinForm')!.onsubmit = async (e) => {
    e.preventDefault();
    const code = codeInput.value.trim().toUpperCase();
    if (!isRoomCode(code)) return renderLanding('Room codes are 4 letters.');
    try {
      const res = await fetch(`/api/rooms/${code}`);
      const body = (await res.json()) as { exists?: boolean };
      if (!body.exists) return renderLanding(`No lobby with code ${code}.`);
    } catch {
      return renderLanding("Couldn't reach the server. Check your connection.");
    }
    go('/' + code);
  };
}

// ---- Room connection ----------------------------------------------------

interface Room {
  code: string;
  identity: Identity;
  ws: WebSocket | null;
  state: PublicState | null;
  you: string;
  retries: number;
  closed: boolean;
  /** Bets being edited (sent to the server as you type). */
  draft: Bets | null;
  /** What's typed in each bet box (so "5." survives a re-render). */
  draftText: string[];
  draftRound: number;
  sendTimer: number;
  autoRoll: number;
  manualPick: number | null;
  /** Keep the finished race on screen briefly before the results. */
  holdRaceUntil: number;
  lastPhase: string;
  /** The join QR code overlay is open. */
  showQr: boolean;
}
let room: Room | null = null;

function enterRoom(code: string) {
  if (room?.code === code) return;
  leaveRoom();
  const identity = store.get<Identity>(identityKey(code)) ?? { playerId: newId(), name: null };
  room = {
    code, identity, ws: null, state: null, you: identity.playerId, retries: 0, closed: false,
    draft: null, draftText: [], draftRound: -1, sendTimer: 0, autoRoll: 0, manualPick: null, holdRaceUntil: 0, lastPhase: '', showQr: false,
  };
  if (identity.name) connect(room);
  else renderNamePrompt(room);
}

function leaveRoom() {
  if (!room) return;
  room.closed = true;
  clearInterval(room.autoRoll);
  room.ws?.close();
  room = null;
}

function connect(r: Room) {
  if (r.closed) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${r.code}/ws`);
  r.ws = ws;
  ws.onopen = () => {
    r.retries = 0;
    send({ t: 'hello', playerId: r.identity.playerId, name: r.identity.name ?? '' });
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMsg;
    if (msg.t === 'error') {
      if (msg.fatal) { r.closed = true; return renderGone(msg.message); }
      if (!r.state) {
        // Rejected before joining (e.g. the name is taken): ask again.
        r.closed = true; ws.close();
        r.identity.name = null;
        return renderNamePrompt(r, msg.message);
      }
      return toast(msg.message);
    }
    onState(r, msg.state, msg.you);
  };
  ws.onclose = () => {
    if (r.closed || r.ws !== ws) return;
    if (r.state) renderRoom(r); // shows "reconnecting"
    const delay = Math.min(8000, 500 * 2 ** r.retries++);
    setTimeout(() => connect(r), delay);
  };
}

function send(msg: ClientMsg) {
  if (room?.ws?.readyState === WebSocket.OPEN) room.ws.send(JSON.stringify(msg));
  else toast('Reconnecting…');
}

function renderNamePrompt(r: Room, error = '') {
  const last = store.get<string>('hr:lastName') ?? '';
  render(`
    <section class="landing">
      <div class="hero small">
        <p class="muted">Lobby</p>
        <div class="room-code">${r.code}</div>
      </div>
      <form class="card" id="nameForm" autocomplete="off">
        <h2>Your display name</h2>
        <input id="nameInput" maxlength="${MAX_NAME}" value="${esc(last)}" placeholder="e.g. Lucky Lou" />
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" type="submit">Join lobby</button>
        <button class="link" type="button" id="home">Back</button>
      </form>
    </section>`);
  const input = document.getElementById('nameInput') as HTMLInputElement;
  input.focus();
  input.select();
  document.getElementById('home')!.onclick = () => go('/');
  document.getElementById('nameForm')!.onsubmit = (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return renderNamePrompt(r, 'Pick a name.');
    store.set('hr:lastName', name);
    r.identity.name = name;
    r.closed = false;
    connect(r);
  };
}

function renderGone(message: string) {
  render(`
    <section class="landing">
      <div class="card center">
        <h2>Lobby not found</h2>
        <p class="muted">${esc(message)}</p>
        <button class="primary big" id="home">Back to start</button>
      </div>
    </section>`);
  document.getElementById('home')!.onclick = () => go('/');
}

function onState(r: Room, s: PublicState, you: string) {
  const prev = r.state;
  r.state = s;
  r.you = you;
  store.set(identityKey(r.code), r.identity);

  const me = s.players.find((p) => p.id === you);
  if (s.phase === 'betting' && me && (r.draftRound !== s.round || prev?.phase !== 'betting' || me.locked)) {
    r.draft = (me.bets ?? Array(HORSES).fill(0)).slice();
    r.draftText = r.draft.map((b) => (b ? String(r2(b)) : ''));
    r.draftRound = s.round;
  }
  if (prev?.phase === 'racing' && s.phase === 'results' && s.mode === 'digital') {
    r.holdRaceUntil = Date.now() + 2200;
    setTimeout(() => room === r && renderRoom(r), 2300);
  }
  if (s.phase !== 'racing' || s.mode !== 'digital') stopAuto(r);
  if (s.phase !== 'racing') r.manualPick = null;
  r.lastPhase = s.phase;
  renderRoom(r);
}

function stopAuto(r: Room) {
  clearInterval(r.autoRoll);
  r.autoRoll = 0;
}

// ---- Room screens -------------------------------------------------------

function renderRoom(r: Room) {
  const s = r.state!;
  const me = s.players.find((p) => p.id === r.you)!;
  const isHost = s.hostId === r.you;
  const offline = r.ws?.readyState !== WebSocket.OPEN;

  let body: string;
  const showRace = s.phase === 'racing' || (s.phase === 'results' && Date.now() < r.holdRaceUntil);
  if (s.phase === 'lobby') body = lobbyScreen(s, isHost);
  else if (s.phase === 'betting') body = bettingScreen(r, s, me, isHost);
  else if (s.phase === 'review') body = reviewScreen(s, me, isHost);
  else if (showRace) body = s.mode === 'manual' ? manualScreen(r, s, isHost) : raceScreen(r, s, isHost);
  else if (s.phase === 'results') body = resultsScreen(s, me, isHost);
  else body = finishedScreen(s, me, isHost);

  const roundLabel = s.round > 0 ? `Round ${s.round} of ${s.rounds}` : 'Lobby';
  render(`
    <header class="bar">
      <button class="chip code" id="showQr" title="Show the join QR code" aria-label="Room ${s.code}: show join QR code">${s.code} <span aria-hidden="true">▦</span></button>
      <span class="round">${roundLabel}</span>
      <span class="balance" title="Your money">${money(me.balance)}</span>
    </header>
    ${offline ? '<div class="offline">Reconnecting…</div>' : ''}
    <section class="screen">${body}</section>
    ${r.showQr ? qrOverlay(s.code) : ''}`);

  document.getElementById('showQr')!.onclick = () => { r.showQr = true; renderRoom(r); };
  const closeQr = () => { r.showQr = false; renderRoom(r); };
  document.getElementById('closeQr')?.addEventListener('click', closeQr);
  document.getElementById('qrOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeQr(); });
  document.getElementById('overlayShare')?.addEventListener('click', () => share(s.code));
  bind(r, s, me);
}

function joinCard(code: string) {
  return `
    <div class="qr" role="img" aria-label="QR code to join lobby ${code}">${qrSvg(joinUrl(code))}</div>
    <p class="muted">Scan to join, or go to <b>${esc(location.host)}</b> and enter the code.</p>`;
}

function qrOverlay(code: string) {
  return `
    <div class="overlay" id="qrOverlay" role="dialog" aria-modal="true" aria-label="Join this lobby">
      <div class="card center sheet">
        <p class="muted">Room code</p>
        <div class="room-code">${code}</div>
        ${joinCard(code)}
        <div class="two">
          <button class="secondary" id="overlayShare">Share link</button>
          <button class="primary" id="closeQr">Done</button>
        </div>
      </div>
    </div>`;
}

function share(code: string) {
  const url = joinUrl(code);
  if (navigator.share) navigator.share({ title: 'Horse Race', text: `Join my horse race lobby: ${code}`, url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url));
}

function playerList(s: PublicState, show: (p: PublicPlayer) => string = () => '') {
  return `<ul class="players">${s.players.map((p) => `
    <li class="${p.connected ? '' : 'away'}">
      <span class="dot" title="${p.connected ? 'Online' : 'Offline'}"></span>
      <span class="name">${esc(p.name)}${p.id === s.hostId ? ' <span class="tag">host</span>' : ''}</span>
      <span class="aside">${show(p)}</span>
    </li>`).join('')}</ul>`;
}

function lobbyScreen(s: PublicState, isHost: boolean) {
  return `
    <div class="card center">
      <p class="muted">Room code</p>
      <div class="room-code">${s.code}</div>
      ${joinCard(s.code)}
      <button class="secondary" id="shareBtn">Share link</button>
    </div>
    <div class="card">
      <h2>Players (${s.players.length})</h2>
      ${playerList(s, () => money(START_BALANCE))}
    </div>
    ${isHost ? `
      <div class="card">
        <h2>Rounds</h2>
        <div class="stepper">
          <button class="secondary" id="roundsDown" ${s.rounds <= 1 ? 'disabled' : ''} aria-label="Fewer rounds">−</button>
          <span class="value">${s.rounds}</span>
          <button class="secondary" id="roundsUp" ${s.rounds >= MAX_ROUNDS ? 'disabled' : ''} aria-label="More rounds">+</button>
        </div>
        <label class="toggle">
          <input type="checkbox" id="hideOdds" ${s.hideOdds ? 'checked' : ''} />
          <span><b>Hide odds until all bets are in</b><br /><span class="muted small">Players bet blind: no live odds or pool totals while betting.</span></span>
        </label>
        <button class="primary big" id="start">Start game</button>
      </div>`
    : `<p class="waiting">Waiting for the host to start a ${s.rounds}-round game${s.hideOdds ? ' (odds hidden until all bets are in)' : ''}…</p>`}`;
}

function bettingScreen(r: Room, s: PublicState, me: PublicPlayer, isHost: boolean) {
  const locked = me.locked || !me.playing;
  const mine = locked ? me.bets ?? Array(HORSES).fill(0) : r.draft!;
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
        <span class="dollar">$<input id="bet${h}" data-bet="${h}" inputmode="decimal" value="${esc(locked ? (mine[h] ? String(r2(mine[h])) : '') : r.draftText[h] ?? '')}" placeholder="0" ${locked ? 'disabled' : ''} aria-label="Bet on horse ${h + 1}" /></span>
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
      ${playerList(s, (x) => !x.playing ? 'sitting out' : x.locked ? '<span class="ok">✓ locked in</span>' : 'betting…')}
      ${isHost ? '<button class="secondary" id="closeBetting">Close betting now</button>' : ''}
    </div>`;
}

function reviewScreen(s: PublicState, me: PublicPlayer, isHost: boolean) {
  const allBets = s.players.filter((p) => p.playing).map((p) => p.bets ?? []);
  const totals = horseTotals(allBets);
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
    ${allBetsTable(s)}
    ${isHost ? `
      <div class="card">
        <h2>Race mode</h2>
        <div class="two">
          <button class="primary big" data-race="digital">🎲 Digital</button>
          <button class="secondary big" data-race="manual">🏁 Manual</button>
        </div>
        <p class="muted small">Digital: roll 3 dice at a time; each die moves that horse one space; first to ${FINISH} wins. Manual: race for real, then press Finish and pick the winner.</p>
      </div>` : '<p class="waiting">Waiting for the host to start the race…</p>'}`;
}

function allBetsTable(s: PublicState, winner: number | null = null) {
  const players = s.players.filter((p) => p.playing);
  if (!players.length) return '';
  const head = Array.from({ length: HORSES }, (_, h) => `<th class="${winner === h + 1 ? 'win' : ''}">${horse(h + 1)}</th>`).join('');
  const body = players.map((p) => `<tr><td class="name">${esc(p.name)}</td>${(p.bets ?? []).map((b, h) =>
    `<td class="${winner === h + 1 ? 'win' : ''}">${b ? money(b) : ''}</td>`).join('')}</tr>`).join('');
  return `
    <details class="card">
      <summary><h2>Everyone's bets</h2></summary>
      <div class="scroll"><table class="table grid"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    </details>`;
}

function track(s: PublicState) {
  const lead = Math.max(...s.positions);
  return `<div class="track">${s.positions.map((pos, h) => {
    const pct = (Math.min(pos, FINISH) / FINISH) * 100;
    const won = s.winner === h + 1;
    return `<div class="lane ${won ? 'won' : ''} ${pos === lead && pos > 0 ? 'leading' : ''}">
      <div class="lane-track">
        ${Array.from({ length: FINISH }, () => '<span class="tick"></span>').join('')}
        <div class="runner" style="left: calc(${pct}% - ${pct / 100} * var(--token))">${horse(h + 1)}</div>
      </div>
      <span class="lane-pos">${pos}</span>
    </div>`;
  }).join('')}</div>`;
}

function dice(roll: number[] | null) {
  if (!roll) return '<div class="dice muted">Roll to start the race</div>';
  return `<div class="dice">${roll.map((d) => `<span class="die h${d}">${d}</span>`).join('')}</div>`;
}

function raceScreen(r: Room, s: PublicState, isHost: boolean) {
  const tied = isTiedAtLine(s.positions);
  const status = s.winner
    ? `<div class="banner h${s.winner}-bg">Horse ${s.winner} wins!</div>`
    : tied ? '<div class="banner warn">Photo finish! Tied at the line, keep rolling…</div>' : '';
  return `
    <div class="card race">
      <div class="race-top">
        ${dice(s.lastRoll)}
        <span class="muted small">Roll ${s.rollCount}</span>
      </div>
      ${track(s)}
      ${status}
    </div>
    ${isHost && !s.winner ? `
      <div class="two">
        <button class="primary big" id="roll" ${r.autoRoll ? 'disabled' : ''}>🎲 Roll dice</button>
        <button class="secondary big" id="auto">${r.autoRoll ? '⏸ Stop' : '⏩ Auto-roll'}</button>
      </div>` : !s.winner ? '<p class="waiting">The host is rolling…</p>' : ''}`;
}

function manualScreen(r: Room, s: PublicState, isHost: boolean) {
  if (!s.manualFinished) {
    return `
      <div class="card center">
        <div class="logo" aria-hidden="true">🏁</div>
        <h2>They're off!</h2>
        <p class="muted">Watch the real race. ${isHost ? 'Press Finish when it is over.' : 'The host will press Finish when it is over.'}</p>
        ${isHost ? '<button class="primary big" id="finish">Finish</button>' : ''}
      </div>`;
  }
  if (!isHost) return '<div class="card center"><h2>Race over</h2><p class="waiting">The host is picking the winner…</p></div>';
  return `
    <div class="card center">
      <h2>Which horse won?</h2>
      <div class="pick">${Array.from({ length: HORSES }, (_, h) =>
        `<button class="pick-btn ${r.manualPick === h + 1 ? 'on' : ''}" data-pick="${h + 1}" aria-label="Horse ${h + 1}">${horse(h + 1, 'lg')}</button>`).join('')}</div>
      <button class="primary big" id="confirmWinner" ${r.manualPick ? '' : 'disabled'}>${r.manualPick ? `Horse ${r.manualPick} won` : 'Pick a horse'}</button>
    </div>`;
}

function leaderboard(s: PublicState, you: string, showLast = true) {
  const ranked = s.players.slice().sort((a, b) => b.balance - a.balance);
  let rank = 0, prev = Infinity;
  return `<ol class="leaders">${ranked.map((p, i) => {
    if (p.balance < prev - 1e-9) { rank = i + 1; prev = p.balance; }
    const last = p.history[p.history.length - 1];
    return `<li class="${p.id === you ? 'me' : ''}">
      <span class="rank">${rank}</span>
      <span class="name">${esc(p.name)}</span>
      ${showLast ? `<span class="delta ${cls(last ?? 0)}">${last == null ? '–' : money(last, true)}</span>` : ''}
      <span class="bal">${money(p.balance)}</span>
    </li>`;
  }).join('')}</ol>`;
}

function resultsScreen(s: PublicState, me: PublicPlayer, isHost: boolean) {
  const w = s.winner!;
  const allBets = s.players.filter((p) => p.playing).map((p) => p.bets ?? []);
  const nobody = horseTotals(allBets)[w - 1] === 0;
  const myNet = me.history[me.history.length - 1];
  const last = s.round >= s.rounds;
  return `
    <div class="banner h${w}-bg big">Horse ${w} wins!</div>
    ${nobody ? '<p class="note">Nobody backed horse ' + w + ', so every stake is lost.</p>' : ''}
    <div class="card center">
      <p class="muted">Your result this round</p>
      <div class="result ${cls(myNet ?? 0)}">${myNet == null ? 'Sat out' : money(myNet, true)}</div>
    </div>
    <div class="card">
      <h2>Leaderboard</h2>
      ${leaderboard(s, me.id)}
    </div>
    ${allBetsTable(s, w)}
    ${isHost ? `<button class="primary big" id="next">${last ? 'Final standings' : `Next round (${s.round + 1} of ${s.rounds})`}</button>`
      : `<p class="waiting">Waiting for the host${last ? '' : ' to start the next round'}…</p>`}`;
}

function finishedScreen(s: PublicState, me: PublicPlayer, isHost: boolean) {
  const ranked = s.players.slice().sort((a, b) => b.balance - a.balance);
  const top = ranked[0];
  const rounds = Math.max(0, ...s.players.map((p) => p.history.length));
  // Like the Results sheet: Start, then each race's result and running sum.
  const head = Array.from({ length: rounds }, (_, i) => `<th>R${i + 1}</th><th>Σ${i + 1}</th>`).join('');
  const rows = ranked.map((p) => {
    let bal = START_BALANCE;
    const cells = Array.from({ length: rounds }, (_, i) => {
      const n = p.history[i];
      if (n != null) bal += n;
      return `<td class="${cls(n ?? 0)}">${n == null ? '–' : money(n, true)}</td><td>${money(bal)}</td>`;
    }).join('');
    return `<tr><td class="name">${esc(p.name)}</td><td>${money(START_BALANCE)}</td>${cells}</tr>`;
  }).join('');
  return `
    <div class="card center">
      <div class="logo" aria-hidden="true">🏆</div>
      <h2>${esc(top.name)} wins with ${money(top.balance)}</h2>
      <p class="muted">${me.id === top.id ? 'Nice betting!' : `You finished with ${money(me.balance)}.`}</p>
    </div>
    <div class="card"><h2>Final standings</h2>${leaderboard(s, me.id, false)}</div>
    <details class="card">
      <summary><h2>Round by round</h2></summary>
      <div class="scroll"><table class="table grid"><thead><tr><th></th><th>Start</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    </details>
    ${isHost ? '<button class="primary big" id="playAgain">Play again</button>' : ''}
    <button class="link" id="home">Leave lobby</button>`;
}

// ---- Events -------------------------------------------------------------

function bind(r: Room, s: PublicState, me: PublicPlayer) {
  const on = (id: string, fn: () => void) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('shareBtn', () => share(s.code));
  on('home', () => go('/'));
  on('roundsDown', () => send({ t: 'config', rounds: s.rounds - 1 }));
  on('roundsUp', () => send({ t: 'config', rounds: s.rounds + 1 }));
  on('start', () => send({ t: 'start' }));
  const hide = document.getElementById('hideOdds') as HTMLInputElement | null;
  if (hide) hide.onchange = () => send({ t: 'config', hideOdds: hide.checked });
  on('lock', () => { flushBets(r); send({ t: 'lock' }); });
  on('unlock', () => send({ t: 'unlock' }));
  on('closeBetting', () => {
    if (confirm('Close betting for everyone? Bets not locked in yet are used as they are.')) { flushBets(r); send({ t: 'closeBetting' }); }
  });
  app.querySelectorAll<HTMLButtonElement>('[data-race]').forEach((b) => {
    b.onclick = () => send({ t: 'race', mode: b.dataset.race as RaceMode });
  });
  on('roll', () => send({ t: 'roll' }));
  on('auto', () => {
    if (r.autoRoll) stopAuto(r);
    else { send({ t: 'roll' }); r.autoRoll = window.setInterval(() => send({ t: 'roll' }), 900); }
    renderRoom(r);
  });
  on('finish', () => send({ t: 'finish' }));
  app.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
    b.onclick = () => { r.manualPick = Number(b.dataset.pick); renderRoom(r); };
  });
  on('confirmWinner', () => r.manualPick && send({ t: 'winner', horse: r.manualPick }));
  on('next', () => send({ t: 'next' }));
  on('playAgain', () => send({ t: 'playAgain' }));

  if (s.phase === 'betting' && me.playing && !me.locked && r.draft) {
    const draft = r.draft;
    const otherStake = (h: number) => sum(draft) - draft[h];
    app.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
      b.onclick = () => {
        const h = Number(b.dataset.step), d = Number(b.dataset.d);
        const max = me.balance - otherStake(h);
        draft[h] = r2(Math.max(0, Math.min(max, draft[h] + d)));
        r.draftText[h] = draft[h] ? String(draft[h]) : '';
        queueBets(r);
        renderRoom(r);
      };
    });
    app.querySelectorAll<HTMLInputElement>('[data-bet]').forEach((inp) => {
      inp.oninput = () => {
        const h = Number(inp.dataset.bet);
        const cleaned = inp.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        let v = cleaned === '' || cleaned === '.' ? 0 : Number(cleaned);
        const max = me.balance - otherStake(h);
        let text = cleaned;
        if (v > max) { v = r2(max); text = String(v); toast(`You only have ${money(max)} left to bet.`); }
        draft[h] = r2(v);
        r.draftText[h] = text;
        queueBets(r);
        renderRoom(r);
      };
    });
  }
}

function queueBets(r: Room) {
  clearTimeout(r.sendTimer);
  r.sendTimer = window.setTimeout(() => flushBets(r), 200);
}
function flushBets(r: Room) {
  clearTimeout(r.sendTimer);
  const me = r.state?.players.find((p) => p.id === r.you);
  if (r.draft && me?.playing && !me.locked && r.state?.phase === 'betting') send({ t: 'bets', bets: r.draft });
}

route();
