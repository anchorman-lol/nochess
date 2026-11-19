/** The kind 0 fields the profile editor shows. */
export const PROFILE_FIELDS = ["name", "display_name", "about", "picture", "lud16"] as const;
export type ProfileEdits = Partial<Record<(typeof PROFILE_FIELDS)[number], string>>;

/** A kind 0's content with the edits applied: cleared fields go, fields this app doesn't know stay. */
export function mergeProfile(content: string | undefined, edits: ProfileEdits): string {
  let old: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(content ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      old = parsed as Record<string, unknown>;
  } catch {
    // a profile that isn't JSON is replaced
  }
  const merged = { ...old };
  for (const [key, value] of Object.entries(edits)) {
    const text = value?.trim();
    if (text) merged[key] = text;
    else delete merged[key];
  }
  return JSON.stringify(merged);
}
