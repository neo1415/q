import type {
  QClientActionIntent,
  QRecordPage,
  QResultBlock,
} from "@capital-q/contracts";
import type { TurnReference } from "@capital-q/q-core";
import { movePhaseLine } from "@capital-q/q-core/speech";
import type {
  QAnswerRequest,
  QConversationMessage,
  QToolPort,
} from "@capital-q/q-runtime";
import type { Logger } from "@capital-q/observability";

import type { TurnAppAction } from "./app-action-turn.js";
import type { DeckSpeech } from "./deck-speech.js";

/**
 * The conversation reference resolver (follow-55, Zino live 2026-10-04).
 *
 * "Open the questions for…", "open that one", "now try again", "same for
 * Kazikit": each points back at something in the conversation. What Q
 * showed (documents, named records, cards) and the last action it took or
 * tried are kept here, by code, and given to the turn reader as Capital
 * Q's own note; the reader says by meaning what the turn points at, and
 * code binds that to a concrete record or action. Nothing here grants
 * authority: a record is opened through open_page's authorize step (their
 * own records only), and an action re-runs through its own authorize step
 * and approval card.
 */

/** One thing Q showed or named, newest first. */
export type ShownItem = {
  readonly kind: "DOCUMENT" | "NAMED";
  /** The record's id when a block carried it; null for a name in prose. */
  readonly id: string | null;
  readonly name: string;
};

/** The last action Q took or tried for them in this conversation. */
export type LastAction = {
  readonly tool: string;
  /** Its inputs as last tried; null when they were never read. */
  readonly arguments: Readonly<Record<string, unknown>> | null;
  /** What they said when they asked for it, for reading its inputs again. */
  readonly utterance: string;
  /** PREPARED: a card waits; SAID: it answered; NOT_DONE: nothing happened. */
  readonly outcome: "PREPARED" | "SAID" | "WAITING" | "NOT_DONE";
};

const SHOWN_MAX = 8;
const SHOWN_MESSAGES = 4;
const NOTE_CHARS = 400;

