import { createHash } from "node:crypto";

import { QNavigateTargetSchema } from "@capital-q/contracts";
import { targetToSitePlace } from "@capital-q/model-gateway/q";

import { Q_IQ_COMPANIES } from "../q-iq/world.js";

/**
 * The Q-NAV world: fictional records with stable ids, so an expected
 * target is a real W3.1 QNavigateTarget (uuids and all). The subject is
 * given the records the person may open (as W2.3's resolution will give
 * Q), never the expectation.
 */

/** A stable uuid for a fictional key (v4-shaped, from its hash). */
export function navId(key: string): string {
  const hex = createHash("sha256").update(`q-nav:${key}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export type QNavCompany = {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  /** The current deck (COMPANY tab deck). */
  readonly deckId: string;
  /** A data-room document, by its kind. */
  readonly documents: readonly {
    readonly kind: string;
    readonly title: string;
    readonly id: string;
  }[];
};

const DATA_ROOM_KINDS = [
  ["cap-table", "Cap table"],
  ["financials", "2025 management accounts"],
  ["contracts", "Top customer contracts"],
] as const;

export const Q_NAV_COMPANIES: readonly QNavCompany[] = Q_IQ_COMPANIES.map(
  (c) => ({
    key: c.id,
    id: navId(c.id),
    name: c.name,
    deckId: navId(`${c.id}:deck`),
    documents: DATA_ROOM_KINDS.map(([kind, title]) => ({
      kind,
      title,
      id: navId(`${c.id}:doc:${kind}`),
    })),
  }),
);

/** A company that was on record and has been deleted (curveball). */
export const Q_NAV_DELETED_COMPANY = {
  key: "co-harrow-mills",
  id: navId("co-harrow-mills"),
  name: "Harrow Mills",
} as const;

export const Q_NAV_INVESTORS = [
  {
    key: "inv-savanna-seed",
    name: "Savanna Seed Partners",
    short: "Savanna Seed",
  },
  {
    key: "inv-kestrel-lane",
    name: "Kestrel Lane Ventures",
    short: "Kestrel Lane",
  },
  {
    key: "inv-baobab-ridge",
    name: "Baobab Ridge Capital",
    short: "Baobab Ridge",
  },
  {
    key: "inv-harbour-angels",
    name: "Harbour Angels",
    short: "Harbour Angels",
  },
].map((i) => ({ ...i, id: navId(i.key) }));

/** The founder of every FOUNDER case runs Ledgerfold. */
export const Q_NAV_FOUNDER_COMPANY_KEY = "co-ledgerfold";

/** Q's documents, Daily editions, work items and Board items. */
export const Q_NAV_THINGS = {
  memoSilo: {
    page: "DOCUMENT",
    id: navId("doc:memo-silo-credit"),
    title: "Investment memo: Silo Credit",
  },
  briefLedgerline: {
    page: "DOCUMENT",
    id: navId("doc:brief-ledgerline"),
    title: "Diligence brief: Ledgerline",
  },
  dailyToday: {
    page: "DAILY_EDITION",
    id: navId("daily:2026-11-06"),
    title: "Q Daily, 6 November",
  },
  dailyYesterday: {
    page: "DAILY_EDITION",
    id: navId("daily:2026-11-05"),
    title: "Q Daily, 5 November",
  },
  workDiligence: {
    page: "WORK_ITEM",
    id: navId("work:diligence-ledgerline"),
    title: "Ledgerline diligence",
  },
  workOutreach: {
    page: "WORK_ITEM",
    id: navId("work:outreach-seed"),
    title: "Seed investor outreach",
  },
  boardCallTunde: {
    page: "BOARD",
    id: navId("board:call-tunde"),
    title: "Call Tunde about the term sheet",
  },
  boardChaseLegal: {
    page: "BOARD",
    id: navId("board:chase-legal"),
    title: "Chase legal on the SHA",
  },
  roundSeed: {
    page: null,
    id: navId("round:ledgerfold-seed"),
    title: "Ledgerfold seed round",
  },
  pitchBrightwell: {
    page: "COMPANY_PITCH",
    id: navId("pitch:brightwell"),
    title: "Brightwell Energy pitch video",
  },
  rehearsalExternal: {
    page: "EXTERNAL_REHEARSAL",
    id: navId("person:dr-okoye"),
    title: "Rehearsal with Dr Ifeoma Okoye (external)",
  },
  applicationTamarind: {
    page: "GATEQ_APPLICATION",
    id: navId("gateq:tamarind"),
    title: "Tamarind Pay's GateQ application",
  },
  applicationOwn: {
    page: "GATEQ_APPLICATION",
    id: navId("gateq:ledgerfold-kestrel"),
    title: "Ledgerfold's application to Kestrel Lane's gate",
  },
} as const;

export function company(key: string): QNavCompany {
  const found = Q_NAV_COMPANIES.find((c) => c.key === key);
  if (found === undefined) throw new Error(`unknown Q-NAV company ${key}`);
  return found;
}

export function investor(key: string): (typeof Q_NAV_INVESTORS)[number] {
  const found = Q_NAV_INVESTORS.find((i) => i.key === key);
  if (found === undefined) throw new Error(`unknown Q-NAV investor ${key}`);
  return found;
}

/**
 * What a person may resolve by name (W2.3's job): their records, in
 * plain words with ids. The subject reads these; it never sees a case's
 * expectation.
 */
export type QNavRecords = {
  readonly companies: readonly {
    readonly id: string;
    readonly name: string;
    readonly deckId: string;
    readonly documents: readonly {
      readonly title: string;
      readonly id: string;
    }[];
  }[];
  readonly investors: readonly { readonly id: string; readonly name: string }[];
  /** Each opens on its route (the site map's), when it has a page. */
  readonly things: readonly {
    readonly id: string;
    readonly title: string;
    readonly route?: string | null;
  }[];
  /** Their own company or firm, by name. */
  readonly own?: {
    readonly kind: "COMPANY" | "INVESTOR";
    readonly name: string;
    readonly id?: string;
  };
  /** Records that were deleted: never a target. */
  readonly deleted: readonly { readonly id: string; readonly name: string }[];
};

export const Q_NAV_RECORDS: QNavRecords = {
  companies: Q_NAV_COMPANIES.map((c) => ({
    id: c.id,
    name: c.name,
    deckId: c.deckId,
    documents: c.documents.map((d) => ({ title: d.title, id: d.id })),
  })),
  investors: Q_NAV_INVESTORS.map((i) => ({ id: i.id, name: i.name })),
  things: Object.values(Q_NAV_THINGS).map((t) => {
    // A round has no page of its own to name (/capital only redirects).
    const place =
      t.page === null
        ? null
        : targetToSitePlace(
            t.page === "BOARD"
              ? { page: "BOARD", itemId: t.id }
              : QNavigateTargetSchema.parse({ page: t.page, recordId: t.id }),
          );
    return {
      id: t.id,
      title: t.title,
      // Null: no page of its own (the round lives on Capital's raise tab).
      route: place?.route ?? null,
    };
  }),
  deleted: [{ id: Q_NAV_DELETED_COMPANY.id, name: Q_NAV_DELETED_COMPANY.name }],
};
