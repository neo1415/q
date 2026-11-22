// W5-B (audit finding 4): three guarded code-answer branches, moved
// unchanged out of createModelGatewayQAnswer (the map's phase J). Each
// runs only when its guard, still in the answer, holds; it returns the
// outcome it answered with, or null to let the answer go on. A `let` of
// the answer is read and written through `live`, at the moment it was.

import {
  type QAccountDigest,
  type QAnswerCardsBlock,
  type QMessageId,
  type QStageAbout,
  type QVisibleStage,
} from "@capital-q/contracts";
import { type Logger } from "@capital-q/observability";
import { type PublicSourceLike, type RenderedPrompt } from "@capital-q/q-core";
import {
  type QAnswerOutcome,
  type QAnswerRequest,
  type QConversationMessage,
  type QLiveDelta,
  type QOfferedTool,
  type QToolExecutionContext,
} from "@capital-q/q-runtime";

import { type ModelGatewayQAnswerDependencies } from "./answer-dependencies.js";
import { type PersistCodeAnswer } from "./answer-persist.js";
import { type SubjectAnnouncer } from "./artifact-preview.js";
import { containsCompanyName } from "./card-subjects.js";
import {
  type DiscoverAsk,
  type DiscoveryAnswer,
} from "./discover-companies.js";
import {
  fitSweepCardsBlock,
  fitSweepSummary,
  type RunFit,
} from "./fit-cards.js";
import { asComparison } from "./fit-integrity.js";
import { type FitSweepResult } from "./fit-sweep.js";
import { inContactOf, inContactWith } from "./in-contact.js";
import { PUBLIC_WEB_TOOL, settledWithin } from "./owned-first.js";
import {
  type KnownInvestorAnswer,
  type PersonAsk,
  type PersonSearchAnswer,
} from "./person-search-answer.js";
import {
  corroboratedPictures,
  type SearchEvidence,
} from "./picture-corroboration.js";
import {
  PICTURE_WAIT_MS,
  publicPictureBlocks,
  type QPublicPicturePort,
} from "./result-blocks.js";
import {
  priorListings,
  type WebDiscoveryAnswer,
  type WebDiscoveryAsk,
} from "./web-discovery.js";

export type PersonSearchBranchInput = {
  readonly announcer: SubjectAnnouncer;
  readonly dependencies: ModelGatewayQAnswerDependencies;
  readonly investorAsking: boolean;
  readonly knownInvestorFor: (
    name: string,
  ) => Promise<KnownInvestorAnswer | null>;
  readonly latest: QConversationMessage;
  readonly logger: Logger | undefined;
  readonly messageId: QMessageId;
  readonly persistCodeAnswer: PersistCodeAnswer;
  readonly personFor: (
    ask: PersonAsk,
    notOnCapitalQ?: boolean,
  ) => Promise<PersonSearchAnswer | null>;
  readonly pictureSearch: QPublicPicturePort | undefined;
  readonly prepared: {
    readonly ownCompanyId: string | null;
    readonly ownMandateData: () => unknown;
    readonly prepareMs: Record<string, number>;
  };
  readonly publicSources: PublicSourceLike[];
  readonly request: QAnswerRequest & {
    readonly personSearch: NonNullable<QAnswerRequest["personSearch"]>;
  };
  readonly send: (delta: QLiveDelta) => void;
  readonly startedAt: number;
  readonly webEvidence: SearchEvidence[];
  readonly webPictures:
    (() => Promise<Awaited<ReturnType<QPublicPicturePort["find"]>>>) | null;
  /** The answer's own lets, read (and written) live. */
  readonly live: {
    readonly rendered: RenderedPrompt;
    readonly toolContext: QToolExecutionContext;
  };
};

/**
 * W2: a named person, company or body is identified from public sources
 * by code. The branch's body, moved unchanged; null: it did not answer.
 */
