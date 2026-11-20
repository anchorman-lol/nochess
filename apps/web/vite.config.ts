import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** A build is for GitHub Pages, which serves the app under the repository's name. */
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/nochess/" : "/",
  server: { host: "127.0.0.1" },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true, prerender: { outputPath: "/index.html" } } }),
    react(),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "nostr", test: /node_modules[\\/](nostr-tools|@noble|@scure)[\\/]/ },
          ],
        },
      },
    },
  },
}));
