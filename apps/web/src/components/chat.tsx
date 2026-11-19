import { cn } from "cn";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  type ChatLine,
  MAX_LENGTH,
  PHRASES,
  type Phase,
  type Room,
  roomsFor,
  shown,
} from "../chat/rules.ts";
import { me, route, settings } from "../app/store.ts";
import { Player } from "./common.tsx";

const LABELS: Record<Room, string> = { players: "Players", spectators: "Spectators" };

/**
 * A game's chat: the players' room and the spectators' room. Players write freely, with quick
 * phrases one tap away, and meet the spectators' room only once the game is over.
 */
export function Chat({
  lines,
  error,
  players,
  phase,
}: {
  lines: ChatLine[];
  error: string;
  players: string[];
  phase: Phase;
}) {
  const rooms = roomsFor(me, players, phase);
  const [picked, setPicked] = useState<Room>(rooms[0]);
  const room = rooms.includes(picked) ? picked : rooms[0];
  const list = useRef<HTMLOListElement>(null);
  const visible = shown(lines, { room, players, muted: settings.muted });
  const player = players.includes(me);
  const writable = room === "spectators" ? !player || phase === "finished" : player;
  const phrases = room === "players" && phase !== "finished";
  const send = (text: string) => route?.act("chat", { room, text });
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [visible.length, room]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem("chat") as HTMLInputElement;
    if (!field.value.trim()) return;
    send(field.value);
    field.value = "";
  };
  return (
    <section
      data-testid="chat"
      aria-label="Chat"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[0.6rem] border border-line"
    >
      <div role="tablist" className="flex border-b border-line bg-surface">
        {rooms.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === room}
            data-testid={`chat-room-${id}`}
            onClick={() => setPicked(id)}
            className="h-9 flex-1 text-[0.87rem] font-semibold text-muted-foreground shadow-[inset_0_-2px_0_transparent] aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-[inset_0_-2px_0_var(--brand)]"
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
      <p
        className="border-b border-line px-3 py-1 text-[0.78rem] text-muted-foreground"
        data-testid="chat-public"
      >
        Chat is public: anyone reading this relay sees it.
      </p>
      <ol ref={list} className="min-h-28 flex-1 overflow-y-auto px-3 py-2" aria-live="polite">
        {visible.map((line) => (
          <li
            key={line.id}
            data-testid="chat-line"
            className="group flex items-baseline gap-1.5 py-0.5 leading-snug"
          >
            <span className="min-w-0 flex-1 break-words">
              <b className="font-semibold">
                <Player pubkey={line.from} />:
              </b>{" "}
              <span>{line.text}</span>
            </span>
            {line.from !== me && (
              <button
                type="button"
                className="text-[0.78rem] text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                onClick={() => route?.act("mute", { pubkey: line.from, on: "1" })}
              >
                Mute
              </button>
            )}
          </li>
        ))}
        {!visible.length && (
          <li className="text-[0.87rem] text-muted-foreground">
            {room === "players" ? "Nothing said yet." : "No spectator has said anything."}
          </li>
        )}
      </ol>
      {writable && (
        <div className="grid gap-1.5 border-t border-line p-2">
          {phrases && (
            <div className="flex flex-wrap gap-1">
              {PHRASES.map((phrase) => (
                <button
                  key={phrase}
                  type="button"
                  data-testid="phrase"
                  onClick={() => send(phrase)}
                  className="h-7 rounded-full border border-line px-2.5 text-[0.82rem] font-semibold hover:border-brand hover:text-brand"
                >
                  {phrase}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit}>
            <input
              name="chat"
              maxLength={MAX_LENGTH}
              autoComplete="off"
              placeholder={
                room === "players" ? "Say something to your opponent" : "Say something to the room"
              }
              aria-label="Chat message"
              data-testid="chat-input"
              className="h-9 w-full rounded-md border border-line bg-background px-2.5 text-[0.9rem] placeholder:text-muted-foreground"
            />
          </form>
          {error && <p className={cn("text-[0.82rem] text-bad")}>{error}</p>}
        </div>
      )}
    </section>
  );
}
