"use client";

import { useCallback, useEffect, useState } from "react";

import type { QArtifactDetail } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import { readQArtifactAction, readQArtifactVersionAction } from "./actions";

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
};

function whenLabel(iso: string): string {
  const at = new Date(iso);
  return at.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function typeLabel(type: string): string {
  return type === "INVESTMENT_BRIEF" ? "Investment brief" : "Document";
}

export function ArtifactViewer({ artifactId, onClose }: ArtifactViewerProps) {
  const [detail, setDetail] = useState<QArtifactDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Which version is on screen; null means whatever is current. */
  const [showing, setShowing] = useState<number | null>(null);

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
  }, [load, showing]);

  const current = detail?.current;

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

      {current === undefined ? null : (
        <article className="flex flex-col gap-5" data-q-artifact-body>
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
