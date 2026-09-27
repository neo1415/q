import type {
  ModelMessage,
  QNavigateDestination,
  QResultBlock,
} from "@capital-q/contracts";
import type { QCapabilityManifest } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

export type { QCapabilityManifest };

/**
 * What Q can do in this conversation, and what it has already done, as
 * facts built by code (CQ-QX-008; founder live, 2026-09-26).
 *
 * Q said "I can't navigate you" while navigation worked, said "This
 * conversation is ended" when nothing ended, and said a mandate PDF it had
 * made one turn earlier "is not currently available". The model knew
 * neither what the run could do nor what earlier turns produced: history
 * carries text, and the cards and proposals ride beside it. Here both
 * become trusted notes: a manifest from what is actually registered for
 * this run, and receipts read back from the owning records, current status
 * included. Nothing here reads what a sentence meant.
 */

/** The owning records, read as the person: current status, or null. */
export type QReceiptPort = {
  readonly artifact: (
    actor: ActorContext,
    artifactId: string,
  ) => Promise<{ readonly status: string } | null>;
  readonly action: (
    actor: ActorContext,
    proposalId: string,
  ) => Promise<{ readonly status: string } | null>;
};

export type QReceipt =
  | {
      readonly kind: "DOCUMENT";
      readonly id: string;
      readonly type: string;
      readonly title: string;
      readonly status: string;
    }
  | {
      readonly kind: "ACTION";
      readonly id: string;
      readonly actionType: string;
      readonly summary: string;
      readonly status: string;
    };

const RECEIPTS_MAX = 12;

/**
 * Every document card and action proposal in this conversation, newest
 * last, each with its CURRENT status from its own record. One the record
 * no longer shows this person (gone, or not theirs) is left out, never
 * guessed.
 */
export async function collectReceipts(
  history: readonly { readonly blocks?: readonly QResultBlock[] | undefined }[],
  port: QReceiptPort,
  actor: ActorContext,
): Promise<readonly QReceipt[]> {
  const seen = new Set<string>();
  const found: QResultBlock[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    for (const block of history[index]?.blocks ?? []) {
      const id =
        block.kind === "ARTIFACT_REFERENCE"
          ? `d:${block.artifactId}`
          : block.kind === "ACTION_PROPOSAL"
            ? `a:${block.proposal.proposalId}`
            : null;
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      found.push(block);
    }
    if (found.length >= RECEIPTS_MAX) break;
  }
  const receipts: QReceipt[] = [];
  for (const block of found.slice(0, RECEIPTS_MAX).reverse()) {
    if (block.kind === "ARTIFACT_REFERENCE") {
      const record = await port
        .artifact(actor, block.artifactId)
        .catch(() => null);
      if (record === null) continue;
      receipts.push({
        kind: "DOCUMENT",
        id: block.artifactId,
        type: block.type,
        title: block.title,
        status: record.status,
      });
    } else if (block.kind === "ACTION_PROPOSAL") {
      const record = await port
        .action(actor, block.proposal.proposalId)
        .catch(() => null);
      if (record === null) continue;
      receipts.push({
        kind: "ACTION",
        id: block.proposal.proposalId,
        actionType: block.proposal.actionType,
        summary: block.proposal.summary,
        status: record.status,
      });
    }
  }
  return receipts;
}

const SCREEN_NAMES: Readonly<Record<QNavigateDestination, string>> = {
  HOME: "Home",
  PROFILE: "their profile",
  CAPITAL: "Capital",
  DISCOVER: "Discover",
  COMPANY_VISIBILITY: "their company's visibility settings",
};

const DOCUMENT_NAMES: Readonly<Record<string, string>> = {
  PITCH_DECK: "a pitch deck",
  INVESTMENT_BRIEF: "an investment brief",
  OWN_MANDATE: "a document of their own mandate",
};

/**
 * The manifest and the receipts, as one trusted note. Tools are named by
 * what the model is actually offered this turn.
 */
export function capabilityNote(
  manifest: QCapabilityManifest | undefined,
  offeredTools: readonly {
    readonly name: string;
    readonly description: string;
    /** READ_ONLY reads; anything else prepares a change for approval. */
    readonly classification?: string | undefined;
  }[],
  receipts: readonly QReceipt[],
): ModelMessage {
  const lines: string[] = [
    "WHAT YOU CAN DO IN THIS CONVERSATION (Capital Q, authoritative; you can do nothing else):",
  ];
  const named = (tools: typeof offeredTools): string =>
    tools
      .map(
        (tool) =>
          `${tool.name} (${tool.description.split(/(?<=\.)\s/)[0]?.slice(0, 140) ?? ""})`,
      )
      .join("; ");
  // A change-preparing tool listed as a read told the model it could only
  // read, and "edit my profile" was declined (R20).
  const reads = offeredTools.filter(
    (tool) => (tool.classification ?? "READ_ONLY") === "READ_ONLY",
  );
  const changes = offeredTools.filter(
    (tool) => (tool.classification ?? "READ_ONLY") !== "READ_ONLY",
  );
  if (reads.length > 0) {
    lines.push(`- Read and look things up with these tools: ${named(reads)}.`);
  }
  if (changes.length > 0) {
    lines.push(
      `- Prepare these changes when they ask, for their approval (nothing changes until they approve; say it is ready for approval, never done): ${named(changes)}.`,
    );
  }
  if (manifest !== undefined && manifest.navigate.length > 0) {
    lines.push(
      `- Capital Q opens these screens when they ask to be taken there, including when they leave the choice to you: ${manifest.navigate
        .map((d) => SCREEN_NAMES[d])
        .join(", ")}.`,
    );
  }
  if (manifest !== undefined && manifest.documents.length > 0) {
    lines.push(
      `- Capital Q prepares ${manifest.documents
        .map((d) => DOCUMENT_NAMES[d] ?? d.toLowerCase().replace(/_/g, " "))
        .join(
          ", ",
        )} when they ask, and files it as their private document with a PDF download on its card.`,
    );
  }
  if (manifest?.visibilityChange === true) {
    lines.push(
      "- Capital Q prepares a change to who can see their company, for their approval.",
    );
  }
  lines.push(
    "- You cannot end, clear or start a conversation: they start a new one with New chat in their chats list. You cannot send messages, schedule, pay or change records beyond the above.",
    "- Say something was done, opened, prepared, saved, sent or ended ONLY when a tool result in this turn or a record below says so. Otherwise say plainly what you can do instead.",
  );
  if (receipts.length > 0) {
    lines.push(
      "WHAT YOU HAVE ALREADY PRODUCED IN THIS CONVERSATION (Capital Q's records, current status):",
      ...receipts.map((receipt) =>
        receipt.kind === "DOCUMENT"
          ? `- Document "${receipt.title.slice(0, 160)}" (${receipt.type}), status ${receipt.status}: it is the card shown with your earlier reply${receipt.status === "READY" ? ", and its PDF downloads from that card" : ""}.`
          : `- Proposed action: ${receipt.summary.slice(0, 200)} (${receipt.actionType}), status ${receipt.status}.`,
      ),
    );
  }
  return { role: "SYSTEM", content: lines.join("\n").slice(0, 4_000) };
}
