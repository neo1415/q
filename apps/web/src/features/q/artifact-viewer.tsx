"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";

import type { QArtifactDetail, QDocumentLook } from "@capital-q/contracts";
import { buttonClassName, IconButton } from "@capital-q/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Presentation,
  X,
} from "@capital-q/ui/icons";
import { InlineNotice, Skeleton } from "@capital-q/ui/states";

import { SourcesDisclosure } from "@/components/sources-disclosure";

import { artifactTypeLabel } from "./artifact-type";
import { readQArtifactAction, readQArtifactVersionAction } from "./actions";
import { ArtifactDownloads, artifactFileUrl } from "./artifact-download";
import { formatDayTime } from "@/components/date-format";

/**
 * Reading what Q composed (QX-003E).
 *
 * A document, rendered as one: headings, prose, and under each section
 * the findings it rests on with whose claim each is. Deliberately not a
 * textarea and deliberately not JSON — the point of an artifact is that
 * somebody can read it and decide whether to send it.
 *
 * It opens as a large modal over the Q page (R24), closable with its own
 * Close, Escape or the backdrop; the conversation is still there beneath.
 * On a phone it is a full-screen sheet that can be pulled down by its
 * header (R36). A deck is paged: one slide at a time with its count, the
 * arrow keys turn it, and it fits the width or the whole page.
 *
 * A deck is the same document with slides (QX-004 §5-§7). The slides are
 * drawn by the Q API from the stored version and arrive as SVG, so the
 * picture on this screen and the file the founder sends come from one
 * layout; drawing them again in React would be a second opinion about
 * what fits. They are shown in an `img`, which cannot run script, because
 * markup assembled on a server and injected into this page would be the
 * wrong place to rely on an escape function being complete. The sections
 * stay below the slides: a slide is what an investor sees, and the
 * section under it is what that slide is standing on.
 *
 * Nothing internal appears here. No tenant, no organisation, no run id,
 * no prompt, no provider, no storage path — the artifact id is in the DOM
 * only as a test hook, and it grants nothing: every read re-resolves
 * through the Q API under this person's own session, so a document they
 * have lost access to stops opening at that moment rather than when
 * somebody remembers to hide the card.
 */

export type ArtifactViewerProps = {
  readonly artifactId: string;
  readonly onClose: () => void;
  /**
   * Changes whenever the conversation puts this document in front of the
   * person again — a revision Q just wrote (CQ-QACT-001, F5). Live, the
   * viewer stayed on Version 1 after "make the traction slide shorter"
   * had produced Version 2, until it was closed and reopened.
   */
  readonly revision?: string | undefined;
  /**
   * Take this document back to Q to change it. Absent where there is no
   * conversation to take it to; the viewer then offers nothing.
   */
  readonly onEditWithQ?: ((title: string) => void) | undefined;
};

export type SlideFit = "width" | "page";

/**
 * The page a key asks for, or null for a key the pager does not own.
 *
 * Left and right only (and Home / End): up, down and the page keys stay
 * with scrolling, which is what somebody reading the section under a
 * slide expects them to do.
 */
