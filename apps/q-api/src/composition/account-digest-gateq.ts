import type {
  AccountDigestGateq,
  AccountDigestInbox,
  GateqInboxDto,
  GateqInboxView,
} from "@capital-q/contracts";
import type { FounderApplication } from "@capital-q/gateq-intake";
import type { AccountDigestGateqPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * Owner 14 Nov 2026: GateQ's part of the account digest, read through
 * GateQ's own reads and authority exactly as the person's GateQ pages read
 * it: a founder's own submitted applications (their GateQ page, by their
 * user id), an investor's own gateway inbox (the inbox's authority decides
 * whether they may see it at all). Counts and names only: no answers,
 * dossier, notes, labels or assignee reach Q from here.
 */

const clip = (text: string, max: number): string =>
  text.replace(/\s+/gu, " ").trim().slice(0, max);

/** A founder's applications as the digest holds them, newest first. */
export function founderApplicationsDigestOf(
  applications: readonly FounderApplication[],
): {
  readonly applications: AccountDigestGateq["applications"];
  readonly total: number;
} {
  return {
    applications: applications.slice(0, 6).map((application) => ({
      applicationId: application.applicationId,
      fund: clip(application.fund, 120) || "an investor",
      status: application.status,
      sentAt: new Date(application.sentAt).toISOString(),
      replyBy:
        application.replyBy === null ? null : clip(application.replyBy, 40),
    })),
    total: applications.length,
  };
}

/** An investor's inbox, counted; the few that need judgement first. */
export function inboxDigestOf(inbox: GateqInboxDto): AccountDigestInbox {
  const open = inbox.items.filter(
    (item) => item.folder === "INBOX" && item.replyState !== "ANSWERED",
  );
  // A running reply promise is a judgement owed; overdue first.
  const owed = open
    .filter((item) => item.replyState !== "NONE")
    .sort(
      (a, b) =>
        (a.daysLeft ?? Number.MAX_SAFE_INTEGER) -
        (b.daysLeft ?? Number.MAX_SAFE_INTEGER),
    );
  const count = (view: GateqInboxView): number => inbox.counts[view];
  return {
    gatewayName: clip(inbox.gateway.name, 120) || "Your gateway",
    unread: count("INBOX"),
    fits: count("FITS"),
    partial: count("PARTIAL"),
    notAFit: count("NOT_A_FIT"),
    needsJudgement: owed.length,
    top: (owed.length > 0 ? owed : open).slice(0, 3).map((item) => ({
      applicationId: item.applicationId,
      companyName: clip(item.companyName, 120) || "A company",
      fit: item.fit,
      daysLeft: item.daysLeft,
    })),
  };
}

export function createAccountDigestGateq(dependencies: {
  readonly founders: {
    readonly listFor: (
      actor: ActorContext,
    ) => Promise<readonly FounderApplication[]>;
  };
  readonly inbox: {
    readonly ownGatewayId: (actor: ActorContext) => Promise<string | null>;
    readonly list: (
      actor: ActorContext,
      gatewayId: string,
      view: GateqInboxView,
    ) => Promise<GateqInboxDto | { readonly ok: false }>;
  };
}): AccountDigestGateqPort {
  return {
    founderApplications: async (actor) =>
      founderApplicationsDigestOf(
        actor.actorType === "HUMAN"
          ? await dependencies.founders.listFor(actor)
          : [],
      ),
    investorInbox: async (actor) => {
      const gatewayId = await dependencies.inbox.ownGatewayId(actor);
      if (gatewayId === null) return null;
      const inbox = await dependencies.inbox.list(actor, gatewayId, "INBOX");
      return "ok" in inbox ? null : inboxDigestOf(inbox);
    },
  };
}
