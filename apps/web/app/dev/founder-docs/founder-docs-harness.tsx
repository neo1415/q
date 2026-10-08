"use client";

import { useMemo, useState } from "react";

import type { DocumentsTab } from "@capital-q/contracts";

import { AssumptionsSection } from "@/features/assumptions/assumptions-section";
import {
  InvestorDataRoom,
  OwnerDataRoom,
} from "@/features/company/material/data-room";
import {
  AccessSheet,
  type AccessTarget,
} from "@/features/documents/requests/access-sheet";
import { DocumentsTabBar } from "@/features/documents/requests/documents-tab-bar";
import { RequestsInbox } from "@/features/documents/requests/requests-inbox";
import { requestedMarks } from "@/features/documents/requests/requests-model";
import {
  REVIEW_COMPANY,
  reviewDocumentAccess,
  reviewFolderAccess,
  reviewInbox,
  reviewInvestorBoard,
  reviewInvestorRoom,
  reviewOwnerRoom,
  ZINO,
} from "@/features/documents/requests/review-fixtures";

/**
 * Founder documents in the real components with fictional data (design
 * docs/design/2026-10-08/founder-docs): `?view=requested|dataroom|access|
 * folder|investor` and `?item=` for a notification's deep link. Nothing is
 * read or written here; an action that reaches the server says it didn't
 * go through, as it would without a session.
 */
export function FounderDocsHarness({
  view,
  item,
}: {
  readonly view: "requested" | "dataroom" | "access" | "folder" | "investor";
  readonly item: string | null;
}) {
  const inbox = useMemo(() => reviewInbox(), []);
  const room = useMemo(() => reviewOwnerRoom(), []);
  const marks = useMemo(() => requestedMarks(inbox.items), [inbox]);
  const [target, setTarget] = useState<AccessTarget | null>(
    view === "access"
      ? {
          kind: "DOCUMENT",
          documentId: reviewDocumentAccess().documentId,
          title: reviewDocumentAccess().title,
        }
      : view === "folder"
        ? { kind: "FOLDER", folderCode: "financials", label: "Financials" }
        : null,
  );
  if (view === "investor") {
    return (
      <div className="flex flex-col gap-10">
        <InvestorDataRoom
          companyId={REVIEW_COMPANY}
          companyName="Ledgerline (fictional)"
          view={reviewInvestorRoom()}
        />
        <AssumptionsSection
          board={reviewInvestorBoard()}
          companyName="Ledgerline (fictional)"
          route={{ kind: "DILIGENCE", relationshipId: ZINO }}
        />
      </div>
    );
  }
  const tab: DocumentsTab = view === "requested" ? "requested" : "data-room";
  return (
    <div className="flex flex-col gap-6">
      <DocumentsTabBar active={tab} counts={{ requested: "3 open" }} />
      {view === "requested" ? (
        <RequestsInbox
          companyId={REVIEW_COMPANY}
          initial={inbox}
          documents={room.documents.map((document) => ({
            documentId: document.documentId,
            title: document.title,
          }))}
          focusItem={item}
        />
      ) : (
        <>
          <OwnerDataRoom
            companyId={REVIEW_COMPANY}
            view={room}
            requested={marks}
            inDocuments
            onAccess={(document) =>
              setTarget({
                kind: "DOCUMENT",
                documentId: document.documentId,
                title: document.title,
              })
            }
            onFolderAccess={(folder) =>
              setTarget({
                kind: "FOLDER",
                folderCode: folder.code,
                label: folder.label,
              })
            }
          />
          <AccessSheet
            companyId={REVIEW_COMPANY}
            target={target}
            initial={
              target?.kind === "FOLDER"
                ? reviewFolderAccess()
                : reviewDocumentAccess()
            }
            onClose={() => setTarget(null)}
          />
        </>
      )}
    </div>
  );
}
