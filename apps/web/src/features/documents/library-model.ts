import type {
  DocumentDto,
  DocumentType,
  QArtifactSummary,
} from "@capital-q/contracts";

import { artifactTypeLabel } from "@/features/q/artifact-type";

/**
 * The documents page's one list (P3): what Q made for them and what they
 * uploaded, as one kind of item. Pure, so the page's sorting, filtering
 * and paging are tested without a browser.
 */

export const LIBRARY_PAGE = 24;

export type LibraryGroup = "DECK" | "FINANCIAL" | "LEGAL" | "OTHER";

export type LibraryItem = {
  /** Unique across both sources. */
  readonly key: string;
  readonly source: "Q" | "UPLOAD";
  readonly id: string;
  readonly title: string;
  readonly typeLabel: string;
  readonly group: LibraryGroup;
  readonly sizeBytes: number | null;
  readonly updatedAt: string;
  /** Who can see it, in the page's words. */
  readonly sharing: string;
  readonly shared: boolean;
  /** Q's read of an upload; null for what Q wrote itself. */
  readonly qRead: "READ" | "READING" | "UNREADABLE" | "WAITING" | null;
  /** For Q's documents: still being written, or failed. */
  readonly state: "READY" | "PREPARING" | "FAILED";
  readonly version: number;
  readonly isDeck: boolean;
  readonly documentType: DocumentType | null;
  readonly downloadAudience: "ORGANISATION" | "INVESTORS" | null;
  readonly fileName: string | null;
};

export type LibraryPage = {
  readonly items: readonly LibraryItem[];
  readonly cursors: {
    readonly q: string | null;
    readonly uploads: string | null;
  };
};

const UPLOAD_LABELS: Readonly<Partial<Record<DocumentType, string>>> = {
  PITCH_DECK: "Pitch deck",
  FINANCIAL_MODEL: "Financial model",
  MANAGEMENT_ACCOUNTS: "Management accounts",
  FINANCIAL: "Financials",
  COMPANY_PROFILE: "Company profile",
  LEGAL: "Legal",
  CORPORATE: "Corporate",
  GOVERNANCE: "Governance",
  PRODUCT: "Product",
  COMMERCIAL: "Commercial",
  CUSTOMER: "Customers",
  OPERATIONAL: "Operations",
};

function uploadGroup(type: DocumentType): LibraryGroup {
  if (type === "PITCH_DECK") return "DECK";
  if (
    type === "FINANCIAL_MODEL" ||
    type === "MANAGEMENT_ACCOUNTS" ||
    type === "FINANCIAL"
  ) {
    return "FINANCIAL";
  }
  if (type === "LEGAL" || type === "CORPORATE" || type === "GOVERNANCE") {
    return "LEGAL";
  }
  return "OTHER";
}

export function fromUpload(document: DocumentDto): LibraryItem {
  const version = document.currentVersion;
  const qRead =
    version === null
      ? ("WAITING" as const)
      : version.textExtractionStatus === "COMPLETED"
        ? ("READ" as const)
        : version.processingStatus === "FAILED" ||
            version.textExtractionStatus === "FAILED"
          ? ("UNREADABLE" as const)
          : version.processingStatus === "PROCESSING"
            ? ("READING" as const)
            : ("WAITING" as const);
  const investors =
    document.documentType === "PITCH_DECK" &&
    document.downloadAudience === "INVESTORS";
  return {
    key: `upload:${document.id}`,
    source: "UPLOAD",
    id: document.id,
    title: document.title,
    typeLabel: UPLOAD_LABELS[document.documentType] ?? "Document",
    group: uploadGroup(document.documentType),
    sizeBytes: version?.sizeBytes ?? null,
    updatedAt: document.updatedAt,
    sharing: investors ? "Investors can download" : "Only your team",
    shared: investors,
    qRead,
    state: "READY",
    version: document.version,
    isDeck: document.documentType === "PITCH_DECK",
    documentType: document.documentType,
    downloadAudience: document.downloadAudience,
    fileName: version?.originalFilename ?? null,
  };
}

export function fromArtifact(artifact: QArtifactSummary): LibraryItem {
  const deck = artifact.type === "PITCH_DECK";
  return {
    key: `q:${artifact.artifactId}`,
    source: "Q",
    id: artifact.artifactId,
    title: artifact.title,
    typeLabel: artifactTypeLabel(artifact.type),
    group: deck
      ? "DECK"
      : /FINANC|MODEL/u.test(artifact.type)
        ? "FINANCIAL"
        : "OTHER",
    sizeBytes: null,
    updatedAt: artifact.updatedAt,
    sharing: "Only your team",
    shared: false,
    qRead: null,
    state: artifact.status,
    version: artifact.currentVersion,
    isDeck: deck,
    documentType: null,
    downloadAudience: null,
    fileName: null,
  };
}

