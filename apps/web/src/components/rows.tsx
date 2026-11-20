import { Link, type LinkProps } from "@tanstack/react-router";
import type { Verdict } from "@nochess/core/game/archive.ts";
import { type Speed, speedOf } from "@nochess/core/game/events.ts";
import type { Rating } from "@nochess/core/game/glicko.ts";
import { Icon } from "@nochess/ui/components/icon";
import { useEffect, useRef } from "react";
import { FIRST_PAGE, type Seek } from "../app/store.ts";
import { gameLink, plural, seekLink, tcLabel, terms } from "../lib/format.ts";
import { Player, PlayerLink, RatingOf, ShowRating } from "./common.tsx";

export function SeekRow({ seek }: { seek: Seek }) {
  return (
    <li>
      <Link {...seekLink(seek)} className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand">
        <span className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold">
          <Player pubkey={seek.host} />
          <RatingOf pubkey={seek.host} speed={speedOf(seek.tc)} />
        </span>
        <span className="text-[0.9rem] text-muted-foreground tabular-nums">{tcLabel(seek.tc)}</span>
        <span className="w-24 text-right text-[0.9rem] text-muted-foreground">
          {seek.forMe ? "challenges you" : seek.rated ? "rated" : "casual"}
        </span>
      </Link>
    </li>
  );
}

export function LiveRow({ game }: { game: Seek & { guest: string } }) {
  return (
    <li>
      <Link {...seekLink(game)} className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand">
        <Icon name="eye" className="text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-semibold">
          <Player pubkey={game.host} />{" "}
          <i className="font-normal text-muted-foreground not-italic">vs</i>{" "}
          <Player pubkey={game.guest} />
        </span>
        <span className="text-[0.9rem] text-muted-foreground max-sm:hidden">
          {terms(game.tc, game.rated)}
        </span>
      </Link>
    </li>
  );
}

export function ResultRow({ verdict }: { verdict: Verdict }) {
  return (
    <li>
      <Link
        {...gameLink(verdict.addr)}
        className="flex min-w-0 flex-1 items-center gap-3 hover:text-brand"
      >
        <span className="min-w-0 flex-1 truncate">
          <Player pubkey={verdict.players[0]} />{" "}
          <b className="mx-1 inline-block min-w-9 text-center tabular-nums">
            {verdict.result.replaceAll("1/2", "½")}
          </b>{" "}
          <Player pubkey={verdict.players[1]} />
        </span>
        <span className="text-[0.87rem] text-muted-foreground max-sm:hidden">
          {verdict.termination} · {terms(verdict.tc, verdict.rated)}
        </span>
      </Link>
    </li>
  );
}

export function RankRow({
  rank: { pubkey, speed, rating },
  n,
}: {
  rank: { pubkey: string; speed: Speed; rating: Rating };
  n: number;
}) {
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-line py-1.5">
      <span className="min-w-5 text-muted-foreground tabular-nums">{n}</span>
      <span className="min-w-0 flex-1 truncate">
        <PlayerLink pubkey={pubkey} />
      </span>
      <span className="text-[0.87rem] text-muted-foreground">
        {speed} · {plural(rating.games, "game")}
      </span>
      <b className="rating tabular-nums">
        <ShowRating rating={rating} />
      </b>
    </li>
  );
}

/** The link from a list's first page to all of it, shown once there is more than that page. */
export function ShowAll({ count, ...link }: LinkProps & { count: number }) {
  if (count <= FIRST_PAGE) return null;
  return (
    <Link
      {...link}
      className="text-[0.87rem] font-semibold text-brand hover:underline"
      data-testid="show-all"
    >
      Show all
    </Link>
  );
}

/** The foot of a long list: asks for older items when it scrolls into view, or on a click. */
export function MoreOnScroll({
  loading,
  done,
  onMore,
}: {
  loading: boolean;
  done: boolean;
  onMore: () => void;
}) {
  const foot = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!foot.current || done || loading) return;
    const seen = new IntersectionObserver(([entry]) => entry.isIntersecting && onMore(), {
      rootMargin: "400px",
    });
    seen.observe(foot.current);
    return () => seen.disconnect();
  }, [done, loading, onMore]);
  return (
    <p
      ref={foot}
      className="py-4 text-center text-[0.9rem] text-muted-foreground"
      data-testid="more"
      data-state={done ? "done" : loading ? "loading" : "idle"}
    >
      {done ? (
        "That is everything this relay has."
      ) : loading ? (
        "Loading older ones…"
      ) : (
        <button type="button" className="font-semibold text-brand hover:underline" onClick={onMore}>
          Load older
        </button>
      )}
    </p>
  );
}
