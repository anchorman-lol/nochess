# Luft: design

Luft is chess between Nostr keys. There is no game server: every action is a signed event on a relay, and `replay()` in `src/game/replay.ts` rebuilds a game from whatever events it is given. The same events give the same game for everyone, so that function is the only judge. The wider proposal (prior art, money, phases) is a separate document; this file is what the code does.

## Events

| Kind  | What                                                   | Signed by                          | Tags and content                                                                                                                                                                                               |
| ----- | ------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30064 | Game: an open seek or challenge, then the game in play | host                               | `d` game id, `t` `luft`, `status` `open`, `playing` or `cancelled`, `tc`, `rated`, `-`. Open: `session`, `seed`, `expiration`, optional `p` (a challenge to one player). Playing: `session`, `salt`, `p` guest, `e` the accepted join. Cancelled: `expiration` a minute ahead. |
| 1640  | Join                                                   | guest                              | `a` game, `p` host, the same `tc` and `rated`, the `seed` it saw, its `session` key. A bot that charges adds `e`, the zap receipt it spends on this game.                                                      |
| 1641  | Move                                                   | session key                        | `a`, `ply`, `e` the previous move (the join for the first), `fen` after the move, in exactly that order. Content: the move in SAN.                                                                             |
| 1642  | Action                                                 | session key                        | `a`, `ply` (moves played when it was taken), `action`: `resign`, `abort`, `draw-offer`, `draw-accept`, `claim-time`                                                                                            |
| 64    | Archive (NIP-64)                                       | each player                        | Content: PGN. `a`, `p` both players, `t`, `result`, `alt`, `proof`                                                                                                                                             |
| 0     | Profile                                                | anyone                             | `t` `luft` when Luft wrote it. Content: `lud16` or `lud06` to receive zaps, `"bot": true` (NIP-24) for a bot, and for a bot or reviewer a `luft` block with its price (see Zaps and fees).                     |
| 1985  | Fair-play label (NIP-32)                               | reviewer                           | `L` `luft/fairplay`, `l` `analysed` or `review-suggested`, `a` game, `p` player, and `e` the zap receipt when the review was paid for. Content: the numbers as JSON.                                           |
| 9734  | Zap request (NIP-57)                                   | payer                              | `p` recipient, `amount`, `relays`, `lnurl`, and `a` when the zap is for a game. Sent to the recipient's LNURL callback, never to a relay.                                                                      |
| 9735  | Zap receipt (NIP-57)                                   | the recipient's Lightning provider | `p`, `a`, `bolt11`, `description` (the zap request)                                                                                                                                                            |
| 30382 | Rating assertion (NIP-85)                              | rater                              | `d` and `p` the player, `rating:<speed>`, `rd:<speed>`, `games:<speed>`                                                                                                                                        |

The kind numbers are placeholders next to 64 and need checking against the registry before anyone else builds on them.

## Rules

- **Time controls.** `300+3` is base and increment in seconds, `2d` is days per move. Speed classes are Lichess's: base plus 40 increments, under 480 s blitz, under 1500 s rapid, then classical. Under 180 s is bullet and has no class, so `replay()` starts no such game.
- **Session keys.** The seek and the join each name a throwaway key that signs that game's moves, so a NIP-07 extension is asked twice per game (join or start, and the archive), not once per move. The session secret lives in the browser that made it: a game cannot yet be continued from another device.
- **Colours.** The host commits to a salt in the seek (`seed` is its hash) and reveals it when the game starts. White is decided by `sha256(salt:join id)`. The join repeats the seed, because the open event is replaced and would otherwise leave nothing to check the salt against.
- **Withdrawing.** The host can withdraw an open seek or challenge from the waiting page, its row in the lobby or its quick-pairing tile. The game event is replaced by one with `status` `cancelled`, and `replay()` stops there: a cancelled game takes no join, whether it was signed before or after. The cancelled event expires a minute later, and not at once, because a relay with NIP-40 rejects an event that has already expired. A seek is renewed only by a client that has it open, on the waiting page or in the lobby, so one that was never withdrawn lapses within 15 minutes of its host leaving.
- **Order.** Moves form a chain: each names the one before. Arrival order and timestamps do not order moves.
- **Equivocation.** Two different legal moves for the same turn, signed by the same key, lose the game.
- **Actions.** Abort is possible until both have moved, and a resignation before that counts as an abort. A draw needs an offer the other side accepts before it has moved twice. An ending whose author has a later move is ignored, so nobody can write "I aborted at move 1" at move 40.
- **Automatic draws.** Stalemate, insufficient material, the fifty-move rule and threefold repetition end the game on their own. Lichess makes the last two a claim; this is a known difference.
- **Duties.** A player's client admits a fitting join (host, from the waiting page or the lobby), claims a flag one second after it fell, and publishes the archive. `Table` in `src/game/table.ts` does this for the browser and the bot alike.

