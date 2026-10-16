"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import type { QArtifactSummary } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { DialogRoot, DialogViewerContent } from "@capital-q/ui/dialog";
import { useGlobalQ } from "@/components/app-shell/global-q";

const ArtifactViewer = dynamic(
  () =>
    import("@/features/q/artifact-viewer").then(
      (module) => module.ArtifactViewer,
    ),
  { ssr: false },
);
const subscribe = () => () => undefined;

/** A first click must not disappear while a server-rendered control hydrates. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** Only an actual READY version is offered as something to open. */
function readyDocuments(
  documents: readonly QArtifactSummary[],
): readonly QArtifactSummary[] {
  return documents.filter(
    (document) => document.status === "READY" && document.currentVersion > 0,
  );
}

/**
 * The job's primary document: the revised one when the reviewer revised
 * (the highest version), else the latest updated; null when none is READY.
 */
export function primaryDocument(
  documents: readonly QArtifactSummary[],
): QArtifactSummary | null {
  return (
    [...readyDocuments(documents)].sort(
      (a, b) =>
        b.currentVersion - a.currentVersion ||
        b.updatedAt.localeCompare(a.updatedAt),
    )[0] ?? null
  );
}

/** The existing viewer in its dialog, keeping Q's edit path. */
function DocumentDialog({
  open,
  onClose,
}: {
  readonly open: QArtifactSummary | null;
  readonly onClose: () => void;
}) {
  const { askNow } = useGlobalQ();
  return (
    <DialogRoot
      open={open !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {open === null ? null : (
        <DialogViewerContent title={open.title} onSwipeDismiss={onClose}>
          <ArtifactViewer
            artifactId={open.artifactId}
            onClose={onClose}
            onEditWithQ={(title) => {
              onClose();
              askNow(`Edit "${title}" with me — what would you change first?`);
            }}
          />
        </DialogViewerContent>
      )}
    </DialogRoot>
  );
}

/**
 * A finished job's row in "Done for you": one Open for its primary
 * document (the revised memo when there is one); any others on expand.
 * The same authorized projection and viewer as the Team map's list.
 */
export function DoneJobDocuments({
  documents,
  unavailable,
}: {
  readonly documents: readonly QArtifactSummary[];
  readonly unavailable: boolean;
}) {
  const [open, setOpen] = useState<QArtifactSummary | null>(null);
  const [more, setMore] = useState(false);
  const interactive = useHydrated();
  const ready = readyDocuments(documents);
  const primary = primaryDocument(documents);
  const others = ready.filter(
    (document) => document.artifactId !== primary?.artifactId,
  );
  const missing = unavailable || ready.length < documents.length;
  if (primary === null && !missing) return null;
  return (
    <div data-done-job-documents className="mt-1">
      {primary === null ? null : (
        <div className="flex flex-wrap items-center gap-x-2">
          <Button
            type="button"
            variant="secondary"
            size="compact"
            disabled={!interactive}
            data-workforce-document={primary.artifactId}
            aria-label={`Open document: ${primary.title}`}
            onClick={() => setOpen(primary)}
          >
            Open document
          </Button>
          <span className="cq-label font-normal text-(--cq-text-tertiary)">
            {primary.title} · version {primary.currentVersion}
          </span>
          {others.length === 0 ? null : (
            <button
              type="button"
              aria-expanded={more}
              onClick={() => setMore((now) => !now)}
              className="min-h-11 cq-label font-normal text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            >
              {more
                ? "Hide other documents"
                : `${String(others.length)} more ${others.length === 1 ? "document" : "documents"}`}
            </button>
          )}
        </div>
      )}
      {more && others.length > 0 ? (
        <ul className="m-0 list-none ps-0">
          {others.map((document) => (
            <li
              key={document.artifactId}
              className="flex items-center justify-between gap-3"
            >
              <span className="min-w-0 truncate cq-label font-normal text-(--cq-text-secondary)">
                {document.title} · version {document.currentVersion}
              </span>
              <Button
                type="button"
                variant="quiet"
                size="compact"
                disabled={!interactive}
                data-workforce-document={document.artifactId}
                aria-label={`Open document: ${document.title}`}
                onClick={() => setOpen(document)}
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {missing ? (
        <p className="m-0 cq-label font-normal text-(--cq-text-tertiary)">
          A prepared document isn’t available to open right now.
        </p>
      ) : null}
      <DocumentDialog open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** Open the canonical document in the existing viewer, retaining Q's edit path. */
export function WorkforceDocuments({
  documents,
  unavailable,
}: {
  readonly documents: readonly QArtifactSummary[];
  readonly unavailable: boolean;
}) {
  const [open, setOpen] = useState<QArtifactSummary | null>(null);
  const interactive = useHydrated();
  const ready = readyDocuments(documents);
  const missing = unavailable || ready.length < documents.length;
  if (ready.length === 0 && !missing) return null;
  return (
    <section
      aria-label="Prepared documents"
      data-workforce-documents
      className="border-t border-(--cq-border-subtle) px-4 py-3"
    >
      {ready.map((document) => (
        <div
          key={document.artifactId}
          className="flex items-center justify-between gap-3 py-1"
        >
          <div className="min-w-0">
            <p className="cq-label truncate">{document.title}</p>
            <p className="cq-body-sm text-(--cq-text-secondary)">
              Version {document.currentVersion}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={!interactive}
            data-workforce-document={document.artifactId}
            onClick={() => setOpen(document)}
          >
            Open document
          </Button>
        </div>
      ))}
      {missing ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          A prepared document isn’t available to open right now.
        </p>
      ) : null}
      <DocumentDialog open={open} onClose={() => setOpen(null)} />
    </section>
  );
}
