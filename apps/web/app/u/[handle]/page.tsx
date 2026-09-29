import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import type { PublicCardDto } from "@capital-q/contracts";

import {
  cardTagline,
  publicExternalFields,
} from "@/features/q-card/card-content";
import {
  appOrigin,
  displayUrlFor,
  loadPublicCard,
} from "@/features/q-card/public-card-data";
import { qrSvg } from "@/features/q-card/qr";
import { PublicCardView } from "@/features/q-card/public-card-view";

export const dynamic = "force-dynamic";

/**
 * `/@handle` (BIZ-004; reached through a rewrite to `/u/[handle]`): an
 * organisation's public Q identity, value before any sign-in -- most often
 * opened by a phone camera from a Q Card (R26; the layout is
 * `PublicCardView`).
 *
 * Everything here is the API's allowlisted projection for this visitor:
 * public_external fields for anyone, network_visible ones too for a signed-
 * in Capital Q participant, and nothing else can reach the page because the
 * projection has nowhere to put it; the view re-filters by audience as a
 * second layer. Metadata and JSON-LD travel beyond this visitor (link
 * previews, crawlers), so they use public_external fields only, whoever
 * asks. noindex unless the owner opted in. No third-party script, pixel
 * or font.
 */

async function cardOrRedirect(handle: string): Promise<PublicCardDto> {
  const result = await loadPublicCard(handle);
  if (result === null) notFound();
  if (result.kind === "REDIRECT") permanentRedirect(`/@${result.handle}`);
  return result;
}

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const result = await loadPublicCard(handle);
  if (result === null || result.kind !== "CARD") {
    return { title: "Not found", robots: { index: false, follow: false } };
  }
  const tagline = cardTagline(
    result.subjectType,
    publicExternalFields(result.fields),
  );
  const origin = appOrigin();
  const url = `${origin}/@${result.handle}`;
  return {
    // The og:image beside this route is a relative URL: resolved against the
    // configured origin, never Next's localhost fallback.
    metadataBase: new URL(origin),
    title: result.name,
    ...(tagline === null ? {} : { description: tagline }),
    alternates: { canonical: url },
    // Profile pages are spam targets: noindex unless the owner opted in.
    robots: result.indexable
      ? { index: true, follow: false }
      : { index: false, follow: false },
    openGraph: {
      type: "profile",
      title: result.name,
      ...(tagline === null ? {} : { description: tagline }),
      url,
    },
  };
}

export default async function PublicCardPage({
  params,
}: {
  readonly params: Promise<{ readonly handle: string }>;
}) {
  const { handle } = await params;
  const card = await cardOrRedirect(handle);
  const publicFields = publicExternalFields(card.fields);
  const tagline = cardTagline(card.subjectType, publicFields);
  const url = `${appOrigin()}/@${card.handle}`;
  const website = publicFields.find((field) => field.key === "websiteUrl");

  return (
    <main className="min-h-dvh bg-(--cq-canvas) text-(--cq-text-primary)">
      {card.indexable ? (
        <script
          type="application/ld+json"
          // Built from public_external fields only.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "ProfilePage",
              url,
              mainEntity: {
                "@type": "Organization",
                name: card.name,
                ...(tagline === null ? {} : { description: tagline }),
                ...(website === undefined ? {} : { sameAs: [website.value] }),
              },
            }).replace(/</g, "\\u003c"),
          }}
        />
      ) : null}
      <PublicCardView
        card={card}
        displayUrl={displayUrlFor(card.handle)}
        qrSvg={qrSvg(`${appOrigin()}/@${card.handle}`)}
      />
    </main>
  );
}
