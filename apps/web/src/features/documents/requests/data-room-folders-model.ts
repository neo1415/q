import {
  DATA_ROOM_GRANT_DEFAULT_DAYS,
  type AccessCandidate,
  type DataRoomLevel,
  type DataRoomOwnerDocument,
  type DataRoomOwnerView,
  type DocumentAccessDto,
  type DocumentAccessLevel,
} from "@capital-q/contracts";

/**
 * The data room as folders (chosen design 2026-10-21, Documents option 3,
 * warm charcoal), its pure parts: who can open each folder, said in words
 * from the documents' own levels, and every investor with access to a
 * folder, from the grants on its documents. Tested without a browser.
 */

/** Who a level lets open a document, in the design's words. */
export const LEVEL_WORDS: Readonly<Record<DataRoomLevel, string>> = {
  PUBLIC: "Capital Q members",
  ON_REQUEST: "On request",
  SHARED_ONLY: "Only people you share with",
  PRIVATE: "Only your team",
};

export type AccessTone = "positive" | "brass" | "stone" | "dash";

export const LEVEL_TONE: Readonly<Record<DataRoomLevel, AccessTone>> = {
  PUBLIC: "positive",
  ON_REQUEST: "brass",
  SHARED_ONLY: "brass",
  PRIVATE: "stone",
};

export type FolderCard = {
  readonly code: string;
  readonly label: string;
  readonly documents: readonly DataRoomOwnerDocument[];
  /** The folder's access in words: one level, mixed, or nothing in it. */
  readonly access:
    | { readonly kind: "LEVEL"; readonly level: DataRoomLevel }
    | { readonly kind: "MIXED"; readonly levels: readonly DataRoomLevel[] }
    | { readonly kind: "EMPTY" };
  /** Recommended for their stage and not filed yet, in this folder. */
  readonly missing: readonly string[];
};

const ORDER: readonly DataRoomLevel[] = [
  "PUBLIC",
  "ON_REQUEST",
  "SHARED_ONLY",
  "PRIVATE",
];

export function folderCards(view: DataRoomOwnerView): readonly FolderCard[] {
  return view.folders.map((folder) => {
    const documents = view.documents.filter(
      (document) => document.folderCode === folder.code,
    );
    const levels = ORDER.filter((level) =>
      documents.some((document) => document.level === level),
    );
    const only = levels[0];
    return {
      code: folder.code,
      label: folder.label,
      documents,
      access:
        documents.length === 0 || only === undefined
          ? { kind: "EMPTY" as const }
          : levels.length === 1
            ? { kind: "LEVEL" as const, level: only }
            : { kind: "MIXED" as const, levels },
      missing: view.checklist
        .filter((item) => item.folderCode === folder.code && !item.present)
        .map((item) => item.label),
    };
  });
}

export function accessWords(access: FolderCard["access"]): string {
  switch (access.kind) {
    case "EMPTY":
      return "Nothing filed yet";
    case "LEVEL":
      return LEVEL_WORDS[access.level];
    case "MIXED":
      return `Mixed: ${access.levels.map((level) => LEVEL_WORDS[level].toLowerCase()).join(", ")}`;
  }
}

export type FolderPerson =
  | {
      readonly kind: "SHARED";
      readonly relationshipId: string;
      readonly name: string;
      readonly accessLevel: DocumentAccessLevel;
      /** The soonest any of their grants here ends; null: no end. */
      readonly until: string | null;
      readonly documents: number;
      readonly policyIds: readonly string[];
    }
  | {
      readonly kind: "ASKED" | "CONNECTED";
      readonly relationshipId: string;
      readonly name: string;
    }
  | {
      readonly kind: "AWAITING";
      readonly relationshipId: string;
      readonly name: string;
    };

/**
 * Everyone who can open this folder's documents, or could: shared (with
 * the grants to withdraw), asked for one of them and not shared yet,
 * connected and not shared, and waiting on the founder to connect.
 */
export function folderPeople(input: {
  readonly folderDocumentIds: readonly string[];
  readonly access: readonly DocumentAccessDto[];
  readonly requests: DataRoomOwnerView["requests"];
  readonly candidates: readonly AccessCandidate[];
  readonly awaiting: readonly AccessCandidate[];
}): readonly FolderPerson[] {
  const inFolder = new Set(input.folderDocumentIds);
  const shared = new Map<
    string,
    {
      name: string;
      level: DocumentAccessLevel;
      until: string | null;
      documents: Set<string>;
      policyIds: string[];
    }
  >();
  for (const document of input.access) {
    if (!inFolder.has(document.documentId)) continue;
    for (const grant of document.grants) {
      const known = shared.get(grant.relationshipId);
      const entry = known ?? {
        name: grant.investorOrganisationName ?? "An investor",
        level: grant.accessLevel,
        until: null,
        documents: new Set<string>(),
        policyIds: [],
      };
      // Mixed levels read as the narrower one: never overstate access.
      if (grant.accessLevel === "view") entry.level = "view";
      if (
        grant.expiresAt !== null &&
        (entry.until === null || grant.expiresAt < entry.until)
      ) {
        entry.until = grant.expiresAt;
      }
      entry.documents.add(document.documentId);
      entry.policyIds.push(grant.policyId);
      shared.set(grant.relationshipId, entry);
    }
  }
  const out: FolderPerson[] = [...shared.entries()].map(
    ([relationshipId, entry]) => ({
      kind: "SHARED" as const,
      relationshipId,
      name: entry.name,
      accessLevel: entry.level,
      until: entry.until,
      documents: entry.documents.size,
      policyIds: entry.policyIds,
    }),
  );
  const seen = new Set(out.map((person) => person.relationshipId));
  for (const request of input.requests) {
    if (request.status !== "OPEN" || seen.has(request.relationshipId)) continue;
    if (request.documentId !== null && !inFolder.has(request.documentId)) {
      continue;
    }
    seen.add(request.relationshipId);
    out.push({
      kind: "ASKED",
      relationshipId: request.relationshipId,
      name:
        request.requesterOrganisationName ??
        request.requesterName ??
        "An investor",
    });
  }
  for (const candidate of input.candidates) {
    if (seen.has(candidate.relationshipId)) continue;
    seen.add(candidate.relationshipId);
    out.push({
      kind: "CONNECTED",
      relationshipId: candidate.relationshipId,
      name: candidate.investorOrganisationName,
    });
  }
  for (const candidate of input.awaiting) {
    if (seen.has(candidate.relationshipId)) continue;
    seen.add(candidate.relationshipId);
    out.push({
      kind: "AWAITING",
      relationshipId: candidate.relationshipId,
      name: candidate.investorOrganisationName,
    });
  }
  return out;
}

/** The share a folder's Share button makes: view only, for the default term. */
export const FOLDER_SHARE = {
  accessLevel: "view" as const,
  days: DATA_ROOM_GRANT_DEFAULT_DAYS,
};

/** "View only until 12 Nov": a shared person's access in words. */
export function sharedWords(
  person: Extract<FolderPerson, { kind: "SHARED" }>,
  total: number,
): string {
  const level =
    person.accessLevel === "view" ? "View only" : "View and download";
  const until =
    person.until === null
      ? ""
      : ` until ${new Date(person.until).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })}`;
  const some =
    person.documents < total
      ? `, ${String(person.documents)} of ${String(total)}`
      : "";
  return `${level}${until}${some}`;
}
