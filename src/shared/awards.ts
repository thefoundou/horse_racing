// End-of-round awards: the biggest winner and loser, plus fun badges
// (streaks, long shots, going all in...). Worked out from the state the
// lobby already broadcasts once a round is settled, so there is nothing new
// to store and every screen agrees.

import { HORSES, horseTotals, sum } from './game';
import type { PublicPlayer, PublicState } from './protocol';

export interface Spotlight {
  player: PublicPlayer;
  net: number;
}

export interface Award {
  id: string;
  emoji: string;
  title: string;
  detail: string;
  playerId: string;
  /** Good news or bad news (sets the colour). */
  tone: 'good' | 'bad' | 'neutral';
}

export interface RoundAwards {
  best: Spotlight | null;
  worst: Spotlight | null;
  awards: Award[];
}

const EPS = 0.005;
const lastNet = (p: PublicPlayer) => (p.history.length ? p.history[p.history.length - 1] : null);

/** How many rounds in a row, ending with the last one, match `test`. */
export function streak(history: (number | null)[], test: (n: number) => boolean): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const v = history[i];
    if (v == null || !test(v)) break;
    n++;
  }
  return n;
}

/** Rank (0 = first) of each player by `balance`, ties sharing a rank. */
function ranks(players: PublicPlayer[], balance: (p: PublicPlayer) => number): Map<string, number> {
  const sorted = players.slice().sort((a, b) => balance(b) - balance(a));
  const out = new Map<string, number>();
  let rank = 0;
  sorted.forEach((p, i) => {
    if (i > 0 && balance(sorted[i - 1]) - balance(p) > 1e-9) rank = i;
    out.set(p.id, rank);
  });
  return out;
}

/** Balance before the round just played. */
export const balanceBefore = (p: PublicPlayer) => p.balance - (lastNet(p) ?? 0);

/** Each player's rank before and after the round just played. */
export function rankChanges(s: PublicState) {
  return { before: ranks(s.players, balanceBefore), after: ranks(s.players, (p) => p.balance) };
}

/**
 * A running streak worth flagging beside a player's name on the leaderboard
 * (kept off the award badges, which are for rarer feats).
 */
export function streakBadge(p: Pick<PublicPlayer, 'history'>): { emoji: string; count: number; tone: 'good' | 'bad'; label: string } | null {
  const wins = streak(p.history, (n) => n > EPS);
  if (wins >= 2) return { emoji: '🔥', count: wins, tone: 'good', label: `On fire: ${wins} wins in a row` };
  const losses = streak(p.history, (n) => n < -EPS);
  if (losses >= 2) return { emoji: '🥶', count: losses, tone: 'bad', label: `Cold streak: ${losses} losses in a row` };
  return null;
}

export function roundAwards(s: PublicState): RoundAwards {
  const played = s.players.filter((p) => p.playing && lastNet(p) != null);
  const byNet = played.slice().sort((a, b) => lastNet(b)! - lastNet(a)! || b.balance - a.balance);
  const top = byNet[0], bottom = byNet[byNet.length - 1];
  const best = top && lastNet(top)! > EPS ? { player: top, net: lastNet(top)! } : null;
  const worst = bottom && lastNet(bottom)! < -EPS && bottom !== top ? { player: bottom, net: lastNet(bottom)! } : null;

  const w = s.winner ? s.winner - 1 : -1;
  const totals = horseTotals(played.map((p) => p.bets ?? []));
  const pool = sum(totals);
  const winOdds = w >= 0 && totals[w] > 0 ? pool / totals[w] : 0;
  const { before, after } = rankChanges(s);
  const leadersBefore = s.players.filter((p) => before.get(p.id) === 0);
  const leadersAfter = s.players.filter((p) => after.get(p.id) === 0);

  const awards: Award[] = [];
  const give = (p: PublicPlayer, a: Omit<Award, 'playerId'>) => awards.push({ ...a, playerId: p.id });

  for (const p of played) {
    const net = lastNet(p)!;
    const bets = p.bets ?? [];
    const staked = sum(bets);
    const prev = balanceBefore(p);

    if (net > EPS && w >= 0 && bets[w] > 0 && winOdds >= 4) {
      give(p, { id: 'longshot', emoji: '🎯', title: 'Long shot', detail: `Backed #${w + 1} at ×${winOdds.toFixed(1)}`, tone: 'good' });
    }
    if (staked > 0 && prev > EPS && staked >= prev - EPS) {
      give(p, { id: 'allin', emoji: net > EPS ? '💰' : '💸', title: 'All in', detail: net > EPS ? 'Bet everything and won' : 'Bet everything and lost it', tone: net > EPS ? 'good' : 'bad' });
    } else if (staked > 0 && w >= 0 && bets[w] === staked) {
      give(p, { id: 'sniper', emoji: '🏹', title: 'Sharpshooter', detail: `Only backed the winner`, tone: 'good' });
    }
    if (bets.length === HORSES && bets.every((b) => b > 0)) {
      give(p, { id: 'hedge', emoji: '🌈', title: 'Hedge fund', detail: 'Backed all six horses', tone: 'neutral' });
    }
    if (staked === 0 && prev > EPS) give(p, { id: 'wallflower', emoji: '🪑', title: 'Wallflower', detail: 'Sat this one out', tone: 'neutral' });
    if (p.balance < 0.01 && prev >= 0.01) give(p, { id: 'busted', emoji: '🪦', title: 'Busted', detail: 'Out of money', tone: 'bad' });
    const twice = s.startBalance * 2;
    if (p.balance >= twice && prev < twice) give(p, { id: 'double', emoji: '✌️', title: 'Doubled up', detail: `Over $${twice.toLocaleString('en-US')}`, tone: 'good' });
    const climbed = (before.get(p.id) ?? 0) - (after.get(p.id) ?? 0);
    if (climbed >= 2) give(p, { id: 'comeback', emoji: '🚀', title: 'Comeback', detail: `Up ${climbed} places`, tone: 'good' });
  }
  // A new outright leader: alone in first now, and wasn't alone in first before.
  const wasSoleLeader = leadersBefore.length === 1 && leadersBefore[0].id === leadersAfter[0]?.id;
  if (leadersAfter.length === 1 && !wasSoleLeader) {
    give(leadersAfter[0], { id: 'leader', emoji: '👑', title: 'New leader', detail: 'Took first place', tone: 'good' });
  }
  return { best, worst, awards };
}
