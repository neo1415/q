import {
  buildMeetingSnapshot,
  type HostParty,
  type MeetingContextSnapshot,
  type SnapshotFact,
  type SnapshotSources,
} from "@capital-q/communication";
import {
  CompanyDeckViewSchema,
  DataRoomInvestorViewSchema,
} from "@capital-q/contracts";
import type { CompanyKnowledgePort } from "@capital-q/discovery";
import type { MandateLabels } from "@capital-q/q-specialists";
import type { ActorContext } from "@capital-q/security";

import type { WorkingSnapshots } from "./working-snapshot.js";

/**
 * The Meeting Context Snapshot, built before Q joins (founder ask P3).
 *
 * Every read goes through a service that already applies the Context
 * Firewall's scoping for its viewer: the company as the INVESTOR sees it
 * (CompanyKnowledgePort.companies), the investor's mandate (mandateSummary,
 * the investor's own), each side's own working snapshot, and the data room
 * and deck views as the investor's view shows them. This module reads no
 * table. Each side's private layer is read AS that side's actor, so one
 * side's actor is never used to read the other side's record.
 *
 * Assumption flagged for the lead: the published mandate (sector,
 * geography, stage range, cheque range) is treated as shared with the
 * founder in a booked call; the discovery mode, excluded sectors, hard
 * exclusions and deployment state stay INVESTOR_PRIVATE.
 */

export type MeetingSnapshotContext = {
  readonly meetingId: string;
  readonly purpose: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly parties: readonly HostParty[];
  readonly companyId: string | null;
  /** The organisation each invited person acts for, from the booking's read. */
  readonly organisationIdOf: (userId: string) => string | null;
};

export type MeetingSnapshotDependencies = {
  readonly ownerActor: (
    userId: string,
    organisationId: string | null,
  ) => Promise<ActorContext | null>;
  readonly knowledge: CompanyKnowledgePort;
  readonly workingSnapshots: WorkingSnapshots;
  readonly labels: MandateLabels;
  /** The data room as the actor's view shows it (the investor's: disclosed). */
  readonly dataRoom?:
    ((actor: ActorContext, companyId: string) => Promise<unknown>) | undefined;
  /** The deck as the actor's view shows it (the investor sees confirmed sections). */
  readonly deck?:
    ((actor: ActorContext, companyId: string) => Promise<unknown>) | undefined;
};

const names = (
  labels: MandateLabels,
  codes: readonly string[],
  max = 6,
): string =>
  codes
    .slice(0, max)
    .map((code) => labels.code(code) ?? code.replace(/_/g, " "))
    .join(", ");

const money = (
  min: string | null,
  max: string | null,
  currency: string | null,
): string | null =>
  min === null && max === null
    ? null
    : `${min ?? "?"} to ${max ?? "?"}${currency === null ? "" : ` ${currency}`}`;

