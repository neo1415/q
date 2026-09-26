"use client";

import { useCallback, useEffect, useState } from "react";

import type { QArtifactDetail } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import { artifactTypeLabel } from "./artifact-type";
import { readQArtifactAction, readQArtifactVersionAction } from "./actions";
import { ArtifactDownloads, artifactFileUrl } from "./artifact-download";

/**
 * Reading what Q composed (QX-003E).
 *
 * A document, rendered as one: headings, prose, and under each section
 * the findings it rests on with whose claim each is. Deliberately not a
 * textarea and deliberately not JSON — the point of an artifact is that
 * somebody can read it and decide whether to send it.
 *
 * On a wide screen it is a panel beside Q, so the conversation stays
 * reachable and "Edit with Q" is one sentence away rather than one
 * navigation. On a narrow one it takes the screen, with a plain way back.
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
};

function whenLabel(iso: string): string {
  const at = new Date(iso);
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const typeLabel = artifactTypeLabel;

/** An SVG slide the browser can show without being allowed to run it. */
export function slideSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function ArtifactViewer({
  artifactId,
  onClose,
  revision,
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
    readonly slides: readonly string[];
  } | null>(null);

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
        }
      } catch {
        // Aborted, offline, or something that was not JSON. The prose
        // stands on its own.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [artifactId, isDeck, version]);

  const slides =
    drawn !== null && drawn.version === version ? drawn.slides : null;

  return (
    <aside
      className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-4"
      aria-label="Document"
      data-q-artifact-viewer={artifactId}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="cq-label text-(--cq-text-tertiary)">
            {detail === null ? "Document" : typeLabel(detail.artifact.type)}
          </span>
          <h2 className="cq-title-md text-(--cq-text-primary)">
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
        <button
          type="button"
          className={buttonClassName("quiet", "compact")}
          onClick={onClose}
          data-q-artifact-close
        >
          Back to Q
        </button>
      </div>

      {loading && detail === null ? (
        <p className="cq-body-sm text-(--cq-text-tertiary)">
          Opening the document…
        </p>
      ) : null}

      {notice !== null ? (
        <InlineNotice tone="warning" title="That didn't open">
          {notice}
        </InlineNotice>
      ) : null}

      {newer ? (
        <InlineNotice tone="info" title="A new version is ready">
          <button
            type="button"
            className={buttonClassName("secondary", "compact")}
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

      {detail !== null && detail.history.length > 1 ? (
        <nav
          aria-label="Versions"
          className="flex flex-wrap items-center gap-2"
          data-q-artifact-versions
        >
          <span className="cq-label text-(--cq-text-tertiary)">Versions</span>
          {detail.history.map((entry) => {
            const active = current?.version === entry.version;
            return (
              <button
                key={entry.version}
                type="button"
                aria-current={active ? "true" : undefined}
                className={buttonClassName(
                  active ? "secondary" : "quiet",
                  "compact",
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

      {version !== null ? (
        <div
          className="flex flex-wrap items-center gap-2"
          data-q-artifact-export
        >
          <span className="cq-label text-(--cq-text-tertiary)">Download</span>
          {/*
            Every document downloads as a PDF, and a deck as PowerPoint too
            (BIZ-001). Decided by what this version holds rather than by its
            type code, so the offer and the file cannot disagree.
          */}
          <ArtifactDownloads
            artifactId={artifactId}
            formats={isDeck ? ["pdf", "pptx"] : ["pdf"]}
            version={version}
          />
        </div>
      ) : null}

      {slides === null ? null : (
        <div className="flex flex-col gap-3" data-q-artifact-slides>
          {slides.map((svg, index) => (
            // A data-URI SVG drawn per request: there is nothing for an
            // image optimiser to fetch, resize or cache, so `next/image`
            // would add a loader in front of bytes that are already here.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              // Slides have no identity of their own; their order is what
              // they are, and the layout is deterministic.
              key={index}
              src={slideSource(svg)}
              alt={`Slide ${String(index + 1)}`}
              className="w-full rounded-md border border-(--cq-border-subtle)"
              data-q-artifact-slide={String(index + 1)}
            />
          ))}
        </div>
      )}

      {current === undefined ? null : (
        <article className="flex flex-col gap-5" data-q-artifact-body>
          {isDeck && current.content.sections.length > 0 ? (
            <h3 className="cq-label text-(--cq-text-tertiary)">
              What each slide rests on
            </h3>
          ) : null}
          {current.content.sections.map((section) => (
            <section key={section.heading} className="flex flex-col gap-2">
              <h3 className="cq-title-sm text-(--cq-text-primary)">
                {section.heading}
              </h3>
              <p className="cq-body whitespace-pre-wrap text-(--cq-text-primary)">
                {section.body}
              </p>
              {section.findings.length === 0 ? null : (
                <dl className="flex flex-col gap-1 border-l-2 border-(--cq-border-subtle) pl-3">
                  {section.findings.map((finding) => (
                    <div key={finding.findingId} className="flex flex-col">
                      <dd className="cq-body-sm text-(--cq-text-secondary)">
                        {finding.statement}
                      </dd>
                      {/*
                        Truth class and evidence status, kept apart and
                        kept visible: a reader deciding whether to send
                        this needs to know which sentences are somebody's
                        claim and which the record actually supports.
                      */}
                      <dd className="cq-caption text-(--cq-text-tertiary)">
                        {finding.truthClass.toLowerCase().replace(/_/g, " ")} ·{" "}
                        {finding.evidenceStatus
                          .toLowerCase()
                          .replace(/_/g, " ")}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          ))}

          {current.content.gaps.length === 0 ? null : (
            <section className="flex flex-col gap-2" data-q-artifact-gaps>
              <h3 className="cq-title-sm text-(--cq-text-primary)">
                What isn&apos;t on record yet
              </h3>
              {/* Unknown stays unknown, in the document itself, because an
                  investor should see the shape of the gap. */}
              <ul className="flex flex-col gap-1">
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
            Q composed this from what Capital Q holds on record. It is a private
            draft: it is not verified evidence, it does not change your company
            record, and nothing here has been shared or sent.
          </p>
        </article>
      )}
    </aside>
  );
}