## Clock

The first two moves are untimed, as on Lichess. From then on a move costs the seconds between its `created_at` and the previous move's, and adds the increment. A move stamped after the deadline loses on time by itself. If no move comes, the opponent's `claim-time` action wins once it is stamped after the deadline. Correspondence gives every move its days from the previous event.

A timeout always loses, also when the opponent could not mate. Lichess draws that case.

This clock is only as honest as `created_at`. On a relay that accepts any timestamp, a player can stamp a move a minute in the past and gain a minute. The fix is a relay rule.

### What the relay module must do

Working name `kind_time_window`, for anchorman-relay. Not built yet; Luft runs without it on the local relay.

1. Configuration: a list of kinds and a window in seconds. For Luft: `{ "kinds": [1641, 1642], "window_secs": 2 }`.
2. On EVENT with a listed kind: reject it when `abs(created_at - relay_now) > window_secs`, with `["OK", id, false, "invalid: created_at outside the window for this kind"]`. The relay's own clock is the reference.
3. Leave every other kind alone. The global `created_at_lower_limit` stays 0, because NIP-59 gift wraps are backdated on purpose.
4. Advertise it in the NIP-11 document, so a client or auditor can tell the rule is on before trusting a clock: for example `"limitation": { "created_at_window": { "kinds": [1641, 1642], "seconds": 2 } }`.
5. Rate limit: kinds 1641 and 1642 need their own budget of at least 60 events a minute per key. The general limit of 30 a minute is enough for blitz and too low for bullet.

What the client has to change when the module exists: `Table.send` signs once and resends the same event until the relay takes it. A resend older than the window will be refused, so on that rejection the client must sign the same move again with a fresh time. Same content, so it is not equivocation.

What stays unsolved by this level: a third party reading the events elsewhere has to take the relay's word that the rule was on. Signed timekeeper receipts (the proposal's level 2) remove that.

## Archive and audit

A finished game is published by each player as a kind 64 note. Its `proof` tag holds the game and join events, one `[created_at, signature]` pair per move, and any other event the result rests on (the resignation, the draw offer and accept, the time claim). Move events are canonical, so anyone rebuilds each one from the PGN and that pair, checks its signature, and replays the game. `prove()` and `audit()` in `src/game/archive.ts` do this; the results list on the home page shows only games that pass.

All archives for one game are replayed together. A player cannot hide a lost game behind an earlier ending of their own, because the opponent's archive carries the later moves and the "author moved on" rule voids the earlier ending.

Known gap: a false time claim, with a timestamp in the future on a relay without the module, makes a self-consistent archive until the other player's archive appears.

## Bots

- **The computer in the browser** is Stockfish 19 lite (WASM, one thread) in a Web Worker with eight levels. Casual only, as on Lichess, and nothing is published.
- **A bot account** (`tools/bot.ts`) is a process with its own key. It publishes a profile with `bot: true`, accepts direct challenges and nothing else (Lichess: "Bots can only play challenge games"), and plays through the same `Table` as a browser. Its games are archived, audited and rated like any other.
- **Ratings against bots** follow Lichess: a rated game counts, and the human's rating moves half as far. Bots are rated but not ranked.