export async function personSearchBranch(
  input: PersonSearchBranchInput,
): Promise<QAnswerOutcome | null> {
  const {
    announcer,
    dependencies,
    investorAsking,
    knownInvestorFor,
    latest,
    logger,
    messageId,
    persistCodeAnswer,
    personFor,
    pictureSearch,
    prepared,
    publicSources,
    request,
    send,
    startedAt,
    webEvidence,
    webPictures,
    live,
  } = input;
  const personStarted = Date.now();
  // Artifacts live (L-15): the identity's card frame goes up as soon
  // as the name is known, while the public lookup runs (seconds),
  // with initials until the card lands. Only a name in the person's
  // own words, never one a model wrote.
  const askedName = request.personSearch.name.trim().slice(0, 80);
  if (askedName.length > 0 && containsCompanyName(latest.content, askedName)) {
    const ahead = announcer.ahead({
      subject: null,
      name: askedName,
      kind:
        request.personSearch.entityKind === "PERSON"
          ? "PERSON"
          : "ORGANISATION",
    });
    if (ahead !== null) {
      send({
        runId: request.runId,
        tenantId: request.tenantId,
        messageId,
        text: "",
        preview: ahead,
      });
    }
  }
  // Their picture from public pages, looked for beside the lookup
  // (owner 2026-10-23): the turn's own picture search when the web
  // search began with their name, else one for the name they asked.
  // Asked for only once the lookup found them (spend rule 2026-10-25).
  let laneStarted: ReturnType<QPublicPicturePort["find"]> | null = null;
  const lanePictures =
    webPictures ??
    (pictureSearch !== undefined && askedName.length > 0
      ? () =>
          (laneStarted ??= pictureSearch
            .find({
              name: askedName,
              userText: latest.content,
              earlierUserText:
                live.toolContext.conversation?.earlierUserText ?? [],
              shownText: live.toolContext.conversation?.earlierQText ?? [],
              privateText: live.toolContext.conversation?.privateText?.() ?? [],
              signal: request.signal,
              runId: request.runId,
            })
            .catch(() => []))
      : null);
  // Live 2026-10-28: for a founder, an organisation they named is
  // looked for among Capital Q's own investors they may see before
  // any public search; found, the answer is its card (public profile
  // and published gate only), and no web page is read.
  const founderAsking = !investorAsking && prepared.ownCompanyId !== null;
  const known =
    founderAsking &&
    request.personSearch.entityKind !== "PERSON" &&
    askedName.length > 0
      ? await knownInvestorFor(askedName)
      : null;
  if (known !== null) {
    const message = await persistCodeAnswer(known.text, [...known.blocks]);
    logger?.info(
      {
        qRunId: request.runId,
        investorOrganisationId: known.investorOrganisationId,
        modelCalls: 0,
        prepareMs: prepared.prepareMs,
        personMs: Date.now() - personStarted,
        totalMs: Date.now() - startedAt,
      },
      "q answered a named investor from Capital Q's own investors",
    );
    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: "none",
      promptBundleVersion: live.rendered.bundle.bundleVersion,
    };
  }
  const found = await personFor(
    request.personSearch,
    founderAsking && request.personSearch.entityKind !== "PERSON",
  );
  if (found !== null) {
    for (const source of found.sources) {
      if (!publicSources.some((known) => known.url === source.url)) {
        publicSources.push(source);
      }
    }
    // QA F-17: pictures only of someone the lookup found.
    const foundThem =
      found.result.card !== null || found.result.candidates.length > 0;
    const soleFound =
      found.result.candidates.length === 1
        ? found.result.candidates[0]
        : undefined;
    const placedAt = (
      found.result.card?.subject.organization ??
      soleFound?.organization ??
      ""
    ).trim();
    // QA QO-09: only on a site the lookup found them on, or the own
    // site of the organisation it placed them at.
    const theirs = (candidates: Parameters<typeof corroboratedPictures>[0]) =>
      corroboratedPictures(candidates, {
        name: askedName,
        sources: [
          ...webEvidence,
          ...found.sources.map((source) => ({
            domain: source.domain,
            subjectMatch: "MATCH",
          })),
        ],
        organisations: placedAt.length > 0 ? [placedAt] : [],
      });
    let pictures =
      lanePictures === null || !foundThem
        ? []
        : publicPictureBlocks(
            theirs(
              (await settledWithin(lanePictures(), PICTURE_WAIT_MS)) ?? [],
            ),
            new Date().toISOString(),
          );
    // A person's name alone often finds namesakes' pictures, which
    // the page check drops (live 2026-10-23: "captain zino mario"
    // found game art). Where the lookup placed them at an
    // organisation, its pages are asked too (a company's page about
    // its founder, a press interview).
    // From the matched card, or from the one candidate a name alone
    // found (live 2026-10-23: "Captain Zino Mario" found one plausible
    // candidate, Zino Mario-Ghae of Zino Aviation, which a name alone
    // never makes a confirmed identity, so there was no card).
    const soleCandidate =
      found.result.candidates.length === 1
        ? found.result.candidates[0]
        : undefined;
    const organisation = (
      found.result.card?.subject.organization ??
      soleCandidate?.organization ??
      ""
    ).trim();
    if (
      foundThem &&
      pictures.length === 0 &&
      organisation.length > 0 &&
      dependencies.publicPictures !== undefined &&
      askedName.length > 0
    ) {
      pictures = publicPictureBlocks(
        theirs(
          (await settledWithin(
            dependencies.publicPictures.find({
              name: askedName,
              organisation,
              userText: latest.content,
              earlierUserText:
                live.toolContext.conversation?.earlierUserText ?? [],
              shownText: live.toolContext.conversation?.earlierQText ?? [],
              privateText: live.toolContext.conversation?.privateText?.() ?? [],
              signal: request.signal,
              runId: request.runId,
            }),
            PICTURE_WAIT_MS,
          )) ?? [],
        ),
        new Date().toISOString(),
      );
    }
    const message = await persistCodeAnswer(found.text, [
      ...(found.block === null ? [] : [found.block]),
      ...pictures,
    ]);
    logger?.info(
      {
        qRunId: request.runId,
        pictures: pictures.length,
        outcome: found.result.outcome,
        source: found.source,
        confidence: found.result.card?.subject.confidence ?? null,
        candidates: found.result.candidates.length,
        searchMs: found.result.elapsedMs,
        modelCalls: 0,
        prepareMs: prepared.prepareMs,
        personMs: Date.now() - personStarted,
        totalMs: Date.now() - startedAt,
      },
      "q answered a person search",
    );
    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: "none",
      promptBundleVersion: live.rendered.bundle.bundleVersion,
    };
  }

  return null;
}

