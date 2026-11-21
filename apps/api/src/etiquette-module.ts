import type {
  EtiquetteGuidePort,
  OrganisationEtiquettePort,
} from "@capital-q/app-actions";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createEtiquetteGuideAdminStore,
  type EtiquetteGuideAdminStore,
} from "@capital-q/platform-admin";
import { houseEtiquetteOf } from "@capital-q/q-core";
import {
  createPostgresEtiquetteGuideStore,
  createPostgresOrganisationEtiquetteStore,
} from "@capital-q/q-runtime";
import { capability, type AuthorizationService } from "@capital-q/security";

/**
 * The business etiquette guides (ADR 0050; owner decision 112), composed
 * for the API: a person's own, the console's house guide and, since
 * decision 112, the organisation's own ("How Q speaks for us"), which only
 * its owners and admins change (organisation.admin, asked on every write).
 */
export type EtiquetteModule = {
  readonly guides: EtiquetteGuidePort;
  readonly adminStore: EtiquetteGuideAdminStore;
  readonly organisation: OrganisationEtiquettePort;
};

export function createEtiquetteModule(dependencies: {
  readonly database: {
    readonly sql: DatabaseExecutor;
    readonly transactions: TransactionManager;
  };
  readonly authorization: Pick<AuthorizationService, "authorize">;
}): EtiquetteModule {
  const { sql, transactions } = dependencies.database;
  const adminStore = createEtiquetteGuideAdminStore({ sql, transactions });
  const house = async () => houseEtiquetteOf(await adminStore.active());
  return {
    adminStore,
    guides: {
      ...createPostgresEtiquetteGuideStore({ sql, transactions }),
      house,
    },
    organisation: {
      ...createPostgresOrganisationEtiquetteStore({ sql, transactions }),
      house,
      mayManage: async (actor) =>
        actor.organisationId !== undefined &&
        (
          await dependencies.authorization.authorize({
            actor,
            capability: capability("organisation.admin"),
            resource: {
              kind: "ORGANISATION",
              tenantId: actor.tenantId,
              organisationId: actor.organisationId,
            },
          })
        ).outcome === "ALLOW",
    },
  };
}
