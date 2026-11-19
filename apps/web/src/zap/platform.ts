export const DEFAULT_SHARE = 15;
export const MAX_SHARE = 50;

/**
 * Who gets the platform's share of a zap and its default percent: a key and a lightning address,
 * both or there is no share, and VITE_PLATFORM_SHARE (default 15, at most 50).
 */
export function platformFrom(env: Record<string, unknown>) {
  const text = (name: string) => String(env[`VITE_PLATFORM_${name}`] ?? "").trim();
  const [pubkey, lud16] = [text("PUBKEY"), text("LUD16")];
  if (!pubkey || !lud16) return null;
  const asked = Number(text("SHARE") || DEFAULT_SHARE);
  const share = asked >= 0 && asked <= MAX_SHARE ? asked : DEFAULT_SHARE;
  return { pubkey, lud16, share };
}
