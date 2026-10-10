import {
  IdentityCardSchema,
  type IdentityCard,
  type QResultBlock,
} from "@capital-q/contracts";
import { identityCardBlock } from "@capital-q/model-gateway/q";
import {
  aliasKeyOf,
  cardFromKnownEntity,
  type KnownEntityIndex,
  type ResearchedEntityReader,
} from "@capital-q/q-research";
import type { QAnswerRequest } from "@capital-q/q-runtime";
import type { SpecialistQAnswerDependencies } from "@capital-q/q-specialists";

/**
 * W4: a name that is none of the asker's relationships but is a researched
 * entity they can already reach: a prepared public seed (the known-entity
 * index, warm and database-free), or one of their own researched records.
 * Answers with its identity card ready to show. Never a web search: a
 * stranger is found only by the person search, which says so.
 */
export function createExternalEntityFinder(dependencies: {
  readonly known: Pick<KnownEntityIndex, "resolve">;
  readonly researched: Pick<ResearchedEntityReader, "find">;
}): NonNullable<SpecialistQAnswerDependencies["externalEntities"]> {
  return {
    find: async (request: QAnswerRequest, name: string) => {
      const asked = name.trim();
      if (asked.length < 3) return null;
      let card: IdentityCard | null = null;
      const known = await dependencies.known.resolve(asked);
      if (known.kind === "FOUND") card = cardFromKnownEntity(known.record);
      if (card === null && known.kind === "NONE") {
        // The asker's own researched records only (tenant AND user scoped).
        const own = await dependencies.researched.find(
          { tenantId: request.tenantId, userId: request.actor.userId },
          { aliasKey: aliasKeyOf(asked) },
        );
        if (own !== null && own.sources.length > 0) {
          const parsed = IdentityCardSchema.safeParse({
            entityKind: own.subject.entityKind,
            subject: own.subject,
            sources: own.sources.slice(0, 8),
            uncertainty: [],
            enriching: false,
            actions: ["RESEARCH_FURTHER", "REHEARSE"],
          });
          card = parsed.success ? parsed.data : null;
        }
      }
      if (card === null) return null;
      const block = identityCardBlock(card);
      if (block === null) return null;
      const blocks: QResultBlock[] = [block];
      return {
        externalPersonId: card.subject.externalPersonId,
        displayName: card.subject.displayName,
        said: `Here's ${card.subject.displayName}, from public sources. The card and its sources are on screen; I can research further or set up a rehearsal.`,
        blocks,
      };
    },
  };
}