## Ratings

`src/game/glicko.ts` is Glicko-2 with Lichess's settings (1500, deviation 500, volatility 0.09, tau 0.75, deviation floor 45, provisional from 110), one rating period per game, one rating per speed class. The browser computes ratings from the audited games it has; `tools/rater.ts` does the same over the whole relay and publishes assertions. Not done: deviation growing with inactivity, Sybil defences, and anyone reading the published assertions.

## Reviewer

`tools/reviewer.ts` is the first automated reviewer. Per game and player it counts moves after the player's tenth that were not forced, in positions within six pawns of equal, and compares them with Stockfish at depth 10. It publishes `review-suggested` only with at least 25 such positions, at least 85% first-choice agreement and at most 12 centipawns average loss; otherwise `analysed`. The label carries the numbers and each move's engine choice, so anyone can rerun it. It never says more than "a human should look", it skips declared bots, and it does not label a game twice.

## Zaps and fees

Money in Luft is a tip or a fee for a service, paid over Lightning as a NIP-57 zap from the payer's wallet to the recipient's. Luft holds nothing and passes nothing on.

**No stakes, wagers or prize pools.** Nothing anyone pays or receives is contingent on a game's result. A bot's fee is owed for the game whoever wins, a reviewer's fee is the same whatever its label says, and "zap the winner" is a gift from a spectator after the fact that nobody was promised. Two players putting money on a game, an entry fee that funds a prize, or a pot the client or a bot holds are all on the other side of this line and are not built.

### A zap

1. The client reads the recipient's `lud16` (or `lud06`) from their kind 0 and fetches the LNURL-pay endpoint. It must say `allowsNostr` and name a `nostrPubkey`.
2. It signs a kind 9734 zap request (`src/zap/zap.ts`) with the recipient, the amount, this relay and, for a game, its address in `a`, and sends it to the endpoint's callback.
3. It checks the invoice that comes back: the amount asked for, and a description hash that is the hash of the request. Anything else is refused before a wallet sees it (`src/zap/lnurl.ts`).
4. The invoice is paid by WebLN if the browser has it, else through the Nostr Wallet Connect link the user stored (NIP-47 `pay_invoice`, NIP-44 when the wallet advertises it, else NIP-04), else it is shown as text and a QR code to pay with any wallet (`src/zap/wallet.ts`).
5. The provider publishes the kind 9735 receipt to the relay. The zap counts when that receipt arrives and holds up.

`readZap()` is the one check for a receipt, used by the browser, the bot and the reviewer. It follows NIP-57 appendix F: the receipt is signed by the `nostrPubkey` the recipient's own endpoint names, its `description` is a valid signed zap request, the invoice's description hash is the hash of that request and its amount is the request's, and the receipt's `p` and `a` are the request's. A receipt signed by any other key is a claim. Nobody's word is taken for a payment, including the paying client's.

Zaps show on the player cards of a game (sats zapped for that game), under the board, and on a player's page (`#/player/<pubkey>`). A player with a key kept in the browser sets their lightning address on the home page, which publishes a kind 0 on this relay. A player signing with an extension keeps their own profile: Luft reads it from this relay and does not write one.

### The platform's share

NIP-57 appendix G splits a zap by weight and leaves the client to send one zap per receiver, so a split is several invoices. `split()` computes it: the platform's weight is the share, the recipients divide the rest equally, amounts are whole sats and the remainder goes to the first recipient. Each line gets its own zap request, invoice and receipt, and the dialog lists them before anything is paid: zapping 200 sats at 5% shows 190 for the player and 10 for Luft. The share defaults to 5%, is the payer's to change, and at 0 (or when it rounds to under one sat) there is one invoice and Luft gets nothing. Luft's events carry no `zap` tags: a tag is set by an event's author, and this share is the payer's choice.