export type WebDiscoveryBranchInput = {
  readonly discoverFor: (ask: DiscoverAsk) => Promise<DiscoveryAnswer | null>;
  readonly earlier: QConversationMessage[];
  readonly investorAsking: boolean;
  readonly logger: Logger | undefined;
  readonly offeredForRun: readonly QOfferedTool[];
  readonly persistCodeAnswer: PersistCodeAnswer;
  readonly prepared: {
    readonly ownCompanyId: string | null;
    readonly ownMandateData: () => unknown;
    readonly prepareMs: Record<string, number>;
  };
  readonly publicSources: PublicSourceLike[];
  readonly request: QAnswerRequest & {
    readonly webDiscovery: NonNullable<QAnswerRequest["webDiscovery"]>;
  };
  readonly stageOnce: (
    stage: QVisibleStage,
    about?: QStageAbout,
  ) => Promise<void>;
  readonly startedAt: number;
  readonly webDiscoveryFor: (
    ask: WebDiscoveryAsk,
    prepared: unknown,
    alreadyListed?: {
      readonly name: string;
      readonly founders: readonly string[];
    }[],
  ) => Promise<WebDiscoveryAnswer | null>;
  /** The answer's own lets, read (and written) live. */
  readonly live: {
    readonly rendered: RenderedPrompt;
    tieLineAllowed: boolean;
  };
};

