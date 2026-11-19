import { BRAND } from "@luft/ui/brand";
import { Icon } from "@luft/ui/components/icon";
import { cn } from "cn";
import { renderSVG } from "uqr";
import { PLATFORM, wallet, zap, zapSheet } from "../app/store.ts";
import { plural } from "../lib/format.ts";
import { MAX_SHARE } from "../zap/platform.ts";
import { Hint, Player } from "./common.tsx";

const AMOUNTS = [21, 100, 500, 1000];
const STATE = {
  new: "",
  open: "paying…",
  sent: "paid, waiting for the receipt…",
  paid: "zapped",
  failed: "failed",
};
const field =
  "h-10 rounded-[0.55rem] border border-line bg-background px-3 text-foreground placeholder:text-muted-foreground";

/** The zap dialog: the amount and who gets what, then one invoice per receiver until its receipt arrives. */
export function ZapSheet() {
  const sheet = zap.sheet;
  if (!sheet) return null;
  const platform = PLATFORM?.pubkey ?? null;
  const total = sheet.lines.reduce((sum, line) => sum + line.sats, 0);
  const done = sheet.lines.every((line) => line.state === "paid");
  const [, without] = sheet.error.match(/^no-address (.+)$/) ?? [];
  const close = () => zapSheet.act("zap-close");
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-foreground/40 p-3 animate-in fade-in-0 duration-150"
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={sheet.title}
        data-testid="zap-sheet"
        className="grid max-h-[calc(100dvh-1.5rem)] w-full max-w-md gap-4 overflow-y-auto rounded-xl bg-background p-5 shadow-lift animate-in zoom-in-95 duration-150"
      >
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Icon name="zap" className="text-zap" />
          {sheet.title}
        </h2>
        {sheet.note && <Hint>{sheet.note}</Hint>}
        {!sheet.paying && !sheet.fee && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {AMOUNTS.map((sats) => (
                <button
                  key={sats}
                  type="button"
                  onClick={() => zapSheet.act("zap-sats", { sats: String(sats) })}
                  className={cn(
                    "h-9 rounded-[0.55rem] border border-line px-3 font-semibold tabular-nums",
                    sats === sheet.sats && "border-zap bg-zap-soft",
                  )}
                >
                  {sats}
                </button>
              ))}
              <label className="flex items-center gap-1.5 text-muted-foreground">
                <input
                  name="zap-sats"
                  type="number"
                  min="1"
                  value={sheet.sats}
                  aria-label="Sats"
                  data-testid="zap-sats"
                  onChange={(event) => zapSheet.set("zap-sats", Number(event.target.value))}
                  className={cn(field, "h-9 w-24 tabular-nums")}
                />
                sats
              </label>
            </div>
            {platform && (
              <>
                <label className="flex items-center gap-2 text-[0.92rem] font-semibold">
                  {BRAND.name}'s share
                  <input
                    name="zap-percent"
                    type="number"
                    min="0"
                    max={MAX_SHARE}
                    value={sheet.percent}
                    data-testid="zap-percent"
                    onChange={(event) => zapSheet.set("zap-percent", Number(event.target.value))}
                    className={cn(field, "h-9 w-18 tabular-nums")}
                  />
                  %
                </label>
                <Hint>
                  Each receiver gets a zap of their own. Set the share to 0 and everything goes to
                  the players.
                </Hint>
              </>
            )}
          </div>
        )}
        <ul className="border-t border-line">
          {sheet.lines.map((line, i) => (
            <li
              key={`${line.pubkey}-${i}`}
              data-testid="zap-line"
              data-state={line.state}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line py-2"
            >
              <span className="truncate">
                <Player pubkey={line.pubkey} you={false} />
                {line.pubkey === platform ? " (the platform's share)" : ""}
              </span>
              <b className="tabular-nums">{plural(line.sats, "sat")}</b>
              <span className="col-span-2 text-[0.87rem] text-muted-foreground">
                {line.manual && line.state === "open"
                  ? "waiting for your payment…"
                  : line.state === "new" && sheet.paying
                    ? "asking for an invoice…"
                    : STATE[line.state]}
              </span>
              {line.error && <p className="col-span-2 text-[0.87rem] text-bad">{line.error}</p>}
              {line.manual && line.bolt11 && line.state !== "paid" && (
                <div className="invoice col-span-2 grid gap-2">
                  <a
                    href={`lightning:${line.bolt11}`}
                    aria-label="Open in a wallet"
                    className="mx-auto block w-44 rounded-lg bg-white p-1 [&_svg]:block [&_svg]:size-full"
                    dangerouslySetInnerHTML={{
                      __html: renderSVG(line.bolt11.toUpperCase(), { border: 2 }),
                    }}
                  />
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={line.bolt11}
                      aria-label="Lightning invoice"
                      data-testid="bolt11"
                      className={cn(field, "min-w-0 flex-1 font-mono text-[0.8rem]")}
                    />
                    <button
                      type="button"
                      onClick={() => zapSheet.act("zap-copy", { i: String(i) })}
                      className="h-10 rounded-[0.55rem] border border-line px-3 font-semibold"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Hint>
          {wallet()
            ? `Paid with ${wallet()}.`
            : "No wallet connected: you get each invoice as text and QR, and the zap shows when its receipt arrives."}
        </Hint>
        {without && (
          <p className="text-bad" data-testid="zap-error">
            <Player pubkey={without} you={false} /> has no lightning address that takes zaps.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {sheet.paying ? (
            <button
              type="button"
              data-testid="zap-close"
              onClick={close}
              className={cn(
                "h-10 rounded-[0.55rem] border border-line px-4 font-semibold",
                done && "border-brand bg-brand text-brand-ink",
              )}
            >
              {done ? "Done" : "Close"}
            </button>
          ) : (
            <>
              <button
                type="button"
                data-testid="zap-go"
                onClick={() => zapSheet.act("zap-go")}
                className="inline-flex h-10 items-center gap-1.5 rounded-[0.55rem] bg-zap px-4 font-semibold text-[oklch(0.2_0.03_60)]"
              >
                <Icon name="zap" />
                {sheet.fee ? "Pay" : "Zap"} {plural(total, "sat")}
              </button>
              <button
                type="button"
                onClick={close}
                className="h-10 rounded-[0.55rem] border border-line px-4 font-semibold"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
