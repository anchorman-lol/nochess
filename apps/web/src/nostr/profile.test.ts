import { expect, it } from "vitest";
import { mergeProfile } from "./profile.ts";

it("changes the edited fields of a kind 0 and keeps the ones this app doesn't know", () => {
  const old = JSON.stringify({ name: "leon", website: "https://example.com", nip05: "l@x.y" });
  const merged = JSON.parse(mergeProfile(old, { name: "Leon", about: "Plays the Caro-Kann." }));
  expect(merged).toEqual({
    name: "Leon",
    about: "Plays the Caro-Kann.",
    website: "https://example.com",
    nip05: "l@x.y",
  });
});

it("drops a field that is cleared, and trims what is typed", () => {
  const old = JSON.stringify({ name: "leon", lud16: "leon@wallet.example", picture: "x" });
  expect(
    JSON.parse(mergeProfile(old, { lud16: "", picture: "  https://p.example/a.png " })),
  ).toEqual({
    name: "leon",
    picture: "https://p.example/a.png",
  });
});

it("starts from nothing when there is no profile, or it isn't a JSON object", () => {
  expect(JSON.parse(mergeProfile(undefined, { name: "Leon" }))).toEqual({ name: "Leon" });
  expect(JSON.parse(mergeProfile("not json", { name: "Leon" }))).toEqual({ name: "Leon" });
  expect(JSON.parse(mergeProfile("[1]", { name: "Leon" }))).toEqual({ name: "Leon" });
});
