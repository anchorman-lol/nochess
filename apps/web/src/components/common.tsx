import type { Speed } from "@luft/core/game/events.ts";
import { Icon } from "@luft/ui/components/icon";
import { cn } from "cn";
import type { ReactNode } from "react";
import { me, rate, who } from "../app/store.ts";
import { plural, shortKey, showRating } from "../lib/format.ts";

/** A name, with the BOT tag for bot accounts and "(you)" for this browser's key. */
export function Player({ pubkey, you = true }: { pubkey: string; you?: boolean }) {
  const { name, bot } = who(pubkey);
  return (
    <>
      {bot && (
        <b className="bot mr-1 inline-flex h-[1.15rem] items-center rounded-[0.25rem] bg-foreground px-1 align-[0.1em] text-[0.66rem] font-bold tracking-[0.04em] text-background">
          BOT
        </b>
      )}
      {name || shortKey(pubkey)}
      {you && pubkey === me ? " (you)" : ""}
    </>
  );
}

export function PlayerLink({ pubkey, className }: { pubkey: string; className?: string }) {
  return (
    <a
      href={`#/player/${pubkey}`}
      className={cn("truncate font-semibold hover:text-brand", className)}
    >
      <Player pubkey={pubkey} />
    </a>
  );
}

/** A round initial in a colour drawn from the key, so faces differ without pictures. */
export function Avatar({
  pubkey,
  size = "md",
}: {
  pubkey: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const name = who(pubkey).name || "?";
  const hue = parseInt(pubkey.slice(0, 4), 16) % 360;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid flex-none place-items-center rounded-full font-bold text-white",
        {
          sm: "size-5 text-[0.65rem]",
          md: "size-[1.55rem] text-[0.78rem]",
          lg: "size-9 text-base",
          xl: "size-18 text-3xl",
        }[size],
      )}
      style={{ background: `oklch(0.55 0.11 ${hue})` }}
    >
      {name[0]?.toUpperCase()}
    </span>
  );
}

export function RatingOf({ pubkey, speed }: { pubkey: string; speed: Speed | null }) {
  const rating = speed && rate(pubkey, speed);
  return rating ? (
    <span className="rating text-muted-foreground tabular-nums">{showRating(rating)}</span>
  ) : null;
}

export function Zapped({ sats }: { sats: number }) {
  if (!sats) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 font-semibold text-zap tabular-nums"
      data-testid="zapped"
      title={`${plural(sats, "sat")} zapped`}
    >
      <Icon name="zap" />
      {sats}
    </span>
  );
}

export function ZapButton({
  label,
  sats = 0,
  onClick,
  className,
}: {
  label?: string;
  sats?: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="zap"
      aria-label={label ? undefined : "Zap"}
      title={`Zap${sats ? `: ${plural(sats, "sat")} so far` : ""}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[0.55rem] font-semibold text-zap transition-colors duration-150 hover:bg-zap-soft",
        label
          ? "h-9 border border-[color-mix(in_oklch,var(--zap)_45%,var(--line))] px-3"
          : "h-8 px-1.5",
        className,
      )}
    >
      <Icon name="zap" />
      {sats ? (
        <span data-testid="zapped" className="tabular-nums">
          {sats}
        </span>
      ) : null}
      {label}
    </button>
  );
}

/** The loop from the logo: the icon for "signed". */
export function Signed({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-semibold text-brand", className)}>
      <svg viewBox="0 0 64 56" aria-hidden="true" className="h-[1.1em] w-auto">
        <path
          d="M6 46H18C30 46 44 31 44 19C44 12.5 40.5 9 35.5 9C30 9 26.5 14 26.5 22.5C26.5 36 33.5 46 46 46H58"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </span>
  );
}

export const Hint = ({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) => (
  <p className={cn("text-[0.9rem] text-muted-foreground", className)} {...rest}>
    {children}
  </p>
);

export const Section = ({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn("min-w-0", className)}>
    <div className="mb-3 flex items-center gap-3">
      <h2 className="mr-auto text-base font-bold tracking-[-0.005em]">{title}</h2>
      {aside}
    </div>
    {children}
  </section>
);

/** A ruled list: one line per row, hairlines between. */
export const List = ({
  children,
  className,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}) => (
  <ul
    className={cn(
      "border-t border-line [&>li]:flex [&>li]:min-h-11 [&>li]:items-center [&>li]:gap-3 [&>li]:border-b [&>li]:border-line [&>li]:py-1.5",
      className,
    )}
    {...rest}
  >
    {children}
  </ul>
);
export const None = ({ children }: { children: ReactNode }) => (
  <li className="none text-[0.9rem] text-muted-foreground">{children}</li>
);
