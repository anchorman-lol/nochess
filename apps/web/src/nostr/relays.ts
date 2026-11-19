type Store = Pick<Storage, "getItem">;
export type RelayEdit = "add" | "remove" | "up" | "use";

/** The player's relays, tried in order. */
export const RELAYS_STORE = "luft:relays";
/** One relay: a share link's for its tab in sessionStorage, or what an older version saved. */
export const RELAY_STORE = "luft:relay";

/** The relays to try in order: a share link's for its tab, else the player's list, else the defaults. */
export function relaysFrom(session: Store, local: Store, defaults: string[]): string[] {
  const shared = session.getItem(RELAY_STORE);
  if (shared) return [shared];
  try {
    const saved: unknown = JSON.parse(local.getItem(RELAYS_STORE) ?? "null");
    if (Array.isArray(saved) && saved.length && saved.every((url) => typeof url === "string"))
      return saved;
  } catch {
    // an unreadable list is replaced by the defaults
  }
  const old = local.getItem(RELAY_STORE);
  return old ? [old] : defaults;
}

/** The list after an edit, or null if the edit can't be made: a URL that isn't a relay's, or removing the last. */
export function editRelays(list: string[], edit: RelayEdit, text: string): string[] | null {
  const url = text.trim().replace(/\/+$/, "");
  const rest = list.filter((relay) => relay !== url);
  const at = list.indexOf(url);
  if (edit === "add")
    return /^wss?:\/\/[^/\s]+/.test(url) ? (at < 0 ? [...list, url] : list) : null;
  if (edit === "remove") return rest.length ? rest : null;
  if (edit === "use") return [url, ...rest];
  return at > 0 ? rest.toSpliced(at - 1, 0, url) : list;
}
