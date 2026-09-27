import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { loadWebServerConfig } from "@capital-q/config/web";
import { THEME_COLORS } from "@capital-q/ui/tokens";

import { THEME_BOOT_SCRIPT } from "@/features/appearance/theme";
import { ServiceWorkerRegistration } from "@/pwa/service-worker-registration";

import "./globals.css";

const METADATA: Metadata = {
  title: { default: "Capital Q", template: "%s · Capital Q" },
  description:
    "Investment intelligence for private capital. Q helps founders and investors reach a capital objective with evidence, not noise.",
  applicationName: "Capital Q",
  appleWebApp: {
    capable: true,
    title: "Capital Q",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
  // Next renders the standard `mobile-web-app-capable`; older iOS versions
  // read only Apple's prefixed name for standalone launch from the Home
  // Screen, so both are declared.
  other: { "apple-mobile-web-app-capable": "yes" },
};

/**
 * The configured web origin (`CQ_WEB_ORIGIN`) as the base for every
 * relative metadata URL (og:image, canonical). Without it Next falls back
 * to `http://localhost:3000`, which is what share previews then fetch.
 * Read at request time, not build time: the origin is deployment config.
 * A build that cannot load the config yet leaves the base unset rather
 * than failing; any page that emits an absolute URL also sets it itself.
 */
function metadataBase(): URL | undefined {
  try {
    return new URL(loadWebServerConfig().auth.appOrigin);
  } catch {
    return undefined;
  }
}

export function generateMetadata(): Metadata {
  const base = metadataBase();
  return base === undefined ? METADATA : { ...METADATA, metadataBase: base };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lay out under the notch and home indicator; the shell pads with the
  // safe-area insets itself.
  viewportFit: "cover",
  // The on-screen keyboard shrinks the layout viewport, so fixed navigation
  // and the composer stay reachable instead of sliding under it.
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: THEME_COLORS.light.canvas,
    },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark.canvas },
  ],
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    // suppressHydrationWarning: the boot script below sets `data-theme` on
    // this element before React hydrates it, on purpose. It covers this
    // element's own attributes only, never its children.
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
         * The person's own appearance choice, applied before anything is
         * painted. It reads one key and sets one attribute; the tokens do
         * the rest, and no choice at all leaves the device deciding.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
