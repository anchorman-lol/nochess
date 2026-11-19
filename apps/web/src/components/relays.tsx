import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@luft/ui/components/dialog";
import { Icon } from "@luft/ui/components/icon";
import { cn } from "cn";
import { type FormEvent, useState } from "react";
import { editRelay, relays, status } from "../app/store.ts";
import { Hint } from "./common.tsx";
import { btn, field } from "./table.tsx";

const host = (url: string) => url.replace(/^wss?:\/\//, "");
const small =
  "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sunk hover:text-foreground disabled:opacity-35";

/** The relay status in the header, which opens the player's list of relays. */
export function RelayButton() {
  const { online, relay } = status();
  const { list, shared } = relays();
  const [error, setError] = useState("");
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const url = String(new FormData(form).get("relay") ?? "");
    if (editRelay("add", url)) {
      form.reset();
      setError("");
    } else setError("That isn't a relay address: it starts with wss://.");
  };
  return (
    <Dialog onOpenChange={() => setError("")}>
      <DialogTrigger
        data-testid="relay-status"
        title={`Moves travel through ${relay}. Pick relays`}
        className="mr-1.5 flex h-9 items-center gap-2 rounded-lg px-1.5 text-[0.87rem] text-muted-foreground transition-colors duration-150 hover:bg-sunk hover:text-foreground sm:mr-1"
      >
        <i
          className={cn(
            "size-2 rounded-full",
            online ? "bg-good" : "animate-pulse bg-muted-foreground",
          )}
        />
        <span className="max-sm:sr-only">{online ? "relay connected" : "connecting…"}</span>
      </DialogTrigger>
      <DialogContent className="gap-3 sm:max-w-md" data-testid="relays">
        <DialogTitle className="text-lg font-bold">Relays</DialogTitle>
        <DialogDescription>
          Games, moves and ratings travel through one relay at a time: the first in this list that
          answers. Games on one relay don't show on another.
        </DialogDescription>
        {shared && (
          <Hint data-testid="relay-shared">
            This tab follows the relay a shared link named, {host(relay)}. Picking one here goes
            back to your list.
          </Hint>
        )}
        <ol className="border-t border-line">
          {list.map((url, i) => {
            const current = url === relay;
            return (
              <li
                key={url}
                data-testid="relay"
                className="flex min-h-11 items-center gap-1 border-b border-line py-1"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[0.85rem]" title={url}>
                  {host(url)}
                </span>
                {current ? (
                  <span className="px-2 text-[0.8rem] font-semibold text-good">
                    {online ? "connected" : "connecting…"}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={cn(btn, "h-8 px-2.5 text-[0.85rem]")}
                    onClick={() => editRelay("use", url)}
                  >
                    Use
                  </button>
                )}
                <button
                  type="button"
                  className={small}
                  aria-label={`Try ${host(url)} earlier`}
                  title="Try earlier"
                  disabled={i === 0}
                  onClick={() => editRelay("up", url)}
                >
                  <Icon name="up" />
                </button>
                <button
                  type="button"
                  className={small}
                  aria-label={`Remove ${host(url)}`}
                  title="Remove"
                  disabled={list.length === 1}
                  onClick={() => editRelay("remove", url)}
                >
                  <Icon name="abort" />
                </button>
              </li>
            );
          })}
        </ol>
        <form className="flex gap-2" onSubmit={add}>
          <input
            name="relay"
            placeholder="wss://relay.example"
            aria-label="Relay to add"
            data-testid="relay-add"
            className={field}
          />
          <button className={btn}>Add</button>
        </form>
        {error && <p className="text-[0.9rem] text-bad">{error}</p>}
        <Hint>Kept in this browser. Changing the first relay reconnects.</Hint>
      </DialogContent>
    </Dialog>
  );
}
