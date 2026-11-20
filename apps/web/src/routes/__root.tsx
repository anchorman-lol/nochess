import {
  ClientOnly,
  createRootRoute,
  HeadContent,
  Navigate,
  Scripts,
} from "@tanstack/react-router";
import { lazy, type ReactNode } from "react";
import { head } from "../app/head.ts";

const App = lazy(() => import("../app/app.tsx").then((m) => ({ default: m.App })));

export const Route = createRootRoute({
  head: () => head,
  shellComponent: Document,
  component: () => (
    <ClientOnly>
      <App />
    </ClientOnly>
  ),
  notFoundComponent: () => <Navigate to="/" replace />,
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Two metas of one name, which the head would merge into one. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b0e14" />
      </head>
      <body>
        <div id="app">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
