"use client";

import type { QBrandKitState } from "@capital-q/contracts";
import { ChevronDown, ICON_SIZE } from "@capital-q/ui/icons";

import { BrandKitPanel } from "./brand-kit-panel";
import { DocumentLibrary } from "./document-library";
import type { LibraryPage } from "./library-model";

/**
 * The Documents page (DOCS spec §3; P3): the library first, then the
 * brand, set once and folded behind its heading.
 */
export function DocumentsScreen({
  initial,
  companyId,
  brand,
  openOnArrival = null,
}: {
  /** Null when the first page could not be read. */
  readonly initial: LibraryPage | null;
  readonly companyId: string | null;
  readonly brand: QBrandKitState | null;
  /**
   * A document Q was asked to open (`/documents?open=<id>`): opened in the
   * viewer once, only when it is one of the person's own listed and ready
   * documents. Anything else is ignored, never fetched.
   */
  readonly openOnArrival?: string | null;
}) {
  return (
    <>
      <DocumentLibrary
        initial={initial}
        companyId={companyId}
        openOnArrival={openOnArrival}
      />
      <details
        className="group border-y border-(--cq-border-subtle)"
        data-brand-fold
      >
        <summary className="cq-title-sm flex min-h-12 cursor-pointer list-none items-center justify-between text-(--cq-text-primary) [&::-webkit-details-marker]:hidden">
          Brand
          <ChevronDown
            size={ICON_SIZE.regular}
            aria-hidden="true"
            className="text-(--cq-text-tertiary) transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="pb-4">
          <BrandKitPanel initial={brand} />
        </div>
      </details>
    </>
  );
}
