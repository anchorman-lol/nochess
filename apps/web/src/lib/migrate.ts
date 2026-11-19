const OLD = "luft:";
const NEW = "nochess:";

/**
 * The app stored its keys as `luft:…` before it was renamed. Each is copied once to `nochess:…`,
 * unless that is already set, so the key kept in the browser, the relays, settings and mutes stay.
 * The old entries are left in place.
 */
export function migrateKeys(store: Pick<Storage, "length" | "key" | "getItem" | "setItem">) {
  const old = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
    (key): key is string => !!key?.startsWith(OLD),
  );
  for (const key of old) {
    const renamed = NEW + key.slice(OLD.length);
    if (store.getItem(renamed) === null) store.setItem(renamed, store.getItem(key)!);
  }
}
