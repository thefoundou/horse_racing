// The browser side: a landing page, then the lobby. The device that starts a
// lobby becomes its big screen (host.ts); everyone else plays on their phone
// (player.ts). Both render the state the lobby's Durable Object broadcasts.

import { HORSES, START_BALANCE, sum, type Bets } from '../shared/game';
import {
  isRoomCode, MAX_NAME,
  type ClientMsg, type PublicPlayer, type PublicState, type RaceMode, type ServerMsg,
} from '../shared/protocol';
import { hostScreen } from './host';
import { bettingKey, patchBetting, playerScreen } from './player';
import { joinUrl, qrSvg } from './qr';
import { horseSvg, slideRunners } from './race';
import { runCountUps } from './awards-view';
import { pickPhoto } from './photo';
import { crowdSwell, playAww, playBoom, playBugle, playCheer, playDieRoll, playGallop, playRegister, playShutters, playTumble, startCrowd, stopCrowd, setSound, soundOn, startRaceAmbience, stopRaceAmbience, unlockAudio } from './sound';
import { app, esc, money, r2, render, store, toast } from './ui';
import { floorCents } from '../shared/game';

interface Identity {
  playerId: string;
  name: string | null;
  /** This device started the lobby: it's the big screen, not a player. */
  host?: boolean;
}
const identityKey = (code: string) => `hr:room:${code}`;
const newId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

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
        <h1>Horse Race</h1>
        <p class="tagline">Place your bets</p>
        <div class="herd" aria-hidden="true">${horseSvg(1)}${horseSvg(4)}${horseSvg(3)}</div>
      </div>
      <div class="card center">
        <p>Everyone starts with the same pot of play money (<b>${money(START_BALANCE)}</b>, unless the host picks another amount). Bet on horses 1–6, race them, and the richest player wins.</p>
      </div>
      <div class="card">
        <h2>Host a game</h2>
        <p class="muted">Use this on the screen everyone watches (a laptop, or AirPlay it to the TV). It shows a QR code for players to scan, then the odds, the race and the leaderboard. The host runs the game but doesn't bet.</p>
        <button class="primary big" id="create">Start a lobby on this screen</button>
      </div>
      <form class="card" id="joinForm" autocomplete="off">
        <h2>Join a game</h2>
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
      store.set(identityKey(body.code), { playerId, name: null, host: true } satisfies Identity);
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
  /** When this round's photo finish began on this screen (0: show it as it is now, e.g. after a reload). */
  photoAt: number;
  /** When the latest photo-finish die arrived (its shake and throw play from then). */
  dieAt: number;
  /** Hold off rolling (auto or by hand) until the current animation has played. */
  busyUntil: number;
  /** Positions before the latest roll, so the next render can slide from them. */
  slideFrom: number[] | null;
  /** The round whose results celebration has already played. */
  celebratedRound: number;
  lastPhase: string;
  /** The join QR code overlay is open. */
  showQr: boolean;
  /** Just joined with a name: show the photo page before the lobby. */
  askPhoto: boolean;
  /** The photo shown on that page (picked now, or remembered from last time). */
  photoPreview: string | null;
  /** The starting budget being typed on the big screen, or null. */
  budgetText: string | null;
  /** The name being edited in the lobby, or null. */
  nameDraft: string | null;
  /** A photo waiting to go: kept until the lobby confirms it (phones drop the connection while the camera is open). */
  photoOutbox: { data: string; version: number; timer: number } | null;
}
let room: Room | null = null;
const FINAL_SHOWN = Number.MAX_SAFE_INTEGER;

/** Set while a player still has the photo page to see (survives the phone reloading the page). */
const askPhotoKey = (code: string) => `hr:askPhoto:${code}`;

function enterRoom(code: string) {
  if (room?.code === code) return;
  leaveRoom();
  const identity = store.get<Identity>(identityKey(code)) ?? { playerId: newId(), name: null };
  room = {
    code, identity, ws: null, state: null, you: identity.playerId, retries: 0, closed: false,
    draft: null, draftText: [], draftRound: -1, sendTimer: 0, autoRoll: 0, manualPick: null, holdRaceUntil: 0, photoAt: 0, dieAt: 0, busyUntil: 0, slideFrom: null, celebratedRound: -1, lastPhase: '', showQr: false, askPhoto: !!store.get<boolean>(askPhotoKey(code)), photoPreview: store.get<string>('hr:lastPhoto'), photoOutbox: null, nameDraft: null, budgetText: null,
  };
  if (identity.host || identity.name) connect(room);
  else renderNamePrompt(room);
}

