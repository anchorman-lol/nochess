import { parseTc, speedOf } from "@nochess/core/game/events.ts";
import { type Seat, turnOf } from "@nochess/core/game/replay.ts";
import { Icon } from "@nochess/ui/components/icon";
import { cn } from "cn";
import { FEE_RULE, type GameModel, me, route, settings, status, zapSheet } from "../app/store.ts";
import { Chat } from "../components/chat.tsx";
import { Clock, Countdown } from "../components/clock.tsx";
import {
  Avatar,
  Hint,
  Player,
  PlayerLink,
  RatingOf,
  Signed,
  Zapped,
  ZapButton,
} from "../components/common.tsx";
import {
  btn,
  btnPrimary,
  Outcome,
  Scoresheet,
  SeatCard,
  Signatures,
  TableLayout,
} from "../components/table.tsx";
import { outcomeText, plural, satsTo, SIDES, terms } from "../lib/format.ts";

const act = (action: string, data: Record<string, string> = {}) => route?.act(action, data);

export function GamePage({ model }: { model: GameModel }) {
  const { game } = model;
  if (!model.loaded) return <Note>Looking for the game…</Note>;
  if (game.phase === "missing")
    return <Note testid="missing">There is no such game on this relay.</Note>;
  if (game.phase === "cancelled")
    return (
      <Note testid="cancelled">
        {game.ending === "expired"
          ? "Nobody joined in time, so this challenge was withdrawn."
          : game.ending.startsWith("declined")
            ? `The challenge was declined: ${game.ending.slice("declined: ".length)}.`
            : "This seek was withdrawn."}
      </Note>
    );
  if (game.phase === "open") return <Waiting model={model} />;
  const over = game.phase === "finished";
  const top = (model.board.flipped ? 0 : 1) as Seat;
  return (
    <TableLayout
      data={{ seat: String(model.seat ?? ""), turn: over ? "" : String(turnOf(game)) }}
      board={model.board}
      top={<Seat model={model} seat={top} />}
      bottom={<Seat model={model} seat={(1 - top) as Seat} />}
      sheet={
        <Scoresheet
          moves={model.moves}
          empty="The clock starts after both first moves. Each has its own short limit."
          result={
            over && (
              <Outcome
                score={game.result === "*" ? "" : game.result!.replaceAll("1/2", "½")}
                text={outcomeText(game.result!, game.termination, game.noStart)}
              />
            )
          }
        />
      }
      acts={over ? <Finished model={model} /> : <Controls model={model} />}
      slip={<Slip model={model} />}
    />
  );
}

const Note = ({ children, testid }: { children: string; testid?: string }) => (
  <p
    className="note mx-auto max-w-xl px-5 py-16 text-center text-muted-foreground"
    data-testid={testid}
  >
    {children}
  </p>
);

function Seat({ model, seat }: { model: GameModel; seat: Seat }) {
  const { game } = model;
  const pubkey = game.players![seat];
  const playing = game.phase === "playing";
  const running = playing && turnOf(game) === seat && game.deadline !== null;
  const live = "base" in (parseTc(game.tc) ?? {});
  const sats = satsTo(model.zaps, [pubkey]);
  return (
    <SeatCard
      seat={seat}
      active={playing && turnOf(game) === seat}
      clock={
        running ? (
          <Clock seat={seat} due={game.deadline! * 1000} left={0} mine={model.seat === seat} />
        ) : live ? (
          <Clock seat={seat} left={game.clocks[seat]} mine={model.seat === seat} />
        ) : null
      }
    >
      <Avatar pubkey={pubkey} size="lg" />
      <span className="grid min-w-0">
        <PlayerLink pubkey={pubkey} />
        <span className="flex items-center gap-1.5 text-[0.87rem]">
          <RatingOf pubkey={pubkey} speed={speedOf(game.tc)} />
          {pubkey === me ? (
            <Zapped sats={sats} />
          ) : (
            <ZapButton
              sats={sats}
              onClick={() => zapSheet.open([pubkey], game.addr)}
              className="h-6 px-1"
            />
          )}
        </span>
      </span>
    </SeatCard>
  );
}

