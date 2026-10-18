import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  AssumptionBoardDtoSchema,
  COMPANIES_PATH,
  COMPANY_ASSUMPTIONS_SEGMENT,
  COMPANY_DATA_ROOM_OPEN_SEGMENT,
  COMPANY_DATA_ROOM_SEGMENT,
  COMPANY_DECK_OPEN_SEGMENT,
  COMPANY_DECK_SEGMENT,
  COMPANY_FOUNDER_SEGMENT,
  COMPANY_QUESTIONS_SEGMENT,
  COMPANY_REQUESTS_SEGMENT,
  CompanyDeckViewSchema,
  DataRoomCodeSchema,
  DOCUMENT_ACCESS_PATH,
  DocumentAccessDtoSchema,
  FOLDER_ACCESS_PATH,
  FolderAccessDtoSchema,
  InvestorQuestionsDtoSchema,
  RequestInboxDtoSchema,
  DataRoomOpenDtoSchema,
  DataRoomViewSchema,
  FounderPersonDtoSchema,
  UuidSchema,
  parseContract,
  type FounderPersonDto,
} from "@capital-q/contracts";
import {
  buildAssumptionBoard,
  DocumentNotFoundError,
  withAskedQuestions,
} from "@capital-q/evidence";
import type {
  CompanyDeckService,
  DataRoomService,
  FounderRequestsService,
} from "@capital-q/permissions";
import type { ActorContext } from "@capital-q/security";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * A company profile's Data room, Pitch deck and founder tabs (overnight
 * plan A1, A3, A4, A7). Reads only: every change is a declared app action
 * (ADR 0040) with its own route in http/app-actions.ts.
 *
 *   GET /v1/companies/:companyId/data-room                         the room, for this reader
 *   GET /v1/companies/:companyId/data-room/documents/:documentId/open  a view-only read
 *   GET /v1/companies/:companyId/deck                              the deck and Q's sections
 *   GET /v1/companies/:companyId/deck/open                         the deck, inline
 *   GET /v1/companies/:companyId/founders/:position                a founder as a person
 *   GET /v1/companies/:companyId/requests                          the founder's requests inbox
 *   GET /v1/companies/:companyId/questions                         an investor's own questions
 *   GET /v1/data-room/documents/:documentId/access                 who can see one document
 *   GET /v1/companies/:companyId/data-room/folders/:folderCode/access  who can see a folder
 *
 * Each service decides the reader (owner, an investor the pitch rule
 * admits, nobody) and the projection; a reader it refuses gets the same
 * not-found as a company or document that does not exist.
 */

export type CompanyMaterialRoutesDependencies = ActorContextDependencies & {
  readonly dataRoom: Pick<DataRoomService, "view" | "open">;
  readonly companyDeck: Pick<CompanyDeckService, "view" | "open">;
  readonly founderPerson?:
    | ((
        actor: ActorContext,
        companyId: string,
        position: number,
      ) => Promise<FounderPersonDto | null>)
    | undefined;
  /** Founder documents (2026-10-08). Absent: those reads do not register. */
  readonly founderRequests?:
    | Pick<
        FounderRequestsService,
        "inbox" | "documentAccess" | "folderAccess" | "investorQuestions"
      >
    | undefined;
};

function uuidParam(request: FastifyRequest, name: string): string {
  return parseContract(
    UuidSchema,
    (request.params as Record<string, unknown>)[name],
    "The identifier is not valid.",
  );
}