The share goes to `VITE_PLATFORM_LUD16`, zapped as `VITE_PLATFORM_PUBKEY`. With either unset there is no share and no mention of one. Fees are not split: a bot or reviewer gets its whole price.

### Bots that charge

A bot's kind 0 carries `"luft": { "role": "bot", "price_msat": 21000, "speeds": ["blitz", "rapid"], "rated": true, "casual": true }`. `speeds`, `rated` and `casual` say which games it takes and default to all; a bot without the block, or with a price of 0, is free and joins at once as before. The client shows the price on the challenge button and disables it for terms the bot doesn't cover.

The challenger opens the challenge as usual and zaps the bot at least its price with the challenge's address in `a`. The bot joins only when `payment()` (`src/zap/fee.ts`) finds a receipt that passes `readZap()` against the bot's own provider, is for at least the price and names that game. Its join names the receipt in an `e` tag, which spends it: anyone can see which payment bought which game, and the bot rebuilds what is spent from its own joins after a restart. A challenge nobody pays for expires like any seek.

Refunds: there are none, and the client says so before the payment. The rule is that the fee is spent when the bot joins. If the bot never joins (it was down, or the challenge expired first), the receipt is unspent and admits the same player's next challenge to that bot without a new payment. Once the bot has joined, the fee stays spent whatever happens: if the player aborts or leaves, and also if the bot crashes, in which case it loses on time and the player has the win. The bot itself never aborts.

### Reviewers that charge

A reviewer's kind 0 carries `"luft": { "role": "review", "price_msat": 50000 }`. A finished, archived game shows "Request a review (50 sats)" for each such reviewer on the relay. The request is a zap to the reviewer with the game in `a`, from a player or anyone else. `tools/reviewer.ts --serve` reviews a game when `owed()` finds a valid receipt of at least the price that none of its labels names yet, and its labels name the receipt in `e`. A zap under the price is a tip and buys nothing. A request for a game that has no signed archive is kept open for a day; a request the reviewer missed while it was down is answered when it is back, since the receipts are on the relay.

The free tier stays. `pnpm review` without `--serve` is the default reviewer's pass over every finished game at depth 10, for whoever runs the relay to schedule. The paid review is the same measurement on request: at once, at depth 14, and also of a declared bot's moves, which the free pass skips.

### Without real money

`tools/zapmock.ts` is a Lightning provider for development and the tests. It serves LNURL-pay for any name at its host, issues well-formed BOLT11 invoices on regtest (`lnbcrt…`, which no wallet will pay), and when told an invoice is paid, by `POST /pay` or by NIP-47 `pay_invoice`, publishes the NIP-57 receipt signed by the `nostrPubkey` it advertises. It publishes only to its own relay. In development the app loads a WebLN wallet of play money (`src/zap/devwallet.ts`, only when `VITE_DEV_WALLET` is set) that pays by calling `/pay`. Nothing else in the client or the services knows the mock exists: they see a lightning address, an LNURL endpoint, a WebLN provider and receipts.

Real Lightning needs no code change: leave `VITE_DEV_WALLET` unset, give the bot, the reviewer and the platform lightning addresses at a provider that supports NIP-57, and don't start the mock.

### Known gaps

- The provider must publish its receipt to Luft's relay, which the zap request asks for. A provider that can't reach the relay (a local one, for example) leaves the zap paid and unseen.
- A player who signs with an extension can be zapped only if their kind 0 is on this relay.
- To check a receipt the browser fetches the recipient's LNURL endpoint, so viewing a zapped player's game tells their provider the viewer's address.
- Zap comments, anonymous zaps and zaps for a single move are not built.
- A bot's price change is not retroactive in either direction: an unspent receipt under the new price no longer admits a challenge.