export function pageForKey(
  key: string,
  page: number,
  count: number,
): number | null {
  if (count <= 1) return null;
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, page + 1);
    case "ArrowLeft":
      return Math.max(0, page - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

const whenLabel = formatDayTime;

const typeLabel = artifactTypeLabel;

/** An SVG slide the browser can show without being allowed to run it. */
/** Relative luminance of #rrggbb, 0..1 (WCAG). */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The document's own look (founder live 2026-09-30): the page colour the
 * person asked for, and text in their ink or whichever of black and white
 * reads best on it. Content, like a deck's colours, so it is applied as
 * given rather than drawn from the design tokens it temporarily replaces.
 */
export function documentLookStyle(
  look: QDocumentLook | undefined,
): CSSProperties | undefined {
  if (look === undefined) return undefined;
  const ink =
    look.ink ??
    (look.background === undefined
      ? undefined
      : luminance(look.background) > 0.179
        ? "#000000"
        : "#ffffff");
  return {
    ...(look.background === undefined ? {} : { background: look.background }),
    ...(ink === undefined
      ? {}
      : {
          color: ink,
          ["--cq-text-primary" as string]: ink,
          ["--cq-text-secondary" as string]: ink,
          ["--cq-text-tertiary" as string]: ink,
        }),
    ...(look.accent === undefined
      ? {}
      : { ["--cq-accent" as string]: look.accent }),
  };
}

export function slideSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function ArtifactViewer({
  artifactId,
  onClose,
  revision,
  onEditWithQ,
}: ArtifactViewerProps) {
  const [detail, setDetail] = useState<QArtifactDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Which version is on screen; null means whatever is current. */
  const [showing, setShowing] = useState<number | null>(null);
  /**
   * Bumped when the conversation says the document changed, so the
   * current version is read again. Somebody deliberately reading an
   * earlier version keeps it, and is told a newer one exists instead.
   */
  const [reloads, setReloads] = useState(0);
  const [newer, setNewer] = useState(false);
  // Adjusted while rendering, React's pattern for state that follows a
  // prop: no effect, no extra paint showing the stale version.
  const [seenRevision, setSeenRevision] = useState(revision);
  if (seenRevision !== revision) {
    setSeenRevision(revision);
    if (showing === null) {
      setReloads((count) => count + 1);
    } else {
      setNewer(true);
    }
  }
  /**
   * The drawn slides, and which version they are of.
   *
   * The version travels with them so a drawing that arrives late, or one
   * left over from the version before, is never shown against a different
   * version's prose: somebody reading V1 and looking at V2's slides would
   * be reading two documents at once.
   */
  const [drawn, setDrawn] = useState<{
    readonly version: number;
    /** Null when the drawing did not arrive: the prose stands alone. */
    readonly slides: readonly string[] | null;
  } | null>(null);
  /** Which slide is on screen, against the version it belongs to. */
  const [pageAt, setPageAt] = useState<{
    readonly version: number | null;
    readonly page: number;
  }>({ version: null, page: 0 });
  const [fit, setFit] = useState<SlideFit>("page");

  const load = useCallback(
    async (version: number | null) => {
      setLoading(true);
      const result =
        version === null
          ? await readQArtifactAction(artifactId)
          : await readQArtifactVersionAction(artifactId, version);
      if (result.ok) {
        setDetail(result.value);
        setNotice(null);
      } else {
        // Not theirs, or gone. One sentence, and no hint which.
        setDetail(null);
        setNotice(result.message);
      }
      setLoading(false);
    },
    [artifactId],
  );

  useEffect(() => {
    // One microtask later, so the read belongs to the open rather than to
    // the render that scheduled it.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load(showing);
    });
    return () => {
      cancelled = true;
    };
  }, [load, showing, reloads]);

  const current = detail?.current;
  const isDeck = current?.content.deck !== undefined;
  const version = current?.version ?? null;

  useEffect(() => {
    if (!isDeck || version === null) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          artifactFileUrl(artifactId, "slides", version),
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          // The document is readable and the prose is already on screen; a
          // drawing that did not arrive is not a reason to hide it.
          setDrawn({ version, slides: null });
          return;
        }
        const body: unknown = await response.json();
        const slides =
          typeof body === "object" && body !== null && "slides" in body
            ? body.slides
            : null;
        if (
          Array.isArray(slides) &&
          slides.every((s) => typeof s === "string")
        ) {
          setDrawn({ version, slides });
        } else {
          setDrawn({ version, slides: null });
        }
      } catch {
        // Aborted, offline, or something that was not JSON. The prose
        // stands on its own.
        if (!controller.signal.aborted) setDrawn({ version, slides: null });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [artifactId, isDeck, version]);

  const drawing = drawn !== null && drawn.version === version ? drawn : null;
  const slides = drawing?.slides ?? null;
  const drawingPending = isDeck && drawing === null;
  const pageCount = slides?.length ?? 0;
  const page =
    pageAt.version === version
      ? Math.min(pageAt.page, Math.max(0, pageCount - 1))
      : 0;
  const goTo = (next: number) => {
    setPageAt({ version, page: next });
  };

  const sections = current?.content.sections ?? [];
  const deckSlides = current?.content.deck?.slides ?? [];
  /** The section the slide on screen is standing on. */
  const behind =
    slides === null ? undefined : sections[deckSlides[page]?.section ?? -1];
  /** Sections no slide stands on, so paging never hides part of the record. */
  const unslid =
    slides === null
      ? sections
      : sections.filter(
          (_, index) => !deckSlides.some((slide) => slide.section === index),
        );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-(--cq-surface-raised)"
      role="document"
      aria-label={detail?.artifact.title ?? "Document"}
      data-q-artifact-viewer={artifactId}
      onKeyDown={(event) => {
        const target = event.target;
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          (target instanceof Element &&
            target.closest("input, textarea, select, [role='menu']") !== null)
        ) {
          return;
        }
        const next = pageForKey(event.key, page, pageCount);
        if (next === null) return;
        event.preventDefault();
        goTo(next);
      }}
    >
      <header
        className="flex shrink-0 items-start gap-3 border-b border-(--cq-border-subtle) px-4 pt-2 pb-3 sm:px-6 sm:pt-4"
        // A phone can pull the sheet down by its header (R36).
        data-cq-sheet-drag
      >
        <span
          aria-hidden="true"
          className="mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary) sm:flex"
        >
          {isDeck ? (
            <Presentation size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
          ) : (
            <FileText size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="cq-caption text-(--cq-text-tertiary)">
            {detail === null ? "Document" : typeLabel(detail.artifact.type)}
          </span>
          <h2 className="cq-title-md line-clamp-2 text-(--cq-text-primary)">
            {detail?.artifact.title ?? "Document"}
          </h2>
          {current === undefined ? null : (
            <p className="cq-caption text-(--cq-text-tertiary)">
              Version {String(current.version)} · {whenLabel(current.createdAt)}
              {detail !== null &&
              current.version !== detail.artifact.currentVersion
                ? " · an earlier version"
                : ""}
            </p>
          )}
        </div>
        <IconButton aria-label="Close" onClick={onClose} data-q-artifact-close>
          <X
            aria-hidden="true"
            size={ICON_SIZE.regular}
            strokeWidth={ICON_STROKE}
          />
        </IconButton>
      </header>

      {version === null && detail === null ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-(--cq-border-subtle) px-4 py-2 sm:px-6">
          {detail !== null && detail.history.length > 1 ? (
            <nav
              aria-label="Versions"
              className="flex flex-wrap items-center gap-1"
              data-q-artifact-versions
            >
              {detail.history.map((entry) => {
                const active = current?.version === entry.version;
                return (
                  <button
                    key={entry.version}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    aria-label={`Version ${String(entry.version)}`}
                    className={buttonClassName(
                      active ? "secondary" : "quiet",
                      "regular",
                    )}
                    onClick={() => {
                      setShowing(entry.version);
                    }}
                    data-q-artifact-version={String(entry.version)}
                    title={entry.instruction ?? undefined}
                  >
                    V{String(entry.version)}
                  </button>
                );
              })}
            </nav>
          ) : null}
          <div
            className="ml-auto flex flex-wrap items-center gap-2"
            data-q-artifact-export
          >
            {onEditWithQ === undefined || detail === null ? null : (
              <button
                type="button"
                className={buttonClassName("quiet", "regular")}
                onClick={() => {
                  onEditWithQ(detail.artifact.title);
                }}
                data-q-artifact-edit
              >
                Edit with Q
              </button>
            )}
            {version === null ? null : (
              /*
                Every document downloads as a PDF, and a deck as PowerPoint
                too (BIZ-001), for the version on screen. Decided by what
                this version holds rather than by its type code, so the
                offer and the file cannot disagree.
              */
              <ArtifactDownloads
                artifactId={artifactId}
                formats={isDeck ? ["pdf", "pptx"] : ["pdf"]}
                version={version}
                layer="modal"
              />
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6">
        {loading && detail === null ? (
          <div className="flex flex-col gap-4" data-q-artifact-loading>
            <span className="sr-only" role="status">
              Opening the document…
            </span>
            <Skeleton lines={1} className="w-1/3" />
            <Skeleton lines={4} />
            <Skeleton lines={3} />
          </div>
        ) : null}

        {notice !== null ? (
          <InlineNotice tone="warning" title="That didn't open">
            <span className="block">{notice}</span>
            <span className="block">
              Close this and open it again from the conversation, or ask Q for
              it.
            </span>
          </InlineNotice>
        ) : null}

        {newer ? (
          <InlineNotice tone="info" title="A new version is ready">
            <button
              type="button"
              className={buttonClassName("secondary", "regular")}
              onClick={() => {
                setNewer(false);
                setShowing(null);
                setReloads((count) => count + 1);
              }}
              data-q-artifact-show-latest
            >
              Show the latest
            </button>
          </InlineNotice>
        ) : null}

        {drawingPending && current !== undefined ? (
          <div
            aria-hidden="true"
            className="aspect-video w-full animate-pulse rounded-md bg-(--cq-surface-strong)"
            data-q-artifact-slides-loading
          />
        ) : null}

        {slides === null || slides.length === 0 ? null : (
          <section
            aria-roledescription="slide viewer"
            aria-label="Slides"
            className="flex flex-col gap-3"
            data-q-artifact-slides
            data-fit={fit}
          >
            <div
              className={
                fit === "page"
                  ? "flex justify-center"
                  : "flex justify-center overflow-x-auto"
              }
            >
              {/*
                A data-URI SVG drawn per request: there is nothing for an
                image optimiser to fetch, resize or cache, so `next/image`
                would add a loader in front of bytes that are already here.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slideSource(slides[page] ?? "")}
                alt={`Slide ${String(page + 1)}`}
                className={
                  fit === "page"
                    ? "h-auto max-h-[calc(100dvh-260px)] w-auto max-w-full rounded-md border border-(--cq-border-subtle) object-contain"
                    : "h-auto w-full rounded-md border border-(--cq-border-subtle)"
                }
                data-q-artifact-slide={String(page + 1)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <IconButton
                  aria-label="Previous slide"
                  variant="secondary"
                  className="aria-disabled:cursor-default aria-disabled:opacity-50"
                  // aria-disabled, not disabled: a disabled button drops
                  // the focus it had, and the arrow keys with it.
                  aria-disabled={page === 0}
                  onClick={() => {
                    if (page > 0) goTo(page - 1);
                  }}
                  data-q-artifact-prev
                >
                  <ChevronLeft
                    aria-hidden="true"
                    size={ICON_SIZE.regular}
                    strokeWidth={ICON_STROKE}
                  />
                </IconButton>
                <span
                  className="cq-body-sm min-w-16 text-center text-(--cq-text-secondary) tabular-nums"
                  aria-live="polite"
                  data-q-artifact-page
                >
                  <span className="sr-only">Slide </span>
                  {String(page + 1)}
                  <span aria-hidden="true"> / </span>
                  <span className="sr-only"> of </span>
                  {String(pageCount)}
                </span>
                <IconButton
                  aria-label="Next slide"
                  variant="secondary"
                  className="aria-disabled:cursor-default aria-disabled:opacity-50"
                  aria-disabled={page >= pageCount - 1}
                  onClick={() => {
                    if (page < pageCount - 1) goTo(page + 1);
                  }}
                  data-q-artifact-next
                >
                  <ChevronRight
                    aria-hidden="true"
                    size={ICON_SIZE.regular}
                    strokeWidth={ICON_STROKE}
                  />
                </IconButton>
              </div>
              <div
                role="group"
                aria-label="Zoom"
                className="flex items-center gap-1"
              >
                {(["width", "page"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={fit === option}
                    className={buttonClassName(
                      fit === option ? "secondary" : "quiet",
                      "regular",
                    )}
                    onClick={() => setFit(option)}
                    data-q-artifact-fit={option}
                  >
                    {option === "width" ? "Fit width" : "Fit page"}
                  </button>
                ))}
              </div>
            </div>
            <p className="cq-caption hidden text-(--cq-text-tertiary) sm:block">
              Use the left and right arrow keys to turn slides.
            </p>
          </section>
        )}

        {current === undefined ? null : (
          <article
            className={
              current.content.look?.background === undefined
                ? "mx-auto flex w-full max-w-(--cq-layout-narrow) flex-col gap-5"
                : "mx-auto flex w-full max-w-(--cq-layout-narrow) flex-col gap-5 rounded-lg p-6"
            }
            style={documentLookStyle(current.content.look)}
            data-q-artifact-body
          >
            {behind === undefined ? null : (
              <DocumentSection section={behind} eyebrow="Behind this slide" />
            )}
            {unslid.map((section) => (
              <DocumentSection key={section.heading} section={section} />
            ))}

            {current.content.gaps.length === 0 ? null : (
              <section className="flex flex-col gap-2" data-q-artifact-gaps>
                <h3 className="cq-title-sm text-(--cq-text-primary)">
                  What isn&apos;t on record yet
                </h3>
                {/* Unknown stays unknown, in the document itself, because
                    an investor should see the shape of the gap. */}
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {current.content.gaps.map((gap) => (
                    <li
                      key={gap}
                      className="cq-body-sm text-(--cq-text-secondary)"
                    >
                      {gap}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="cq-caption text-(--cq-text-tertiary)">
              Q composed this from what Capital Q holds on record. It is a
              private draft: it is not verified evidence, it does not change
              your company record, and nothing here has been shared or sent.
            </p>
          </article>
        )}
      </div>
    </div>
  );
}

type ArtifactSection = NonNullable<
  QArtifactDetail["current"]
>["content"]["sections"][number];

function DocumentSection({
  section,
  eyebrow,
}: {
  readonly section: ArtifactSection;
  readonly eyebrow?: string | undefined;
}) {
  return (
    <section className="flex flex-col gap-2" data-q-artifact-section>
      {eyebrow === undefined ? null : (
        <span className="cq-caption text-(--cq-text-tertiary)">{eyebrow}</span>
      )}
      <h3 className="cq-title-sm text-(--cq-text-primary)">
        {section.heading}
      </h3>
      <p className="cq-body whitespace-pre-wrap text-(--cq-text-primary)">
        {section.body}
      </p>
      {section.findings.length === 0 ? null : (
        <SourcesDisclosure count={section.findings.length}>
          <dl className="flex flex-col gap-1 border-l-2 border-(--cq-border-subtle) pl-3">
            {section.findings.map((finding) => (
              <div key={finding.findingId} className="flex flex-col">
                <dd className="cq-body-sm text-(--cq-text-secondary)">
                  {finding.statement}
                </dd>
                {/*
                  Truth class and evidence status, kept apart and one tap
                  away (ADR 0018): a reader deciding whether to send this can
                  still see which sentences are somebody's claim and which
                  the record supports.
                */}
                <dd className="cq-caption text-(--cq-text-tertiary)">
                  {finding.truthClass.toLowerCase().replace(/_/g, " ")} ·{" "}
                  {finding.evidenceStatus.toLowerCase().replace(/_/g, " ")}
                </dd>
              </div>
            ))}
          </dl>
        </SourcesDisclosure>
      )}
    </section>
  );
}