export function createMeetingSnapshotBuilder(
  dependencies: MeetingSnapshotDependencies,
) {
  const { knowledge, workingSnapshots, labels } = dependencies;

  return async (
    context: MeetingSnapshotContext,
    revision = 1,
  ): Promise<MeetingContextSnapshot> => {
    const founder = context.parties.find((p) => p.side === "FOUNDER");
    const investor = context.parties.find((p) => p.side === "INVESTOR");
    const actorOf = async (party: HostParty | undefined) =>
      party === undefined
        ? null
        : await dependencies.ownerActor(
            party.userId,
            context.organisationIdOf(party.userId),
          );

    // Both actors are resolved once, from membership, now: a suspended or
    // removed person resolves to nothing and so reads nothing.
    const investorActor = actorOf(investor);
    const founderActor = actorOf(founder);

    const sources: SnapshotSources = {
      shared: async () => {
        const facts: SnapshotFact[] = [
          {
            id: "meeting",
            topic: "MEETING",
            text: `Scheduled ${context.startsAt.toISOString()} to ${context.endsAt.toISOString()}`,
            source: "booking",
            truth: "VERIFIED",
          },
        ];
        const viewer = await investorActor;
        if (viewer !== null && context.companyId !== null) {
          // 2026-10-20: the company and the mandate are read together.
          const [companies, mandate] = await Promise.all([
            knowledge.companies(viewer, [context.companyId]),
            knowledge.mandateSummary(viewer),
          ]);
          const company = companies.get(context.companyId);
          if (company !== undefined) {
            const sector = names(labels, company.sectorCodes, 3);
            const stage =
              company.stageCode === null
                ? null
                : (labels.code(company.stageCode) ?? company.stageCode);
            facts.push({
              id: "company",
              topic: "COMPANY",
              text: [
                `${company.name}: ${company.shortDescription ?? company.description ?? "no description on file"}`,
                sector.length > 0 ? `Sector: ${sector}` : "",
                stage === null ? "" : `Stage: ${stage}`,
                company.countryCode === null
                  ? ""
                  : `Based in ${company.city === null ? "" : `${company.city}, `}${company.countryCode}`,
              ]
                .filter((part) => part.length > 0)
                .join(". "),
              source: "company profile (investor view)",
              truth:
                company.evidenceStatus === "SELF_REPORTED"
                  ? "USER_CLAIM"
                  : "UNKNOWN",
            });
          }
          if (mandate !== null) {
            const stages = [mandate.minStageCode, mandate.maxStageCode]
              .filter((s): s is string => s !== null)
              .map((s) => labels.code(s) ?? s);
            const cheque = money(
              mandate.minCheque,
              mandate.maxCheque,
              mandate.currencyCode,
            );
            facts.push({
              id: "mandate",
              topic: "MANDATE",
              text: [
                mandate.sectorCodes.length > 0
                  ? `Sectors: ${names(labels, mandate.sectorCodes)}`
                  : "",
                mandate.geographyCodes.length > 0
                  ? `Geographies: ${names(labels, mandate.geographyCodes)}`
                  : "",
                stages.length > 0 ? `Stages: ${stages.join(" to ")}` : "",
                cheque === null ? "" : `Cheque: ${cheque}`,
              ]
                .filter((part) => part.length > 0)
                .join(". "),
              source: `mandate v${String(mandate.mandateVersion)} (declared)`,
              truth: "USER_CLAIM",
            });
          }
        }
        return {
          agenda: context.purpose,
          participants: context.parties.map((p) => ({
            userId: p.userId,
            name: p.name,
            role: null,
            side: p.side,
            organisation: p.organisation,
          })),
          facts,
        };
      },

      disclosed: async () => {
        const viewer = await investorActor;
        if (viewer === null || context.companyId === null) {
          throw new Error("no investor view");
        }
        const facts: SnapshotFact[] = [];
        // 2026-10-20: the data room and the deck are read together.
        const companyId = context.companyId;
        const [roomView, deckView] = await Promise.all([
          dependencies.dataRoom?.(viewer, companyId),
          dependencies.deck?.(viewer, companyId),
        ]);
        if (dependencies.dataRoom !== undefined) {
          const room = DataRoomInvestorViewSchema.safeParse(roomView);
          if (room.success) {
            // Only what this investor may open now: shared or open to them.
            for (const document of room.data.documents.filter(
              (d) => d.access === "OPEN",
            )) {
              facts.push({
                id: `doc:${document.documentId}`,
                topic: "DOCUMENT",
                text: `Shared with the investor: ${document.title}`,
                source: "data room (investor view)",
                truth: "VERIFIED",
              });
            }
          }
        }
        if (dependencies.deck !== undefined) {
          const deck = CompanyDeckViewSchema.safeParse(deckView);
          if (deck.success && deck.data.extraction !== null) {
            for (const section of deck.data.extraction.sections) {
              if (
                section.status === "NOT_IN_DECK" ||
                section.summary === null
              ) {
                continue;
              }
              facts.push({
                id: `deck:${section.section}`,
                topic: "DECK",
                text: `${section.section.replace(/_/g, " ").toLowerCase()}: ${section.summary}`,
                source: `deck${section.pages.length > 0 ? ` p.${section.pages.join(",")}` : ""}`,
                // The deck's words are the company's claims, not verified.
                truth: "USER_CLAIM",
              });
            }
          }
        }
        return facts;
      },

      founderPrivate: async () => {
        const actor = await founderActor;
        if (actor === null) return [];
        const own = (await workingSnapshots.forActor(actor))?.company ?? null;
        return own === null
          ? []
          : [
              {
                id: "own-company",
                topic: "COMPANY",
                text: `Own record: ${own.name}${own.shortDescription === null ? "" : `, ${own.shortDescription}`}`,
                source: "own company record",
                truth: "USER_CLAIM",
              },
            ];
      },

      investorPrivate: async () => {
        const actor = await investorActor;
        if (actor === null) return [];
        const mandate =
          (await workingSnapshots.forActor(actor))?.mandate ?? null;
        if (mandate === null) return [];
        const facts: SnapshotFact[] = [];
        if (mandate.excludedSectorCodes.length > 0) {
          facts.push({
            id: "excluded",
            topic: "MANDATE",
            text: `Excluded sectors: ${names(labels, mandate.excludedSectorCodes)}`,
            source: "own mandate",
            truth: "USER_CLAIM",
          });
        }
        if (mandate.hardExclusions > 0) {
          facts.push({
            id: "hard-exclusions",
            topic: "MANDATE",
            text: `${String(mandate.hardExclusions)} hard exclusion(s) on the mandate`,
            source: "own mandate",
            truth: "USER_CLAIM",
          });
        }
        return facts;
      },
    };

    const snapshot = await buildMeetingSnapshot({
      meetingId: context.meetingId,
      sources,
      revision,
    });
    // Sources the composition has no read for are unknown, not empty.
    const missing = [
      ...(dependencies.deck === undefined ? ["deck_claims"] : []),
      ...(dependencies.dataRoom === undefined ? ["documents"] : []),
    ];
    return missing.length === 0
      ? snapshot
      : { ...snapshot, gaps: [...snapshot.gaps, ...missing] };
  };
}
