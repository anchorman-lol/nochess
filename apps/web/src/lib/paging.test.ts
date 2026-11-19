import { expect, test } from "vitest";
import { nextPage } from "./paging.ts";

const at = (...times: number[]) =>
  times.map((created_at, i) => ({ id: `e${created_at}-${i}`, created_at }));

test("the next page starts at the oldest event, kept inclusive so a shared second isn't skipped", () => {
  expect(nextPage(at(50, 40, 30), 3, new Set())).toEqual({ until: 30, done: false });
});

test("a short page, or one with nothing new, is the last", () => {
  expect(nextPage(at(50, 40), 3, new Set()).done).toBe(true);
  const page = at(50, 40, 30);
  expect(nextPage(page, 3, new Set(page.map((event) => event.id))).done).toBe(true);
  expect(nextPage([], 3, new Set())).toEqual({ until: null, done: true });
});

test("a full page from a single second steps past it, or paging would stand still", () => {
  expect(nextPage(at(30, 30, 30), 3, new Set())).toEqual({ until: 29, done: false });
});
