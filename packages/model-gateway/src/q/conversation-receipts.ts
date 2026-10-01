import { z } from "zod";

import {
  Q_CLIENT_ACTION_TOOLS,
  Q_INSTANT_ACTION_TOOLS,
  type ModelMessage,
  type QNavigateDestination,
  type QResultBlock,
  type QScreenContext,
  type QScreenRoute,
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
 * The provider name of the q-tools tool that approves the one waiting
 * change (`proposal.pending.approve`). It decides nothing new, so it is
 * named beside the changes it approves rather than as a change of its own.
 * q-tools is not a runtime dependency of this package, hence the literal.
 */
export const APPROVE_PENDING_TOOL = "approve_pending_proposal";

/**
 * What a change's status lets Q say, in the person's terms. The statuses
 * are the plain ones q-api reads from the Approval Engine; anything else
 * is shown as given and claims nothing.
 */
const CHANGE_STATUS_MEANS: Readonly<Record<string, string>> = {
  PENDING: "not saved yet, waiting for their approval",
  SAVING: "approved, still being saved",
  SAVED: "saved",
  NOT_SAVED: "approved but it did not go through, so it is not saved",
  DECLINED: "declined, nothing changed",
  EXPIRED: "lapsed before a decision, nothing changed",
};

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
  RELATIONSHIPS: "their relationships",
  SETTINGS: "Settings",
  VERIFICATION: "their company's verification",
  PITCH: "their pitch (video and deck)",
  COMPANY_INTEREST: "their company's incoming interest",
  SAVED: "their Saved list",
  INVESTORS: "Investors",
  SEARCH: "Search",
  GATEWAY: "their GateQ gateway",
  MEMORY: "what Q remembers about them",
  NEW_PITCH: "a new pitch video",
  REHEARSALS: "Rehearsals",
};

/** Where the person is, in their terms (R21). */
const SCREEN_ROUTE_NAMES: Readonly<Record<QScreenRoute, string | null>> = {
  HOME: "Home (Q's own page)",
  DISCOVER: "Discover (the feed)",
  CAPITAL: "Capital (their raise)",
  PROFILE: "their profile",
  COMPANY_VISIBILITY: "their company's visibility settings",
  COMPANY_INTEREST: "their company's incoming interest",
  COMPANY: "a company's page",
  PITCH: "their pitch",
  RELATIONSHIPS: "their relationships",
  RELATIONSHIP_COMPANY: "their relationship with a company",
  RELATIONSHIP_INVESTOR: "their relationship with an investor",
  VERIFICATION: "verification",
  ONBOARDING: "their setup",
  OTHER: null,
};

/**
 * Where the person is as they ask (R21), from the screen the run carries
 * through the Context Firewall: the route, and only entities it bound.
 */
export function screenLines(
  screen: QScreenContext | undefined,
  now: Date = new Date(),
): string[] {
  if (screen === undefined) return [];
  const name = SCREEN_ROUTE_NAMES[screen.route];
  const shown = [
    ...(screen.companyId === undefined
      ? []
      : [`the company ${screen.companyId}`]),
    ...(screen.investorOrganisationId === undefined
      ? []
      : [`the investor organisation ${screen.investorOrganisationId}`]),
    ...(screen.documentId === undefined
      ? []
      : [`their document ${screen.documentId} open`]),
  ];
  return [
    `WHERE THEY ARE NOW (Capital Q, from their screen as they asked): ${
      name === null ? "a Capital Q screen without a name here" : `on ${name}`
    }${shown.length === 0 ? "" : `, showing ${shown.join(" and ")}`}. You know what screen they are on: when they ask where they are or what they are looking at, say it plainly (for example "You're on your profile."); never say you cannot see their screen.`,
    ...localTimeLines(screen.timeZone, now),
  ];
}

/**
 * Their date and time (live test 2026-09-28 #2): the model otherwise has no
 * idea what "tomorrow" is. The instant a time names is still resolved by
 * code from the tool's structured `when`; this line only lets Q talk about
 * days sensibly.
 */
