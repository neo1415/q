import type { Metadata } from "next";

import { HERO } from "@/features/landing/landing-content";
import { LandingPage } from "@/features/landing/landing-page";

/**
 * The landing page, for signed-out visitors in a browser (founder-approved
 * design, 2026-10-04). Signed-in people and installed (PWA) launches never
 * reach it: the request proxy sends them into the app first
 * (src/auth/landing-route.ts). The page reads no request data, so it
 * prerenders; the splash still plays over it first, from the root layout.
 */
export const dynamic = "force-static";

const TITLE = `Capital Q · ${HERO.title}`;
const DESCRIPTION =
  "Capital Q is investment intelligence for private capital. Q reads the evidence, prepares the next step, and acts only when you approve.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "Capital Q",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [
      { url: "/icons/icon-512.png", width: 512, height: 512, alt: "Capital Q" },
    ],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/icons/icon-512.png"],
  },
};

export default function RootPage() {
  return <LandingPage />;
}
