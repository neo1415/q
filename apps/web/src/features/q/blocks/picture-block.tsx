"use client";

import { useState } from "react";

import type { QResultBlock } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

type PictureBlock = Extract<QResultBlock, { kind: "PICTURE" }>;

/** The source's own name, as its licence asks it to be said. */
const SOURCE_NAMES: Readonly<
  Record<Exclude<PictureBlock["source"], "PUBLIC_WEB">, string>
> = {
  PEXELS: "Pexels",
};

const CREDIT_LINK =
  "inline-flex min-h-11 items-center underline decoration-(--cq-border-strong) underline-offset-2 hover:text-(--cq-text-primary) hover:decoration-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--cq-focus-ring)";

/**
 * L-13 (owner ask 2026-10-20): a picture of what Q is talking about,
 * credited on the picture's own frame. It is illustration, never evidence,
 * so it carries no claim: only what it shows (alt) and who made it.
 *
 * The image loads straight from the source's CDN (the contract allows
 * only that host), never through this app, with no referrer sent. Links
 * open the photographer's and the picture's pages in a new tab.
 */
export function PictureBody({ block }: { readonly block: PictureBlock }) {
  const t = useT();
  if (block.source === "PUBLIC_WEB") return <PublicPicture block={block} />;
  const source = SOURCE_NAMES[block.source];
  return (
    <figure className="m-0" data-q-picture>
      {/* eslint-disable-next-line @next/next/no-img-element -- a stock CDN image; an optimiser would proxy it through this app */}
      <img
        src={block.url}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="aspect-[3/2] w-full rounded-(--cq-radius-md) bg-(--cq-surface-sunken) object-cover"
      />
      {/* The credit is a line of text, but each link is a full 44 px
          target (min-h-11) so it can be tapped beside the picture; the
          line keeps its height either way (accessibility). */}
      <figcaption className="cq-caption flex flex-wrap items-center gap-x-1 text-(--cq-text-secondary)">
        <span>{t("Photo by")}</span>{" "}
        {block.credit.url === null ? (
          <span className="inline-flex min-h-11 items-center">
            {block.credit.name}
          </span>
        ) : (
          <a
            href={block.credit.url}
            target="_blank"
            rel="noopener noreferrer"
            className={CREDIT_LINK}
          >
            {block.credit.name}
          </a>
        )}{" "}
        <span>{t("on")}</span>{" "}
        <a
          href={block.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={CREDIT_LINK}
        >
          {source}
        </a>
      </figcaption>
    </figure>
  );
}

/**
 * Owner 2026-10-23: a picture of the company or person Q is talking about,
 * as a public page shows it. Credited to that page ("From nairametrics.com")
 * and said to be what the page shows, never a verified identity. A picture
 * that will not load is left out rather than shown broken.
 */
function PublicPicture({ block }: { readonly block: PictureBlock }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="m-0" data-q-picture="public">
      {/* eslint-disable-next-line @next/next/no-img-element -- a public page's image; an optimiser would proxy it through this app */}
      <img
        src={block.url}
        alt={block.alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="aspect-[3/2] w-full rounded-(--cq-radius-md) bg-(--cq-surface-sunken) object-cover"
      />
      <figcaption className="cq-caption flex flex-wrap items-center gap-x-1 text-(--cq-text-secondary)">
        <span>{t("From")}</span>{" "}
        <a
          href={block.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={CREDIT_LINK}
        >
          {block.credit.name}
        </a>
        <span>· {t("Public image, not a verified identity")}</span>
      </figcaption>
    </figure>
  );
}
