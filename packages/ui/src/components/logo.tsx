import { cn } from "cn";
import { BRAND } from "../brand.ts";

/** Logo B: one pen stroke that loops once. It reads as a signature on a line. */
export const LOOP =
  "M6 46H18C30 46 44 31 44 19C44 12.5 40.5 9 35.5 9C30 9 26.5 14 26.5 22.5C26.5 36 33.5 46 46 46H58";

export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 56"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn("text-brand", className)}
    >
      <path
        d={LOOP}
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The loop drawn as a lowercase o, in hundredths of an em from the baseline. */
const LOOP_O =
  "M-4 19.5H0C20 19.5 52 10 52 -17C52 -35 42 -44 28 -44C14 -44 4 -35 4 -17C4 8 17 19.5 36 19.5H62";

/**
 * The wordmark: the name's first o is the loop, signed onto the line the name sits on, and its
 * tails run on as that line.
 */
export function Wordmark({ className }: { className?: string }) {
  const name = BRAND.name.toLowerCase();
  const o = name.indexOf("o");
  return (
    <span
      className={cn(
        "relative inline-block pb-[0.12em] font-extrabold leading-none tracking-[-0.03em] whitespace-nowrap",
        className,
      )}
      aria-label={BRAND.name}
      role="img"
    >
      <span aria-hidden="true">
        {name.slice(0, o)}
        <span className="relative inline-block h-0 w-[0.56em]">
          <svg
            viewBox="-6 -52 72 80"
            className="absolute -bottom-[0.28em] -left-[0.06em] h-[0.8em] w-[0.72em] overflow-visible text-brand"
          >
            <path
              d={LOOP_O}
              fill="none"
              stroke="currentColor"
              strokeWidth="12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        {name.slice(o + 1)}
      </span>
      <span className="absolute inset-x-0 bottom-[0.035em] h-[0.12em] rounded-full bg-brand" />
    </span>
  );
}
