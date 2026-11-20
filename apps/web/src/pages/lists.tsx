import { Link } from "@tanstack/react-router";
import { type ListModel, route } from "../app/store.ts";
import { List, None } from "../components/common.tsx";
import { LiveRow, MoreOnScroll, RankRow, ResultRow, SeekRow } from "../components/rows.tsx";
import { shortKey } from "../lib/format.ts";

const more = () => route?.act("more", {});
const TABS = [
  ["games", "/games", "Finished"],
  ["live", "/games/live", "On the boards"],
  ["open", "/games/open", "Open seeks"],
] as const;

/** A whole list on its own page: every game, the leaderboard, or one player's games. */
export function ListPage({ model }: { model: ListModel }) {
  const { kind } = model;
  const title =
    kind === "leaderboard"
      ? "Leaderboard"
      : kind === "player"
        ? `Games of ${shortKey(model.pubkey)}`
        : "Games";
  const rows =
    kind === "leaderboard"
      ? model.ranks.map((rank, i) => (
          <RankRow key={`${rank.pubkey}-${rank.speed}`} rank={rank} n={i + 1} />
        ))
      : kind === "live"
        ? model.live.map((game) => <LiveRow key={game.gameId} game={game} />)
        : kind === "open"
          ? model.seeks.map((seek) => <SeekRow key={seek.gameId} seek={seek} />)
          : model.results.map((verdict) => <ResultRow key={verdict.addr} verdict={verdict} />);
  return (
    <main
      className="mx-auto grid max-w-[52rem] content-start gap-4 px-3 pt-6 pb-16 md:px-5"
      data-testid="list"
    >
      <h1 className="text-[1.6rem] leading-tight font-extrabold tracking-[-0.02em]">{title}</h1>
      {kind !== "leaderboard" && kind !== "player" && (
        <nav
          className="flex gap-4 border-b border-line text-[0.92rem] font-semibold"
          aria-label="Which games"
        >
          {TABS.map(([id, to, label]) => (
            <Link
              key={id}
              to={to}
              activeOptions={{ exact: true }}
              className="-mb-px border-b-2 border-transparent py-2 text-muted-foreground aria-[current=page]:border-brand aria-[current=page]:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      {kind === "player" && (
        <Link
          to="/player/$pubkey"
          params={{ pubkey: model.pubkey }}
          className="text-[0.92rem] font-semibold text-brand"
        >
          Back to the player
        </Link>
      )}
      {kind === "leaderboard" ? (
        <ol className="border-t border-line" data-testid="list-rows">
          {rows}
        </ol>
      ) : (
        <List data-testid="list-rows">
          {rows.length ? rows : <None>{model.loading ? "Loading…" : "Nothing here yet."}</None>}
        </List>
      )}
      <MoreOnScroll loading={model.loading} done={model.done} onMore={more} />
    </main>
  );
}
