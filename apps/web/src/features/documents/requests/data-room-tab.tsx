"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { DataRoomOwnerView, RequestInboxItem } from "@capital-q/contracts";

import { OwnerDataRoom } from "@/features/company/material/data-room";

import { AccessSheet, type AccessTarget } from "./access-sheet";
import { requestedMarks } from "./requests-model";

/**
 * The Data room tab on Documents (2026-10-08): the curated folders, with
 * the intersection shown on each document an investor asked for
 * ("Requested by Zino Capital · shared"), and the access editor for every
 * document and folder.
 */
export function DataRoomTab({
  companyId,
  view,
  items,
}: {
  readonly companyId: string;
  /** Null when the room could not be read. */
  readonly view: DataRoomOwnerView | null;
  readonly items: readonly RequestInboxItem[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<AccessTarget | null>(null);
  const marks = useMemo(() => requestedMarks(items), [items]);
  if (view === null) {
    return (
      <p className="cq-body text-(--cq-text-secondary)" role="status">
        The data room couldn&apos;t load. Try again in a moment.
      </p>
    );
  }
  return (
    <>
      <OwnerDataRoom
        // A change made in the access sheet arrives as a new view: the
        // room starts again from it.
        key={view.documents
          .map((d) => `${d.documentId}:${d.level}:${String(d.version)}`)
          .join("|")}
        companyId={companyId}
        view={view}
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
        companyId={companyId}
        target={target}
        onClose={() => {
          setTarget(null);
          router.refresh();
        }}
      />
    </>
  );
}
