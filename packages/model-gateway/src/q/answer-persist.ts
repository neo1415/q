// W5-B (audit finding 4): the answer's persisting, moved unchanged out of
// createModelGatewayQAnswer (see docs/architecture/notes/2026-11-22-q-answer-map.md,
// phase I). Each takes what the closure read as one typed input; a `let` of
// the answer is read through `live`, at call time, as the closure did.

import {
  type QAccountDigest,
  type QAnswerCardsBlock,
  type QConversationId,
  type QMessageId,
  type QResponseMessage,
  type QResultBlock,
  type QSpokenForm,
} from "@capital-q/contracts";
import { type TransactionManager } from "@capital-q/database";
import { type Logger } from "@capital-q/observability";
import {
  publicSourceBlockFields,
  type PublicSourceLike,
  spokenFormWithin,
} from "@capital-q/q-core";
import {
  appendRunEvent,
  type QAnswerRequest,
  type QConversationMessage,
  type QRuntimeRepositories,
  type QToolCallOutcome,
  toQMessage,
} from "@capital-q/q-runtime";

import {
  withExclusionChecked,
  withoutExcludedCompanies,
} from "./account-digest.js";
import {
  inSecondPerson,
  withReferenceLead,
  withRelationshipStagesChecked,
} from "./answer-continuity.js";
import { type ModelGatewayQAnswerDependencies } from "./answer-dependencies.js";
import { ANSWER_LIMIT_CHARS } from "./answer-plan.js";
import { type RunRead } from "./card-subjects.js";
import {
  answerCardCompanies,
  comparisonOnScreen,
  comparisonSpokenLine,
  type ComparisonVerdict,
  ledByVerdict,
  withoutCompareOffers,
  withoutMarkdownTables,
} from "./compare-table.js";
import { boundedCompletedMessage } from "./completed-event.js";
import {
  previousCardCompanyIds,
  tieIsAsked,
  tieLine,
  withFitIntegrity,
} from "./fit-integrity.js";
import { claimsLeftOutContacts, inContactOf } from "./in-contact.js";
import { withoutInternalFailureLines } from "./internal-failure-lines.js";
import {
  othersInterestAsked,
  withOthersInterestWithheld,
} from "./others-interest.js";
import { askerSideOf, COMPANIES_TABLE_TITLE } from "./result-blocks.js";
import { type SpeculationGate } from "./speculation.js";
import {
  missFacts,
  screenActMissLine,
  withoutLandedClaims,
} from "./turn-notes.js";
import { withoutUnaskedMoves } from "./unasked-moves.js";

/** The answer's `persistAnswer`, as the branches call it. */
export type PersistAnswer = (
  content: string,
  given?: QResponseMessage["blocks"],
  gestures?: QResponseMessage["gestures"],
  spokenCandidate?: string | null,
) => ReturnType<typeof persistAnswerWith>;

/** The answer's `persistCodeAnswer`. */
export type PersistCodeAnswer = (
  content: string,
  given?: QResponseMessage["blocks"],
) => ReturnType<typeof persistAnswerWith>;

export type PersistAnswerWithInput = {
  readonly accountDigest: Promise<QAccountDigest | null>;
  readonly chartFor: (
    blocks: readonly QResultBlock[],
    read?: RunRead,
  ) => QResultBlock | null;
  readonly clientActionBlocks: QResultBlock[];
  readonly compareTable: QResultBlock | null;
  readonly conversationId: QConversationId;
  readonly dependencies: ModelGatewayQAnswerDependencies;
  readonly earlier: QConversationMessage[];
  readonly gate: SpeculationGate | null;
  readonly inTheirLanguage: (text: string) => Promise<string>;
  readonly latest: QConversationMessage;
  readonly logger: Logger | undefined;
  readonly messageId: QMessageId;
  readonly movedBlocks: (
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
  ) => Promise<QResultBlock[] | undefined>;
  readonly publicSources: PublicSourceLike[];
  readonly repositories: QRuntimeRepositories;
  readonly request: QAnswerRequest;
  readonly screenReceipts: readonly string[];
  readonly stages: { now: string | undefined; queue: Promise<void> };
  readonly standingOf: () => Promise<QToolCallOutcome> | null;
  readonly transactions: TransactionManager;
  /** The answer's own lets, read (and written) live. */
  readonly live: {
    readonly answerVerdict: ComparisonVerdict | null;
    readonly rankedPastShown: boolean;
    readonly tieLineAllowed: boolean;
  };
};

