// One Durable Object per lobby (keyed by room code). It holds the whole game
// and is the only place rules are enforced; browsers just send intents and
// render the state broadcast back. Uses the WebSocket Hibernation API, so an
// idle lobby costs nothing; state is persisted after every change.

import { DurableObject } from 'cloudflare:workers';
import {
  applyRoll, emptyBets, HORSES, horseTotals, net, raceWinner, rollDice, START_BALANCE, sum,
  tidy, validateBets, type Bets,
} from '../shared/game';
import {
  MAX_NAME, MAX_PLAYERS, MAX_ROUNDS,
  type ClientMsg, type Phase, type PublicState, type RaceMode, type ServerMsg,
} from '../shared/protocol';

interface Player {
  id: string;
  name: string;
  balance: number;
  bets: Bets;
  locked: boolean;
  playing: boolean;
  history: (number | null)[];
}

interface State {
  code: string;
  hostId: string;
  phase: Phase;
  rounds: number;
  round: number;
  players: Player[];
  mode: RaceMode | null;
  positions: number[];
  lastRoll: number[] | null;
  rollCount: number;
  manualFinished: boolean;
  winner: number | null; // 1..6
}

interface Attachment { playerId: string | null }

/** Lobbies are wiped after this long with no activity. */
const IDLE_MS = 24 * 60 * 60 * 1000;
const BROKE = 0.01;

class GameError extends Error {}
const fail = (message: string): never => { throw new GameError(message); };

