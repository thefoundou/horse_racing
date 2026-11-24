# Horse Race

A multiplayer horse-betting party game for phones and laptops, based on the "Horse Race Game r11.xls" spreadsheet.

## How to play

1. Someone taps **Start a lobby**. They become the host and get a 4-letter room code (the link `/<CODE>` works too).
2. Everyone else enters the code and picks a display name. Each player starts with **$100** of play money.
3. The host picks the number of rounds and starts the game. Each round:
   - **Betting:** bet any amounts on horses 1–6, up to your balance. Live odds update as people bet. Other players' bets stay hidden until betting closes. Tap **Lock in** when you're done. You can unlock and change your bets until everyone has locked in. The host can also **Close betting** early (for example, if someone has wandered off).
   - **Bets are in:** everyone sees what they'd get back for each possible winner, plus the full bet table.
   - **Race:** the host picks the mode.
     - *Digital:* each tap rolls 3 dice, and each die moves the horse with that number one space. The first horse to reach 10 that is strictly ahead of every other horse wins. If horses are tied at the line, keep rolling. Auto-roll is available.
     - *Manual:* run a real race, then the host presses **Finish** and picks the winner.
   - **Results:** winnings are paid out and a leaderboard ranks players by money.
4. After the last round, the final standings show a round-by-round table, like the spreadsheet's Results sheet. The host can start again.

Players who join mid-game get $100 and sit out any round whose betting has already closed.

## The maths (from the spreadsheet)

Parimutuel betting with no house cut. For each race:

- `pool` = every player's bets on every horse
- `odds[h] = pool / (total bet on h)`, or 0 if nobody backed `h`
- `net = bet on winner × odds[winner] − everything you staked`

If nobody backed the winning horse, its odds are 0 and every stake is lost. This matches the sheet. See `src/shared/game.ts`; the tests in `src/shared/game.test.ts` check it against a literal transcription of the sheet's formulas.

## Architecture

- `src/client/`: the single-page app (Vite + TypeScript, no framework).
- `src/worker/index.ts`: Worker API. `POST /api/rooms` creates a lobby, `GET /api/rooms/:code` checks a code, and `/api/rooms/:code/ws` is the game WebSocket.
- `src/worker/lobby.ts`: the `Lobby` Durable Object, one per room code. It holds the game state, enforces every rule, and broadcasts state to players over hibernatable WebSockets. A lobby is wiped after 24 hours with no activity.
- `src/shared/`: game rules and message types, used by both the client and the worker.

## Develop

```bash
npm install
npm test            # payout / race maths
npx wrangler dev    # builds, then serves the site + Worker at http://localhost:8787
```

For hot reload on the client, run `npm run dev:worker` (Worker on :8787) and `npm run dev` (Vite, which proxies `/api` to the Worker) side by side. Vite listens on your LAN, so phones on the same Wi-Fi can join.

After changing `wrangler.jsonc`, run `npm run types` to regenerate `worker-configuration.d.ts`.

## Deploy

```bash
npm run deploy
```

`wrangler deploy` runs the build itself. The Durable Object migration (`v1`, `Lobby`) is in `wrangler.jsonc`.
