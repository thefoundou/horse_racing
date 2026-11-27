import { describe, expect, it } from 'vitest';
import { gameRecap, runningBalances } from './recap';
import type { PublicPlayer, PublicState, RoundLog } from './protocol';

const player = (id: string, history: (number | null)[]): PublicPlayer => ({
  id, name: id[0].toUpperCase() + id.slice(1), history,
  balance: 100 + history.reduce<number>((a, n) => a + (n ?? 0), 0),
  bets: null, staked: null, connected: true, locked: true, playing: true, avatar: null, budget: 100,
});

const log = (round: number, winner: number, pool: number, winOdds: number, stakes: Record<string, [number, number]>, rolls = 0): RoundLog =>
  ({ round, winner, mode: rolls ? 'digital' : 'manual', rolls, pool, winOdds, stakes });

function game(players: PublicPlayer[], entries: RoundLog[]): PublicState {
  return {
    code: 'ABCD', hostId: 'host', phase: 'finished', rounds: entries.length, startBalance: 100, photoEveryRound: false, round: entries.length,
    players, totals: null, mode: null, positions: [0, 0, 0, 0, 0, 0], lastRoll: null, rollCount: 0, photo: null,
    manualFinished: false, winner: null, log: entries, hostConnected: true, lineup: null, chat: [],
  };
}

// Four rounds. Ann wins big early then collapses; Ben loses three in a row
// then lands a long shot; Cat barely bets.
const ann = player('ann', [50, 40, -60, -80]);   // 100 → 150 → 190 → 130 → 50
const ben = player('ben', [-30, -20, -40, 150]); // 100 → 70 → 50 → 10 → 160
const cat = player('cat', [0, 0, 5, -5]);
const entries = [
  log(1, 3, 120, 2.4, { ann: [50, 50], ben: [30, 0], cat: [0, 0] }, 14),
  log(2, 3, 80, 2, { ann: [40, 40], ben: [20, 0], cat: [0, 0] }, 22),
  log(3, 5, 100, 0, { ann: [60, 0], ben: [40, 0], cat: [0, 0] }),
  log(4, 6, 160, 16, { ann: [80, 0], ben: [10, 10], cat: [5, 0] }, 9),
];
const recap = gameRecap(game([ann, ben, cat], entries));
const byId = Object.fromEntries(recap.moments.map((m) => [m.id, m]));

describe('gameRecap', () => {
  it('ranks the final standings', () => {
    expect(recap.ranked.map((p) => p.id)).toEqual(['ben', 'cat', 'ann']);
  });

  it('tracks running balances', () => {
    expect(runningBalances(ann, 100)).toEqual([100, 150, 190, 130, 50]);
  });

  it('finds the biggest single win and loss', () => {
    expect(byId.bigwin.headline).toBe('+$150');
    expect(byId.bigwin.playerIds).toEqual(['ben']);
    expect(byId.bigwin.horse).toBe(6);
    expect(byId.bigloss.headline).toBe('−$80');
    expect(byId.bigloss.playerIds).toEqual(['ann']);
  });

  it('finds the longest shot and who backed it', () => {
    expect(byId.longshot.headline).toBe('×16.0');
    expect(byId.longshot.playerIds).toEqual(['ben']);
  });

  it('spots the comeback and the collapse', () => {
    expect(byId.comeback.playerIds).toEqual(['ben']);
    expect(byId.comeback.headline).toBe('$10 → $160');
    expect(byId.collapse.playerIds).toEqual(['ann']);
    expect(byId.collapse.headline).toBe('$190 → $50');
  });

  it('finds the longest streaks anywhere in the game', () => {
    expect(byId.hot.playerIds).toEqual(['ann']);
    expect(byId.hot.headline).toBe('2 wins in a row');
    expect(byId.cold.playerIds).toEqual(['ben']);
    expect(byId.cold.detail).toContain('rounds 1–3');
  });

  it('names the high roller and the tightest wallet', () => {
    expect(byId.highroller.playerIds).toEqual(['ann']);
    expect(byId.highroller.headline).toBe('$230');
    expect(byId.tightwallet.playerIds).toEqual(['cat']);
  });

  it('covers the horses and races', () => {
    expect(byId.favhorse.headline).toBe('Horse 3');
    expect(byId.marathon.headline).toBe('22 rolls');
    expect(byId.bigpot.headline).toBe('$160');
    expect(byId.shutout.detail).toContain('round 3');
    expect(recap.stats).toEqual({ rounds: 4, wagered: 460, digital: 3, manual: 1 });
  });

  it('copes with a game nobody bet in', () => {
    const quiet = gameRecap(game([player('a', [0]), player('b', [0])], [log(1, 2, 0, 0, { a: [0, 0], b: [0, 0] })]));
    expect(quiet.moments.map((m) => m.id)).toEqual([]);
  });
});
