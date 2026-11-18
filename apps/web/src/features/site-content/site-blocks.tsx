import type { ReactNode } from "react";

import type {
  RichSpan,
  RichText,
  SiteBlock,
  SiteLeafBlock,
} from "@capital-q/contracts";

import { PricingPlans } from "./pricing-plans";

/**
 * Renders published blocks (decision 107) with the design system, for the
 * public pages and the editor's preview alike. Every word is a React text
 * node: rich text is structured spans, never HTML, so nothing here sets
 * inner HTML and a "<script>" in a block is shown as those characters.
 * Links were checked on the server (site paths, #anchors, https, mailto);
 * this checks once more and drops anything else.
 */

const SAFE_HREF = /^(?:\/(?!\/)|#|https:\/\/|mailto:)/u;

function Span({ span }: { readonly span: RichSpan }): ReactNode {
  let node: ReactNode = span.text;
  if (span.italic === true) node = <em>{node}</em>;
  if (span.bold === true)
    node = <strong className="font-semibold">{node}</strong>;
  if (span.href !== undefined && SAFE_HREF.test(span.href)) {
    const external = span.href.startsWith("https://");
    node = (
      <a
        href={span.href}
        className="text-(--cq-text-primary) underline decoration-(--cq-border-strong) underline-offset-[3px] transition-colors duration-(--cq-motion-fast) hover:decoration-(--cq-accent)"
        {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}
      >
        {node}
      </a>
    );
  }
  return node;
}

function Spans({ spans }: { readonly spans: readonly RichSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Span key={index} span={span} />
      ))}
    </>
  );
}