function leaveRoom() {
  document.body.classList.remove('tv');
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
    if (r.photoOutbox) ws.send(JSON.stringify({ t: 'avatar', data: r.photoOutbox.data }));
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

/**
 * Upload a profile photo and keep trying until the lobby confirms it. Taking
 * or picking a photo sends the page to the background, and phones often drop
 * (or silently kill) the connection meanwhile.
 */
function sendPhoto(r: Room, data: string) {
  const me = r.state?.players.find((p) => p.id === r.you);
  if (r.photoOutbox) clearTimeout(r.photoOutbox.timer);
  const attempt = (tries: number) => {
    if (r.ws?.readyState === WebSocket.OPEN) r.ws.send(JSON.stringify({ t: 'avatar', data }));
    const timer = window.setTimeout(() => {
      if (!r.photoOutbox || r.closed) return;
      if (tries >= 4) { r.photoOutbox = null; toast("Couldn't save your photo. Try again from the lobby."); return; }
      r.ws?.close(); // probably a dead connection: reconnect (which resends) and check again
      attempt(tries + 1);
    }, 5000);
    r.photoOutbox = { data, version: me?.avatar ?? 0, timer };
  };
  attempt(0);
}

// Coming back from the camera or another app: reconnect at once rather than waiting out the backoff.
document.addEventListener('visibilitychange', () => {
  const r = room;
  if (document.visibilityState !== 'visible' || !r || r.closed || !r.identity.name && !r.identity.host) return;
  if (r.ws?.readyState !== WebSocket.OPEN && r.ws?.readyState !== WebSocket.CONNECTING) { r.retries = 0; connect(r); }
});

function renderNamePrompt(r: Room, error = '') {
  const last = store.get<string>('hr:lastName') ?? '';
  render(`
    <section class="landing">
      <div class="hero small">
        <h1>Horse Race</h1>
        <p class="tagline">Lobby ${r.code}</p>
      </div>
      <form class="card" id="nameForm" autocomplete="off">
        <h2>Your display name</h2>
        <input id="nameInput" maxlength="${MAX_NAME}" value="${esc(last)}" placeholder="e.g. Lucky Lou" />
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" type="submit">Next</button>
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
    r.askPhoto = true; // once the lobby lets us in, ask for a photo
    store.set(askPhotoKey(r.code), true);
    r.photoPreview = store.get<string>('hr:lastPhoto'); // your photo from last time, if any
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
  const me = s.players.find((p) => p.id === you);
  if (me && !r.identity.host && r.identity.name !== me.name) {
    r.identity.name = me.name; // renamed in the lobby
    store.set('hr:lastName', me.name);
  }
  store.set(identityKey(r.code), r.identity);
  if (s.phase !== 'lobby') r.nameDraft = null; // names are fixed once the game starts
  if (me && r.photoOutbox && (me.avatar ?? 0) > r.photoOutbox.version) {
    clearTimeout(r.photoOutbox.timer); // the lobby has the photo
    r.photoOutbox = null;
  }
  if (s.phase === 'betting' && me && (r.draftRound !== s.round || prev?.phase !== 'betting' || me.locked)) {
    r.draft = (me.bets ?? Array(HORSES).fill(0)).slice();
    r.draftText = r.draft.map((b) => (b ? String(r2(b)) : ''));
    r.draftRound = s.round;
  }
  if (!s.photo) { r.photoAt = 0; r.dieAt = 0; }
  const later = (ms: number) => setTimeout(() => room === r && renderRoom(r), ms + 30);
  if (prev && prev.round === s.round && !prev.photo && s.photo) {
    // A tie at the line: the horses slide up to it, the camera zooms in on them,
    // then the close-up, with the tied horses galloping in to the line.
    r.photoAt = Date.now();
    r.busyUntil = r.photoAt + PF.ready;
    [PF.zoom, PF.intro, PF.ready].forEach(later);
  }
  if (prev?.photo && s.photo && prev.round === s.round && s.photo.rolls.length > prev.photo.rolls.length) {
    // A new photo-finish die: shake it, throw it, and only then show what it says.
    r.dieAt = Date.now();
    r.busyUntil = r.dieAt + PF.reveal + 900;
    [PF.shake, PF.reveal, PF.reveal + 900].forEach(later);
  }
  if (prev?.phase === 'racing' && s.phase === 'results' && s.mode === 'digital') {
    // Let the winner cross the line (or the photo-finish losers crash and blow up) before the results.
    const hold = s.photo ? PF.reveal + PF.aftermath : 3600;
    r.holdRaceUntil = Date.now() + hold;
    later(hold + 70);
  }
  if (s.phase !== 'racing' || s.mode !== 'digital') stopAuto(r);
  if (s.phase !== 'racing') r.manualPick = null;
  if (prev && prev.round === s.round && prev.positions.join() !== s.positions.join()) r.slideFrom = prev.positions;
  if (s.hostId === you) raceSounds(prev, s);
  betSounds(prev, s, you);
  r.lastPhase = s.phase;
  renderRoom(r);
}

/**
 * Cha-ching when bets go in: on the big screen for each player who locks in
 * (once if the host closes betting on several at once), and on your own phone
 * when you lock in.
 */
function betSounds(prev: PublicState | null, s: PublicState, you: string) {
  if (!prev || prev.phase !== 'betting' || prev.round !== s.round) return;
  const wasLocked = new Set(prev.players.filter((p) => p.locked).map((p) => p.id));
  const fresh = s.players.filter((p) => p.playing && p.locked && !wasLocked.has(p.id) && prev.players.some((q) => q.id === p.id));
  if (s.hostId === you ? fresh.length > 0 : fresh.some((p) => p.id === you)) playRegister();
}

/** The big screen's soundtrack: bugle at the off, hooves and horses during the race, a cheer at the finish. */
function raceSounds(prev: PublicState | null, s: PublicState) {
  if (!prev) return; // joining or reloading mid-race: don't replay anything
  const racing = s.phase === 'racing' && !s.winner;
  if (s.phase === 'racing' && prev.phase !== 'racing') {
    playBugle();
    if (s.mode === 'digital') startRaceAmbience();
  }
  if (s.mode === 'digital' && prev.round === s.round && (s.phase === 'racing' || s.phase === 'results')) {
    const moved = s.positions.filter((p, i) => p !== prev.positions[i]).length;
    if (moved) playGallop(moved);
  }
  if (s.photo && prev.round === s.round) {
    const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
    if (!prev.photo) {
      // The crowd roars as the camera zooms in, and the flashes go off for the close-up.
      later(PF.zoom, startCrowd);
      later(PF.intro, () => playShutters(5));
    } else if (s.photo.rolls.length > prev.photo.rolls.length) {
      // Each die: rattle, throw, and the crowd holding its breath; then the verdict.
      playDieRoll(PF.shake / 1000, (PF.reveal - PF.shake) / 1000);
      crowdSwell(PF.reveal / 1000);
      later(PF.reveal, () => playShutters(2));
      if (!s.winner) later(PF.reveal, playAww);
    }
  }
  if (s.phase === 'betting' || s.phase === 'lobby') stopCrowd(0.5);
  if (s.winner && !prev.winner) {
    stopRaceAmbience();
    if (s.photo) {
      // Photo finish: the losers tumble and crash, blow up, then the crowd goes wild.
      window.setTimeout(() => playTumble(PF.tumble / 1000), PF.reveal);
      window.setTimeout(() => playBoom(s.photo!.horses.length - 1), PF.reveal + PF.tumble);
      window.setTimeout(playCheer, PF.reveal + PF.tumble + 400);
      window.setTimeout(() => stopCrowd(2.5), PF.reveal + PF.tumble + 1500);
    } else {
      // Digital: cheer as the winner reaches the line (after its slide). Manual: straight away.
      window.setTimeout(playCheer, s.mode === 'digital' ? 1100 : 0);
    }
  }
  if (!racing) stopRaceAmbience();
}

// Browsers only allow sound after the page is clicked: wake the audio on the first click or key.
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);

// ---- Photo-finish timing (ms) --------------------------------------------------

const PF = {
  zoom: 1700, // the horses slide up to the line, then the camera starts zooming in
  intro: 4400, // the close-up: the tied horses gallop in to the line
  ready: 6800, // ready for the first die
  shake: 1000, // each die: shaken (glowing) for this long…
  reveal: 3000, // …then bounces about until it lands, here
  tumble: 2000, // the losers tumble and crash for this long, then explode
  aftermath: 2000 + 2600, // tumble, explosion and a moment to take it in, before the results
};
const AUTO_ROLL_MS = 3900;

function stageOf(r: Room, s: PublicState): 'track' | 'zoom' | 'intro' | 'ready' {
  if (!s.photo) return 'track';
  const t = Date.now() - r.photoAt;
  return t < PF.zoom ? 'track' : t < PF.intro ? 'zoom' : t < PF.ready ? 'intro' : 'ready';
}
function rollingOf(r: Room, s: PublicState): 'shake' | 'bounce' | null {
  if (!s.photo?.rolls.length || !r.dieAt) return null;
  const t = Date.now() - r.dieAt;
  return t < PF.shake ? 'shake' : t < PF.reveal ? 'bounce' : null;
}

/** While the photo-finish die bounces, flick its face through random numbers. */
let spinTimer = 0;
function spinDie() {
  clearInterval(spinTimer);
  const die = app.querySelector<HTMLElement>('.pf-die.bounce');
  if (!die) return;
  spinTimer = window.setInterval(() => {
    if (!die.isConnected) return clearInterval(spinTimer);
    const n = 1 + Math.floor(Math.random() * 6);
    die.classList.remove('h1', 'h2', 'h3', 'h4', 'h5', 'h6');
    die.classList.add('h' + n);
    die.textContent = String(n);
  }, 110);
}

function stopAuto(r: Room) {
  clearInterval(r.autoRoll);
  r.autoRoll = 0;
}

// ---- Room screens -------------------------------------------------------

/**
 * Step two of joining: a page just for the profile photo, so it's hard to
 * miss. You're already in the lobby; skipping is fine.
 */
function renderPhotoStep(r: Room, s: PublicState, me: PublicPlayer) {
  const preview = r.photoPreview;
  const started = s.phase !== 'lobby';
  render(`
    <section class="landing">
      <div class="hero small">
        <h1>Horse Race</h1>
        <p class="tagline">Lobby ${s.code}</p>
      </div>
      <div class="card center photo-step">
        <h2>Add your photo, ${esc(me.name)}</h2>
        <p class="muted">It goes on the leaderboard and the big screen, so everyone can see who's winning (and who isn't).</p>
        <button type="button" class="photo-frame" id="pickPhoto" aria-label="${preview ? 'Choose a different photo' : 'Take or choose a photo'}">
          ${preview ? `<img src="${preview}" alt="Your photo" />` : '<span aria-hidden="true">📷</span>'}
        </button>
        ${preview
          ? `<button class="primary big" id="usePhoto">Use this photo</button>
             <button class="secondary big" id="pickAgain">Choose a different photo</button>`
          : '<button class="primary big" id="pickPhotoBtn">📷 Take or choose a photo</button>'}
        <button class="link" id="skipPhoto">Skip for now</button>
        ${started ? '<p class="note">The game has started. Finish up here to place your bets.</p>' : ''}
      </div>
    </section>`);
  const pick = async () => {
    const photo = await pickPhoto();
    if (!photo) return;
    r.photoPreview = photo;
    renderRoom(r);
  };
  const done = () => { r.askPhoto = false; r.photoPreview = null; store.set(askPhotoKey(r.code), false); renderRoom(r); };
  for (const id of ['pickPhoto', 'pickPhotoBtn', 'pickAgain']) document.getElementById(id)?.addEventListener('click', pick);
  document.getElementById('skipPhoto')!.onclick = done;
  document.getElementById('usePhoto')?.addEventListener('click', () => {
    store.set('hr:lastPhoto', preview);
    sendPhoto(r, preview!);
    done();
  });
}

function renderRoom(r: Room) {
  const s = r.state!;
  const isHost = s.hostId === r.you;
  const me = s.players.find((p) => p.id === r.you);
  const offline = r.ws?.readyState !== WebSocket.OPEN;
  if (r.askPhoto && me && !isHost) return renderPhotoStep(r, s, me);
  // While betting, patch the numbers in place rather than rebuilding the page,
  // so the box you're typing in is never swapped out under your fingers.
  if (!isHost && me && s.phase === 'betting' && !offline && !r.showQr && !document.getElementById('reconnecting')) {
    const form = document.getElementById('betForm');
    if (form && form.dataset.key === bettingKey(s, me)) {
      patchBetting(s, me, { draft: r.draft, draftText: r.draftText, showRace: false, slideFrom: null, photoStage: 'track', rolling: null, celebrate: false });
      return;
    }
  }
  const showRace = s.phase === 'racing' || (s.phase === 'results' && Date.now() < r.holdRaceUntil);
  document.body.classList.toggle('tv', isHost);
  if (s.phase === 'lobby') r.celebratedRound = -1; // play again restarts the rounds
  // Play each round's celebration, and the final recap, once.
  const celebrate = (s.phase === 'results' && !showRace && r.celebratedRound !== s.round)
    || (s.phase === 'finished' && r.celebratedRound !== FINAL_SHOWN);

  let body: string;
  const photoStage = stageOf(r, s), rolling = rollingOf(r, s), rollBusy = Date.now() < r.busyUntil;
  if (isHost) body = hostScreen(s, { autoRoll: !!r.autoRoll, manualPick: r.manualPick, showRace, slideFrom: r.slideFrom, photoStage, rolling, rollBusy, budgetText: r.budgetText, celebrate });
  else if (me) body = playerScreen(s, me, { draft: r.draft, draftText: r.draftText, showRace, slideFrom: r.slideFrom, photoStage, rolling, celebrate, nameDraft: r.nameDraft });
  else return; // not joined yet

  const roundLabel = s.round > 0 ? `Round ${s.round} of ${s.rounds}` : isHost ? 'Big screen' : 'Lobby';
  const right = isHost
    ? `<button class="chip sound" id="soundToggle" aria-pressed="${soundOn()}" title="${soundOn() ? 'Sound on: click to mute' : 'Sound off: click to turn on'}">${soundOn() ? '🔊' : '🔇'}</button>
       <span class="balance">${s.players.length} ${s.players.length === 1 ? 'player' : 'players'}</span>`
    : `<span class="balance" title="Your money">${money(me!.balance)}</span>`;
  render(`
    <header class="bar">
      <button class="chip code" id="showQr" title="Show the join QR code" aria-label="Room ${s.code}: show join QR code">${s.code} <span aria-hidden="true">▦</span></button>
      <span class="round">${roundLabel}</span>
      ${right}
    </header>
    ${offline ? '<div class="offline" id="reconnecting">Reconnecting…</div>' : ''}
    ${!isHost && !s.hostConnected ? '<div class="offline">The big screen is offline.</div>' : ''}
    <section class="screen">${body}</section>
    ${r.showQr ? qrOverlay(s.code) : ''}`);

  document.getElementById('showQr')!.onclick = () => { r.showQr = true; renderRoom(r); };
  const closeQr = () => { r.showQr = false; renderRoom(r); };
  document.getElementById('closeQr')?.addEventListener('click', closeQr);
  document.getElementById('qrOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeQr(); });
  document.getElementById('overlayShare')?.addEventListener('click', () => share(s.code));
  r.slideFrom = null; // slide once; later re-renders draw horses where they are
  slideRunners(app);
  spinDie();
  if (celebrate) {
    r.celebratedRound = s.phase === 'finished' ? FINAL_SHOWN : s.round;
    if (s.phase === 'results') runCountUps(app, s.players.length);
  }
  bind(r, s, me);
}

function qrOverlay(code: string) {
  return `
    <div class="overlay" id="qrOverlay" role="dialog" aria-modal="true" aria-label="Join this lobby">
      <div class="card center sheet">
        <p class="muted">Room code</p>
        <div class="room-code">${code}</div>
        <div class="qr" role="img" aria-label="QR code to join lobby ${code}">${qrSvg(joinUrl(code))}</div>
        <p class="muted">Scan to join, or go to <b>${esc(location.host)}</b> and enter the code.</p>
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

// ---- Events -------------------------------------------------------------

function bind(r: Room, s: PublicState, me: PublicPlayer | undefined) {
  const on = (id: string, fn: () => void) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('shareBtn', () => share(s.code));
  on('home', () => go('/'));
  on('soundToggle', () => { unlockAudio(); setSound(!soundOn()); renderRoom(r); });
  on('editName', () => {
    r.nameDraft = me?.name ?? '';
    renderRoom(r);
    const input = document.getElementById('nameEdit') as HTMLInputElement | null;
    input?.focus(); input?.select();
  });
  on('cancelName', () => { r.nameDraft = null; renderRoom(r); });
  const nameInput = document.getElementById('nameEdit') as HTMLInputElement | null;
  if (nameInput) nameInput.oninput = () => { r.nameDraft = nameInput.value; };
  const nameForm = document.getElementById('nameEditForm') as HTMLFormElement | null;
  if (nameForm) nameForm.onsubmit = (e) => {
    e.preventDefault();
    const name = nameInput!.value.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Pick a name.');
    r.nameDraft = null;
    if (name !== me?.name) send({ t: 'rename', name });
    renderRoom(r);
  };
  on('changePhoto', async () => {
    const photo = await pickPhoto();
    if (!photo) return;
    store.set('hr:lastPhoto', photo);
    sendPhoto(r, photo);
  });
  on('roundsDown', () => send({ t: 'config', rounds: s.rounds - 1 }));
  on('roundsUp', () => send({ t: 'config', rounds: s.rounds + 1 }));
  on('start', () => send({ t: 'start' }));
  const photoMode = document.getElementById('photoEveryRound') as HTMLInputElement | null;
  if (photoMode) photoMode.onchange = () => send({ t: 'config', photoEveryRound: photoMode.checked });
  // Starting budget: a quick pick, or any whole-dollar amount typed in.
  app.querySelectorAll<HTMLButtonElement>('[data-budget]').forEach((b) => {
    b.onclick = () => { r.budgetText = null; send({ t: 'config', startBalance: Number(b.dataset.budget) }); };
  });
  const budget = document.getElementById('budgetInput') as HTMLInputElement | null;
  if (budget) {
    budget.oninput = () => {
      const text = budget.value.replace(/[^0-9]/g, '');
      if (budget.value !== text) budget.value = text;
      r.budgetText = text;
    };
    budget.onchange = () => {
      const n = Number(budget.value);
      r.budgetText = null;
      if (budget.value && n !== s.startBalance) send({ t: 'config', startBalance: n }); // the lobby checks the range
      else renderRoom(r);
    };
    budget.onkeydown = (e) => { if (e.key === 'Enter') budget.blur(); };
  }
  // Lock in exactly what's on screen: the bets travel with the lock, and if
  // they aren't valid the lobby says so and you stay unlocked.
  on('lock', () => { clearTimeout(r.sendTimer); if (r.draft) send({ t: 'lock', bets: r.draft }); });
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
    else {
      if (Date.now() >= r.busyUntil) send({ t: 'roll' });
      // A roll every 3.9 s, and never while a photo-finish animation is still playing.
      r.autoRoll = window.setInterval(() => { if (Date.now() >= r.busyUntil) send({ t: 'roll' }); }, AUTO_ROLL_MS);
    }
    renderRoom(r);
  });
  on('finish', () => send({ t: 'finish' }));
  app.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
    b.onclick = () => { r.manualPick = Number(b.dataset.pick); renderRoom(r); };
  });
  on('confirmWinner', () => r.manualPick && send({ t: 'winner', horse: r.manualPick }));
  on('next', () => send({ t: 'next' }));
  on('playAgain', () => send({ t: 'playAgain' }));

  if (s.phase === 'betting' && me && me.playing && !me.locked && r.draft) {
    const draft = r.draft;
    // The most you can put on horse h, in whole cents (never rounding up past your balance).
    const maxFor = (h: number) => Math.max(0, floorCents(me.balance - (sum(draft) - draft[h])));
    const changed = () => { queueBets(r); renderRoom(r); }; // renderRoom patches; it won't replace the inputs
    app.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => {
      b.onclick = () => {
        const h = Number(b.dataset.step), d = Number(b.dataset.d);
        draft[h] = r2(Math.max(0, Math.min(maxFor(h), draft[h] + d)));
        r.draftText[h] = draft[h] ? String(draft[h]) : '';
        const input = document.getElementById(`bet${h}`) as HTMLInputElement | null;
        if (input) input.value = r.draftText[h];
        changed();
      };
    });
    app.querySelectorAll<HTMLInputElement>('[data-bet]').forEach((inp) => {
      inp.oninput = () => {
        const h = Number(inp.dataset.bet);
        // Digits and one decimal point, at most two decimal places.
        let text = inp.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').replace(/(\.\d\d)\d+/, '$1');
        let v = text === '' || text === '.' ? 0 : Number(text);
        const max = maxFor(h);
        if (v > max) { v = max; text = String(max); toast(`You only have ${money(max)} left to bet.`); }
        draft[h] = r2(v);
        r.draftText[h] = text;
        if (inp.value !== text) inp.value = text;
        changed();
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
