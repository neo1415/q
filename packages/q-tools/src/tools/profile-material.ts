import { z } from "zod";

import {
  CompanyDeckViewSchema,
  DataRoomViewSchema,
  DeckCoachingSchema,
  DeckSectionSchema,
  UuidSchema,
  type CompanyDeckView,
  type DataRoomView,
  type InvestorQuestion,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import type { QToolExecutionContext } from "@capital-q/q-runtime";
import { actorWideScope, boundScopeFor } from "../plan.js";

/**
 * A company's data room and pitch deck, for Q (overnight plan A8).
 *
 * Each tool reads through the same service the profile's tabs call, AS the
 * person, so Q sees exactly what their screen would and nothing more: an
 * investor gets only the titles their data room shows them and Q's deck
 * sections only once the founder confirmed them; coaching is the founder's
 * own and only through coach_my_deck. The plan must also admit the company
 * (the Context Firewall decides before the service is asked).
 */

export const READ_COMPANY_DECK = "company.deck.read" as const;
export const READ_COMPANY_DATA_ROOM = "company.data_room.read" as const;
export const COACH_MY_DECK = "deck.coaching.read" as const;

export type ProfileMaterialPort = {
  readonly dataRoom: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<DataRoomView | null>;
  readonly deck: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<CompanyDeckView | null>;
  /** The actor's own company, from their membership on the server. */
  readonly ownCompanyId: (actor: ActorContext) => Promise<string | null>;
  /**
   * 2026-10-08: an investor's own questions to the company and the
   * founder's answers (null: not an investor). Absent: the board shows no
   * questions.
   */
  readonly askedQuestions?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<readonly InvestorQuestion[] | null>)
    | undefined;
  /**
   * R0: the data-room documents this person may know exist at a company,
   * as the Data room tab authorises them, with what helps find one by
   * meaning (its type, and the opening of its extracted text where they
   * may open it). Absent: no document is found or read by Q.
   */
  readonly documents?:
    | ((
        actor: ActorContext,
        companyId: string,
      ) => Promise<readonly MaterialDocument[] | null>)
    | undefined;
  /**
   * R0: one document's extracted text, for a person who may open it now
   * (re-authorised by the implementation through the same data-room
   * view); null when they may not, or nothing was extracted.
   */
  readonly documentText?:
    | ((
        actor: ActorContext,
        companyId: string,
        documentId: string,
      ) => Promise<{
        readonly text: string;
        readonly truncated: boolean;
      } | null>)
    | undefined;
  /**
   * Q room W3 (R3): pages `from`..`to` (1-based, inclusive) of one
   * document's text, for a person who may open it now (re-authorised the
   * same way as documentText). `pageCount` is how many pages have text;
   * 0 for a document with no page text (scanned, or not paged). Null when
   * they may not open it.
   */
  readonly documentPages?:
    | ((
        actor: ActorContext,
        companyId: string,
        documentId: string,
        range: { readonly from: number; readonly to: number },
      ) => Promise<{
        readonly pageCount: number;
        readonly pages: readonly {
          readonly page: number;
          readonly text: string;
        }[];
      } | null>)
    | undefined;
};

/** One data-room document as Q may find it (R0). */
export type MaterialDocument = {
  readonly documentId: string;
  readonly title: string;
  readonly folder: string;
  /** The evidence document type ("CERTIFICATE_OF_INCORPORATION"); null: unknown. */
  readonly documentType: string | null;
  /** OPEN or OWNER may be opened and read; the rest only named. */
  readonly access: "OPEN" | "OWNER" | "REQUESTABLE" | "REQUESTED";
  readonly pageCount: number | null;
  readonly updatedAt: string;
  /** The first words of its extracted text, only where it may be opened. */
  readonly opening: string | null;
};

const CompanyInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The canonical company identifier (UUID), as given in the conversation context.",
    ),
  })
  .strict();
type CompanyInput = z.infer<typeof CompanyInputSchema>;

/** The plan admits this company: bound to it, a subject of the run, or the actor-wide network scope. */
export function planAdmits(
  context: QToolExecutionContext,
  companyId: string,
): boolean {
  const { plan } = context;
  if (
    boundScopeFor(
      plan,
      "COMPANY_PROFILE",
      (filter) => filter.companyId === companyId,
    ) !== undefined
  ) {
    return true;
  }
  if (
    plan.subjects.some(
      (subject) =>
        subject.kind === "COMPANY" && subject.companyId === companyId,
    )
  ) {
    return true;
  }
  return actorWideScope(plan, "NETWORK_VISIBLE_DATA") !== undefined;
}

const DeckOutputSchema = z
  .object({
    viewer: z.enum(["INVESTOR", "OWNER"]),
    deck: CompanyDeckViewSchema.shape.deck,
    /** Q's reading, in the standard twelve; facts are the deck's claims. */
    sections: z.array(DeckSectionSchema).max(12),
    confirmedByFounder: z.boolean(),
    truthClass: z.literal("USER_CLAIM"),
  })
  .strict();