function Controls({ model }: { model: GameModel }) {
  const { game, seat } = model;
  const turn = turnOf(game);
  return (
    <>
      <p className="flex items-center gap-2 font-semibold" data-testid="status">
        {seat === turn && (
          <span className="size-2 animate-pulse rounded-full bg-brand" aria-hidden="true" />
        )}
        {seat === null
          ? `${SIDES[turn]} to move. You are watching.`
          : seat === turn
            ? "Your move."
            : `Waiting for ${SIDES[turn]}.`}
      </p>
      {game.startBy !== null && (
        <p className="text-[0.9rem] text-muted-foreground" data-testid="first-move">
          {seat === turn ? "Make your first move" : `${SIDES[turn]}'s first move is due`} within{" "}
          <Countdown until={game.startBy} testid="first-move-countdown" />, or the game is aborted,
          unrated, on the side that didn't move.
        </p>
      )}
      {game.drawOffer !== null && game.drawOffer !== seat && (
        <p className="rounded-md bg-brand-soft px-3 py-2 font-semibold" data-testid="draw-offered">
          {SIDES[game.drawOffer]} offers a draw.
        </p>
      )}
      {seat !== null && (
        <div className="grid grid-cols-2 gap-2">
          {game.sans.length < 2 ? (
            <button type="button" className={btn} data-testid="abort" onClick={() => act("abort")}>
              <Icon name="abort" />
              Abort
            </button>
          ) : model.confirming ? (
            <>
              <button
                type="button"
                className={cn(btn, "border-bad bg-bad text-white hover:border-bad")}
                data-testid="resign-confirm"
                onClick={() => act("resign-confirm")}
              >
                Confirm resign
              </button>
              <button type="button" className={btn} onClick={() => act("resign-cancel")}>
                Keep playing
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={btn}
                data-testid="resign"
                title="Resign"
                onClick={() => act("resign")}
              >
                <Icon name="flag" />
                Resign
              </button>
              {game.drawOffer !== null && game.drawOffer !== seat ? (
                <button
                  type="button"
                  className={cn(btn, btnPrimary)}
                  data-testid="draw-accept"
                  onClick={() => act("draw-accept")}
                >
                  Accept draw
                </button>
              ) : (
                <button
                  type="button"
                  className={btn}
                  data-testid="draw-offer"
                  disabled={game.drawOffer === seat}
                  onClick={() => act("draw-offer")}
                >
                  <span className="font-bold">½</span>
                  {game.drawOffer === seat ? "Draw offered" : "Offer draw"}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <GameZaps model={model} />
    </>
  );
}

function GameZaps({ model }: { model: GameModel }) {
  const { game, seat } = model;
  const players = game.players!;
  const others = players.filter((pubkey) => pubkey !== me);
  const winner = game.result === "1-0" ? players[0] : game.result === "0-1" ? players[1] : null;
  const total = satsTo(model.zaps, players);
  return (
    <div className="zaps flex flex-wrap items-center gap-2" data-testid="game-zaps">
      {total > 0 && (
        <span className="inline-flex items-center gap-1 font-semibold text-zap">
          <Icon name="zap" />
          {plural(total, "sat")} zapped on this game
        </span>
      )}
      {seat !== null ? (
        others.length > 0 &&
        game.phase === "finished" && (
          <ZapButton label="Zap your opponent" onClick={() => zapSheet.open(others, game.addr)} />
        )
      ) : (
        <>
          {winner && (
            <ZapButton label="Zap the winner" onClick={() => zapSheet.open([winner], game.addr)} />
          )}
          <ZapButton label="Zap both players" onClick={() => zapSheet.open(players, game.addr)} />
        </>
      )}
    </div>
  );
}

function Finished({ model }: { model: GameModel }) {
  const { game } = model;
  const players = game.players!;
  return (
    <>
      {game.result !== "*" && (
        <>
          <Signatures
            names={[<Player key="w" pubkey={players[0]} />, <Player key="b" pubkey={players[1]} />]}
            count={model.signed}
          />
          <p
            className="text-[0.87rem] text-muted-foreground"
            data-testid={model.signed ? "signed" : "unsigned"}
          >
            {model.signed
              ? `Signed by ${model.signed === 1 ? "one player" : "both players"}. Anyone can check this scoresheet.`
              : "Not signed on the relay yet."}
          </p>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <a className={cn(btn, btnPrimary)} href="#/play">
          New game
        </a>
      </div>
      <GameZaps model={model} />
      {model.reviewers.map((reviewer) =>
        reviewer.requested ? (
          <Hint key={reviewer.pubkey} data-testid="review-requested">
            Review paid for. <Player pubkey={reviewer.pubkey} /> publishes its labels here.
          </Hint>
        ) : (
          <button
            key={reviewer.pubkey}
            type="button"
            className={btn}
            data-testid="request-review"
            onClick={() => act("request-review", { pubkey: reviewer.pubkey })}
          >
            <Icon name="scale" />
            Request a review ({plural(reviewer.sats, "sat")})
          </button>
        ),
      )}
      {model.labels.length > 0 && (
        <ul className="labels grid gap-1.5 text-[0.88rem]" data-testid="labels">
          {model.labels.map((label, i) => (
            <li key={i} className="rounded-md bg-surface px-2.5 py-1.5">
              <b className={cn("font-semibold", label.label === "review-suggested" && "text-bad")}>
                {label.label === "review-suggested" ? "Worth a second look" : label.label}
              </b>{" "}
              {label.detail}{" "}
              <small className="text-muted-foreground">
                {label.paid ? "paid review by" : "reviewer"} <Player pubkey={label.reviewer} />
              </small>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Slip({ model }: { model: GameModel }) {
  const { game } = model;
  const facts: [string, string][] = [
    ["Game", terms(game.tc, game.rated)],
    ["Signed moves", `${game.sans.length} of ${game.sans.length}`],
    ["Relay", status().relay.replace(/^wss?:\/\//, "")],
  ];
  return (
    <>
      <dl className="grid gap-2">
        {facts.map(([term, value]) => (
          <div key={term} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="truncate text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="terms sr-only">{terms(game.tc, game.rated)}</p>
      <Signed className="text-[0.87rem]">Every move is signed by its player</Signed>
      {settings.chat && (
        <Chat
          lines={model.chat.lines}
          error={model.chat.error}
          players={game.players ?? []}
          phase={game.phase === "finished" ? "finished" : "playing"}
        />
      )}
    </>
  );
}

function Waiting({ model }: { model: GameModel }) {
  const { game } = model;
  const box = "mx-auto my-10 grid max-w-lg gap-4 rounded-xl border border-line p-6 max-sm:mx-3";
  if (game.host === me)
    return (
      <section className={box} data-testid="waiting">
        <div className="flex items-center gap-3">
          <span className="size-3 animate-pulse rounded-full bg-brand" aria-hidden="true" />
          <h1 className="text-xl font-bold">
            Waiting for {game.challenged ? <Player pubkey={game.challenged} /> : "an opponent"}
          </h1>
        </div>
        <p className="text-muted-foreground">
          {terms(game.tc, game.rated)}. Colours are drawn when the game starts.
        </p>
        {game.joinBy !== null && (
          <p data-testid="join-by">
            Withdrawn on its own in <Countdown until={game.joinBy} testid="join-countdown" /> if
            nobody joins.
          </p>
        )}
        {model.fee &&
          (model.fee.paid ? (
            <p data-testid="fee-paid">
              Paid. <Player pubkey={game.challenged!} /> joins when it has checked the receipt.
            </p>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                className={cn(
                  btn,
                  "h-11 border-zap bg-zap text-[oklch(0.2_0.03_60)] hover:border-zap",
                )}
                data-testid="pay-fee"
                onClick={() => act("pay-fee")}
              >
                <Icon name="zap" />
                Pay {plural(model.fee.sats, "sat")} to start
              </button>
              <Hint>{FEE_RULE}</Hint>
            </div>
          ))}
        <div className="flex gap-2">
          <input
            readOnly
            value={model.shareUrl}
            aria-label="Link to this game"
            className="h-10 min-w-0 flex-1 rounded-[0.55rem] border border-line bg-surface px-3 font-mono text-[0.8rem]"
          />
          <button type="button" className={btn} onClick={() => act("copy")}>
            <Icon name="copy" />
            {model.copied ? "Copied" : "Copy link"}
          </button>
        </div>
        <Hint>
          Anyone with the link can join{game.challenged ? " if they hold the challenged key" : ""}.
          The seek also shows in the lobby.
        </Hint>
        <button
          type="button"
          className={cn(btn, "justify-self-start")}
          data-testid="cancel-seek"
          onClick={() => act("cancel-seek")}
        >
          Cancel
        </button>
      </section>
    );
  const allowed = !game.challenged || game.challenged === me;
  return (
    <section className={box}>
      <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
        <Avatar pubkey={game.host} size="lg" />
        <Player pubkey={game.host} />
        <RatingOf pubkey={game.host} speed={speedOf(game.tc)} />
        <span className="font-normal text-muted-foreground">wants to play</span>
      </h1>
      <p className="text-muted-foreground">
        {terms(game.tc, game.rated)}. Colours are drawn when the game starts.
      </p>
      {game.joinBy !== null && (
        <p data-testid="join-by">
          Open for <Countdown until={game.joinBy} testid="join-countdown" /> more.
        </p>
      )}
      {allowed ? (
        <button
          type="button"
          className={cn(btn, btnPrimary, "h-11")}
          data-testid="join"
          disabled={model.joining}
          onClick={() => act("join")}
        >
          {model.joining ? "Joining…" : "Join the game"}
        </button>
      ) : (
        <p>This challenge is for someone else.</p>
      )}
    </section>
  );
}
