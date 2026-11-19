import { type GameEvent, KIND, type Profile, tagValue } from "@luft/core/game/events.ts";
import type { Net } from "@luft/core/nostr/net.ts";
import { invoiceFor, type PayPoint, payPoint } from "@luft/core/zap/lnurl.ts";
import { pay } from "./wallet.ts";
import { readZap, split, type Zap, zapRequest } from "@luft/core/zap/zap.ts";

const SHARE_STORE = "luft:share";
const AMOUNT_STORE = "luft:zap";
export const DEFAULT_SHARE = 5;
export const MAX_SHARE = 50;

/** One zap of a sheet: `open` has an invoice, `sent` was paid by the wallet, `paid` has its receipt. */
export type Line = {
  pubkey: string;
  sats: number;
  bolt11: string;
  state: "new" | "open" | "sent" | "paid" | "failed";
  /** No wallet paid it, so the invoice is shown. */
  manual: boolean;
  error: string;
};
export type Sheet = {
  title: string;
  note: string;
  to: string[];
  addr?: string;
  /** A fee is a fixed amount for one service; the platform takes no share of it. */
  fee: boolean;
  sats: number;
  percent: number;
  lines: Line[];
  paying: boolean;
  error: string;
};

const nowSec = () => Math.floor(Date.now() / 1000);
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Zaps from this browser: one zap request and invoice per receiver of the split, paid by the
 * wallet or shown, and done when the provider's receipt arrives. Also checks receipts for display.
 */
export function zapper(
  net: Net,
  who: (pubkey: string) => Profile,
  platform: string | null,
  paint: () => void,
) {
  let sheet: Sheet | null = null;
  let stop = () => {};
  const asked = new Map<string, Promise<PayPoint | null>>();
  const points = new Map<string, PayPoint | null>();
  const read = new Map<string, Zap | null>();

  /** The pay endpoint of a player's lightning address, asked for once per address. */
  function pointOf(pubkey: string): Promise<PayPoint | null> {
    const profile = who(pubkey);
    const key = `${pubkey} ${profile.lud16} ${profile.lud06}`;
    if (!asked.has(key))
      asked.set(
        key,
        payPoint(profile)
          .catch(() => null)
          .then((point) => {
            points.set(pubkey, point);
            paint();
            return point;
          }),
      );
    return asked.get(key)!;
  }

  const lines = ({ fee, sats, to, percent }: Sheet): Line[] =>
    (fee ? [{ pubkey: to[0], sats }] : split(sats, to, platform, percent)).map((part) => ({
      ...part,
      bolt11: "",
      state: "new",
      manual: false,
      error: "",
    }));

  function close() {
    stop();
    stop = () => {};
    sheet = null;
  }

  async function go(s: Sheet) {
    s.error = "";
    s.paying = true;
    paint();
    const found = await Promise.all(s.lines.map((line) => pointOf(line.pubkey)));
    const without = s.lines.find((_, i) => !found[i]);
    if (without) {
      s.paying = false;
      s.error = `no-address ${without.pubkey}`;
      return paint();
    }
    stop = net.subscribe(
      [{ kinds: [KIND.zap], "#p": s.lines.map((line) => line.pubkey), since: nowSec() - 60 }],
      (receipt) => {
        const i = s.lines.findIndex((line) => line.bolt11 === tagValue(receipt, "bolt11"));
        if (i < 0 || !readZap(receipt, found[i]!.nostrPubkey)) return;
        s.lines[i].state = "paid";
        paint();
      },
    );
    for (const [i, line] of s.lines.entries()) {
      const point = found[i]!;
      const msat = line.sats * 1000;
      try {
        if (msat < point.min || msat > point.max)
          throw new Error("The amount is outside what their provider takes.");
        const request = await net.signer.sign(
          zapRequest(
            { to: line.pubkey, msat, relays: [net.url], lnurl: point.lnurl, addr: s.addr },
            nowSec(),
          ),
        );
        line.bolt11 = await invoiceFor(point, request, msat);
        line.state = "open";
        paint();
        line.manual = !(await pay(line.bolt11));
      } catch (error) {
        line.error = reason(error);
        line.manual = true;
      }
      if (sheet !== s) return;
      if (!line.bolt11) line.state = "failed";
      else if (!line.manual && s.lines[i].state !== "paid") line.state = "sent";
      paint();
    }
  }

  return {
    get sheet() {
      return sheet;
    },
    /** The receipts that hold up against their recipient's provider. A provider not asked yet is asked, and the page repaints when it answers. */
    zaps(receipts: Iterable<GameEvent>): Zap[] {
      return [...receipts].flatMap((receipt) => {
        const to = tagValue(receipt, "p") ?? "";
        void pointOf(to);
        const point = points.get(to);
        if (!point) return [];
        const key = receipt.id + point.nostrPubkey;
        if (!read.has(key)) read.set(key, readZap(receipt, point.nostrPubkey));
        return read.get(key) ?? [];
      });
    },
    open(spec: { title: string; note?: string; to: string[]; addr?: string; fee?: number }) {
      close();
      sheet = {
        title: spec.title,
        note: spec.note ?? "",
        to: spec.to,
        addr: spec.addr,
        fee: spec.fee !== undefined,
        sats: spec.fee ?? (Number(localStorage.getItem(AMOUNT_STORE)) || 100),
        percent: Number(localStorage.getItem(SHARE_STORE) ?? DEFAULT_SHARE),
        lines: [],
        paying: false,
        error: "",
      };
      sheet.lines = lines(sheet);
    },
    /** A click inside the sheet; false if the action isn't the sheet's. */
    act(action: string, data: { i?: string; sats?: string } = {}): boolean {
      if (!sheet || !action.startsWith("zap-")) return false;
      if (action === "zap-close") close();
      else if (action === "zap-go" && !sheet.paying) void go(sheet);
      else if (action === "zap-copy")
        void navigator.clipboard?.writeText(sheet.lines[Number(data.i)].bolt11);
      else if (action === "zap-sats") this.set("zap-sats", Number(data.sats));
      return true;
    },
    /** The amount or the platform's share, while nothing is being paid yet. */
    set(name: string, value: number): boolean {
      if (!sheet || sheet.paying || !name.startsWith("zap-")) return false;
      if (name === "zap-sats" && !sheet.fee && value >= 1) {
        sheet.sats = Math.floor(value);
        localStorage.setItem(AMOUNT_STORE, String(sheet.sats));
      } else if (name === "zap-percent" && value >= 0 && value <= MAX_SHARE) {
        sheet.percent = value;
        localStorage.setItem(SHARE_STORE, String(value));
      }
      sheet.lines = lines(sheet);
      return true;
    },
  };
}
