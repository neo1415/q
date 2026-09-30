import type { MetadataRoute } from "next";

import { THEME_COLORS } from "@capital-q/ui/tokens";

/**
 * Web application manifest, served at /manifest.webmanifest.
 *
 * Installed Capital Q opens on Discover, where the product starts (founder
 * directive, 2026-09-27); Q is a shortcut away. `id` stays "/home": it is
 * the installed app's identity, not a route, and changing it would make
 * every existing install a different app.
 *
 * A manifest carries one theme colour, so it is the light canvas; the
 * dark canvas is set per colour scheme by the viewport's theme-color
 * metadata (app/layout.tsx), which browsers prefer when present.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "Capital Q",
    short_name: "Capital Q",
    description:
      "Investment intelligence for private capital. Q helps founders and investors reach a capital objective.",
    start_url: "/welcome",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The OS launch screen, in the splash's own navy, so an installed
    // launch hands straight over to the particle splash (2026-09-29).
    background_color: "#030916",
    theme_color: THEME_COLORS.light.canvas,
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Discover",
        short_name: "Discover",
        url: "/discover",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Ask Q",
        short_name: "Ask Q",
        url: "/home",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