export type LibraryFilter =
  "ALL" | "DECK" | "FINANCIAL" | "LEGAL" | "BY_Q" | "SHARED";

export const LIBRARY_FILTERS: readonly {
  readonly value: LibraryFilter;
  readonly label: string;
}[] = [
  { value: "ALL", label: "All" },
  { value: "DECK", label: "Decks" },
  { value: "FINANCIAL", label: "Financials" },
  { value: "LEGAL", label: "Legal" },
  { value: "BY_Q", label: "By Q" },
  { value: "SHARED", label: "Shared" },
];

export type LibrarySort = "RECENT" | "NAME" | "TYPE";

export function matches(
  item: LibraryItem,
  filter: LibraryFilter,
  query: string,
): boolean {
  const byFilter =
    filter === "ALL" ||
    (filter === "BY_Q" && item.source === "Q") ||
    (filter === "SHARED" && item.shared) ||
    item.group === filter;
  const words = query.trim().toLowerCase();
  return (
    byFilter &&
    (words.length === 0 ||
      `${item.title} ${item.typeLabel} ${item.fileName ?? ""}`
        .toLowerCase()
        .includes(words))
  );
}

const time = (item: LibraryItem) => new Date(item.updatedAt).getTime();

export function sortItems(
  items: readonly LibraryItem[],
  sort: LibrarySort,
): readonly LibraryItem[] {
  const recent = (a: LibraryItem, b: LibraryItem) =>
    time(b) - time(a) || a.key.localeCompare(b.key);
  const byName = (a: LibraryItem, b: LibraryItem) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return [...items].sort(
    sort === "NAME"
      ? (a, b) => byName(a, b) || recent(a, b)
      : sort === "TYPE"
        ? (a, b) => a.typeLabel.localeCompare(b.typeLabel) || recent(a, b)
        : recent,
  );
}

/**
 * Merging two newest-first sources page by page: an item is shown only
 * when no unread item of the other source can be newer than it, so the
 * list never reorders under the reader as more pages arrive. The frontier
 * is the oldest item loaded from each source that still has more.
 */
export function visibleUpTo(
  items: readonly LibraryItem[],
  cursors: LibraryPage["cursors"],
): readonly LibraryItem[] {
  const oldest = (source: LibraryItem["source"]) =>
    items
      .filter((item) => item.source === source)
      .reduce<number | null>(
        (min, item) => (min === null ? time(item) : Math.min(min, time(item))),
        null,
      );
  const frontiers = [
    cursors.q === null ? null : (oldest("Q") ?? Number.POSITIVE_INFINITY),
    cursors.uploads === null
      ? null
      : (oldest("UPLOAD") ?? Number.POSITIVE_INFINITY),
  ].filter((value): value is number => value !== null);
  if (frontiers.length === 0) return items;
  const frontier = Math.max(...frontiers);
  return items.filter((item) => time(item) >= frontier);
}

/** Adds a page, newest copy of each item winning. */
export function mergePage(
  current: readonly LibraryItem[],
  page: readonly LibraryItem[],
): readonly LibraryItem[] {
  const byKey = new Map(current.map((item) => [item.key, item] as const));
  for (const item of page) byKey.set(item.key, item);
  return [...byKey.values()];
}

/** A guess from the file's name, so a deck lands as a deck. */
export function documentTypeForFile(name: string): DocumentType {
  const lower = name.toLowerCase();
  if (/deck|pitch/u.test(lower)) return "PITCH_DECK";
  if (/model|forecast|projection/u.test(lower)) return "FINANCIAL_MODEL";
  if (/management accounts|p&l|balance sheet|financ/u.test(lower)) {
    return "FINANCIAL";
  }
  if (/agreement|term sheet|contract|sha\b|articles|legal|nda/u.test(lower)) {
    return "LEGAL";
  }
  return "UNCLASSIFIED";
}

const SIZE = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function sizeLabel(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${SIZE.format(bytes / 1024)} KB`;
  return `${SIZE.format(bytes / (1024 * 1024))} MB`;
}

const DAY = 86_400_000;
const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

export function updatedLabel(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((now - then) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${String(days)} days ago`;
  return DATE.format(new Date(iso));
}

export const Q_READ_LABEL: Readonly<
  Record<NonNullable<LibraryItem["qRead"]>, string>
> = {
  READ: "Q has read it",
  READING: "Q is reading",
  WAITING: "Waiting for Q",
  UNREADABLE: "Q couldn't read it",
};
