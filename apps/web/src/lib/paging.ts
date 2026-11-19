/**
 * Where the next page of a relay query that walks back in time starts (its `until`), and whether
 * there is one: a short page, or one with nothing not `seen` before, is the last.
 */
export function nextPage(
  page: { id: string; created_at: number }[],
  size: number,
  seen: Set<string>,
): { until: number | null; done: boolean } {
  if (!page.length) return { until: null, done: true };
  const oldest = Math.min(...page.map((event) => event.created_at));
  const oneSecond = page.every((event) => event.created_at === oldest);
  return {
    until: oneSecond ? oldest - 1 : oldest,
    done: page.length < size || page.every((event) => seen.has(event.id)),
  };
}
