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

/** Open the canonical document in the existing viewer, retaining Q's edit path. */
export function WorkforceDocuments({
  documents,
  unavailable,
}: {
  readonly documents: readonly QArtifactSummary[];
  readonly unavailable: boolean;
}) {
  const [open, setOpen] = useState<QArtifactSummary | null>(null);
  const { askNow } = useGlobalQ();
  // A first click must not disappear while a server-rendered control hydrates.
  const interactive = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const ready = documents.filter(
    (document) => document.status === "READY" && document.currentVersion > 0,
  );
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
      <DialogRoot
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        {open === null ? null : (
          <DialogViewerContent
            title={open.title}
            onSwipeDismiss={() => setOpen(null)}
          >
            <ArtifactViewer
              artifactId={open.artifactId}
              onClose={() => setOpen(null)}
              onEditWithQ={(title) => {
                setOpen(null);
                askNow(
                  `Edit "${title}" with me — what would you change first?`,
                );
              }}
            />
          </DialogViewerContent>
        )}
      </DialogRoot>
    </section>
  );
}
