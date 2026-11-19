import { Icon } from "@luft/ui/components/icon";
import { cn } from "cn";
import * as nip19 from "nostr-tools/nip19";
import {
  me,
  type ProfileModel,
  route,
  settings,
  setSettings,
  who,
  zapSheet,
} from "../app/store.ts";
import {
  Avatar,
  Hint,
  List,
  None,
  Player,
  Section,
  Zapped,
  ZapButton,
} from "../components/common.tsx";
import { btn } from "../components/table.tsx";
import { mute } from "../lib/settings.ts";
import { gameHref, plural, satsTo, shortKey, showRating } from "../lib/format.ts";
import { ResultRow } from "./lobby.tsx";

export function ProfilePage({ model }: { model: ProfileModel }) {
  const { pubkey, zaps } = model;
  const { fee, lud16, lud06 } = who(pubkey);
  const ratings = Object.entries(model.ratings);
  const muted = settings.muted.includes(pubkey);
  return (
    <main className="mx-auto max-w-[76rem] px-3 pt-6 pb-16 md:px-5" data-testid="profile">
      <header className="flex flex-wrap items-center gap-5 border-b border-line pb-6">
        <Avatar pubkey={pubkey} size="xl" />
        <div className="grid min-w-56 flex-1 gap-1">
          <h1 className="text-[1.7rem] leading-tight font-extrabold tracking-[-0.02em]">
            <Player pubkey={pubkey} />
          </h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.92rem] text-muted-foreground">
            <code className="font-mono" title={nip19.npubEncode(pubkey)}>
              {shortKey(pubkey)}
            </code>
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-foreground"
              onClick={() => navigator.clipboard?.writeText(nip19.npubEncode(pubkey))}
            >
              <Icon name="copy" /> Copy key
            </button>
            {lud16 && <span>{lud16}</span>}
          </p>
          {fee?.msat ? (
            <p>
              {fee.role === "bot" ? "Plays" : "Reviews a game"} for {plural(fee.msat / 1000, "sat")}
              {fee.role === "bot" ? " a game" : ""}.
            </p>
          ) : null}
        </div>
        <div className="zaps flex flex-wrap items-center gap-2">
          {lud16 || lud06 ? (
            <>
              <span
                className="inline-flex items-center gap-1 font-semibold text-zap"
                data-testid="received"
              >
                <Icon name="zap" />
                {plural(satsTo(zaps, [pubkey]), "sat")} in {plural(zaps.length, "zap")}
              </span>
              {pubkey !== me && <ZapButton label="Zap" onClick={() => zapSheet.open([pubkey])} />}
            </>
          ) : (
            <Hint>No lightning address, so no zaps.</Hint>
          )}
          {pubkey !== me && (
            <button
              type="button"
              className={cn(btn, "h-9")}
              onClick={() => setSettings(mute(settings, pubkey, !muted))}
            >
              {muted ? "Unmute in chat" : "Mute in chat"}
            </button>
          )}
        </div>
      </header>
      <div className="grid gap-10 pt-7 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="grid min-w-0 content-start gap-9">
          <Section title="Ratings">
            <table className="w-full border-collapse tabular-nums">
              <thead>
                <tr className="border-b border-line text-left text-[0.85rem] text-muted-foreground">
                  <th className="pb-1.5 font-medium">Speed</th>
                  <th className="pb-1.5 font-medium">Rating</th>
                  <th className="pb-1.5 font-medium">Games</th>
                </tr>
              </thead>
              <tbody>
                {ratings.length ? (
                  ratings.map(([speed, rating]) => (
                    <tr key={speed} className="border-b border-line">
                      <td className="py-2 font-bold capitalize">{speed}</td>
                      <td className="py-2 text-xl font-bold">{showRating(rating)}</td>
                      <td className="py-2 text-muted-foreground">{plural(rating.games, "game")}</td>
                    </tr>
                  ))
                ) : (
                  <tr className="border-b border-line">
                    <td colSpan={3} className="py-2.5 text-[0.9rem] text-muted-foreground">
                      No rated game yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {model.rater ? (
              <>
                <Hint className="mt-2 flex flex-wrap items-center gap-2" data-testid="rated-by">
                  Published by rater {shortKey(model.rater)}.
                  <button
                    type="button"
                    className={cn(btn, "h-8 text-[0.87rem]")}
                    data-testid="verify"
                    onClick={() => route?.act("verify", {})}
                  >
                    Verify
                  </button>
                </Hint>
                {model.check && (
                  <p
                    className={cn("mt-1 text-[0.9rem]", model.check.ok ? "text-good" : "text-bad")}
                    data-testid="verified"
                  >
                    {model.check.ok ? "Verified" : "Mismatch"}: {model.check.detail}
                  </p>
                )}
              </>
            ) : (
              ratings.length > 0 && (
                <Hint className="mt-2" data-testid="rated-by">
                  Computed in this browser from the checked games.
                </Hint>
              )
            )}
          </Section>
          <Section title="Games">
            <List className="results">
              {model.games.length ? (
                model.games.map((v) => <ResultRow key={v.addr} verdict={v} />)
              ) : (
                <None>No finished game yet.</None>
              )}
            </List>
          </Section>
        </div>
        <aside className="grid content-start gap-9">
          <Section title="Zaps received">
            <List data-testid="zaps">
              {zaps.length ? (
                zaps.map((zap) => (
                  <li key={zap.id} className="flex-wrap">
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Zapped sats={zap.msat / 1000} /> from <Player pubkey={zap.from} />
                    </span>
                    {zap.addr && (
                      <a className="text-[0.87rem] text-brand" href={gameHref(zap.addr)}>
                        for a game
                      </a>
                    )}
                    {zap.comment && (
                      <span className="text-[0.87rem] text-muted-foreground">{zap.comment}</span>
                    )}
                  </li>
                ))
              ) : (
                <None>None yet.</None>
              )}
            </List>
          </Section>
          <Section title="A key, not an account">
            <Hint>
              This profile is a key. Its games and ratings are signed records that any app reading
              Nostr can check, and nobody can take them away.
            </Hint>
          </Section>
        </aside>
      </div>
    </main>
  );
}