/** Companies found on the public web, composed by code. The branch's body, moved unchanged; null: it did not answer. */
export async function webDiscoveryBranch(
  input: WebDiscoveryBranchInput,
): Promise<QAnswerOutcome | null> {
  const {
    discoverFor,
    earlier,
    investorAsking,
    logger,
    offeredForRun,
    persistCodeAnswer,
    prepared,
    publicSources,
    request,
    stageOnce,
    startedAt,
    webDiscoveryFor,
    live,
  } = input;
  const discoveryStarted = Date.now();
  // The search takes a while (two rounds of searches and page
  // reads): they see the web search's own stage meanwhile.
  const webStage = offeredForRun.find(
    (tool) => tool.definition.name === PUBLIC_WEB_TOOL,
  )?.visibleStage;
  if (webStage !== undefined && webStage !== null) {
    void stageOnce(webStage);
  }
  // Owner's account 2026-11-06: "find me new companies online that i
  // would be interested in" -- Capital Q's own top matches by mandate
  // fit first, in one line, then the web's; both side by side.
  // Round 4 (live 2026-11-06): what Q already listed here, from its
  // own replies. "More" leaves those out, and a follow-up shows the
  // web's list only: no top-3 cards, no ranking line again.
  const alreadyListed = priorListings(
    earlier
      .filter((message) => message.role === "Q")
      .map((message) => message.content),
  );
  const onCapitalQ =
    request.webDiscovery.alsoOnCapitalQ === true &&
    investorAsking &&
    alreadyListed.length === 0
      ? discoverFor({
          text: request.webDiscovery.text,
          sectors: [],
          countries: [],
          stages: [],
          count: 3,
          ranking: "FIT",
          mandateRelevant: true,
          previous: false,
          raising: false,
        }).catch(() => null)
      : Promise.resolve(null);
  const [found, catalog] = await Promise.all([
    webDiscoveryFor(
      request.webDiscovery,
      prepared.ownMandateData(),
      alreadyListed,
    ),
    onCapitalQ,
  ]);
  if (found !== null) {
    for (const source of found.sources) {
      if (!publicSources.some((known) => known.url === source.url)) {
        publicSources.push(source);
      }
    }
    const topCards =
      catalog !== null && catalog.basis === "FIT" && catalog.block !== null
        ? catalog.block.cards.slice(0, 3)
        : [];
    const topNames = topCards.map((card) => `**${card.name}**`);
    const lead =
      topNames.length === 0
        ? null
        : `On Capital Q, your top ${String(topNames.length)} by mandate fit: ${
            topNames.length === 1
              ? (topNames[0] ?? "")
              : `${topNames.slice(0, -1).join(", ")} and ${topNames.at(-1) ?? ""}`
          }. From the public web:`;
    live.tieLineAllowed = false;
    const message = await persistCodeAnswer(
      lead === null ? found.text : `${lead}\n\n${found.text}`,
      lead === null || catalog === null || catalog.block === null
        ? []
        : [{ ...catalog.block, cards: topCards }],
    );
    logger?.info(
      {
        qRunId: request.runId,
        outcome: found.outcome,
        readerFailed: found.readerFailed,
        listed: found.companies.length,
        withFounders: found.companies.filter(
          (company) => company.founders.length > 0,
        ).length,
        onCapitalQ: found.companies.filter((company) => company.onCapitalQ)
          .length,
        queries: found.queries.length,
        founderSearches: found.founderQueries.length,
        toolCalls: found.toolCalls,
        sources: found.sources.length,
        prepareMs: prepared.prepareMs,
        discoveryMs: Date.now() - discoveryStarted,
        totalMs: Date.now() - startedAt,
      },
      "q answered a web discovery",
    );
    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: "none",
      promptBundleVersion: live.rendered.bundle.bundleVersion,
    };
  }

  return null;
}

export type FitSweepBranchInput = {
  readonly accountDigest: Promise<QAccountDigest | null>;
  readonly beyondShown: { count: FitSweepResult["ask"]["count"] } | undefined;
  readonly latest: QConversationMessage;
  readonly logger: Logger | undefined;
  readonly networkRankFailedOf: () => string | null;
  readonly persistCodeAnswer: PersistCodeAnswer;
  readonly reRanked: FitSweepResult | null;
  readonly request: QAnswerRequest;
  readonly startedAt: number;
  readonly sweep: FitSweepResult;
  readonly withReaderSourceCounts: (
    block: QAnswerCardsBlock,
  ) => Promise<QAnswerCardsBlock>;
  /** The answer's own lets, read (and written) live. */
  readonly live: {
    rankedPastShown: boolean;
    readonly rendered: RenderedPrompt;
  };
};

