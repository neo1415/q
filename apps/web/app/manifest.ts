import type { MetadataRoute } from "next";

import { THEME_COLORS } from "@capital-q/ui/tokens";

/**
 * Web application manifest, served at /manifest.webmanifest.
 *
 * Installed Capital Q launches straight into /home in standalone mode. The
 * colours are the canonical light canvas and accent; the icons are the
 * temporary geometric Q mark until an approved brand asset exists.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/home",
    name: "Capital Q",
    short_name: "Capital Q",
    description:
      "Investment intelligence for private capital. Q helps founders and investors reach a capital objective.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: THEME_COLORS.light.canvas,
    theme_color: THEME_COLORS.light.canvas,
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
