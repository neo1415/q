import type { PersonSearchResult } from "@capital-q/contracts/q";

import {
  knownEntityResult,
  type KnownEntityIndex,
  type KnownEntityRecord,
} from "./known-entities.js";
import type { PersonSearchCommand, PersonSearchRun } from "./person-search.js";

/**
 * The one entry point for "find this person or organisation" (W2).
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

export type PersonLookup = {
  readonly find: (command: PersonLookupCommand) => Promise<PersonLookupOutcome>;
};

export function createPersonLookup(dependencies: {
  readonly known: KnownEntityIndex;
  readonly search: {
    readonly search: (command: PersonSearchCommand) => Promise<PersonSearchRun>;
  };
  readonly clock?: (() => number) | undefined;
}): PersonLookup {
  const now = dependencies.clock ?? (() => Date.now());
  return {
    find: async (command) => {
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
      return { result: run.result, source: "WEB", known: null, run };
    },
  };
}
