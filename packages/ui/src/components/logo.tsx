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

/**
 * The wordmark: the loop signs the name, and its tail runs on under the word as the line a
 * signature sits on. The name comes from the brand constant, so a new name needs no new artwork.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex items-end gap-[0.06em] font-extrabold leading-none tracking-[-0.03em]",
        className,
      )}
      aria-label={BRAND.name}
      role="img"
    >
      <svg
        viewBox="0 0 48 56"
        aria-hidden="true"
        className="h-[1.05em] w-auto flex-none text-brand"
      >
        <path
          d="M4 46H12C24 46 38 31 38 19C38 12.5 34.5 9 29.5 9C24 9 20.5 14 20.5 22.5C20.5 36 27.5 46 40 46H48"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span aria-hidden="true" className="relative pb-[0.12em] lowercase">
        {BRAND.name}
        <span className="absolute inset-x-0 -left-[0.1em] bottom-[0.035em] h-[0.12em] rounded-full bg-brand" />
      </span>
    </span>
  );
}
