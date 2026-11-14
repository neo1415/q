import type { TransactionContext } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

/**
 * What the GateQ inbox (F4) borrows from around it. The app composes these:
 * GateQ owns the gateway and who may see or act on it; Identity owns the
 * organisation's members; Evidence owns document titles and bytes. This
 * package owns only what the organisation does with an application.
 */

export type InboxGateway = {
  readonly gatewayId: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly name: string;
  readonly publicId: string;
  /** The organisation's public name, for drafts to founders and the pack. */
  readonly fund: string;
};

/**
 * GateQ's own authority over a gateway. `authorise` answers null when the
 * actor may not even view it, exactly as for a gateway that does not
 * exist; `canDecide` is investor.gateway.edit: replying, passing,
 * assigning and changing the gate.
 */
export type InboxAuthority = {
  readonly authorise: (
    actor: ActorContext,
    gatewayId: string,
  ) => Promise<{
    readonly gateway: InboxGateway;
    readonly canDecide: boolean;
  } | null>;
};

export type InboxFolder = "INBOX" | "ARCHIVED" | "PASSED";

export type InboxRow = {
  readonly applicationId: string;
  readonly submittedAt: string;
  readonly snapshot: unknown;
  readonly qualification: unknown;
  /** GateQ slice 1: the frozen dossier; absent or null before it existed. */
  readonly dossier?: unknown;
  /** Q's READY reading of it, for one application's detail only. */
  readonly synthesis?: unknown;
  /**
   * Where Q's reading stands: READY, still to be tried (PENDING), or every
   * bounded attempt spent (UNAVAILABLE). Detail only; absent means PENDING.
   */
  readonly synthesisState?: "READY" | "PENDING" | "UNAVAILABLE" | undefined;
  readonly folder: InboxFolder;
  readonly assigneeUserId: string | null;
  readonly starred: boolean;
  readonly readAt: string | null;
  readonly labels: readonly string[];
  /** A reply or a pass was sent: the promise is kept. */
  readonly answered: boolean;
};

export type InboxActivityKind =
  | "ASSIGNED"
  | "UNASSIGNED"
  | "LABELLED"
  | "UNLABELLED"
  | "ARCHIVED"
  | "RESTORED"
  | "PASSED"
  | "REPLIED"
  | "NOTED"
  | "PACK_DOWNLOADED";

export type InboxActivity = {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly kind: InboxActivityKind;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
};

export type InboxRepository = {
  readonly list: (input: {
    readonly tenantId: string;
    readonly gatewayId: string;
    readonly userId: string;
  }) => Promise<readonly InboxRow[]>;
  /** Only an application submitted to this gateway, in this tenant. */
  readonly one: (input: {
    readonly tenantId: string;
    readonly gatewayId: string;
    readonly userId: string;
    readonly applicationId: string;
  }) => Promise<InboxRow | null>;
  /** The ids among these that were submitted to this gateway. */
  readonly submittedAmong: (input: {
    readonly tenantId: string;
    readonly gatewayId: string;
    readonly applicationIds: readonly string[];
  }) => Promise<readonly string[]>;
  readonly replyWithinDays: (gatewayId: string) => Promise<number | null>;
  readonly setReplyWithinDays: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly gatewayId: string;
      readonly replyWithinDays: number | null;
      readonly userId: string;
    },
  ) => Promise<void>;
  readonly members: (input: {
    readonly tenantId: string;
    readonly organisationId: string;
  }) => Promise<readonly { readonly userId: string; readonly name: string }[]>;
  readonly labels: (gatewayId: string) => Promise<readonly string[]>;
  readonly setFolder: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly gatewayId: string;
      readonly applicationIds: readonly string[];
      readonly folder: InboxFolder;
    },
  ) => Promise<void>;
  readonly setAssignee: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly gatewayId: string;
      readonly applicationIds: readonly string[];
      readonly assigneeUserId: string | null;
    },
  ) => Promise<void>;
  readonly setStar: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly applicationIds: readonly string[];
    readonly starred: boolean;
  }) => Promise<void>;
  readonly markRead: (input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly applicationId: string;
    readonly at: string;
  }) => Promise<void>;
  readonly setLabel: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly gatewayId: string;
      readonly applicationIds: readonly string[];
      readonly label: string;
      readonly on: boolean;
      readonly userId: string;
    },
  ) => Promise<void>;
  readonly addNote: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly applicationId: string;
      readonly authorUserId: string;
      readonly body: string;
      readonly clientRequestId: string;
    },
  ) => Promise<{ readonly deduplicated: boolean }>;
  readonly notes: (applicationId: string) => Promise<
    readonly {
      readonly id: string;
      readonly authorUserId: string;
      readonly authorName: string;
      readonly body: string;
      readonly createdAt: string;
    }[]
  >;
  readonly addMessage: (
    tx: TransactionContext,
    input: {
      readonly tenantId: string;
      readonly applicationId: string;
      readonly kind: "PASS" | "REPLY";
      readonly reasonCode: string | null;
      readonly body: string;
      readonly bodySha256: string;
      readonly approvedByUserId: string;
      readonly clientRequestId: string;
    },
  ) => Promise<{ readonly deduplicated: boolean }>;
  readonly messages: (applicationId: string) => Promise<
    readonly {
      readonly kind: "PASS" | "REPLY";
      readonly reasonCode: string | null;
      readonly body: string;
      readonly createdAt: string;
    }[]
  >;
  readonly record: (
    tx: TransactionContext,
    activity: InboxActivity,
  ) => Promise<void>;
  /** Outside a transaction: the pack audit is written as the zip is handed over. */
  readonly recordNow: (activity: InboxActivity) => Promise<void>;
  readonly activity: (applicationId: string) => Promise<
    readonly {
      readonly kind: InboxActivityKind;
      readonly detail: Readonly<Record<string, unknown>>;
      readonly actorName: string | null;
      readonly createdAt: string;
    }[]
  >;
};

/**
 * The documents a founder shared with one application, read by Capital Q
 * on the organisation's behalf. Called only with the ids the frozen
 * submission names, so a document the founder did not send cannot be
 * asked for. `bytes` null: shared, but not downloadable (view-only, still
 * being scanned, or gone), and the pack says so instead.
 */
/**
 * What the founder attached to ONE submitted application, as Evidence
 * extracted it (the exact submitted versions, ADR 0067). Server-side and
 * trusted: the inbox service has authorised the gateway and confirmed the
 * submission is at it before calling. The text is the founder's material:
 * data, never instructions, and never verified by being read.
 */
export type SubmittedDocumentReading = {
  readonly title: string;
  readonly pageCount: number | null;
  /** Null when the text was not read, with why in `notRead`. */
  readonly excerpts:
    readonly { readonly page: number; readonly text: string }[] | null;
  readonly truncated: boolean;
  readonly notRead: string | null;
};
export type SubmittedDocumentTextPort = {
  readonly read: (input: {
    readonly tenantId: string;
    readonly applicationId: string;
  }) => Promise<readonly SubmittedDocumentReading[]>;
};

export type SharedDocumentPort = {
  readonly titles: (
    documentIds: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
  readonly file: (documentId: string) => Promise<{
    readonly title: string;
    readonly fileName: string;
    readonly bytes: Uint8Array | null;
    readonly why: string | null;
  } | null>;
};
