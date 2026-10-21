"use client";

import type { QResultBlock } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

type PictureBlock = Extract<QResultBlock, { kind: "PICTURE" }>;

/** The source's own name, as its licence asks it to be said. */
const SOURCE_NAMES: Readonly<Record<PictureBlock["source"], string>> = {
  PEXELS: "Pexels",
};

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
      <figcaption className="cq-caption mt-1.5 text-(--cq-text-secondary)">
        {t("Photo by")}{" "}
        {block.credit.url === null ? (
          <span>{block.credit.name}</span>
        ) : (
          <a
            href={block.credit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {block.credit.name}
          </a>
        )}{" "}
        {t("on")}{" "}
        <a
          href={block.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {source}
        </a>
      </figcaption>
    </figure>
  );
}
