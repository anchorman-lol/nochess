# Luft: design

Luft is chess between Nostr keys. There is no game server: every action is a signed event on a relay, and `replay()` in `src/game/replay.ts` rebuilds a game from whatever events it is given. The same events give the same game for everyone, so that function is the only judge. The wider proposal (prior art, money, phases) is a separate document; this file is what the code does.

## Events

| Kind  | What                                                   | Signed by   | Tags and content                                                                                                                                                                                               |
| ----- | ------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 30064 | Game: an open seek or challenge, then the game in play | host        | `d` game id, `t` `luft`, `status` `open` or `playing`, `tc`, `rated`, `session`, `-`. Open: `seed`, `expiration`, optional `p` (a challenge to one player). Playing: `salt`, `p` guest, `e` the accepted join. |
| 1640  | Join                                                   | guest       | `a` game, `p` host, the same `tc` and `rated`, the `seed` it saw, its `session` key                                                                                                                            |
| 1641  | Move                                                   | session key | `a`, `ply`, `e` the previous move (the join for the first), `fen` after the move, in exactly that order. Content: the move in SAN.                                                                             |
| 1642  | Action                                                 | session key | `a`, `ply` (moves played when it was taken), `action`: `resign`, `abort`, `draw-offer`, `draw-accept`, `claim-time`                                                                                            |
| 64    | Archive (NIP-64)                                       | each player | Content: PGN. `a`, `p` both players, `t`, `result`, `alt`, `proof`                                                                                                                                             |
| 0     | A bot's profile                                        | bot         | `t` `luft`; content has `"bot": true` (NIP-24)                                                                                                                                                                 |
| 1985  | Fair-play label (NIP-32)                               | reviewer    | `L` `luft/fairplay`, `l` `analysed` or `review-suggested`, `a` game, `p` player. Content: the numbers as JSON.                                                                                                 |
| 30382 | Rating assertion (NIP-85)                              | rater       | `d` and `p` the player, `rating:<speed>`, `rd:<speed>`, `games:<speed>`                                                                                                                                        |

The kind numbers are placeholders next to 64 and need checking against the registry before anyone else builds on them.

## Rules

- **Time controls.** `300+3` is base and increment in seconds, `2d` is days per move. Speed classes are Lichess's: base plus 40 increments, under 480 s blitz, under 1500 s rapid, then classical. Under 180 s is bullet and has no class, so `replay()` starts no such game.
- **Session keys.** The seek and the join each name a throwaway key that signs that game's moves, so a NIP-07 extension is asked twice per game (join or start, and the archive), not once per move. The session secret lives in the browser that made it: a game cannot yet be continued from another device.
- **Colours.** The host commits to a salt in the seek (`seed` is its hash) and reveals it when the game starts. White is decided by `sha256(salt:join id)`. The join repeats the seed, because the open event is replaced and would otherwise leave nothing to check the salt against.
- **Order.** Moves form a chain: each names the one before. Arrival order and timestamps do not order moves.
- **Equivocation.** Two different legal moves for the same turn, signed by the same key, lose the game.
- **Actions.** Abort is possible until both have moved, and a resignation before that counts as an abort. A draw needs an offer the other side accepts before it has moved twice. An ending whose author has a later move is ignored, so nobody can write "I aborted at move 1" at move 40.
- **Automatic draws.** Stalemate, insufficient material, the fifty-move rule and threefold repetition end the game on their own. Lichess makes the last two a claim; this is a known difference.
- **Duties.** A player's client admits a fitting join (host), claims a flag one second after it fell, and publishes the archive. `Table` in `src/game/table.ts` does this for the browser and the bot alike.

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
