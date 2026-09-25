import "server-only";

import {
  discoverCompanies,
  discoverInvestors,
  fetchMe,
  getCompanyPitch,
  getCurrentOnboardingSession,
  listDocuments,
  listOnboardingInterviewTurns,
  listQArtifacts,
  type ApiSession,
} from "@capital-q/api-client";
import { loadWebServerConfig } from "@capital-q/config/web";

import { accountDetails } from "@/auth/account-details";
import { FOUNDER_VOCABULARY } from "@/features/founder-onboarding/conversation-adapter";
import { INVESTOR_VOCABULARY } from "@/features/investor-onboarding/conversation-adapter";
import {
  pendingQuestion,
  progressLines,
} from "@/features/onboarding-conversation/conversation";
import { apiSession, type OwnContext } from "@/features/q/context";

import type { DeckFact, Known, ReturningFacts, SetupFacts } from "./returning";

/**
 * What Home knows about a returning person, read on the server under
 * their own session through the ordinary API (CQ-WEB-030).
 *
 * Every read is optional and bounded. A read that fails or is slow
 * becomes UNKNOWN rather than holding the page: the greeting is meant to
 * be there at once, and a card that cannot be chosen honestly is left
 * out. Nothing here is authority -- each card is a navigation or a
 * question the API and the Q API authorise again.
 */

/** Past this, a read is treated as unanswered rather than waited for. */
const READ_BUDGET_MS = 1500;

async function within<T>(read: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READ_BUDGET_MS);
  });
  try {
    return await Promise.race([read(), late]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function known(value: boolean | undefined): Known {
  return value === undefined ? "UNKNOWN" : value ? "YES" : "NO";
}

async function feedFact(
  session: ApiSession,
  context: OwnContext,
): Promise<Known> {
  if (context.kind === "INVESTOR") {
    const slate = await within(() => discoverCompanies(session, { limit: 1 }));
    return known(slate === undefined ? undefined : slate.items.length > 0);
  }
  if (context.kind === "FOUNDER") {
    const slate = await within(() => discoverInvestors(session, { limit: 1 }));
    return known(slate === undefined ? undefined : slate.items.length > 0);
  }
  return "UNKNOWN";
}

async function pitchFact(
  session: ApiSession,
  context: OwnContext,
): Promise<Known> {
  if (context.kind !== "FOUNDER") return "UNKNOWN";
  const view = await within(() => getCompanyPitch(session, context.companyId));
  return known(view === undefined ? undefined : view.pitch !== null);
}

async function deckFact(
  session: ApiSession,
  context: OwnContext,
): Promise<DeckFact> {
  if (context.kind !== "FOUNDER") return { kind: "UNKNOWN" };
  const { qApiBaseUrl } = loadWebServerConfig();
  const [artifacts, documents] = await Promise.all([
    // Q artifacts live on the Q API, under the same access token.
    qApiBaseUrl === undefined
      ? Promise.resolve(undefined)
      : within(() =>
          listQArtifacts(
            { baseUrl: qApiBaseUrl, accessToken: session.accessToken },
            { subjectId: context.companyId, limit: 20 },
          ),
        ),
    within(() => listDocuments(session, { companyId: context.companyId })),
  ]);
  const prepared = artifacts?.items.find(
    (item) => item.type === "PITCH_DECK" && item.status === "READY",
  );
  if (prepared !== undefined) {
    return { kind: "PREPARED", artifactId: prepared.artifactId };
  }
  const uploaded = documents?.documents.some(
    (document) =>
      document.documentType === "PITCH_DECK" && document.status === "ACTIVE",
  );
  if (uploaded === true) return { kind: "UPLOADED" };
  // "No deck" only when both places answered and neither holds one.
  return artifacts !== undefined && documents !== undefined
    ? { kind: "NONE" }
    : { kind: "UNKNOWN" };
}

/**
 * Where an unfinished setup stands (A: "says naturally where they left
 * off"): the parts the session holds as settled, in the journey's own
 * group names, and the question Q is still waiting on, verbatim from the
 * interview thread the server kept. Read with the same rules the setup
 * screen uses, so Home and the interview describe one state one way.
 */
async function setupFacts(
  session: ApiSession,
  journey: "founder" | "investor",
): Promise<SetupFacts | undefined> {
  const view = await within(() =>
    getCurrentOnboardingSession(session, journey),
  );
  if (view === undefined || view.session.status !== "ACTIVE") {
    return undefined;
  }
  const thread = await within(() =>
    listOnboardingInterviewTurns(session, view.session.id, 5),
  );
  const vocabulary =
    journey === "investor" ? INVESTOR_VOCABULARY : FOUNDER_VOCABULARY;
  const covered = progressLines(view, vocabulary)
    .filter((line) => line.total > 0 && line.done === line.total)
    .map((line) => line.label);
  return {
    covered,
    pending:
      thread === undefined
        ? null
        : pendingQuestion(thread.items, view.session.lastActivityAt),
  };
}

export async function resolveReturningFacts(
  context: OwnContext,
  unfinished: ReturningFacts["unfinished"],
): Promise<ReturningFacts> {
  const session = await apiSession();
  if (session === null) {
    return {
      context,
      unfinished,
      name: null,
      feed: "UNKNOWN",
      pitch: "UNKNOWN",
      deck: { kind: "UNKNOWN" },
    };
  }
  const [me, signedUpWith, feed, pitch, deck, setup] = await Promise.all([
    within(() => fetchMe(session)),
    accountDetails(),
    feedFact(session, context),
    pitchFact(session, context),
    deckFact(session, context),
    unfinished === null
      ? Promise.resolve(undefined)
      : setupFacts(session, unfinished),
  ]);
  return {
    context,
    unfinished,
    // The name they gave at sign-up, until the profile holds one of its
    // own: a person who never passed through the first-run welcome was
    // being greeted as a stranger ("Welcome back.") by a product that
    // knew what to call them.
    name: me?.user.displayName ?? signedUpWith.displayName,
    feed,
    pitch,
    deck,
    setup,
  };
}