/** Moved unchanged from the answer's `persistAnswer` (W5-A map, phase I). */
export async function persistAnswerWith(
  input: PersistAnswerWithInput,
  content: string,
  /**
   * What the analyst produced beside the prose, as blocks
   * (QX-002/003 §C). Carried on the durable completion event, which
   * is the event a client converges on and the one it replays after
   * a reconnect. The message store stays plain text on purpose: an
   * unbounded column there is where a provider's whole response
   * object would eventually land.
   */
  given?: QResponseMessage["blocks"],
  /**
   * PRESENCE: what Q's particles form for which sentence, clamped to
   * the reply. On the live completion event only; never stored.
   */
  gestures?: QResponseMessage["gestures"],
  /**
   * RC3 / Phase 5: the analyst's concise spoken form of this answer,
   * as written in the same call. Kept on the live completion event
   * only when every figure and name in it is in what is stored
   * (spokenFormWithin); otherwise the voice derives its words from
   * the text as before. Never stored.
   */
  spokenCandidate?: string | null,
) {
  const {
    accountDigest,
    chartFor,
    clientActionBlocks,
    compareTable,
    conversationId,
    dependencies,
    earlier,
    gate,
    inTheirLanguage,
    latest,
    logger,
    messageId,
    movedBlocks,
    publicSources,
    repositories,
    request,
    screenReceipts,
    stages,
    standingOf,
    transactions,
    live,
  } = input;
  // Every public page read for this answer travels with it as a
  // structured source (R23, R38): the prose stays answer-first and
  // the provenance is one tap away, never lost.
  // INC-1: one card per canonical record across every block, exactly
  // the count asked for, "them" held to the set just shown, and every
  // score labelled mandate fit with how it was made.
  // Live 23 Oct 2026 (three readings of "compare the top two side by
  // side", three answer paths, no table): a comparison the prepare
  // resolved goes out with its table whichever path answered, and is
  // done, never offered.
  const tableHere =
    compareTable !== null &&
    // live6: the table already on their screen is not drawn again.
    !comparisonOnScreen(earlier, compareTable) &&
    !(given ?? []).some(
      (block) =>
        block.kind === "TABLE" && block.title !== COMPANIES_TABLE_TITLE,
    );
  if (tableHere) {
    given = given?.filter(
      (block) =>
        block.kind !== "TABLE" || block.title !== COMPANIES_TABLE_TITLE,
    );
  }
  // QA F-107: how a tool failed is never said to the person.
  content = withoutInternalFailureLines(content);
  // RC4 (audit 15 Nov): Q's notes speak of them in the third person;
  // the answer speaks to them.
  content = inSecondPerson(content);
  // QA F-44: other investors' interest is withheld, never denied.
  if (othersInterestAsked(request, latest.content)) {
    content = withOthersInterestWithheld(content).slice(0, ANSWER_LIMIT_CHARS);
  }
  if (compareTable !== null) {
    const done = withoutMarkdownTables(withoutCompareOffers(content));
    const spoken = tableHere ? comparisonSpokenLine(compareTable) : null;
    content = (
      spoken === null
        ? done.length === 0
          ? content
          : done
        : done.length === 0
          ? spoken
          : `${spoken}\n\n${done}`
    ).slice(0, ANSWER_LIMIT_CHARS);
  }
  // Coordinator 24 Oct: code decides who a comparison leads with. Last,
  // so the table's spoken line never goes before the verdict (live on
  // bbb4b677: the lead was applied, then "Side by side, …" put first).
  if (live.answerVerdict !== null) {
    content = ledByVerdict(content, live.answerVerdict).slice(
      0,
      ANSWER_LIMIT_CHARS,
    );
  }
  const chart = chartFor([
    ...(given ?? []),
    ...(tableHere && compareTable !== null ? [compareTable] : []),
  ]);
  const carried = withoutUnaskedMoves(
    withFitIntegrity(
      [
        ...(given ?? []),
        ...(tableHere && compareTable !== null ? [compareTable] : []),
        ...(chart === null ? [] : [chart]),
        ...publicSources.map((source) => ({
          kind: "PUBLIC_SOURCE" as const,
          ...publicSourceBlockFields(source),
        })),
        ...clientActionBlocks,
      ],
      {
        asked: latest.content,
        // "Them" is held to the set just shown, except where the
        // answer says it is the mandate's ranking instead (below).
        previous: live.rankedPastShown ? [] : previousCardCompanyIds(earlier),
        // QA U2: a mandate fit is an investor's; none for anyone else.
        mandate: askerSideOf(request) === "INVESTOR",
      },
    ),
    // A map they asked to see is not replaced by a page they did not.
    latest.content,
  );
  // v88 (owner live 14 Nov 2026, D1): a stated "not the ones I'm
  // already in touch with" holds on every path. Any company card of
  // their own relationships still in the answer is dropped and the
  // answer says so -- the digest's relationships, and those this
  // turn's own read found, as them.
  let answerBlocks = carried.length === 0 ? undefined : carried;
  // Owner live 18 Nov 2026 (run faecd30a): "the three best candidates
  // with no recorded contact are Kazikit, Portside and Watchly" --
  // two of them relationships. An answer that itself says it left
  // out their contacts is held to it, as a stated exclusion is.
  if (request.excludeRelationships === true || claimsLeftOutContacts(content)) {
    const standing = await (standingOf() ?? Promise.resolve(null)).catch(
      () => null,
    );
    // in-contact.ts: the one rule, from the digest and this turn's
    // own relationships read.
    const inTouch = inContactOf(
      await accountDigest,
      standing !== null && standing.result.ok ? standing.result.data : null,
    );
    const checked = withoutExcludedCompanies(answerBlocks, inTouch);
    answerBlocks =
      checked.blocks === undefined || checked.blocks.length === 0
        ? undefined
        : checked.blocks;
    const said = withExclusionChecked(
      content,
      checked.dropped,
      answerCardCompanies(answerBlocks ?? []).length,
    );
    if (said !== null) {
      content = said.slice(0, ANSWER_LIMIT_CHARS);
      logger?.warn(
        { qRunId: request.runId, dropped: checked.dropped.length },
        "q answer listed companies the person asked to leave out; dropped by code",
      );
    }
  }
  // A tie is said as a tie, with why (INC-1: three cards at 8.8 read
  // as a ranking) -- on the cards still shown after the check above
  // (live 18 Nov 2026: a tie of the three companies it had dropped).
  const ranked = (answerBlocks ?? []).find(
    (block): block is QAnswerCardsBlock =>
      block.kind === "ANSWER_CARDS" && block.shape === "RANKED",
  );
  // Only where they asked for fit or for companies (QA F-71, live
  // 2026-10-24: "Show my pipeline" ended with "Ajopot and Maji Loop
  // are tied on mandate fit at 7", about cards they had not asked to
  // rank). Any other turn says the tie on its cards only.
  const tie =
    ranked === undefined || !tieIsAsked(request) || !live.tieLineAllowed
      ? null
      : tieLine(ranked);
  content =
    tie === null || /\btied\b/iu.test(content)
      ? content
      : `${content}\n\n${tie}`.slice(0, ANSWER_LIMIT_CHARS);
  // C's follow-up: a move or screen act that did not land is said
  // first, plainly, once (never left for the model to smooth over).
  const missed = screenActMissLine(
    missFacts(dependencies, request.actor, earlier, screenReceipts),
    [...earlier].reverse().find((message) => message.role === "Q")?.content ??
      null,
  );
  if (missed !== null && !content.includes("didn't go through")) {
    const rest = withoutLandedClaims(content);
    content = (rest.length === 0 ? missed : `${missed}\n\n${rest}`).slice(
      0,
      ANSWER_LIMIT_CHARS,
    );
  }
  // RC4 (voice audit 15 Nov): a stated relationship stage about a
  // named counterpart matches the canonical projection (the digest),
  // or the sentence is replaced by the stage as recorded.
  {
    const staged = withRelationshipStagesChecked(
      content,
      await accountDigest,
      // A pipeline denial naming no one is about whom they asked.
      latest.content,
    );
    if (staged.corrected.length > 0) {
      content = staged.content.slice(0, ANSWER_LIMIT_CHARS);
      logger?.warn(
        { qRunId: request.runId, corrected: staged.corrected.length },
        "q answer stated a relationship stage the projection contradicts; corrected by code",
      );
    }
  }
  // RC4: a place they pointed at is said with the list it was
  // counted in (never a silent guess at "the first one").
  content = withReferenceLead(content, request.referenceLead).slice(
    0,
    ANSWER_LIMIT_CHARS,
  );
  // F-96: every line code wrote, in the language of their turn.
  content = await inTheirLanguage(content);
  // Nothing of a speculative answer is stored until it is adopted.
  if (gate !== null) await gate.ready();
  // The stages and live findings already queued are stored first, so
  // the completed message is the last word (lane 3 reconciles on it).
  await stages.queue;
  // W4: the page pane's move joins the answer before it is stored.
  const blocks = await movedBlocks(request, answerBlocks);
  // Voice directive 15 Nov: the spoken form goes through the same
  // sentence rewrites the answer just did (failure lines, person,
  // others' interest, relationship stages) before it is held to it.
  let spokenHeld: string | null = null;
  if (spokenCandidate !== undefined && spokenCandidate !== null) {
    let said = inSecondPerson(withoutInternalFailureLines(spokenCandidate));
    if (othersInterestAsked(request, latest.content)) {
      said = withOthersInterestWithheld(said);
    }
    said = withRelationshipStagesChecked(
      said,
      await accountDigest,
      latest.content,
    ).content;
    spokenHeld = said.trim().length === 0 ? null : said;
  }
  const spokenForm: QSpokenForm | null = spokenFormWithin(spokenHeld, content);
  if (
    spokenCandidate !== undefined &&
    spokenCandidate !== null &&
    spokenForm === null
  ) {
    logger?.info(
      { qRunId: request.runId },
      "q spoken form left out: it said what the answer does not",
    );
  }
  return transactions.run(async (tx) => {
    const stored = await repositories.messages.insert(tx, {
      id: messageId,
      tenantId: request.tenantId,
      conversationId,
      runId: request.runId,
      role: "Q",
      content,
      // Stored as well as streamed (CQ-Q-BLOCKS-HISTORY-001). The
      // event is what a live client converges on; this is what a
      // refresh, a reopened conversation and the chats list read.
      ...(blocks === undefined ? {} : { blocks }),
    });
    // The record holds everything; the event is bounded (the run
    // failed on a ten-card answer, production 2026-10-28).
    const bounded = boundedCompletedMessage({
      ...(toQMessage(stored) as QResponseMessage),
      ...(blocks === undefined ? {} : { blocks }),
      ...(gestures === undefined || gestures.length === 0
        ? {}
        : { gestures: [...gestures] }),
      ...(spokenForm === null ? {} : { spoken: spokenForm }),
    });
    if (bounded.trimmed !== "NONE") {
      logger?.warn(
        { qRunId: request.runId, trimmed: bounded.trimmed },
        "completed-message event over the run-event bound; the record keeps what the event leaves",
      );
    }
    await appendRunEvent(
      repositories,
      tx,
      { id: request.runId, tenantId: request.tenantId },
      {
        type: "q.message.completed",
        data: { message: bounded.message },
      },
    );
    return stored;
  });
}

