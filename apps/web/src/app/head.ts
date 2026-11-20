export const SITE = "https://anchorman-lol.github.io/nochess/";
const TITLE = "Nochess · Chess you sign yourself";
const DESCRIPTION =
  "Free, open-source chess on Nostr. Both players sign every move under their own key, so your games and your rating are yours to keep.";
const IMAGE_ALT =
  "The Nochess logo, the line “Chess you sign yourself.” and a chessboard after 1.e4 e5 2.Nf3 Nc6 3.Bc4.";
const base = import.meta.env.BASE_URL;

export const LD = {
  "@context": "https://schema.org",
  "@type": ["WebApplication", "VideoGame"],
  name: "Nochess",
  url: SITE,
  description: DESCRIPTION,
  image: `${SITE}og.png`,
  applicationCategory: "GameApplication",
  genre: "Chess",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://opensource.org/licenses/MIT",
  codeRepository: "https://github.com/anchorman-lol/nochess",
  sameAs: ["https://github.com/anchorman-lol/nochess"],
};

/** Applies the saved theme before the first paint, so a dark page doesn't flash light. */
const THEME = `try {
  const saved = JSON.parse(localStorage.getItem("nochess:settings") ?? "{}");
  const theme = saved.theme ?? localStorage.getItem("nochess:theme") ?? "system";
  document.documentElement.dataset.theme =
    theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
} catch {}`;

export const head = {
  meta: [
    { charSet: "utf-8" },
    { name: "viewport", content: "width=device-width, initial-scale=1" },
    { title: TITLE },
    { name: "description", content: DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Nochess" },
    { property: "og:title", content: TITLE },
    { property: "og:description", content: DESCRIPTION },
    { property: "og:url", content: SITE },
    { property: "og:image", content: `${SITE}og.png` },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: IMAGE_ALT },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: TITLE },
    { name: "twitter:description", content: DESCRIPTION },
    { name: "twitter:image", content: `${SITE}og.png` },
    { name: "twitter:image:alt", content: IMAGE_ALT },
  ],
  links: [
    { rel: "canonical", href: SITE },
    { rel: "icon", href: `${base}favicon.svg`, type: "image/svg+xml" },
    { rel: "icon", href: `${base}favicon-32.png`, type: "image/png", sizes: "32x32" },
    { rel: "apple-touch-icon", href: `${base}apple-touch-icon.png` },
    { rel: "manifest", href: `${base}site.webmanifest` },
    {
      rel: "preload",
      href: `${base}fonts/AtkinsonHyperlegibleNext.ttf`,
      as: "font",
      type: "font/ttf",
      crossOrigin: "anonymous" as const,
    },
  ],
  scripts: [{ type: "application/ld+json", children: JSON.stringify(LD) }, { children: THEME }],
};
