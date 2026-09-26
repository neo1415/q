import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";

import type { PublicCardDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import {
  cardFieldLabel,
  cardFieldValue,
  cardTagline,
} from "@/features/q-card/card-content";
import {
  appOrigin,
  displayUrlFor,
  loadPublicCard,
} from "@/features/q-card/public-card-data";
import { QCard } from "@/features/q-card/q-card";

export const dynamic = "force-dynamic";

/**
 * `/@handle` (BIZ-004; reached through a rewrite to `/u/[handle]`): an
 * organisation's public Q identity, value before any sign-in.
 *
 * Everything here is the API's allowlisted projection for this visitor:
 * public_external fields for anyone, network_visible ones too for a signed-
 * in Capital Q participant, and nothing else can reach the page because the
 * projection has nowhere to put it. noindex unless the owner opted in; then
 * ProfilePage JSON-LD. No third-party script, pixel or font.
 */

const VERIFIED_WORDS: Readonly<Record<string, string>> = {
  ORGANISATION_VERIFIED: "Organisation verified by Capital Q",
  FOUNDER_IDENTITY_VERIFIED: "Founder identity verified by Capital Q",
};

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
  const tagline = cardTagline(result.subjectType, result.fields);
  const url = `${appOrigin()}/@${result.handle}`;
  return {
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
  const tagline = cardTagline(card.subjectType, card.fields);
  const origin = appOrigin();
  const url = `${origin}/@${card.handle}`;
  const verified = card.verified.map((label) => VERIFIED_WORDS[label] ?? label);
  const details = card.fields.filter(
    (field) =>
      field.key !== "shortDescription" && field.key !== "publicDescription",
  );
  const website = card.fields.find((field) => field.key === "websiteUrl");
  const signIn = `/auth/sign-in?next=${encodeURIComponent(`/@${card.handle}`)}`;

  return (
    <main className="min-h-dvh bg-(--cq-canvas) text-(--cq-text-primary)">
      {card.indexable ? (
        <script
          type="application/ld+json"
          // Built from the public projection only.
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
      <div className="mx-auto flex w-full max-w-(--cq-layout-reading) flex-col gap-10 px-4 py-10 sm:px-6 sm:py-16">
        <header className="flex flex-col gap-3">
          <p className="cq-caption text-(--cq-text-tertiary)">
            Q Card · Capital Q
          </p>
          <h1 className="cq-display break-words">{card.name}</h1>
          {tagline === null ? null : (
            <p className="cq-body-lg max-w-prose text-(--cq-text-secondary)">
              {tagline}
            </p>
          )}
          {verified.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {verified.map((label) => (
                <li
                  key={label}
                  className="cq-body-sm text-(--cq-text-secondary)"
                >
                  {label}
                </li>
              ))}
            </ul>
          )}
        </header>

        {details.length === 0 ? null : (
          <section
            aria-labelledby="facts-heading"
            className="flex flex-col gap-2"
          >
            <h2 id="facts-heading" className="sr-only">
              Details
            </h2>
            <dl className="divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
              {details.map((field) => (
                <div
                  key={field.key}
                  data-card-field={field.key}
                  data-scope={field.scope}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6"
                >
                  <dt className="cq-label shrink-0 text-(--cq-text-secondary) sm:w-40">
                    {cardFieldLabel(field.key)}
                  </dt>
                  <dd className="cq-body min-w-0 break-words">
                    {field.key === "websiteUrl" ? (
                      <a
                        href={field.value}
                        rel="nofollow ugc noopener noreferrer"
                        target="_blank"
                        className="underline decoration-(--cq-border-strong) underline-offset-4 hover:decoration-(--cq-text-primary)"
                      >
                        {field.value.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      cardFieldValue(field)
                    )}
                    {field.scope === "network_visible" ? (
                      <span className="cq-caption block text-(--cq-text-tertiary)">
                        Shown to Capital Q members
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <section aria-labelledby="next-heading" className="flex flex-col gap-3">
          <h2 id="next-heading" className="cq-title-md">
            {card.audience === "PARTICIPANT"
              ? "Continue in Capital Q"
              : "Want to know more?"}
          </h2>
          <p className="cq-body-sm max-w-prose text-(--cq-text-secondary)">
            {card.audience === "PARTICIPANT"
              ? "Ask Q about them, save them, or express interest from inside Capital Q."
              : "Sign in to Capital Q to ask Q about them, see what they share with members, save them or express interest."}
          </p>
          <div className="flex flex-wrap gap-2">
            {card.audience === "PARTICIPANT" ? (
              <Link href="/home" className={buttonClassName("primary")}>
                Open Capital Q
              </Link>
            ) : (
              <Link href={signIn} className={buttonClassName("primary")}>
                Sign in
              </Link>
            )}
            <a
              href={`/@${card.handle}.vcf`}
              className={buttonClassName("secondary")}
              download={`${card.handle}.vcf`}
            >
              Save contact
            </a>
          </div>
        </section>

        <QCard
          name={card.name}
          tagline={tagline}
          handle={card.handle}
          displayUrl={displayUrlFor(card.handle)}
          verifiedLabels={card.verified.length === 0 ? [] : ["Verified claims"]}
        />
        <p className="cq-caption text-(--cq-text-tertiary)">
          Capital Q shows only what {card.name} chose to make public
          {card.audience === "PARTICIPANT" ? " or share with members" : ""}.
          Nothing here is an endorsement.
        </p>
      </div>
    </main>
  );
}