/** Titles Q quoted in its own words ("…" or “…”), as things it named. */
function quotedTitles(text: string): string[] {
  const titles: string[] = [];
  for (const match of text.matchAll(/[“"]([^”"\n]{3,120})[”"]/gu)) {
    // A sentence's full stop inside the quotes is not part of the title.
    const title = match[1]?.trim().replace(/[.,;:!?]+$/u, "");
    if (title !== undefined && title.length >= 3) titles.push(title);
  }
  return titles;
}

function blockItems(blocks: readonly QResultBlock[]): ShownItem[] {
  const items: ShownItem[] = [];
  for (const block of blocks) {
    if (block.kind === "ARTIFACT_REFERENCE") {
      items.push({ kind: "DOCUMENT", id: block.artifactId, name: block.title });
    } else if (block.kind === "COMPARISON_CARDS") {
      for (const card of block.items) {
        items.push({ kind: "NAMED", id: null, name: card.name });
      }
    } else if (block.kind === "ANSWER_CARDS") {
      // "The second one" means the second card as shown.
      for (const card of block.cards) {
        items.push({ kind: "NAMED", id: null, name: card.name });
      }
    }
  }
  return items;
}

/**
 * What Q showed in its last few answers, newest answer first and, within
 * one answer, in the order it showed them: the numbering "the second one"
 * means. A name shown twice is listed once, where it was shown last.
 */
export function shownItems(
  history: readonly QConversationMessage[],
): readonly ShownItem[] {
  const answers = history
    .filter((message) => message.role === "Q")
    .slice(-SHOWN_MESSAGES)
    .reverse();
  const seen = new Set<string>();
  const items: ShownItem[] = [];
  for (const message of answers) {
    const fromBlocks = blockItems(message.blocks ?? []);
    const named = quotedTitles(message.content).map((name): ShownItem => ({
      kind: "NAMED",
      id: null,
      name,
    }));
    for (const item of [...fromBlocks, ...named]) {
      const key = item.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      if (items.length >= SHOWN_MAX) return items;
    }
  }
  return items;
}

const OUTCOME_WORDS: Readonly<Record<LastAction["outcome"], string>> = {
  PREPARED: "prepared for their approval",
  SAID: "answered",
  WAITING: "waiting on their reply",
  NOT_DONE: "not done: it could not be prepared",
};

/**
 * Capital Q's own note for the turn reader, as the last recent turn: what
 * was shown, numbered, and the last action with its inputs. Null when
 * there is nothing to point back at. Bounded: the reader reads 400
 * characters of a turn.
 */
export function referenceNote(
  shown: readonly ShownItem[],
  last: LastAction | null,
): string | null {
  if (shown.length === 0 && last === null) return null;
  const parts: string[] = ["[Q context]"];
  if (shown.length > 0) {
    parts.push(
      `SHOWN: ${shown
        .map(
          (item, index) =>
            `${String(index + 1)}. ${item.kind === "DOCUMENT" ? "document " : ""}"${item.name.slice(0, 60)}"`,
        )
        .join("; ")}.`,
    );
  }
  if (last !== null) {
    const inputs =
      last.arguments === null
        ? "inputs not read"
        : JSON.stringify(last.arguments).slice(0, 140);
    parts.push(
      `LAST ACTION: ${last.tool} ${inputs} (${OUTCOME_WORDS[last.outcome]}).`,
    );
  }
  return parts.join(" ").slice(0, NOTE_CHARS);
}

/**
 * The record's name as said, without the words around it that are not the
 * name (voiceq-63, live 2026-10-04: "open the relationship between Nixon
 * and I" was answered `Opening "Nixon and I".`). Speech only frames the
 * name; the record is still resolved by the open tool among their own.
 */
export function spokenRecordName(name: string): string {
  const bare = name
    .trim()
    .replace(
      /^(?:(?:the|my|our)\s+)?(?:relationship|chat|conversation|call|meeting|page|profile)?\s*(?:between|with|of|for)\s+/iu,
      "",
    )
    .replace(/^(?:me|myself|us|i)\s+and\s+/iu, "")
    .replace(/\s+(?:and|&)\s+(?:i|me|myself|us|we)$/iu, "")
    .replace(/[\s.,;:!?]+$/u, "")
    .trim();
  return bare.length === 0 ? name.trim() : bare;
}

/** Which record a reading points at: its name or id, and the pages to try. */
export type OpenTarget = {
  readonly pages: readonly QRecordPage[];
  readonly id?: string | undefined;
  readonly name?: string | undefined;
};

/**
 * The record a reading asks to open, bound to what was shown when they
 * pointed at it. The pages are tried in order: a company first for an
 * investor, an investor organisation first for a founder. Null: nothing
 * concrete enough to open (Q answers instead of guessing).
 */
export function openTarget(
  reference: TurnReference,
  shown: readonly ShownItem[],
  side: "INVESTOR" | "FOUNDER",
): OpenTarget | null {
  if (reference.open === null) return null;
  const pointed =
    reference.shown === null ? undefined : shown[reference.shown - 1];
  const said =
    reference.name === null ? null : spokenRecordName(reference.name);
  const name = said ?? pointed?.name ?? null;
  const id =
    pointed !== undefined &&
    pointed.id !== null &&
    (said === null || said.toLowerCase() === pointed.name.toLowerCase())
      ? pointed.id
      : null;
  if (name === null && id === null) return null;
  const pair = (company: QRecordPage, investor: QRecordPage) =>
    side === "INVESTOR" ? [company, investor] : [investor, company];
  const pages: readonly QRecordPage[] = (() => {
    switch (reference.open) {
      case "DOCUMENT":
        return ["DOCUMENT"];
      case "CHAT":
        return pair(
          "RELATIONSHIP_COMPANY_MESSAGES",
          "RELATIONSHIP_INVESTOR_MESSAGES",
        );
      case "RELATIONSHIP":
      case "MEETING":
        return pair("RELATIONSHIP_COMPANY", "RELATIONSHIP_INVESTOR");
      case "COMPANY":
        return ["COMPANY"];
      case "INVESTOR":
        return ["INVESTOR"];
      case "PITCH":
        return ["COMPANY_PITCH"];
    }
  })();
  // An id shown on a document card opens only as a document.
  if (id !== null && pointed?.kind === "DOCUMENT") {
    return { pages: ["DOCUMENT"], id };
  }
  return { pages, ...(name === null ? {} : { name }) };
}

/** Inputs that name the record an action is for, as said. */
const RECORD_FIELDS = [
  "company",
  "investor",
  "counterpart",
  "counterpartName",
  "companyName",
  "investorName",
  "name",
  "with",
  "to",
  "recipient",
] as const;

/**
 * Q's last action again (retryLast), for another record when they said
 * "same for X": the record-naming input is replaced; nothing else
 * changes. Null when there is no last action, or its inputs were never
 * read (the caller reads them again from what was said then).
 */
export function repeatedAction(
  last: LastAction,
  sameFor: string | null,
): TurnAppAction | null {
  if (last.arguments === null) return null;
  if (sameFor === null) return { tool: last.tool, arguments: last.arguments };
  const field = RECORD_FIELDS.find(
    (key) => typeof last.arguments?.[key] === "string",
  );
  if (field === undefined) return null;
  return {
    tool: last.tool,
    arguments: { ...last.arguments, [field]: sameFor },
  };
}

/** Opening one record by code, through open_page's own authorize step. */
export type QOpenRecordPort = {
  readonly open: (
    request: QAnswerRequest,
    target: {
      readonly page: QRecordPage;
      readonly id?: string | undefined;
      readonly name?: string | undefined;
    },
  ) => Promise<Extract<
    QClientActionIntent,
    { kind: "OPEN_RECORD_PAGE" }
  > | null>;
  /**
   * N2: a company's pitch deck as this person may read it, through the
   * read_company_deck tool's own authorize step (the same view their Pitch
   * deck tab shows). Null: no deck they may see -- the caller refuses
   * plainly and says nothing about it.
   */
  readonly deck?:
    | ((request: QAnswerRequest, companyId: string) => Promise<DeckSpeech | null>)
    | undefined;
};

export function createToolOpenRecordPort(dependencies: {
  readonly tools: QToolPort;
  readonly logger?: Logger | undefined;
}): QOpenRecordPort {
  return {
    deck: async (request, companyId) => {
      try {
        const outcome = await dependencies.tools.execute(
          {
            callId: "q-open-record-deck-read",
            name: "read_company_deck",
            arguments: { companyId },
          },
          {
            actor: request.actor,
            runId: request.runId,
            correlationId: request.correlationId,
            capability: request.capability,
            plan: request.plan,
            focus: { areas: [], tools: ["read_company_deck"] },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (!outcome.result.ok) return null;
        const data = outcome.result.data as Partial<DeckSpeech> | null;
        if (
          data === null ||
          typeof data !== "object" ||
          !Array.isArray(data.sections) ||
          (data.viewer !== "INVESTOR" && data.viewer !== "OWNER")
        ) {
          return null;
        }
        return {
          viewer: data.viewer,
          sections: data.sections,
          confirmedByFounder: data.confirmedByFounder === true,
        };
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId },
          "a company's deck was not read for the person",
        );
        return null;
      }
    },
    open: async (request, target) => {
      try {
        const outcome = await dependencies.tools.execute(
          {
            callId: `q-open-record-${target.page.toLowerCase()}`,
            name: "open_page",
            arguments: {
              page: target.page,
              ...(target.id === undefined ? {} : { id: target.id }),
              ...(target.id !== undefined || target.name === undefined
                ? {}
                : { name: target.name }),
            },
          },
          {
            actor: request.actor,
            runId: request.runId,
            correlationId: request.correlationId,
            capability: request.capability,
            plan: request.plan,
            focus: { areas: [], tools: ["open_page"] },
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          },
        );
        if (!outcome.result.ok) return null;
        const data = outcome.result.data as {
          readonly clientAction?: QClientActionIntent;
        };
        return data.clientAction?.kind === "OPEN_RECORD_PAGE"
          ? data.clientAction
          : null;
      } catch (error: unknown) {
        if (request.signal?.aborted === true) throw error;
        dependencies.logger?.warn(
          { err: error, qRunId: request.runId, page: target.page },
          "a record named in the turn was not opened",
        );
        return null;
      }
    },
  };
}

/**
 * A record's name as Q says it: a trailing parenthetical the records carry
 * ("Savanna Seed Partners (fictional)") and quotes are not spoken. Bounded
 * so the pending line stays one the thread can read back (pendingPlaceOf).
 */
function spokenName(name: string): string {
  const bare = name
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/["“”]/gu, "")
    .trim();
  return (bare.length === 0 ? name.trim() : bare).slice(0, 60).trim();
}

/**
 * What Q says as it opens a record (the screen follows the intent).
 *
 * G2-D3 (gate on build/int-rc): this said `Opening "Savanna Seed Partners
 * (fictional)".` -- a full stop and the quoted raw name -- so the thread
 * never recognised it as a pending move and never flipped it to "Opened".
 * Every move line is now the one pending wording (q-core move-line.ts).
 */
export function openingLine(
  page: QRecordPage,
  name: string | undefined,
): string {
  const what =
    name === undefined || name.trim().length === 0 ? null : spokenName(name);
  return movePhaseLine("PENDING", recordPlace(page, what));
}

/** The place a record move names ("Tallyloom's pitch deck", "the chat"). */
function recordPlace(page: QRecordPage, what: string | null): string {
  switch (page) {
    case "DOCUMENT":
    case "DATA_ROOM_DOCUMENT":
      return what ?? "the document";
    case "RELATIONSHIP_COMPANY_MESSAGES":
    case "RELATIONSHIP_INVESTOR_MESSAGES":
      return what === null ? "the chat" : `your chat with ${what}`;
    case "COMPANY_PITCH":
      return `${what ?? "the pitch"} in Your companies`;
    case "COMPANY":
    case "INVESTOR":
    case "RELATIONSHIP_COMPANY":
    case "RELATIONSHIP_INVESTOR":
    case "INVESTOR_REHEARSAL":
    case "COMPANY_REHEARSAL":
    case "EXTERNAL_REHEARSAL":
    case "WORK_ITEM":
    case "CAPITAL_ROUND":
    case "GATEQ_APPLICATION":
      return what ?? "the page";
    case "COMPANY_ELEVATOR":
      return what === null ? "the elevator pitch" : `${what}'s elevator pitch`;
    case "COMPANY_DATA_ROOM":
      return what === null ? "the data room" : `${what}'s data room`;
    case "COMPANY_DECK":
      return what === null ? "the pitch deck" : `${what}'s pitch deck`;
    case "COMPANY_TEAM":
      return what === null ? "the team" : `${what}'s team`;
  }
}

/**
 * W4: "I want to rehearse (an investment pitch) with him/her/them" typed or
 * spoken right after Q showed one identity card of a researched person.
 * The pronoun is bound to that card (the newest Q answer's only external
 * card), by code; nothing earlier in the conversation is a referent, and a
 * name said instead must be that card's. Authority still comes from
 * open_page's authorize step, not from this reading.
 */
const REHEARSE_WITH =
  /\b(?:rehears\w*|practi[sc]\w*)\b[^.?!]*?\b(?:with|against|on|for)\s+(him|her|them|this\s+(?:person|one|guy|man|woman)|that\s+(?:person|one|guy|man|woman)|the\s+same\s+(?:person|one)|[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,2})\s*[.!?]*\s*$/iu;
const NOT_WANTED =
  /\b(?:don'?t|do not|never|no longer|not)\b[^.?!]*\b(?:rehears|practi[sc])/iu;

export type PersonCardRehearsal = {
  readonly externalPersonId: string;
  readonly name: string;
};

export function rehearseWithPersonCard(
  text: string,
  history: readonly QConversationMessage[],
): PersonCardRehearsal | null {
  const said = text.replace(/\s+/gu, " ").trim();
  if (said.length === 0 || said.length > 240 || NOT_WANTED.test(said)) {
    return null;
  }
  const match = REHEARSE_WITH.exec(said);
  const who = match?.[1];
  if (who === undefined) return null;
  // Right after a person card: the newest Q answer decides, nothing older.
  const latest = [...history].reverse().find((m) => m.role === "Q");
  if (latest === undefined) return null;
  const externals = (latest.blocks ?? []).flatMap((block) =>
    block.kind === "ANSWER_CARDS"
      ? block.cards.flatMap((card) =>
          card.external?.rehearse === true &&
          card.external.externalPersonId !== null
            ? [{ id: card.external.externalPersonId, name: card.name }]
            : [],
        )
      : [],
  );
  if (externals.length !== 1) return null;
  const only = externals[0];
  if (only === undefined) return null;
  const pronoun = /^(?:him|her|them|this |that |the same )/iu.test(who);
  if (!pronoun) {
    // A name: the card's own (full, or any one word of it), nobody else's.
    const spoken = who
      .toLowerCase()
      .replace(/[.!?,;:]+$/u, "")
      .replace(/[’']s$/u, "");
    const parts = only.name.toLowerCase().split(/\s+/u);
    const ok =
      spoken === only.name.toLowerCase() ||
      (parts.includes(spoken) && spoken.length >= 3);
    if (!ok) return null;
  }
  return { externalPersonId: only.id, name: only.name };
}

/**
 * W4: the name said in "rehearse with <name>" (not a pronoun), or null.
 * A name only: whether it is a researched entity is decided by the
 * lookup, and whether they may rehearse with it by open_page.
 */
export function rehearsalNameOf(text: string): string | null {
  const said = text.replace(/\s+/gu, " ").trim();
  if (said.length === 0 || said.length > 240 || NOT_WANTED.test(said)) {
    return null;
  }
  const who = REHEARSE_WITH.exec(said)?.[1];
  if (who === undefined) return null;
  if (/^(?:him|her|them|this |that |the same )/iu.test(who)) return null;
  const name = who
    .replace(/[.!?,;:]+$/u, "")
    .replace(/[’']s$/u, "")
    .trim();
  return name.length >= 3 ? name : null;
}
