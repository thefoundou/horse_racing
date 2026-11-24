// End-of-game recap: the podium and the biggest moments of the whole game,
// worked out from each player's round results and the lobby's round log.

import { START_BALANCE } from './game';
import { streak } from './awards';
import type { PublicPlayer, PublicState, RoundLog } from './protocol';

export interface Moment {
  id: string;
  emoji: string;
  title: string;
  /** The big line: an amount, a count, a name. */
  headline: string;
  detail: string;
  playerIds: string[];
  horse?: number;
  tone: 'good' | 'bad' | 'neutral';
}

export interface GameRecap {
  /** Everyone, best first. */
  ranked: PublicPlayer[];
  moments: Moment[];
  stats: { rounds: number; wagered: number; digital: number; manual: number };
}

const EPS = 0.005;
const fmt = (n: number) => {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return (n < -EPS ? '−' : '') + '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
};
const signed = (n: number) => (n > EPS ? '+' : '') + fmt(n);
const list = (xs: (string | number)[]) => xs.length <= 1 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** Balances after each round, starting from the opening $100. */
export function runningBalances(p: PublicPlayer): number[] {
  const out = [START_BALANCE];
  for (const n of p.history) out.push(out[out.length - 1] + (n ?? 0));
  return out;
}

/** Longest run of rounds matching `test`, anywhere in the game. */
function longestRun(history: (number | null)[], test: (n: number) => boolean): { len: number; end: number } {
  let best = { len: 0, end: -1 };
  for (let i = 0; i < history.length; i++) {
    const len = streak(history.slice(0, i + 1), test);
    if (len > best.len) best = { len, end: i };
  }
  return best;
}

