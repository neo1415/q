import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  COMPANIES_PATH,
  COMPANY_DATA_ROOM_OPEN_SEGMENT,
  COMPANY_DATA_ROOM_SEGMENT,
  COMPANY_DECK_OPEN_SEGMENT,
  COMPANY_DECK_SEGMENT,
  COMPANY_FOUNDER_SEGMENT,
  CompanyDeckViewSchema,
  DataRoomOpenDtoSchema,
  DataRoomViewSchema,
  FounderPersonDtoSchema,
  UuidSchema,
  parseContract,
  type FounderPersonDto,
} from "@capital-q/contracts";
import { DocumentNotFoundError } from "@capital-q/evidence";
import type {
  CompanyDeckService,
  DataRoomService,
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