export type PersistCodeAnswerWithInput = {
  readonly dependencies: ModelGatewayQAnswerDependencies;
  readonly latest: QConversationMessage;
  readonly persistAnswer: PersistAnswer;
  readonly request: QAnswerRequest;
};

/**
 * An answer composed by code, in the person's language (any language):
 * the prose and each card set's title and follow-ups go through the
 * shared translation layer with their data lifted out. The prose decides:
 * untranslated, everything stays English. Moved unchanged from the
 * answer's `persistCodeAnswer`.
 */
export async function persistCodeAnswerWith(
  input: PersistCodeAnswerWithInput,
  content: string,
  given?: QResponseMessage["blocks"],
) {
  const { dependencies, latest, persistAnswer, request } = input;
  const localise = dependencies.localiseWords;
  if (localise === undefined) return persistAnswer(content, given);
  const cardSets = (given ?? []).filter(
    (block): block is QAnswerCardsBlock => block.kind === "ANSWER_CARDS",
  );
  const texts = [
    content,
    ...cardSets.flatMap((block) => [block.title, ...block.followUps]),
  ];
  const said = await localise(
    {
      tenantId: request.tenantId,
      userId: request.actorUserId,
      runId: request.runId,
      turn: latest.content,
    },
    texts,
  ).catch(() => null);
  const prose = said?.[0];
  if (said === null || prose === null || prose === undefined) {
    return persistAnswer(content, given);
  }
  let at = 1;
  const next = (english: string) => {
    const words = said[at];
    at += 1;
    return words === null || words === undefined ? english : words;
  };
  const blocks = given?.map((block) =>
    block.kind === "ANSWER_CARDS"
      ? {
          ...block,
          title: next(block.title).slice(0, 120),
          followUps: block.followUps.map((chip) => next(chip).slice(0, 120)),
        }
      : block,
  );
  return persistAnswer(prose, blocks);
}
