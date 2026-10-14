import { createHash } from "node:crypto";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  IntakeRefusedError,
  type IntakeService,
} from "@capital-q/gateq-intake";
import type { AuthenticatedPrincipal } from "@capital-q/security";

/** Contact ownership is an identity proof, never organisation membership. */
export type ConfirmedContactIdentity = {
  readonly userId: string;
  readonly email: string;
};
export type ApplicationContactProof = {
  readonly applicationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly emailHash: string;
  readonly confirmedAt: string;
};
export type ApplicationContactStore = {
  readonly read: (
    applicationId: string,
    tenantId: string,
  ) => Promise<ApplicationContactProof | null>;
  /** The first actual identity stays the owner; email may change for that identity. */
  readonly confirm: (proof: ApplicationContactProof) => Promise<boolean>;
};
export type GateqContactResult =
  | { readonly status: "VERIFIED"; readonly confirmedAt: string }
  | {
      readonly status:
        | "CONTACT_INCOMPLETE"
        | "EMAIL_NOT_VERIFIED"
        | "EMAIL_MISMATCH"
        | "OWNER_MISMATCH";
    };

const normalizedEmail = (email: string) => email.trim().toLowerCase();
const emailHash = (email: string) =>
  createHash("sha256").update(normalizedEmail(email)).digest("hex");

export function createGateqContactService(dependencies: {
  readonly intake: Pick<IntakeService, "authorise" | "factsFor">;
  readonly store: ApplicationContactStore;
  /** Fresh verified Auth email + canonical active, unsuspended profile. No metadata claims. */
  readonly identity: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ConfirmedContactIdentity | null>;
  readonly now?: () => Date;
}) {
  const now = dependencies.now ?? (() => new Date());
  return {
    confirm: async (
      token: string,
      principal: AuthenticatedPrincipal,
    ): Promise<GateqContactResult> => {
      const guest = await dependencies.intake.authorise(token);
      if (guest.application.status === "SUBMITTED")
        throw new IntakeRefusedError("ALREADY_SUBMITTED");
      const facts = await dependencies.intake.factsFor(token);
      const text = (dimension: string) => {
        const fact = facts.find(
          (f) =>
            f.dimension === dimension &&
            f.supersededAt === null &&
            f.provenance !== "UNKNOWN",
        );
        return fact?.value.kind === "TEXT" ? fact.value.text.trim() : "";
      };
      if (
        ["contact.name", "contact.email", "contact.role", "company.name"].some(
          (d) => text(d) === "",
        )
      )
        return { status: "CONTACT_INCOMPLETE" };
      const identity = await dependencies.identity(principal);
      if (identity === null) return { status: "EMAIL_NOT_VERIFIED" };
      if (
        normalizedEmail(text("contact.email")) !==
        normalizedEmail(identity.email)
      )
        return { status: "EMAIL_MISMATCH" };
      const proof: ApplicationContactProof = {
        applicationId: guest.application.id,
        tenantId: guest.application.tenantId,
        userId: identity.userId,
        emailHash: emailHash(identity.email),
        confirmedAt: now().toISOString(),
      };
      if (!(await dependencies.store.confirm(proof)))
        return { status: "OWNER_MISMATCH" };
      return { status: "VERIFIED", confirmedAt: proof.confirmedAt };
    },
  };
}

export function createPostgresApplicationContactStore(
  sql: DatabaseExecutor,
): ApplicationContactStore {
  return {
    read: async (applicationId, tenantId) => {
      const rows = await sql<
        {
          application_id: string;
          tenant_id: string;
          user_id: string;
          email_hash: string;
          confirmed_at: Date;
        }[]
      >`
        select application_id,tenant_id,user_id,email_hash,confirmed_at from gateq.application_contact_confirmations
        where application_id=${applicationId} and tenant_id=${tenantId} limit 1`;
      const r = rows[0];
      return r === undefined
        ? null
        : {
            applicationId: r.application_id,
            tenantId: r.tenant_id,
            userId: r.user_id,
            emailHash: r.email_hash,
            confirmedAt: r.confirmed_at.toISOString(),
          };
    },
    confirm: async (proof) => {
      const rows = await sql<{ application_id: string }[]>`
        insert into gateq.application_contact_confirmations(application_id,tenant_id,user_id,email_hash,confirmed_at)
        select a.id,a.tenant_id,${proof.userId},${proof.emailHash},${proof.confirmedAt} from gateq.applications a
        where a.id=${proof.applicationId} and a.tenant_id=${proof.tenantId} and a.status in ('IN_PROGRESS','READY_TO_SUBMIT')
        on conflict(application_id) do update set email_hash=excluded.email_hash,confirmed_at=excluded.confirmed_at
        where application_contact_confirmations.user_id=excluded.user_id and application_contact_confirmations.tenant_id=excluded.tenant_id
        returning application_id`;
      return rows.length === 1;
    },
  };
}
