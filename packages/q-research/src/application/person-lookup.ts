import type {
  ExternalPersonSource,
  ExternalPersonSubject,
  PersonBrief,
  PersonSearchResult,
} from "@capital-q/contracts/q";

import {
  aliasKeyOf,
  knownEntityResult,
  type KnownEntityIndex,
  type KnownEntityRecord,
} from "./known-entities.js";
import {
  briefFromKnownEntity,
  type ResearchedEntityScope,
} from "./person-brief-service.js";
import type { PersonSearchCommand, PersonSearchRun } from "./person-search.js";

/**
 * The one entry point for "find this person or organisation" and for
 * "research them further" (W2).
 *
 * Order, by cost: the known-entity index first (a prepared entity answers
 * with no web call and, warm, no database round trip), then the fast web
 * search. A web search for something already known happens only when the
 * member explicitly asks for a fresh one.
 */

export type PersonLookupCommand = PersonSearchCommand & {
  /** The member asked for a fresh search (any words, read by the turn reader). */
  readonly freshSearch?: boolean | undefined;
};

export type PersonLookupOutcome = {
  readonly result: PersonSearchResult;
  /** Where the answer came from; the web is the only path that costs. */
  readonly source: "KNOWN_ENTITY" | "WEB";
  readonly known: KnownEntityRecord | null;
  /** Present only for a web search. */
  readonly run: PersonSearchRun | null;
};

export type PersonBriefRequest = {
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly externalPersonId?: string | undefined;
  /** Search again and build a new brief version. */
  readonly refresh?: boolean | undefined;
  readonly userText?: string | undefined;
  readonly signal?: AbortSignal | undefined;
};

export type PersonBriefResult =
  | {
      readonly status: "OK";
      readonly brief: PersonBrief;
      readonly reused: boolean;
      readonly subject: { readonly displayName: string };
    }
  | { readonly status: "NOT_FOUND" };

export type PersonLookup = {
  readonly find: (command: PersonLookupCommand) => Promise<PersonLookupOutcome>;
  readonly brief: (request: PersonBriefRequest) => Promise<PersonBriefResult>;
};

/** What the Q API composes: stored, scoped records and the brief builder. */
export type ResearchedEntityReader = {
  readonly find: (
    scope: ResearchedEntityScope,
    by: { readonly externalPersonId?: string; readonly aliasKey?: string },
  ) => Promise<{
    readonly subject: ExternalPersonSubject;
    readonly sources: readonly ExternalPersonSource[];
  } | null>;
  readonly remember: (
    scope: ResearchedEntityScope,
    input: {
      readonly profileKey: string;
      readonly subject: ExternalPersonSubject;
      readonly sources: readonly ExternalPersonSource[];
    },
  ) => Promise<unknown>;
};

export function createPersonLookup(dependencies: {
  readonly known: KnownEntityIndex;
  readonly search: {
    readonly search: (command: PersonSearchCommand) => Promise<PersonSearchRun>;
  };
  readonly researched?: ResearchedEntityReader | undefined;
  readonly briefs?:
    | {
        readonly brief: (command: {
          readonly scope: ResearchedEntityScope;
          readonly subject: ExternalPersonSubject;
          readonly sources: readonly ExternalPersonSource[];
          readonly refresh?: boolean | undefined;
          readonly signal?: AbortSignal | undefined;
        }) => Promise<{
          readonly brief: PersonBrief;
          readonly reused: boolean;
        }>;
      }
    | undefined;
  /** Called, not awaited, after a web match: persistence and enrichment. */
  readonly afterWebMatch?:
    | ((input: {
        readonly scope: ResearchedEntityScope;
        readonly run: PersonSearchRun;
      }) => Promise<void>)
    | undefined;
  readonly onError?: ((error: unknown, what: string) => void) | undefined;
  readonly clock?: (() => number) | undefined;
}): PersonLookup {
  const now = dependencies.clock ?? (() => Date.now());

  const find = async (
    command: PersonLookupCommand,
  ): Promise<PersonLookupOutcome> => {
    if (command.freshSearch !== true) {
      const started = now();
      // The name with its place ("Shadi Qishta Doha") is itself an alias.
      const tries = [
        command.name,
        ...(command.place ? [`${command.name} ${command.place}`] : []),
      ];
      for (const query of tries) {
        const found = await dependencies.known.resolve(query);
        if (found.kind === "FOUND") {
          const result = knownEntityResult(found.record, now() - started);
          if (result !== null) {
            return {
              result,
              source: "KNOWN_ENTITY",
              known: found.record,
              run: null,
            };
          }
        }
        if (found.kind === "SEVERAL") {
          return {
            result: {
              outcome: "AMBIGUOUS",
              card: null,
              candidates: found.records.map((record) => ({
                displayName: record.displayName,
                profileUrl: record.profileUrl,
                role: record.role,
                organization: record.organization,
                location: record.location,
                confidence: record.confidence,
              })),
              clarifyingQuestion:
                `I know more than one match for ${command.name}: ${found.records
                  .map((record) => record.displayName)
                  .join("; ")}. Which one do you mean?`.slice(0, 240),
              elapsedMs: now() - started,
            },
            source: "KNOWN_ENTITY",
            known: null,
            run: null,
          };
        }
      }
    }
    const run = await dependencies.search.search(command);
    if (run.result.outcome === "MATCHED" && dependencies.afterWebMatch) {
      const after = dependencies.afterWebMatch;
      // The card is already built; persistence and enrichment never delay it.
      void after({
        scope: { tenantId: command.tenantId, userId: command.userId },
        run,
      }).catch((error: unknown) =>
        dependencies.onError?.(error, "person enrichment"),
      );
    }
    return { result: run.result, source: "WEB", known: null, run };
  };

  const brief = async (
    request: PersonBriefRequest,
  ): Promise<PersonBriefResult> => {
    const scope = { tenantId: request.tenantId, userId: request.userId };
    const known = await dependencies.known.resolve(request.name);
    if (known.kind === "FOUND" && request.refresh !== true) {
      return {
        status: "OK",
        brief: briefFromKnownEntity(known.record, new Date(now())),
        reused: true,
        subject: { displayName: known.record.displayName },
      };
    }
    const stored =
      dependencies.researched === undefined
        ? null
        : await dependencies.researched.find(scope, {
            ...(request.externalPersonId === undefined
              ? {}
              : { externalPersonId: request.externalPersonId }),
            aliasKey: aliasKeyOf(request.name),
          });
    let target = stored;
    if (target === null || request.refresh === true) {
      // Nothing stored (or a fresh read was asked for): identify again,
      // keep the match for this asker, then build from it.
      const outcome = await find({
        tenantId: scope.tenantId,
        userId: scope.userId,
        name: request.name,
        userText: request.userText ?? request.name,
        freshSearch: true,
        signal: request.signal,
      });
      const card = outcome.result.card;
      if (card === null) return { status: "NOT_FOUND" };
      target = { subject: card.subject, sources: card.sources };
      const profileKey = outcome.run?.profileKey ?? null;
      if (profileKey !== null && dependencies.researched !== undefined) {
        await dependencies.researched.remember(scope, {
          profileKey,
          subject: card.subject,
          sources: card.sources,
        });
      }
    }
    if (dependencies.briefs === undefined) return { status: "NOT_FOUND" };
    const built = await dependencies.briefs.brief({
      scope,
      subject: target.subject,
      sources: target.sources,
      refresh: request.refresh,
      signal: request.signal,
    });
    return {
      status: "OK",
      brief: built.brief,
      reused: built.reused,
      subject: { displayName: target.subject.displayName },
    };
  };

  return { find, brief };
}
