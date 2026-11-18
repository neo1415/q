import type { Metadata } from "next";

import { HERO } from "@/features/landing/landing-content";
import { landingCopyFrom } from "@/features/landing/landing-copy";
import { LandingPage } from "@/features/landing/landing-page";
import { publishedLanding } from "@/features/site-content/public-site";

/**
 * The landing page, for signed-out visitors in a browser (founder-approved
 * design, 2026-10-04). Signed-in people and installed (PWA) launches never
 * reach it: the request proxy sends them into the app first
 * (src/auth/landing-route.ts). The page reads no request data, so it
 * prerenders; the splash still plays over it first, from the root layout.
 * Decision 107: its words come from the content editor's published
 * landing sections, regenerated at most a minute after a publish (or at
 * once, when the console revalidates it), with today's copy as the
 * fallback whenever nothing is published or the API is unreachable.
 */
export const dynamic = "force-static";
export const revalidate = 60;

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

export default async function RootPage() {
  return <LandingPage copy={landingCopyFrom(await publishedLanding())} />;
}
