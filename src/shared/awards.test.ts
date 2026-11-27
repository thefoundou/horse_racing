import { describe, expect, it } from 'vitest';
import { rankChanges, roundAwards, streak, streakBadge } from './awards';
import type { PublicPlayer, PublicState } from './protocol';

function player(id: string, balance: number, history: (number | null)[], bets: number[] | null): PublicPlayer {
  return {
    id, name: id, balance, history, bets, staked: bets ? bets.reduce((a, b) => a + b, 0) : null,
    connected: true, locked: true, playing: true, avatar: null, budget: 100,
  };
}

function state(players: PublicPlayer[], winner: number): PublicState {
  return {
    code: 'ABCD', hostId: 'host', phase: 'results', rounds: 6, startBalance: 100, photoEveryRound: false, round: players[0].history.length,
    players, totals: null, mode: 'manual', positions: [0, 0, 0, 0, 0, 0], lastRoll: null, rollCount: 0, photo: null,
    manualFinished: true, winner, log: [], hostConnected: true, lineup: null, chat: [],
  };
}

const ids = (awards: { id: string; playerId: string }[]) => awards.map((a) => `${a.playerId}:${a.id}`).sort();

describe('streak', () => {
  it('counts the run ending with the latest round', () => {
    expect(streak([5, -2, 3, 4], (n) => n > 0)).toBe(2);
    expect(streak([5, null, 3], (n) => n > 0)).toBe(1);
    expect(streak([-1], (n) => n > 0)).toBe(0);
  });
});

describe('roundAwards', () => {
  // Round 1 from the payout tests: horse 1 wins, pool 80, 40 on horse 1.
  const alice = player('alice', 105, [5], [10, 0, 5, 0, 0, 0]);
  const bob = player('bob', 75, [-25], [0, 20, 5, 0, 0, 0]);
  const cara = player('cara', 120, [20], [30, 0, 0, 0, 0, 10]);

  it('picks the biggest winner and loser', () => {
    const r = roundAwards(state([alice, bob, cara], 1));
    expect(r.best?.player.id).toBe('cara');
    expect(r.best?.net).toBe(20);
    expect(r.worst?.player.id).toBe('bob');
    expect(r.worst?.net).toBe(-25);
  });

  it('has no biggest loser when nobody lost', () => {
    const r = roundAwards(state([player('a', 110, [10], [10, 0, 0, 0, 0, 0]), player('b', 100, [0], [0, 0, 0, 0, 0, 0])], 1));
    expect(r.best?.player.id).toBe('a');
    expect(r.worst).toBeNull();
  });

  it('scales "Doubled up" to the starting budget', () => {
    const big = (startBalance: number) => {
      const s = state([player('a', 210, [120], [60, 0, 0, 0, 0, 0]), player('b', 100, [0], [0, 0, 0, 0, 0, 0])], 1);
      return roundAwards({ ...s, startBalance }).awards.filter((a) => a.id === 'double').map((a) => a.detail);
    };
    expect(big(100)).toEqual(['Over $200']);
    expect(big(500)).toEqual([]);
  });

  it('gives a new outright leader the crown', () => {
    expect(ids(roundAwards(state([alice, bob, cara], 1)).awards)).toContain('cara:leader');
  });

  it('spots streaks, all-in, long shots, hedging, sitting out and busting', () => {
    const hot = player('hot', 150, [10, 20, 20], [20, 0, 0, 0, 0, 0]);       // 3 wins
    const cold = player('cold', 40, [-20, -20, -20], [0, 0, 20, 0, 0, 0]);    // 3 losses
    const allin = player('allin', 0, [0, -60], [0, 60, 0, 0, 0, 0]);          // all of $60, lost, busted
    const hedge = player('hedge', 94, [-6], [1, 1, 1, 1, 1, 1]);
    const idle = player('idle', 100, [0], [0, 0, 0, 0, 0, 0]);
    const r = roundAwards(state([hot, cold, allin, hedge, idle], 1));
    const got = ids(r.awards);
    // Streaks show on the leaderboard instead of as badges.
    expect(got.some((g) => g.endsWith(':hot') || g.endsWith(':cold'))).toBe(false);
    expect(streakBadge(hot)).toMatchObject({ emoji: '🔥', count: 3 });
    expect(streakBadge(cold)).toMatchObject({ emoji: '🥶', count: 3 });
    expect(streakBadge(idle)).toBeNull();
    expect(got).toContain('allin:allin');
    expect(got).toContain('allin:busted');
    expect(got).toContain('hedge:hedge');
    expect(got).toContain('idle:wallflower');
    // Pool 106 with 21 on horse 1: ×5 long shot for both backers who won.
    expect(got).toContain('hot:longshot');
    expect(got).toContain('hot:sniper');
  });

  it('tracks rank changes from balances before the round', () => {
    const { before, after } = rankChanges(state([alice, bob, cara], 1));
    expect(before.get('alice')).toBe(0); // everyone level on $100 before
    expect(after.get('cara')).toBe(0);
    expect(after.get('bob')).toBe(2);
  });
});
