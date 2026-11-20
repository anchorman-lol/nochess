import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { head, LD, SITE } from "./app/head.ts";

const pub = (file: string) => new URL(`../public/${file}`, import.meta.url);

const meta = (key: string) =>
  head.meta.find((tag) => ("property" in tag ? tag.property : "name" in tag && tag.name) === key)
    ?.content;

function pngSize(file: string) {
  const png = readFileSync(pub(file));
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("the head for link previews", () => {
  it("names the canonical page and the card by absolute URL", () => {
    expect(SITE).toBe("https://anchorman-lol.github.io/nochess/");
    expect(head.links).toContainEqual({ rel: "canonical", href: SITE });
    expect(meta("og:url")).toBe(SITE);
    expect(meta("og:image")).toBe(`${SITE}og.png`);
    expect(meta("twitter:image")).toBe(`${SITE}og.png`);
    expect(meta("twitter:card")).toBe("summary_large_image");
  });

  it("has a title and description for every reader", () => {
    for (const key of ["og:title", "og:description", "twitter:title", "twitter:description"]) {
      expect(meta(key), key).toBeTruthy();
    }
    expect(meta("description")!.length).toBeLessThanOrEqual(160);
  });

  it("carries JSON-LD that parses", () => {
    const ld = head.scripts.find((script) => "type" in script)!;
    expect(JSON.parse(ld.children)).toEqual(LD);
    expect(LD.url).toBe(SITE);
  });
});

describe("public images", () => {
  it.each([
    ["og.png", 1200, 630],
    ["icon-512.png", 512, 512],
    ["apple-touch-icon.png", 180, 180],
    ["favicon-32.png", 32, 32],
  ])("%s is %ix%i", (file, width, height) => {
    expect(pngSize(file)).toEqual([width, height]);
  });

  it("og:image matches the card's size", () => {
    expect([meta("og:image:width"), meta("og:image:height")]).toEqual(
      pngSize("og.png").map(String),
    );
  });

  it("every icon the manifest lists exists", () => {
    const manifest = JSON.parse(readFileSync(pub("site.webmanifest"), "utf8"));
    for (const { src } of manifest.icons) expect(existsSync(pub(src)), src).toBe(true);
  });
});