export function registerCompanyMaterialRoutes(
  app: FastifyInstance,
  dependencies: CompanyMaterialRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const base = `${COMPANIES_PATH}/:companyId`;

  app.get(
    `${base}${COMPANY_DATA_ROOM_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const view = await dependencies.dataRoom.view(
        getActorContext(request),
        uuidParam(request, "companyId"),
      );
      if (view === null) throw new DocumentNotFoundError();
      void reply.header("Cache-Control", "no-store");
      return DataRoomViewSchema.parse(view);
    },
  );

  // A read: each call mints a fresh short-lived signed URL, never cached.
  app.get(
    `${base}${COMPANY_DATA_ROOM_OPEN_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const link = await dependencies.dataRoom.open({
        actor: getActorContext(request),
        companyId: uuidParam(request, "companyId"),
        documentId: uuidParam(request, "documentId"),
      });
      if (link === null) throw new DocumentNotFoundError();
      void reply.header("Cache-Control", "no-store");
      return DataRoomOpenDtoSchema.parse(link);
    },
  );

  app.get(
    `${base}${COMPANY_DECK_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const view = await dependencies.companyDeck.view(
        getActorContext(request),
        uuidParam(request, "companyId"),
      );
      if (view === null) throw new DocumentNotFoundError();
      void reply.header("Cache-Control", "no-store");
      return CompanyDeckViewSchema.parse(view);
    },
  );

  app.get(
    `${base}${COMPANY_DECK_OPEN_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const link = await dependencies.companyDeck.open(
        getActorContext(request),
        uuidParam(request, "companyId"),
      );
      if (link === null) throw new DocumentNotFoundError();
      void reply.header("Cache-Control", "no-store");
      return DataRoomOpenDtoSchema.parse(link);
    },
  );

  // Q.07: "Assumptions to test" and the evidence board. Built in code from
  // the deck view the deck service projected for THIS reader (only a
  // reading the founder confirmed, only where the deck is shared with
  // them); investors only, everyone else the same not-found.
  app.get(
    `${base}${COMPANY_ASSUMPTIONS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const view = await dependencies.companyDeck.view(
        getActorContext(request),
        uuidParam(request, "companyId"),
      );
      const board = view === null ? null : buildAssumptionBoard(view);
      if (board === null) throw new DocumentNotFoundError();
      // Their own questions and the founder's answers (2026-10-08).
      const asked =
        (await dependencies.founderRequests
          ?.investorQuestions(
            getActorContext(request),
            uuidParam(request, "companyId"),
          )
          .catch(() => null)) ?? [];
      void reply.header("Cache-Control", "no-store");
      return AssumptionBoardDtoSchema.parse(withAskedQuestions(board, asked));
    },
  );

  const requests = dependencies.founderRequests;
  if (requests !== undefined) {
    // The company's own team only; everyone else the same not-found.
    app.get(
      `${base}${COMPANY_REQUESTS_SEGMENT}`,
      { onRequest: withContext },
      async (request, reply) => {
        const inbox = await requests.inbox(
          getActorContext(request),
          uuidParam(request, "companyId"),
        );
        if (inbox === null) throw new DocumentNotFoundError();
        void reply.header("Cache-Control", "no-store");
        return RequestInboxDtoSchema.parse(inbox);
      },
    );
    // An investor's own questions to the company, with the answers.
    app.get(
      `${base}${COMPANY_QUESTIONS_SEGMENT}`,
      { onRequest: withContext },
      async (request, reply) => {
        const companyId = uuidParam(request, "companyId");
        const questions = await requests.investorQuestions(
          getActorContext(request),
          companyId,
        );
        if (questions === null) throw new DocumentNotFoundError();
        void reply.header("Cache-Control", "no-store");
        return InvestorQuestionsDtoSchema.parse({ companyId, questions });
      },
    );
    app.get(
      DOCUMENT_ACCESS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const access = await requests.documentAccess(
          getActorContext(request),
          uuidParam(request, "documentId"),
        );
        if (access === null) throw new DocumentNotFoundError();
        void reply.header("Cache-Control", "no-store");
        return DocumentAccessDtoSchema.parse(access);
      },
    );
    app.get(
      FOLDER_ACCESS_PATH,
      { onRequest: withContext },
      async (request, reply) => {
        const folderCode = DataRoomCodeSchema.safeParse(
          (request.params as Record<string, unknown>)["folderCode"],
        );
        if (!folderCode.success) throw new DocumentNotFoundError();
        const access = await requests.folderAccess(
          getActorContext(request),
          uuidParam(request, "companyId"),
          folderCode.data,
        );
        if (access === null) throw new DocumentNotFoundError();
        void reply.header("Cache-Control", "no-store");
        return FolderAccessDtoSchema.parse(access);
      },
    );
  }

  const founderPerson = dependencies.founderPerson;
  if (founderPerson !== undefined) {
    app.get(
      `${base}${COMPANY_FOUNDER_SEGMENT}`,
      { onRequest: withContext },
      async (request, reply) => {
        const position = Number(
          (request.params as Record<string, unknown>)["position"],
        );
        if (!Number.isInteger(position) || position < 1 || position > 20)
          throw new DocumentNotFoundError();
        const person = await founderPerson(
          getActorContext(request),
          uuidParam(request, "companyId"),
          position,
        );
        if (person === null) throw new DocumentNotFoundError();
        void reply.header("Cache-Control", "no-store");
        return FounderPersonDtoSchema.parse(person);
      },
    );
  }
}
