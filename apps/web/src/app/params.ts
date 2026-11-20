import { notFound } from "@tanstack/react-router";

/** A path segment that has to match, or the route isn't found. */
export function must(value: string, pattern: RegExp) {
  if (!pattern.test(value)) throw notFound();
  return value;
}

export const PUBKEY = /^[0-9a-f]{64}$/;
