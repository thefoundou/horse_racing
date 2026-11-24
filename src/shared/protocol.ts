// Messages between the browser and a lobby's Durable Object, over WebSocket.

import type { Bets } from './game';

export type Phase =
  | 'lobby'     // waiting for players; host picks the number of rounds
  | 'betting'   // players place and lock in bets
  | 'review'    // bets are final; everyone sees what they'd win; host picks race mode
  | 'racing'    // digital dice race, or a manual real-life race
  | 'results'   // winner paid out; leaderboard
  | 'finished'; // all rounds played

export type RaceMode = 'digital' | 'manual';

export interface PublicPlayer {
  id: string;
  name: string;
  balance: number;
  connected: boolean;
  locked: boolean;
  /** Is this player in the current round (false if they joined after betting closed)? */
  playing: boolean;
  /** Total they've staked this round (shown to all once betting closes). */
  staked: number | null;
  /** Their bets, visible to everyone once betting closes; to yourself always. */
  bets: Bets | null;
  /** Net result per finished round (null where they sat a round out). */
  history: (number | null)[];
}

export interface PublicState {
  code: string;
  hostId: string;
  phase: Phase;
  rounds: number;
  /** Keep odds and pool totals secret until betting closes. */
  hideOdds: boolean;
  /** 1-based; 0 before the game starts. */
  round: number;
  players: PublicPlayer[];
  /** Total on each horse this round: live while betting, or null if the host hid the odds. */
  totals: number[] | null;
  mode: RaceMode | null;
  positions: number[];
  lastRoll: number[] | null;
  rollCount: number;
  /** Manual race: the host pressed Finish and is picking the winner. */
  manualFinished: boolean;
  /** Winning horse, 1..6. */
  winner: number | null;
  /** Is the host's big screen connected? (The host runs the game but doesn't play.) */
  hostConnected: boolean;
}

export type ClientMsg =
  | { t: 'hello'; playerId: string; name: string }
  | { t: 'config'; rounds?: number; hideOdds?: boolean }
  | { t: 'start' }
  | { t: 'bets'; bets: Bets }
  | { t: 'lock' }
  | { t: 'unlock' }
  | { t: 'closeBetting' }
  | { t: 'race'; mode: RaceMode }
  | { t: 'roll' }
  | { t: 'finish' }
  | { t: 'winner'; horse: number }
  | { t: 'next' }
  | { t: 'playAgain' };

export type ServerMsg =
  | { t: 'state'; you: string; state: PublicState }
  | { t: 'error'; message: string; fatal?: boolean };

export const MAX_ROUNDS = 50;
export const MAX_PLAYERS = 30;
export const MAX_NAME = 20;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
export const CODE_LENGTH = 4;
export const isRoomCode = (s: string): boolean =>
  new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(s);
