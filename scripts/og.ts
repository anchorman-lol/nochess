// Renders the social card and the PNG icons into apps/web/public from the brand's own sources.
// Run on demand after a brand change: `node scripts/og.ts`.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { BRAND } from "../packages/ui/src/brand.ts";

const root = new URL("../", import.meta.url);
const pub = new URL("apps/web/public/", root);
const read = (path: string) => readFileSync(new URL(path, pub));
const dataUri = (path: string, type: string) =>
  `data:${type};base64,${read(path).toString("base64")}`;

const logo = readFileSync(new URL("packages/ui/src/components/logo.tsx", root), "utf8");
const path = (name: string) => logo.match(new RegExp(`const ${name} =\\s*"([^"]+)"`))![1];

const INK = "oklch(0.165 0.012 262)";
const TEXT = "oklch(0.94 0.008 255)";
const MUTED = "oklch(0.73 0.02 258)";
const BRAND_DARK = "oklch(0.76 0.12 262)";
const BRAND_LIGHT = "#2346bc";

const font = `@font-face { font-family: A; src: url(${dataUri("fonts/AtkinsonHyperlegibleNext.ttf", "font/ttf")}); font-weight: 200 800; }`;

/** After 1.e4 e5 2.Nf3 Nc6 3.Bc4, the Italian: White's bishop has just landed on c4. */
const POSITION = [
  "rnbqkbnr",
  "pppp.ppp",
  "..n.....",
  "....p...",
  "..B.P...",
  ".....N..",
  "PPPP.PPP",
  "RNBQK..R",
];
const MOVED = new Set(["f1", "c4"]);
const LAST = "oklch(0.84 0.13 92 / 0.5)";

function board(size: number) {
  const sq = size / 8;
  const cells = POSITION.flatMap((row, r) =>
    [...row].map((p, f) => {
      const name = `${"abcdefgh"[f]}${8 - r}`;
      const base = (r + f) % 2 ? "oklch(0.54 0.055 232)" : "oklch(0.8 0.025 222)";
      const bg = MOVED.has(name) ? `linear-gradient(${LAST},${LAST}),${base}` : base;
      const piece =
        p === "."
          ? ""
          : `<img src="${dataUri(`pieces/chessnut/${p === p.toUpperCase() ? "w" : "b"}${p.toUpperCase()}.svg`, "image/svg+xml")}">`;
      return `<div style="background:${bg}">${piece}</div>`;
    }),
  );
  return `<div class="board" style="width:${size}px;height:${size}px;grid-template-columns:repeat(8,${sq}px)">${cells.join("")}</div>`;
}

function wordmark() {
  const name = BRAND.name.toLowerCase();
  const o = name.indexOf("o");
  return `<span class="wordmark">${name.slice(0, o)}<span class="o"><svg viewBox="-6 -52 72 80"><path d="${path("LOOP_O")}" fill="none" stroke="${BRAND_DARK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${name.slice(o + 1)}<span class="line"></span></span>`;
}

const card = `<!doctype html><style>
${font}
* { margin: 0; box-sizing: border-box; }
body { width: 1200px; height: 630px; overflow: hidden; background: ${INK}; color: ${TEXT}; font-family: A; position: relative;
  background-image: radial-gradient(ellipse 70% 90% at 82% 50%, oklch(0.76 0.12 262 / 0.16), transparent 70%); }
.text { position: absolute; left: 84px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
.wordmark { position: relative; display: inline-block; align-self: flex-start; padding-bottom: 0.12em; font-size: 104px; font-weight: 800; line-height: 1; letter-spacing: -0.03em; }
.wordmark .o { position: relative; display: inline-block; height: 0; width: 0.56em; }
.wordmark svg { position: absolute; bottom: -0.28em; left: -0.06em; height: 0.8em; width: 0.72em; overflow: visible; }
.wordmark .line { position: absolute; left: 0; right: 0; bottom: 0.035em; height: 0.12em; border-radius: 99px; background: ${BRAND_DARK}; }
h1 { margin-top: 52px; font-size: 66px; font-weight: 800; line-height: 1.04; letter-spacing: -0.02em; }
p { margin-top: 26px; font-size: 32px; line-height: 1.3; color: ${MUTED}; }
p b { color: ${BRAND_DARK}; font-weight: 700; }
.board { position: absolute; right: 64px; top: 77px; display: grid; border-radius: 14px; overflow: hidden;
  box-shadow: 0 2px 4px oklch(0 0 0 / 0.3), 0 24px 60px oklch(0 0 0 / 0.45); }
.board img { width: 100%; height: 100%; display: block; }
</style><body>
<div class="text">${wordmark()}<h1>${BRAND.tagline.replace(" sign ", " sign<br>")}</h1><p>Every move <b>signed on Nostr</b>.<br>Free and open source.</p></div>
${board(476)}
</body>`;

/** The favicon's loop on a full-bleed square, kept inside the circle a profile picture is cropped to. */
const icon = (
  size: number,
) => `<!doctype html><style>* { margin: 0; } body { width: ${size}px; height: ${size}px; overflow: hidden; }</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"><rect width="64" height="64" fill="${BRAND_LIGHT}"/><g transform="translate(32 32) scale(0.72) translate(-32 -28.5)"><path d="${path("LOOP")}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

const favicon = `<!doctype html><style>* { margin: 0; } body { width: 32px; height: 32px; overflow: hidden; } img { width: 32px; height: 32px; display: block; }</style><img src="${dataUri("favicon.svg", "image/svg+xml")}">`;

const outputs: [string, string, number, number][] = [
  ["og.png", card, 1200, 630],
  ["icon-512.png", icon(512), 512, 512],
  ["apple-touch-icon.png", icon(180), 180, 180],
  ["favicon-32.png", favicon, 32, 32],
];

const browser = await chromium.launch();
for (const [file, html, width, height] of outputs) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: new URL(file, pub).pathname,
    omitBackground: file === "favicon-32.png",
  });
  await page.close();
  console.log(`apps/web/public/${file} ${width}x${height}`);
}
await browser.close();
