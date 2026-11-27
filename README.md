# Horse Race

A multiplayer horse-betting party game for phones and laptops, based on the "Horse Race Game r11.xls" spreadsheet.

## How to play

1. On the screen everyone will watch (usually a laptop, often AirPlayed to a TV), tap **Start a lobby on this screen**. That device becomes the **big screen**: it runs the game but doesn't play or bet. It shows a big **QR code** and a 4-letter room code (the link `/<CODE>` works too). Tapping the room code at the top shows the QR code again at any point in the game.
2. Players scan the code (or enter it) on their phones and pick a display name. The next page is just for a **profile photo** (camera or photo library; it's cropped square and shrunk to a small JPEG on the phone). Last game's photo is offered again, and players can skip it. Photos show on the leaderboard and player lists; anyone without one gets their initial. Players can change their name from the lobby until the host starts the game. Each player starts with the same budget of play money: **$100** unless the host picks another amount.
3. On the big screen, the host picks the number of rounds and the **starting budget** (quick picks from $20 to $1,000, or any whole-dollar amount up to $1,000,000), and can turn on **📸 Photo finish every round** (the dice are quietly steered so every digital race ends with horses level at the line), then starts the game. Changing the budget updates everyone already in the lobby. Each round:
   - **Betting:** players bet on their phones, any amounts on horses 1–6, up to their balance. The big screen shows the six horses and who has locked in. Everyone bets blind: the odds and pool totals aren't even sent to browsers until everyone has locked in. Other players' bets stay hidden until betting closes. Tap **Lock in** when you're done. You can unlock and change your bets until everyone has locked in. The host can also **Close betting** early (for example, if someone has wandered off).
   - **Bets are in:** the big screen shows the final odds and everyone's bets; each phone shows what that player would get back for each possible winner.
   - **Race:** the host picks the mode.
     - *Digital:* the horses (with jockeys in their colours) canter across a turf track on the big screen, and in miniature on the phones, sliding and bouncing to each new spot. On the big screen, the photo of everyone who backed a horse trails it, however many there are (they squeeze up to fit). Each lane shows that horse's odds at its end. Each roll is 3 dice, and each die moves the horse with that number one space. The first horse to reach 10 that is strictly ahead of every other horse wins. If horses reach the line level in front, it's a **photo finish**: the camera zooms in on them at the line with the crowd roaring, then the close-up has them gallop in neck and neck, with camera flashes. Then one die is rolled at a time: it's shaken (glowing) and bounces across the baize for a few seconds before it lands. If it shows one of those horses, that horse wins, and the others tumble and crash for two seconds, then explode; any other number, roll again. Auto-roll rolls every 2.5 seconds and waits for the photo-finish animations.
     - *Manual:* run a real race, then the host presses **Finish** and picks the winner.
   - **The lineup:** each round the lobby picks what's running in each lane and what its jockey is wearing. It's mostly horses in different coats, with the odd rare zebra, giraffe, donkey, cow or unicorn. About half the jockeys are in fancy dress (Santa, bunny ears, cowboy, top hat, crown, pirate, chef, viking or wizard). Each runner and jockey gets a made-up fun fact, shown on the big screen's odds boards and on the phones' bet cards (`src/shared/lineup.ts`).
   - **Chat:** players chat from the 💬 button on their phones. New messages pop up as bubbles: above and below the race while it's running (big screen and phones), and stacked in the corner of the big screen the rest of the time. The lobby keeps the last 40 messages, up to 120 characters each.
   - **Sound** (big screen, `src/client/sound.ts`): a bugle fanfare when the race starts, galloping hooves and huffs each time horses move, whinnies, nickers and snorts now and then during a digital race, and a crowd cheering the winner. Each time a player locks in their bets, a random bet sound plays (never the same twice running) on the big screen and on that player's phone: cash registers, coins, a slot-machine jackpot, a double cha-ching, or a horse having its say. A photo finish adds a roaring crowd, the die rattling and bouncing, an "aww" when it misses, and crashes as the losers go down. The whinnies, cash registers and coins are real recordings (`public/sounds`; licences and credits in its CREDITS.md); everything else is synthesised live with the Web Audio API. Browsers only allow sound after a click, so it starts with the host's first click; the 🔊 button in the header mutes it.
   - **Results:** winnings are paid out. The big screen shows the round's **biggest winner** (laurel wreath, sunburst, confetti) and **biggest loser** (a rain cloud), award badges, then a large leaderboard that sweeps in in the old order and shuffles into the new one while balances count up. Phones show the same, plus the player's own badges.
   - **Streaks** show beside names on the leaderboard: 🔥3 for three wins in a row, 🥶2 for two losses.
   - **Awards** (`src/shared/awards.ts`): 🎯 Long shot (won at ×4 or better), 💰/💸 All in, 🏹 Sharpshooter (only backed the winner), 🌈 Hedge fund (backed all six), 🪑 Wallflower (bet nothing), 🪦 Busted, ✌️ Doubled up ($200+), 🚀 Comeback (up 2+ places), 👑 New leader.
4. After the last round comes the **recap** (`src/shared/recap.ts`): a podium for the top three (plinths rise, then the players pop on, crown on the winner), the game in numbers, the **biggest moments** as cards, and the final leaderboard with each player's profit for the day. A round-by-round table, like the spreadsheet's Results sheet, is underneath. Phones show where you finished and your own moments. The host can start again.
   - Moments: 💥 Biggest win, 😭 Most painful loss, 🎯 Longest shot (and who backed it), 🚀 Comeback of the day, 📉 Biggest collapse, 🔥 Hottest streak, 🥶 Coldest streak, 🎩 High roller, 👛 Tightest wallet, 🐎 Horse of the day, ⏱️ Longest race, 💰 Biggest pot, 🙈 Nobody saw it coming (rounds where nobody backed the winner).
   - The lobby keeps a short log of each round (winner, race mode, rolls, pool, winning odds, each player's stake) for this.

Players who join mid-game get the starting budget and sit out any round whose betting has already closed.

## The maths (from the spreadsheet)

Parimutuel betting with no house cut. For each race:

- `pool` = every player's bets on every horse
- `odds[h] = pool / (total bet on h)`, or 0 if nobody backed `h`
- `net = bet on winner × odds[winner] − everything you staked`

If nobody backed the winning horse, its odds are 0 and every stake is lost. This matches the sheet. See `src/shared/game.ts`; the tests in `src/shared/game.test.ts` check it against a literal transcription of the sheet's formulas.

## Architecture

- Look: styled after vintage racecourse posters (sage sky, rolling hills, a white rail, cream paper, Art Deco capitals in Poiret One and Josefin Sans from Google Fonts).
- `src/client/`: the single-page app (Vite + TypeScript, no framework). `host.ts` is the big screen, `player.ts` is the phone, `race.ts` draws the track and the horses (an original SVG with legs animated in CSS), and `main.ts` handles routing and the connection.
- `src/worker/index.ts`: Worker API. `POST /api/rooms` creates a lobby, `GET /api/rooms/:code` checks a code, and `/api/rooms/:code/ws` is the game WebSocket.
- Photos: sent over the WebSocket as a JPEG data URL, checked (JPEG, under ~110 KB), stored in the lobby's Durable Object and served from `GET /api/rooms/:code/avatars/:playerId?v=N`.
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