export function createReadCompanyDeckTool(
  port: ProfileMaterialPort,
): AnyQToolDefinition {
  return defineQTool<
    CompanyInput,
    z.infer<typeof DeckOutputSchema>,
    CompanyDeckView
  >({
    id: READ_COMPANY_DECK,
    version: 1,
    status: "ACTIVE",
    providerName: "read_company_deck",
    description:
      "Reads a company's pitch deck as Q read it into twelve standard sections (problem, solution, value proposition, market, go-to-market, business model, traction, competition, financials, the ask, founders, team), with slide numbers, exactly as the person's Pitch deck tab shows it. Figures are the company's own claims. Returns an error when the deck is not available to them.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE", "NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: CompanyInputSchema,
    output: DeckOutputSchema,
    authorize: async (input, context) => {
      if (!planAdmits(context, input.companyId)) return deny("NOT_AVAILABLE");
      const view = await port
        .deck(context.actor, input.companyId)
        .catch(() => null);
      if (view === null || view.deck === null) return deny("NOT_AVAILABLE");
      return allow("CONFIDENTIAL", CompanyDeckViewSchema.parse(view));
    },
    execute: (_input, _context, view) =>
      Promise.resolve({
        viewer: view.viewer,
        deck: view.deck,
        sections: view.extraction?.sections ?? [],
        confirmedByFounder: view.extraction?.confirmed ?? false,
        truthClass: "USER_CLAIM",
      }),
  });
}

const DataRoomOutputSchema = z
  .object({
    viewer: z.enum(["INVESTOR", "OWNER"]),
    documents: z
      .array(
        z
          .object({
            title: z.string(),
            folder: z.string(),
            /** In words: open to you, on request, requested, shared with you; owner: its level. */
            status: z.string(),
          })
          .strict(),
      )
      .max(500),
    openRequests: z.number().int().min(0),
  })
  .strict();

export function createReadCompanyDataRoomTool(
  port: ProfileMaterialPort,
): AnyQToolDefinition {
  return defineQTool<
    CompanyInput,
    z.infer<typeof DataRoomOutputSchema>,
    DataRoomView
  >({
    id: READ_COMPANY_DATA_ROOM,
    version: 1,
    status: "ACTIVE",
    providerName: "read_company_data_room",
    description:
      "Lists a company's data room exactly as the person's Data room tab shows it: for an investor, only the documents open to them or listed on request (never a title they may not see) and whether they asked; for the company's own team, every document with who can see it and the open requests. Titles only, never contents.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE", "NETWORK_VISIBLE_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: CompanyInputSchema,
    output: DataRoomOutputSchema,
    authorize: async (input, context) => {
      if (!planAdmits(context, input.companyId)) return deny("NOT_AVAILABLE");
      const view = await port
        .dataRoom(context.actor, input.companyId)
        .catch(() => null);
      return view === null
        ? deny("NOT_AVAILABLE")
        : allow("CONFIDENTIAL", DataRoomViewSchema.parse(view));
    },
    execute: (_input, _context, view) => {
      const folder = new Map(view.folders.map((f) => [f.code, f.label]));
      if (view.viewer === "INVESTOR") {
        const words = {
          OPEN: "open to you",
          REQUESTABLE: "on request",
          REQUESTED: "you asked; waiting",
        } as const;
        return Promise.resolve({
          viewer: "INVESTOR" as const,
          documents: view.documents.map((d) => ({
            title: d.title,
            folder: folder.get(d.folderCode) ?? d.folderCode,
            status:
              d.shownAs === "SHARED" ? "shared with you" : words[d.access],
          })),
          openRequests: view.documents.filter((d) => d.access === "REQUESTED")
            .length,
        });
      }
      const levels = {
        PUBLIC: "public",
        ON_REQUEST: "on request",
        SHARED_ONLY: "shared only",
        PRIVATE: "private",
      } as const;
      return Promise.resolve({
        viewer: "OWNER" as const,
        documents: view.documents.map((d) => ({
          title: d.title,
          folder: folder.get(d.folderCode) ?? d.folderCode,
          status: `${levels[d.level]}; opened by ${String(d.openedBy)}`,
        })),
        openRequests: view.requests.filter((r) => r.status === "OPEN").length,
      });
    },
  });
}

const CoachOutputSchema = z
  .object({
    deckTitle: z.string(),
    coaching: DeckCoachingSchema,
    /** Never shown to investors and never used to rank or match. */
    privateToYou: z.literal(true),
  })
  .strict();

export function createCoachMyDeckTool(
  port: ProfileMaterialPort,
): AnyQToolDefinition {
  return defineQTool<
    Record<string, never>,
    z.infer<typeof CoachOutputSchema>,
    { title: string; coaching: z.infer<typeof DeckCoachingSchema> }
  >({
    id: COACH_MY_DECK,
    version: 1,
    status: "ACTIVE",
    providerName: "coach_my_deck",
    description:
      "Reads the coaching for the person's own pitch deck: each of the twelve sections scored 0-5 against the same rubric for every company, what is missing or weak, how to improve it, and whether the deck meets the minimum standard. The founder's alone: never shown to investors, never used to rank or match.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "GENERAL_QUESTION",
      "ACTION_PREPARATION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "REVIEWING_COMPANY",
    input: z.object({}).strict(),
    output: CoachOutputSchema,
    authorize: async (_input, context) => {
      const companyId = await port
        .ownCompanyId(context.actor)
        .catch(() => null);
      if (companyId === null) return deny("NOT_AVAILABLE");
      const view = await port.deck(context.actor, companyId).catch(() => null);
      if (
        view === null ||
        view.viewer !== "OWNER" ||
        view.deck === null ||
        view.coaching === null
      ) {
        return deny("NOT_AVAILABLE", "Q hasn't read a deck of yours yet.");
      }
      return allow("CONFIDENTIAL", {
        title: view.deck.title,
        coaching: view.coaching,
      });
    },
    execute: (_input, _context, grant) =>
      Promise.resolve({
        deckTitle: grant.title,
        coaching: grant.coaching,
        privateToYou: true as const,
      }),
  });
}

export function createProfileMaterialTools(
  port: ProfileMaterialPort | undefined,
): readonly AnyQToolDefinition[] {
  return port === undefined
    ? []
    : [
        createReadCompanyDeckTool(port),
        createReadCompanyDataRoomTool(port),
        createCoachMyDeckTool(port),
      ];
}
