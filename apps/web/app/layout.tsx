import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { THEME_COLORS } from "@capital-q/ui/tokens";

import { ServiceWorkerRegistration } from "@/pwa/service-worker-registration";

import "./globals.css";

export const metadata: Metadata = {
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
};

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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
