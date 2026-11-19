import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { sound } from "../app/store.ts";
import { clockText } from "../lib/format.ts";
import { LOW_TIME_MS, lowTimeCrossed } from "../lib/sound.ts";

/**
 * A clock: `due` (ms since the epoch) when it runs, `left` (seconds) when it stands. It never
 * animates; it turns red under ten seconds, and my own clock ticks once as it crosses that line.
 */
export function Clock({
  seat,
  due,
  left,
  mine,
}: {
  seat: number;
  due?: number;
  left: number;
  mine: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const before = useRef<number | null>(null);
  useEffect(() => {
    if (due === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [due]);
  const ms = due === undefined ? left * 1000 : Math.max(0, due - now);
  useEffect(() => {
    if (due !== undefined && mine && before.current !== null && lowTimeCrossed(before.current, ms))
      sound("low");
    before.current = due === undefined ? null : ms;
  }, [ms, due, mine]);
  const low = Math.ceil(ms / 1000) <= LOW_TIME_MS / 1000;
  return (
    <span
      data-testid={`clock-${seat}`}
      className={cn(
        "min-w-[6.4rem] rounded-lg bg-sunk px-2.5 py-1 text-right text-[1.9rem] leading-[1.15] font-semibold tracking-[-0.01em] text-muted-foreground tabular-nums max-md:min-w-[5.5rem] max-md:text-[1.6rem]",
        due !== undefined && "bg-brand text-brand-ink",
        low && "bg-bad text-white",
      )}
    >
      {clockText(ms, due !== undefined)}
    </span>
  );
}

/** Time left until `until` (seconds since the epoch), ticking each second and stopping at 0:00. */
export function Countdown({ until, testid }: { until: number; testid: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <b data-testid={testid} className="tabular-nums">
      {clockText(Math.max(0, until * 1000 - now), false)}
    </b>
  );
}
