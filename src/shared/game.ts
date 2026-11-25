// Game rules, shared by the Worker (which is the source of truth) and the
// client (which shows live odds and "what you'd get back").
//
// The betting maths follows the "Horse Race Game r11.xls" spreadsheet:
//   odds[h]  = IF(SUM(bets on h) = 0, 0, 1 / (SUM(bets on h) / SUM(all bets)))
//            = pool / total bet on h          (parimutuel, no house cut)
//   net      = SUM_h winnerFlag[h] * odds[h] * bet[h]  -  SUM(player's bets)
// So if nobody backed the winner its odds are 0 and every stake is lost.

export const HORSES = 6;
export const START_BALANCE = 100;
export const FINISH = 10;
export const DICE_PER_ROLL = 3;

/** A player's stake on horses 1..6, stored at indexes 0..5. */
export type Bets = number[];

export const emptyBets = (): Bets => Array(HORSES).fill(0);

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Total staked on each horse across every player. */
export function horseTotals(allBets: Bets[]): number[] {
  const totals = emptyBets();
  for (const bets of allBets) for (let h = 0; h < HORSES; h++) totals[h] += bets[h] ?? 0;
  return totals;
}

/** Everything bet on every horse this race. */
export const pool = (allBets: Bets[]): number => sum(horseTotals(allBets));

/** Odds per horse: pool ÷ total on that horse, or 0 if nobody backed it. */
export function odds(allBets: Bets[]): number[] {
  const totals = horseTotals(allBets);
  const p = sum(totals);
  return totals.map((t) => (t === 0 ? 0 : 1 / (t / p)));
}

/** What a player gets back (gross) if `winner` (0..5) wins. */
export function payout(bets: Bets, allBets: Bets[], winner: number): number {
  return odds(allBets)[winner] * (bets[winner] ?? 0);
}

/** A player's race result: payout minus everything they staked. */
export function net(bets: Bets, allBets: Bets[], winner: number): number {
  return payout(bets, allBets, winner) - sum(bets);
}

/** Trim float noise (e.g. 0.30000000000000004) without rounding real cents. */
export const tidy = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Round to the nearest cent. Balances are kept in whole cents. */
export const cents = (x: number): number => Math.round(x * 100) / 100;

/**
 * The most you can bet from `x`, in whole cents, never rounding up: $94.666
 * lets you bet $94.66, not $94.67 (which would be more than you have).
 */
export const floorCents = (x: number): number => Math.floor(x * 100 + 1e-6) / 100;

// ---- Digital race -------------------------------------------------------

/** Roll three dice; each die (1..6) is the number of the horse it moves. */
export function rollDice(random: () => number = Math.random): number[] {
  return Array.from({ length: DICE_PER_ROLL }, () => 1 + Math.floor(random() * 6));
}

/** Move each horse one space per die showing its number. */
export function applyRoll(positions: number[], dice: number[]): number[] {
  const next = positions.slice();
  for (const d of dice) next[d - 1] += 1;
  return next;
}

/**
 * The winner (0..5) once a horse has reached FINISH and is strictly ahead of
 * every other horse; null while the race goes on. If two or more horses are
 * level in front at or past the line, nobody has won yet: keep rolling.
 */
export function raceWinner(positions: number[]): number | null {
  const lead = Math.max(...positions);
  if (lead < FINISH) return null;
  const leaders = positions.flatMap((p, i) => (p === lead ? [i] : []));
  return leaders.length === 1 ? leaders[0] : null;
}

/** True while horses are level at or past the line (a photo finish). */
export function isTiedAtLine(positions: number[]): boolean {
  return Math.max(...positions) >= FINISH && raceWinner(positions) === null;
}

/**
 * The horses (1..6) in a photo finish: those level in front when the leaders
 * first reach the line together. Null if there's no tie at the line.
 */
export function photoContenders(positions: number[]): number[] | null {
  if (!isTiedAtLine(positions)) return null;
  const lead = Math.max(...positions);
  return positions.flatMap((p, i) => (p === lead ? [i + 1] : []));
}

/** One die (1..6) for the photo finish. */
export const rollDie = (random: () => number = Math.random): number => 1 + Math.floor(random() * 6);

/** A photo-finish die decides it only if it shows one of the contenders; otherwise roll again. */
export const photoWinner = (contenders: number[], die: number): number | null =>
  contenders.includes(die) ? die : null;

/** Validate a player's bets: six non-negative amounts within their balance. */
export function validateBets(bets: unknown, balance: number): Bets | string {
  if (!Array.isArray(bets) || bets.length !== HORSES) return 'Bets must cover horses 1-6.';
  const clean: Bets = [];
  for (const b of bets) {
    if (typeof b !== 'number' || !Number.isFinite(b) || b < 0) return 'Bets must be zero or more.';
    clean.push(Math.round(b * 100) / 100);
  }
  if (sum(clean) > floorCents(balance) + 1e-9) return `You only have $${floorCents(balance).toFixed(2)} to bet.`;
  return clean;
}