export function gameRecap(s: PublicState): GameRecap {
  const ranked = s.players.slice().sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const log: RoundLog[] = s.log ?? [];
  const moments: Moment[] = [];
  const add = (m: Moment) => moments.push(m);
  const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? '?';

  // Single biggest win and loss.
  let bigWin: { p: PublicPlayer; n: number; r: number } | null = null;
  let bigLoss: { p: PublicPlayer; n: number; r: number } | null = null;
  for (const p of s.players) p.history.forEach((n, i) => {
    if (n == null) return;
    if (n > EPS && (!bigWin || n > bigWin.n)) bigWin = { p, n, r: i + 1 };
    if (n < -EPS && (!bigLoss || n < bigLoss.n)) bigLoss = { p, n, r: i + 1 };
  });
  if (bigWin) {
    const { p, n, r } = bigWin as { p: PublicPlayer; n: number; r: number };
    const h = log.find((l) => l.round === r)?.winner;
    add({ id: 'bigwin', emoji: '💥', title: 'Biggest win', headline: signed(n), detail: `${p.name} in round ${r}${h ? ` on horse ${h}` : ''}`, playerIds: [p.id], horse: h, tone: 'good' });
  }
  if (bigLoss) {
    const { p, n, r } = bigLoss as { p: PublicPlayer; n: number; r: number };
    add({ id: 'bigloss', emoji: '😭', title: 'Most painful loss', headline: signed(n), detail: `${p.name} in round ${r}`, playerIds: [p.id], tone: 'bad' });
  }

  // The longest shot that came in, and who had it.
  const shots = log.filter((l) => l.winOdds > 0).sort((a, b) => b.winOdds - a.winOdds);
  if (shots[0] && shots[0].winOdds >= 3) {
    const l = shots[0];
    const backers = Object.entries(l.stakes).filter(([, [, on]]) => on > 0).map(([id]) => id);
    add({ id: 'longshot', emoji: '🎯', title: 'Longest shot', headline: `×${l.winOdds.toFixed(1)}`, detail: `Horse ${l.winner} in round ${l.round}, backed by ${list(backers.map(name))}`, playerIds: backers, horse: l.winner, tone: 'good' });
  }

  // Comebacks and collapses, from each player's running balance.
  let comeback: { p: PublicPlayer; low: number; gain: number } | null = null;
  let collapse: { p: PublicPlayer; high: number; drop: number } | null = null;
  for (const p of s.players) {
    const bal = runningBalances(p);
    const low = Math.min(...bal), high = Math.max(...bal);
    if (low < START_BALANCE - EPS && p.balance - low >= 20 && (!comeback || p.balance - low > comeback.gain)) comeback = { p, low, gain: p.balance - low };
    if (high > START_BALANCE + EPS && high - p.balance >= 20 && (!collapse || high - p.balance > collapse.drop)) collapse = { p, high, drop: high - p.balance };
  }
  if (comeback) {
    const { p, low } = comeback as { p: PublicPlayer; low: number };
    add({ id: 'comeback', emoji: '🚀', title: 'Comeback of the day', headline: `${fmt(low)} → ${fmt(p.balance)}`, detail: `${p.name} climbed back from the brink`, playerIds: [p.id], tone: 'good' });
  }
  if (collapse) {
    const { p, high } = collapse as { p: PublicPlayer; high: number };
    add({ id: 'collapse', emoji: '📉', title: 'Biggest collapse', headline: `${fmt(high)} → ${fmt(p.balance)}`, detail: `${p.name} was flying, then…`, playerIds: [p.id], tone: 'bad' });
  }

  // Streaks across the whole game.
  const runs = (test: (n: number) => boolean) => s.players
    .map((p) => ({ p, ...longestRun(p.history, test) }))
    .sort((a, b) => b.len - a.len);
  const hot = runs((n) => n > EPS)[0];
  if (hot && hot.len >= 2) add({ id: 'hot', emoji: '🔥', title: 'Hottest streak', headline: `${hot.len} wins in a row`, detail: `${hot.p.name}, rounds ${hot.end - hot.len + 2}–${hot.end + 1}`, playerIds: [hot.p.id], tone: 'good' });
  const cold = runs((n) => n < -EPS)[0];
  if (cold && cold.len >= 2) add({ id: 'cold', emoji: '🥶', title: 'Coldest streak', headline: `${cold.len} losses in a row`, detail: `${cold.p.name}, rounds ${cold.end - cold.len + 2}–${cold.end + 1}`, playerIds: [cold.p.id], tone: 'bad' });

  // Who bet the most, and who barely bet at all.
  const staked = new Map<string, number>();
  for (const l of log) for (const [id, [st]] of Object.entries(l.stakes)) staked.set(id, (staked.get(id) ?? 0) + st);
  const bettors = [...staked.entries()].sort((a, b) => b[1] - a[1]);
  if (bettors.length >= 2 && bettors[0][1] > 0) {
    add({ id: 'highroller', emoji: '🎩', title: 'High roller', headline: fmt(bettors[0][1]), detail: `${name(bettors[0][0])} put the most on the line`, playerIds: [bettors[0][0]], tone: 'neutral' });
    const [id, amt] = bettors[bettors.length - 1];
    add({ id: 'tightwallet', emoji: '👛', title: 'Tightest wallet', headline: amt > 0 ? fmt(amt) : 'Never bet', detail: `${name(id)} ${amt > 0 ? 'staked the least all game' : 'kept every cent'}`, playerIds: [id], tone: 'neutral' });
  }

  // The horses and the races.
  const wins = new Map<number, number>();
  for (const l of log) wins.set(l.winner, (wins.get(l.winner) ?? 0) + 1);
  const fav = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
  if (fav && fav[1] >= 2) add({ id: 'favhorse', emoji: '🐎', title: 'Horse of the day', headline: `Horse ${fav[0]}`, detail: `Won ${fav[1]} of ${log.length} races`, playerIds: [], horse: fav[0], tone: 'neutral' });
  const marathon = log.filter((l) => l.mode === 'digital').sort((a, b) => b.rolls - a.rolls)[0];
  if (marathon && marathon.rolls > 0) add({ id: 'marathon', emoji: '⏱️', title: 'Longest race', headline: `${marathon.rolls} rolls`, detail: `Round ${marathon.round}, won by horse ${marathon.winner}`, playerIds: [], horse: marathon.winner, tone: 'neutral' });
  const pot = log.slice().sort((a, b) => b.pool - a.pool)[0];
  if (pot && pot.pool > 0) add({ id: 'bigpot', emoji: '💰', title: 'Biggest pot', headline: fmt(pot.pool), detail: `Round ${pot.round}`, playerIds: [], tone: 'neutral' });
  const shutouts = log.filter((l) => l.winOdds === 0 && l.pool > 0).map((l) => l.round);
  if (shutouts.length) add({ id: 'shutout', emoji: '🙈', title: 'Nobody saw it coming', headline: `${shutouts.length} ${shutouts.length === 1 ? 'race' : 'races'}`, detail: `Nobody backed the winner in round ${list(shutouts)}`, playerIds: [], tone: 'bad' });

  return {
    ranked,
    moments,
    stats: {
      rounds: log.length,
      wagered: log.reduce((a, l) => a + l.pool, 0),
      digital: log.filter((l) => l.mode === 'digital').length,
      manual: log.filter((l) => l.mode === 'manual').length,
    },
  };
}