export class Lobby extends DurableObject<Env> {
  private state: State | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<State>('state')) ?? null;
    });
  }

  // ---- RPC from the Worker ----------------------------------------------

  async create(code: string, hostId: string): Promise<boolean> {
    if (this.state) return false;
    this.state = {
      code, hostId, phase: 'lobby', rounds: 6, round: 0, players: [],
      mode: null, positions: Array(HORSES).fill(0), lastRoll: null, rollCount: 0,
      manualFinished: false, winner: null,
    };
    await this.save();
    return true;
  }

  async exists(): Promise<boolean> {
    return this.state !== null;
  }

  async fetch(): Promise<Response> {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    if (!this.state) {
      this.send(server, { t: 'error', message: 'That lobby does not exist (or has expired).', fatal: true });
      server.close(4404, 'No such lobby');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) ws.close(4410, 'Lobby expired');
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  // ---- WebSocket handlers -----------------------------------------------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const s = this.state;
    if (!s) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    try {
      const att = ws.deserializeAttachment() as Attachment;
      if (msg.t === 'hello') {
        const playerId = this.hello(s, msg.playerId, msg.name);
        ws.serializeAttachment({ playerId } satisfies Attachment);
      } else {
        const me = s.players.find((p) => p.id === att.playerId) ?? fail('Join the lobby first.');
        this.act(s, me, msg);
      }
      await this.save();
      this.broadcast();
    } catch (e) {
      if (e instanceof GameError) this.send(ws, { t: 'error', message: e.message });
      else throw e;
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code === 1005 ? 1000 : code, 'Closing'); } catch { /* already closed */ }
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcast(ws);
  }

  // ---- Game rules -------------------------------------------------------

  private hello(s: State, playerId: unknown, rawName: unknown): string {
    if (typeof playerId !== 'string' || !playerId || playerId.length > 64) fail('Bad player id.');
    const id = playerId as string;
    const existing = s.players.find((p) => p.id === id);
    if (existing) return id; // rejoining (refresh, new tab, dropped connection)

    const name = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) : '';
    if (!name) fail('Pick a display name.');
    if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(`"${name}" is taken in this lobby.`);
    if (s.players.length >= MAX_PLAYERS) fail('This lobby is full.');

    // Joining mid-game: you start with $100 and sit out any round whose
    // betting has already closed.
    const playing = s.phase === 'lobby' || s.phase === 'betting';
    const roundsDone = s.players[0]?.history.length ?? 0;
    s.players.push({
      id, name, balance: START_BALANCE, bets: emptyBets(), locked: !playing, playing,
      history: Array(roundsDone).fill(null),
    });
    return id;
  }

  private act(s: State, me: Player, msg: ClientMsg): void {
    const isHost = me.id === s.hostId;
    const host = () => { if (!isHost) fail('Only the host can do that.'); };
    const phase = (...ok: Phase[]) => { if (!ok.includes(s.phase)) fail('Not right now.'); };

    switch (msg.t) {
      case 'config': {
        host(); phase('lobby');
        const n = Math.floor(Number(msg.rounds));
        if (!(n >= 1 && n <= MAX_ROUNDS)) fail(`Rounds must be 1-${MAX_ROUNDS}.`);
        s.rounds = n;
        return;
      }
      case 'start':
        host(); phase('lobby');
        s.round = 1;
        return this.beginRound(s);

      case 'bets': {
        phase('betting');
        if (!me.playing) fail("You're sitting this round out.");
        if (me.locked) fail('Your bets are locked in. Unlock to change them.');
        const bets = validateBets(msg.bets, me.balance);
        if (typeof bets === 'string') fail(bets);
        me.bets = bets as Bets;
        return;
      }
      case 'lock':
        phase('betting');
        if (!me.playing) fail("You're sitting this round out.");
        me.locked = true;
        return this.checkAllLocked(s);

      case 'unlock':
        phase('betting');
        if (me.playing && me.balance >= BROKE) me.locked = false;
        return;

      case 'closeBetting':
        host(); phase('betting');
        for (const p of s.players) p.locked = true;
        return this.checkAllLocked(s);

      case 'race':
        host(); phase('review');
        if (msg.mode !== 'digital' && msg.mode !== 'manual') fail('Pick digital or manual.');
        s.mode = msg.mode;
        s.phase = 'racing';
        return;

      case 'roll': {
        host(); phase('racing');
        if (s.mode !== 'digital') fail('This is a manual race.');
        const dice = rollDice();
        s.positions = applyRoll(s.positions, dice);
        s.lastRoll = dice;
        s.rollCount += 1;
        const w = raceWinner(s.positions);
        if (w !== null) this.settle(s, w);
        return;
      }
      case 'finish':
        host(); phase('racing');
        if (s.mode !== 'manual') fail('This is a digital race.');
        s.manualFinished = true;
        return;

      case 'winner': {
        host(); phase('racing');
        if (s.mode !== 'manual' || !s.manualFinished) fail('Press Finish first.');
        const h = Math.floor(Number(msg.horse));
        if (!(h >= 1 && h <= HORSES)) fail('Pick a horse 1-6.');
        return this.settle(s, h - 1);
      }
      case 'next':
        host(); phase('results');
        if (s.round >= s.rounds) { s.phase = 'finished'; return; }
        s.round += 1;
        return this.beginRound(s);

      case 'playAgain':
        host(); phase('finished');
        for (const p of s.players) Object.assign(p, { balance: START_BALANCE, history: [], bets: emptyBets() });
        s.phase = 'lobby';
        s.round = 0;
        return;

      default:
        fail('Unknown action.');
    }
  }

  private beginRound(s: State): void {
    s.phase = 'betting';
    s.mode = null;
    s.positions = Array(HORSES).fill(0);
    s.lastRoll = null;
    s.rollCount = 0;
    s.manualFinished = false;
    s.winner = null;
    for (const p of s.players) {
      p.bets = emptyBets();
      p.playing = true;
      p.locked = p.balance < BROKE; // nothing left to bet
    }
    this.checkAllLocked(s);
  }

  private checkAllLocked(s: State): void {
    if (s.phase === 'betting' && s.players.filter((p) => p.playing).every((p) => p.locked)) s.phase = 'review';
  }

  /** Pay out the round, exactly as the spreadsheet does. `w` is 0..5. */
  private settle(s: State, w: number): void {
    const allBets = s.players.filter((p) => p.playing).map((p) => p.bets);
    for (const p of s.players) {
      if (!p.playing) { p.history.push(null); continue; }
      const n = tidy(net(p.bets, allBets, w));
      p.balance = tidy(p.balance + n);
      p.history.push(n);
    }
    s.winner = w + 1;
    s.phase = 'results';
  }

  // ---- Plumbing ---------------------------------------------------------

  private async save(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put('state', this.state);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
  }

  private view(s: State, you: string | null, online: Set<string>): PublicState {
    const open = s.phase === 'lobby' || s.phase === 'betting';
    return {
      code: s.code, hostId: s.hostId, phase: s.phase, rounds: s.rounds, round: s.round,
      players: s.players.map((p) => {
        const visible = p.id === you || !open;
        return {
          id: p.id, name: p.name, balance: p.balance, connected: online.has(p.id),
          locked: p.locked, playing: p.playing, history: p.history,
          bets: visible ? p.bets : null, staked: visible ? sum(p.bets) : null,
        };
      }),
      totals: horseTotals(s.players.filter((p) => p.playing).map((p) => p.bets)),
      mode: s.mode, positions: s.positions, lastRoll: s.lastRoll, rollCount: s.rollCount,
      manualFinished: s.manualFinished, winner: s.winner,
    };
  }

  private broadcast(exclude?: WebSocket): void {
    const s = this.state;
    if (!s) return;
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude);
    const ids = sockets.map((ws) => (ws.deserializeAttachment() as Attachment | null)?.playerId ?? null);
    const online = new Set(ids.filter((x): x is string => !!x));
    sockets.forEach((ws, i) => {
      const you = ids[i];
      if (you) this.send(ws, { t: 'state', you, state: this.view(s, you, online) });
    });
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket gone */ }
  }
}
