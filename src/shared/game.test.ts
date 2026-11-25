import { describe, expect, it } from 'vitest';
import {
  applyRoll, cents, emptyBets, floorCents, isTiedAtLine, net, odds, payout, photoContenders, photoWinner, pool, raceWinner, rollDice, rollDie, sum,
  validateBets, type Bets,
} from './game';

// Spreadsheet formula, transcribed literally, as the reference:
// odds[h] = IF(SUM(col h)=0, 0, 1/(SUM(col h)/SUM(all)))
// net     = SUMPRODUCT(winnerRow, odds, bets) - SUM(bets)
function sheetNet(bets: Bets, all: Bets[], winner: number): number {
  const colSum = (h: number) => all.reduce((a, b) => a + b[h], 0);
  const total = all.reduce((a, b) => a + sum(b), 0);
  let won = 0;
  for (let h = 0; h < 6; h++) {
    const flag = h === winner ? 1 : 0;
    const o = colSum(h) === 0 ? 0 : 1 / (colSum(h) / total);
    won += flag * o * bets[h];
  }
  return won - sum(bets);
}

const alice: Bets = [10, 0, 5, 0, 0, 0];
const bob: Bets = [0, 20, 5, 0, 0, 0];
const cara: Bets = [30, 0, 0, 0, 0, 10];
const all = [alice, bob, cara];

describe('parimutuel odds', () => {
  it('is pool / total on horse, 0 for unbacked horses', () => {
    expect(pool(all)).toBe(80);
    expect(odds(all)).toEqual([2, 4, 8, 0, 0, 8]);
  });

  it('pays bet × pool ÷ total on winner, minus all stakes', () => {
    // Horse 1 wins: pool 80, 40 on horse 1.
    expect(payout(alice, all, 0)).toBe(20);
    expect(net(alice, all, 0)).toBe(5);    // 20 back − 15 staked
    expect(net(bob, all, 0)).toBe(-25);
    expect(net(cara, all, 0)).toBe(20);    // 60 back − 40 staked
  });

  it('matches the spreadsheet formula for every winner', () => {
    for (let w = 0; w < 6; w++)
      for (const p of all) expect(net(p, all, w)).toBeCloseTo(sheetNet(p, all, w), 10);
  });

  it('conserves money when someone backed the winner', () => {
    for (const w of [0, 1, 2, 5]) expect(sum(all.map((p) => net(p, all, w)))).toBeCloseTo(0, 10);
  });

  it('everyone loses their stake if nobody backed the winner', () => {
    expect(net(alice, all, 3)).toBe(-15);
    expect(net(bob, all, 3)).toBe(-25);
    expect(net(cara, all, 3)).toBe(-40);
  });

  it('a player who bet nothing nets 0', () => {
    expect(net(emptyBets(), all, 0)).toBe(0);
    expect(odds([emptyBets()])).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('matches the sheet on random races', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const players = Array.from({ length: 2 + Math.floor(rand() * 6) }, () =>
        Array.from({ length: 6 }, () => (rand() < 0.5 ? 0 : Math.round(rand() * 40))));
      const w = Math.floor(rand() * 6);
      for (const p of players) expect(net(p, players, w)).toBeCloseTo(sheetNet(p, players, w), 9);
    }
  });
});

describe('digital race', () => {
  it('moves the horse shown on each die', () => {
    expect(applyRoll([0, 0, 0, 0, 0, 0], [2, 2, 6])).toEqual([0, 2, 0, 0, 0, 1]);
  });

  it('dice show 1-6', () => {
    expect(rollDice(() => 0)).toEqual([1, 1, 1]);
    expect(rollDice(() => 0.9999)).toEqual([6, 6, 6]);
  });

  it('no winner before the line', () => {
    expect(raceWinner([9, 9, 9, 0, 0, 0])).toBeNull();
  });

  it('first horse strictly ahead at the line wins', () => {
    expect(raceWinner([10, 9, 3, 0, 0, 0])).toBe(0);
    expect(raceWinner([11, 10, 3, 0, 0, 0])).toBe(0);
  });

  it('a tie at the line keeps the race going', () => {
    expect(raceWinner([10, 10, 3, 0, 0, 0])).toBeNull();
    expect(isTiedAtLine([10, 10, 3, 0, 0, 0])).toBe(true);
    expect(raceWinner(applyRoll([10, 10, 3, 0, 0, 0], [2, 4, 5]))).toBe(1);
  });

  it('a photo finish is only the horses level in front at the line', () => {
    expect(photoContenders([10, 10, 9, 10, 0, 0])).toEqual([1, 2, 4]);
    expect(photoContenders([11, 11, 10, 0, 0, 0])).toEqual([1, 2]);
    expect(photoContenders([10, 9, 0, 0, 0, 0])).toBeNull();
    expect(photoContenders([9, 9, 0, 0, 0, 0])).toBeNull();
  });

  it('a photo-finish die counts only if it shows a contender', () => {
    expect(photoWinner([2, 5], 5)).toBe(5);
    expect(photoWinner([2, 5], 3)).toBeNull();
    expect(rollDie(() => 0)).toBe(1);
    expect(rollDie(() => 0.9999)).toBe(6);
  });
});

describe('bet validation', () => {
  it('rejects bets over balance or negative', () => {
    expect(validateBets([50, 51, 0, 0, 0, 0], 100)).toBeTypeOf('string');
    expect(validateBets([-1, 0, 0, 0, 0, 0], 100)).toBeTypeOf('string');
    expect(validateBets([1, 2], 100)).toBeTypeOf('string');
  });
  it('accepts up to the full balance, rounded to cents', () => {
    expect(validateBets([50, 50, 0, 0, 0, 0], 100)).toEqual([50, 50, 0, 0, 0, 0]);
    expect(validateBets([1.234, 0, 0, 0, 0, 0], 100)).toEqual([1.23, 0, 0, 0, 0, 0]);
  });
});

describe('all in at awkward balances (bug: $94.67 all-in rejected)', () => {
  it('never rounds a bet limit up past the balance', () => {
    expect(floorCents(94.666667)).toBe(94.66);
    expect(floorCents(94.67)).toBe(94.67);
    expect(floorCents(0.1 + 0.2)).toBe(0.3);
    expect(cents(94.666667)).toBe(94.67);
  });
  it('accepts an all-in bet of the floored balance', () => {
    expect(validateBets([94.66, 0, 0, 0, 0, 0], 94.666667)).toEqual([94.66, 0, 0, 0, 0, 0]);
    expect(validateBets([94.67, 0, 0, 0, 0, 0], 94.67)).toEqual([94.67, 0, 0, 0, 0, 0]);
    expect(validateBets([20, 21, 0, 0, 0, 0], 82)).toEqual([20, 21, 0, 0, 0, 0]);
  });
  it('explains how much you can bet when it is too much', () => {
    expect(validateBets([94.67, 0, 0, 0, 0, 0], 94.666667)).toBe('You only have $94.66 to bet.');
  });
  it('settled balances in whole cents can always go all in', () => {
    // Payouts of thirds: 100 split three ways, kept to the cent.
    const all = [[10, 0, 0, 0, 0, 0], [0, 20, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0]];
    for (const p of all) {
      const bal = cents(100 + cents(net(p, all, 0)));
      expect(Math.round(bal * 100)).toBe(bal * 100);
      expect(validateBets([bal, 0, 0, 0, 0, 0], bal)).toEqual([bal, 0, 0, 0, 0, 0]);
    }
  });
});