function localTimeLines(timeZone: string | undefined, now: Date): string[] {
  if (timeZone === undefined) return [];
  try {
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    return [
      `THEIR LOCAL TIME NOW (Capital Q, from their device): ${local} (${timeZone}). When they name a day or time for a call or reminder, pass it as said in the tool's when (day or date, and HH:MM); Capital Q converts it in their time zone. Never ask them to confirm a date they already made clear, such as "2 PM tomorrow".`,
    ];
  } catch {
    return [];
  }
}

const DOCUMENT_NAMES: Readonly<Record<string, string>> = {
  PITCH_DECK: "a pitch deck",
  INVESTMENT_BRIEF: "an investment brief",
  OWN_MANDATE: "a document of their own mandate",
  ANSWER_EXPORT: "an answer you already gave, as a document",
  Q_REPORT:
    "any other written piece as a document (an assessment, analysis, summary or plan)",
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
  screen?: QScreenContext,
): ModelMessage {
  const lines: string[] = [
    ...screenLines(screen),
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
  // The app's own actions in their browser (theme, reload, their website)
  // happen at once when called, never "for approval" (R20/R33).
  const isClientAction = (tool: (typeof offeredTools)[number]) =>
    (Q_CLIENT_ACTION_TOOLS as readonly string[]).includes(tool.name);
  const clientActions = offeredTools.filter(isClientAction);
  // R33: their own reversible decisions (Save, Pass, declining a waiting
  // change) are recorded when called, never "for approval".
  const isInstant = (tool: (typeof offeredTools)[number]) =>
    (Q_INSTANT_ACTION_TOOLS as readonly string[]).includes(tool.name);
  const instant = offeredTools.filter(isInstant);
  const reads = offeredTools.filter(
    (tool) =>
      !isClientAction(tool) &&
      !isInstant(tool) &&
      (tool.classification ?? "READ_ONLY") === "READ_ONLY",
  );
  const changes = offeredTools.filter(
    (tool) =>
      !isClientAction(tool) &&
      !isInstant(tool) &&
      (tool.classification ?? "READ_ONLY") !== "READ_ONLY" &&
      tool.name !== APPROVE_PENDING_TOOL,
  );
  const canApprove = offeredTools.some(
    (tool) => tool.name === APPROVE_PENDING_TOOL,
  );
  if (reads.length > 0) {
    lines.push(`- Read and look things up with these tools: ${named(reads)}.`);
  }
  if (changes.length > 0) {
    lines.push(
      `- Prepare these changes when they ask, for their approval (nothing changes until they approve; until a status or tool result says saved, it is not saved yet): ${named(changes)}.`,
    );
  }
  if (clientActions.length > 0) {
    lines.push(
      `- Do these in their browser at once when they ask, by calling the tool (it happens as your answer arrives; say it in a few words): ${named(clientActions)}.`,
    );
  }
  if (instant.length > 0) {
    lines.push(
      `- Do these for them at once when they clearly ask, by calling the tool (it is recorded when called and they can undo it on the page; report only what its result says): ${named(instant)}.`,
    );
  }
  if (manifest?.offers !== undefined && manifest.offers.length > 0) {
    lines.push(
      `- These they do themselves on a screen (a sign-in, a consent or a file from their device), so offer to take them there and never say you did them: ${manifest.offers
        .map((offer) => `${offer.does} (${SCREEN_NAMES[offer.destination]})`)
        .join("; ")}.`,
    );
  }
  if (manifest !== undefined && manifest.navigate.length > 0) {
    lines.push(
      `- Capital Q opens these screens when they ask to be taken there, including when they leave the choice to you: ${manifest.navigate
        .map((d) => SCREEN_NAMES[d])
        .join(", ")}.`,
      "- Capital Q has no other screens. When they ask for a screen or page it does not have, say plainly that it doesn't exist in Capital Q and offer the nearest of the screens above by name; never say you took them anywhere.",
    );
  }
  if (manifest !== undefined && manifest.documents.length > 0) {
    lines.push(
      `- Capital Q prepares ${manifest.documents
        .map((d) => DOCUMENT_NAMES[d] ?? d.toLowerCase().replace(/_/g, " "))
        .join(
          ", ",
        )} when they ask, and files it as their private document with a PDF download on its card.${
        manifest.documents.includes("Q_REPORT")
          ? " Any written answer can be a document: never say you cannot make a PDF or a document."
          : ""
      }`,
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
    // Live 2026-09-27: "the authorised conversation record states…". The
    // person needs the status, not where it was read from.
    "- About a change, state its status in a few plain words (saved; or not saved yet and how to approve it) and never explain it with Capital Q's internal terms: records, authorisation, context, supplied or the conversation record. One change has one status: never call the same change both waiting for approval and done.",
  );
  if (canApprove) {
    lines.push(
      `- When they clearly approve a change below whose status is PENDING, in whatever words, approve it with ${APPROVE_PENDING_TOOL} and its id; if they want it different first, prepare the new version instead, which needs its own approval. Without that tool's SAVED result it is not saved yet: they can also tap Approve on its card.`,
    );
  }
  if (receipts.length > 0) {
    lines.push(
      "WHAT YOU HAVE ALREADY PRODUCED IN THIS CONVERSATION (Capital Q's records, current status):",
      ...receipts.map((receipt) =>
        receipt.kind === "DOCUMENT"
          ? `- Document "${receipt.title.slice(0, 160)}" (${receipt.type}), status ${receipt.status}: it is the card shown with your earlier reply${receipt.status === "READY" ? ", and its PDF downloads from that card" : ""}.`
          : `- Change you prepared (id ${receipt.id}): ${receipt.summary.slice(0, 200)} (${receipt.actionType}), status ${receipt.status}${CHANGE_STATUS_MEANS[receipt.status] === undefined ? "" : `: ${CHANGE_STATUS_MEANS[receipt.status] ?? ""}`}.`,
      ),
    );
  }
  return { role: "SYSTEM", content: lines.join("\n").slice(0, 5_000) };
}

/** The part of `approve_pending_proposal`'s result a status line reads. */
const ApprovalResultSchema = z.object({
  outcome: z.string(),
  proposal: z.object({ status: z.string() }).nullable(),
});

/**
 * What Capital Q says after the person approved a change by conversation,
 * from the tool's result and nothing else (live 2026-09-27 #1, #2): the
 * analyst never claims an action, so the status is code's to say, plainly.
 * Null for outcomes that approved nothing and need the model's question
 * (none waiting, several waiting, a different one named).
 */
export function approvalStatusLine(data: unknown): string | null {
  const read = ApprovalResultSchema.safeParse(data);
  if (!read.success) return null;
  const { outcome, proposal } = read.data;
  switch (outcome) {
    case "SAVED":
      return "Saved.";
    case "SAVING":
      return "Approved. It's being saved now.";
    case "NOT_SAVED":
      return "Approved, but it didn't go through, so it's not saved. You can try again from its card.";
    case "CHANGED":
      return "Not saved: that change is no longer exactly what you were shown, so I didn't approve it. Ask me to prepare it again.";
    case "EXPIRED":
      return "Not saved: that approval has lapsed. Ask me to prepare it again.";
    case "ALREADY_DECIDED":
      switch (proposal?.status ?? "") {
        case "SAVED":
          return "Already saved.";
        case "SAVING":
          return "Already approved. It's being saved now.";
        case "DECLINED":
          return "Not saved: you declined that one. Ask me to prepare it again if you want it.";
        case "EXPIRED":
          return "Not saved: that approval has lapsed. Ask me to prepare it again.";
        case "NOT_SAVED":
          return "Not saved: that one didn't go through. You can try again from its card.";
        default:
          return null;
      }
    default:
      return null;
  }
}