export function RichTextView({
  content,
  className = "",
}: {
  readonly content: RichText;
  readonly className?: string;
}) {
  return (
    <div
      className={`cq-site-prose flex max-w-[72ch] flex-col gap-3 ${className}`}
    >
      {content.map((node, index) =>
        node.kind === "paragraph" ? (
          <p key={index}>
            <Spans spans={node.spans} />
          </p>
        ) : node.ordered ? (
          <ol key={index} className="flex list-decimal flex-col gap-1.5 ps-5">
            {node.items.map((item, i) => (
              <li key={i} className="ps-1">
                <Spans spans={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul
            key={index}
            className="flex list-disc flex-col gap-1.5 ps-5 marker:text-(--cq-text-tertiary)"
          >
            {node.items.map((item, i) => (
              <li key={i} className="ps-1">
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

export type SiteBlocksOptions = {
  /** Where an image's bytes come from (public route or the editor's own). */
  readonly imageSrc?: ((documentId: string) => string) | undefined;
  /** Editor preview: show lawyer notes in place. Never on a public page. */
  readonly showLawyerNotes?: boolean | undefined;
};

const publicImageSrc = (documentId: string) =>
  `/site-image/${encodeURIComponent(documentId)}`;

export function anchorOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 60);
}

function Leaf({
  block,
  options,
}: {
  readonly block: SiteLeafBlock;
  readonly options: SiteBlocksOptions;
}): ReactNode {
  switch (block.type) {
    case "heading": {
      const id = anchorOf(block.text) || undefined;
      if (block.level === 1) {
        return (
          <h2
            id={id}
            className="cq-title-xl scroll-mt-24 text-balance text-(--cq-text-primary)"
          >
            {block.text}
          </h2>
        );
      }
      return block.level === 2 ? (
        <h2
          id={id}
          className="cq-title-lg mt-4 scroll-mt-24 text-balance text-(--cq-text-primary)"
        >
          {block.text}
        </h2>
      ) : (
        <h3
          id={id}
          className="cq-title-sm mt-2 scroll-mt-24 text-(--cq-text-primary)"
        >
          {block.text}
        </h3>
      );
    }
    case "richText":
      return <RichTextView content={block.content} />;
    case "image": {
      if (block.documentId === null) return null;
      const src = (options.imageSrc ?? publicImageSrc)(block.documentId);
      return (
        <figure className="flex flex-col gap-2">
          {/* The bytes come straight from private storage through a one-minute signed link; next/image would proxy them through this origin. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={block.alt}
            loading="lazy"
            decoding="async"
            className="w-full rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle)"
          />
          {block.caption === "" ? null : (
            <figcaption className="cq-caption text-(--cq-text-tertiary)">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );
    }
    case "callout": {
      const tone =
        block.tone === "warning"
          ? "border-(--cq-warning) bg-(--cq-warning-soft)"
          : block.tone === "info"
            ? "border-(--cq-accent) bg-(--cq-accent-soft)"
            : "border-(--cq-border-strong) bg-(--cq-surface-subtle)";
      return (
        <aside
          className={`flex flex-col gap-2 rounded-(--cq-radius-md) border-s-2 px-5 py-4 ${tone}`}
        >
          {block.title === "" ? null : (
            <p className="cq-label text-(--cq-text-primary)">{block.title}</p>
          )}
          <RichTextView content={block.content} className="cq-body-sm" />
        </aside>
      );
    }
    case "summary":
      return (
        <section
          aria-label={block.title || undefined}
          className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-5 py-5 @2xl:px-7 @2xl:py-6"
        >
          <h2 className="cq-title-sm text-(--cq-text-primary)">
            {block.title}
          </h2>
          <RichTextView
            content={block.content}
            className="cq-body-sm text-(--cq-text-secondary)"
          />
        </section>
      );
    case "faq":
      return (
        <section className="flex flex-col gap-3">
          {block.title === "" ? null : (
            <h2
              id={anchorOf(block.title)}
              className="cq-title-lg mt-4 scroll-mt-24 text-(--cq-text-primary)"
            >
              {block.title}
            </h2>
          )}
          <div className="flex flex-col border-t border-(--cq-border-subtle)">
            {block.items.map((item) => (
              <details
                key={item.id}
                className="cq-site-faq group border-b border-(--cq-border-subtle)"
              >
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
                  <span className="cq-body font-medium">{item.question}</span>
                  <span
                    aria-hidden="true"
                    className="cq-site-faq-mark relative size-4 shrink-0 text-(--cq-text-tertiary)"
                  />
                </summary>
                <div className="cq-site-faq-answer pb-5 pe-8 text-(--cq-text-secondary)">
                  <RichTextView content={item.answer} />
                </div>
              </details>
            ))}
          </div>
        </section>
      );
    case "pricing":
      return <PricingPlans block={block} />;
    case "table":
      return (
        <figure className="flex flex-col gap-2">
          <div className="relative -mx-4 overflow-x-auto px-4 @2xl:mx-0 @2xl:px-0">
            <table className="cq-body-sm w-full min-w-[32rem] border-collapse text-start">
              {block.header.some((cell) => cell !== "") ? (
                <thead>
                  <tr>
                    {block.header.map((cell, i) => (
                      <th
                        key={i}
                        scope="col"
                        className="border-b border-(--cq-border) px-3 py-2.5 text-start font-medium text-(--cq-text-primary) first:ps-0"
                      >
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
              ) : null}
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) =>
                      c === 0 ? (
                        <th
                          key={c}
                          scope="row"
                          className="border-b border-(--cq-border-subtle) px-3 py-2.5 text-start font-normal text-(--cq-text-primary) first:ps-0"
                        >
                          {cell}
                        </th>
                      ) : (
                        <td
                          key={c}
                          className="cq-numeric border-b border-(--cq-border-subtle) px-3 py-2.5 text-(--cq-text-secondary)"
                        >
                          {cell}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption === "" ? null : (
            <figcaption className="cq-caption text-(--cq-text-tertiary)">
              {block.caption}
            </figcaption>
          )}
        </figure>
      );
    case "features":
      return (
        <section className="flex flex-col gap-4">
          {block.title === "" ? null : (
            <h2 className="cq-title-lg text-(--cq-text-primary)">
              {block.title}
            </h2>
          )}
          <dl className="grid gap-x-8 gap-y-5 @2xl:grid-cols-2">
            {block.items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-1 border-t border-(--cq-border-subtle) pt-4"
              >
                <dt className="cq-body font-medium text-(--cq-text-primary)">
                  {item.title}
                </dt>
                <dd className="cq-body-sm text-(--cq-text-secondary)">
                  {item.description}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "button":
      return SAFE_HREF.test(block.href) ? (
        <p>
          <a
            href={block.href}
            className={`cq-body-sm inline-flex min-h-11 items-center rounded-(--cq-radius-md) px-5 font-medium transition-[background-color,transform] duration-(--cq-motion-fast) active:scale-[0.98] ${
              block.variant === "primary"
                ? "bg-(--cq-accent) text-(--cq-text-inverse) hover:bg-(--cq-accent-hover)"
                : "border border-(--cq-border) bg-(--cq-surface) text-(--cq-text-primary) hover:bg-(--cq-surface-subtle)"
            }`}
          >
            {block.label}
          </a>
        </p>
      ) : null;
    case "divider":
      return <hr className="my-2 border-(--cq-border-subtle)" />;
    case "legalClause":
      return (
        <section
          id={anchorOf(block.title) || undefined}
          className="flex scroll-mt-24 flex-col gap-3"
        >
          <h2 className="cq-title-md text-(--cq-text-primary)">
            {block.title}
          </h2>
          <RichTextView
            content={block.content}
            className="text-(--cq-text-secondary)"
          />
          {options.showLawyerNotes === true &&
          (block.lawyerNote ?? "") !== "" ? (
            <aside className="cq-body-sm rounded-(--cq-radius-md) border border-dashed border-(--cq-warning) bg-(--cq-warning-soft) px-4 py-3 text-(--cq-text-primary)">
              <span className="font-medium">Lawyer note (editors only): </span>
              {block.lawyerNote}
            </aside>
          ) : null}
        </section>
      );
  }
}

export function SiteBlocks({
  blocks,
  options = {},
}: {
  readonly blocks: readonly SiteBlock[];
  readonly options?: SiteBlocksOptions;
}) {
  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block) =>
        block.type === "columns" ? (
          <div
            key={block.id}
            className="grid gap-6 @3xl:grid-cols-2 @3xl:gap-10"
          >
            <div className="flex flex-col gap-6">
              {block.left.map((inner) => (
                <Leaf key={inner.id} block={inner} options={options} />
              ))}
            </div>
            <div className="flex flex-col gap-6">
              {block.right.map((inner) => (
                <Leaf key={inner.id} block={inner} options={options} />
              ))}
            </div>
          </div>
        ) : (
          <Leaf key={block.id} block={block} options={options} />
        ),
      )}
    </div>
  );
}