/** The mandate's ranking, from the fit sweep. The branch's body, moved unchanged; null: it did not answer. */
export async function fitSweepBranch(
  input: FitSweepBranchInput,
): Promise<QAnswerOutcome | null> {
  const {
    accountDigest,
    beyondShown,
    latest,
    logger,
    networkRankFailedOf,
    persistCodeAnswer,
    reRanked,
    request,
    startedAt,
    sweep,
    withReaderSourceCounts,
    live,
  } = input;
  // D17 (live 15 Nov 2026, run bef9a7f4): the card set is final
  // before a word of the summary is written. A company they asked to
  // leave out never reaches the cards or the prose, so the answer's
  // last check has nothing to drop and nothing contradicts it.
  const inTouchNow =
    request.excludeRelationships === true
      ? inContactOf(await accountDigest)
      : inContactOf(null);
  const inTouchFit = (fit: RunFit) =>
    inContactWith(inTouchNow, { id: fit.companyId, name: fit.name });
  const leftOutNow = new Set([
    ...sweep.excludedRelationships,
    ...sweep.fits.filter(inTouchFit).map((fit) => fit.companyId),
  ]);
  const finalFits = sweep.fits.filter((fit) => !inTouchFit(fit));
  // voice-cards: "the top three" is three cards, not ten.
  const swept = fitSweepCardsBlock(
    sweep.ask.count === null ? finalFits : finalFits.slice(0, sweep.ask.count),
    sweep.ask.place === null
      ? "Fit against your mandate"
      : `Fit against your mandate: ${sweep.ask.place}`,
  );
  // D7: "compare Ledgerfold and F2" is the comparison table, in the
  // order named, and is said as a comparison, never "ranked".
  const shaped = swept === null ? null : asComparison(swept, latest.content);
  const block = shaped === null ? null : await withReaderSourceCounts(shaped);
  if (block !== null) {
    const summary = fitSweepSummary({
      block,
      scope: sweep.ask.scope,
      place: sweep.ask.place,
      considered: sweep.considered,
      asked: latest.content,
      beyondShown,
      // The count as read, so "the five that best fit" names five.
      requested: sweep.ask.count,
    });
    const shownCount =
      sweep.ask.count === null
        ? finalFits.length
        : Math.min(sweep.ask.count, finalFits.length);
    // The network's ranking failed twice (logged above): what follows
    // is their own pipeline, and it is said to be.
    const fromPipeline =
      networkRankFailedOf() === null || sweep.ask.scope !== "CANDIDATES"
        ? ""
        : `I couldn't rank the whole network just now; here ${shownCount === 1 ? "is one" : `are ${String(shownCount)}`} from your own pipeline. `;
    // v88 (D1, D2): the answer itself says the exclusion it applied,
    // so nothing downstream can claim one that was not made.
    const leftOutLine =
      sweep.ask.excludeRelationships !== true &&
      request.excludeRelationships !== true
        ? ""
        : leftOutNow.size > 0
          ? `I've left out the ${leftOutNow.size === 1 ? "company" : `${String(leftOutNow.size)} companies`} you're already in touch with. `
          : "None of these is a company you're already in touch with. ";
    const text =
      leftOutLine +
      fromPipeline +
      (sweep === reRanked
        ? `None of the companies I just listed has enough on record to score against your mandate yet. Ranked by fit with your mandate, these are the strongest. ${summary}`
        : summary);
    live.rankedPastShown = sweep === reRanked;
    const message = await persistCodeAnswer(text, [block]);
    logger?.info(
      {
        qRunId: request.runId,
        scope: sweep.ask.scope,
        place: sweep.ask.place !== null,
        cards: block.cards.length,
        considered: sweep.considered,
        excluded: sweep.excluded,
        excludedRelationships: leftOutNow.size,
        fitCalls: sweep.calls.length,
        totalMs: Date.now() - startedAt,
      },
      "q answered a fit question from computed fits",
    );
    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: "none",
      promptBundleVersion: live.rendered.bundle.bundleVersion,
    };
  }

  return null;
}
