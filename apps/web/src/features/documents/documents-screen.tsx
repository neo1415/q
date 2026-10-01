"use client";

import {
  qArtifactExportFormats,
  type QArtifactSummary,
  type QBrandKitState,
} from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import {
  CircleAlert,
  FileText,
  ICON_SIZE,
  ICON_STROKE,
  Presentation,
} from "@capital-q/ui/icons";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { ArtifactDownloads } from "@/features/q/artifact-download";
import { artifactTypeLabel } from "@/features/q/artifact-type";

import { BrandKitPanel } from "./brand-kit-panel";
import { openDocumentViewer } from "./document-ready";

/**
 * The Documents page (DOCS spec §3): the brand, then every document, the
 * newest first. A document opens in the one viewer the shell owns; its
 * files download through the same narrow route as everywhere else.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function DocumentRow({ document }: { readonly document: QArtifactSummary }) {
  const ready = document.status === "READY";
  const Icon =
    document.status === "FAILED"
      ? CircleAlert
      : document.type === "PITCH_DECK"
        ? Presentation
        : FileText;
  const state =
    document.status === "READY"
      ? `Version ${String(document.currentVersion)}`
      : document.status === "PREPARING"
        ? "Q is writing this"
        : "Couldn't be finished";
  return (
    <li
      className="flex flex-col gap-3 border-b border-(--cq-border-subtle) py-4 sm:flex-row sm:items-center"
      data-document-row={document.artifactId}
      data-document-status={document.status}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-(--cq-surface-subtle) text-(--cq-text-secondary)"
        >
          <Icon size={ICON_SIZE.regular} strokeWidth={ICON_STROKE} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="cq-body line-clamp-2 font-medium text-(--cq-text-primary)">
            {document.title}
          </p>
          <p className="cq-caption text-(--cq-text-tertiary)">
            {artifactTypeLabel(document.type)} · {state} ·{" "}
            {DATE.format(new Date(document.updatedAt))}
          </p>
        </div>
      </div>
      {ready ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            className={buttonClassName("secondary", "regular")}
            onClick={() => openDocumentViewer(document.artifactId)}
            data-document-open
          >
            Open
          </button>
          <ArtifactDownloads
            artifactId={document.artifactId}
            formats={qArtifactExportFormats(document.type)}
            version={null}
          />
        </div>
      ) : null}
    </li>
  );
}

export function DocumentsScreen({
  documents,
  brand,
}: {
  /** Null when the list could not be read. */
  readonly documents: readonly QArtifactSummary[] | null;
  readonly brand: QBrandKitState | null;
}) {
  const { askAbout } = useGlobalQ();
  const items = documents;

  return (
    <>
      <BrandKitPanel initial={brand} />

      <section className="flex flex-col gap-3" aria-labelledby="documents-list">
        <h2
          id="documents-list"
          className="cq-title-sm text-(--cq-text-primary)"
        >
          Your documents
        </h2>
        {items === null ? (
          <p
            className="cq-body text-(--cq-text-secondary)"
            data-state="unavailable"
          >
            Your documents couldn&apos;t be read just now. Reload in a moment.
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-start gap-3" data-state="empty">
            <p className="cq-body text-(--cq-text-secondary)">
              No documents yet. Ask Q for a pitch deck, a one-pager or a report,
              by typing or by voice, from any page.
            </p>
            <button
              type="button"
              className={buttonClassName("primary", "regular")}
              onClick={() => askAbout("Make me a pitch deck.")}
              data-documents-ask
            >
              Ask Q for a deck
            </button>
          </div>
        ) : (
          <ul className="flex flex-col" data-documents-list>
            {items.map((document) => (
              <DocumentRow key={document.artifactId} document={document} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
