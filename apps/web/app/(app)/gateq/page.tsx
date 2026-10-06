import type { Metadata } from "next";

import {
  getGatewayPolicy,
  getGateqInbox,
  getGateqInboxItem,
  listGateways,
  listMyGateqApplications,
} from "@capital-q/api-client";
import {
  GateqInboxViewSchema,
  type FounderApplicationDto,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GatewayPolicyDto,
} from "@capital-q/contracts";

import { PageContainer } from "@/components/app-shell/page-container";
import { OpenGatewayButton } from "@/features/gateq/gateway-controls";
import {
  FounderApplications,
  ClaimView,
} from "@/features/gateq/page/founder-views";
import { GateqChrome, type GateqTab } from "@/features/gateq/page/gateq-chrome";
import { CopyLink, InboxView } from "@/features/gateq/page/inbox-view";
import {
  FindView,
  GateEmpty,
  GateView,
} from "@/features/gateq/page/investor-views";
import { PolicyEditor } from "@/features/gateq/policy-editor";
import { publicGateway } from "@/features/gateq/public-gateway";
import { appOrigin } from "@/features/q-card/public-card-data";
import { qrSvg } from "@/features/q-card/qr";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "GateQ" };
export const dynamic = "force-dynamic";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * GateQ, its own page in the sidebar (F2, 2026-10-06). A founder checks
 * their fit against investors' gates and sees what came back, and finds
 * their company to claim. An investor works their gate's inbox, finds
 * startups, and runs their gate. Every read is the API's, under GateQ's own
 * gateway authority; the screen decides nothing.
 */
export default async function GateqPage({ searchParams }: Props) {
  const params = await searchParams;
  const context = await resolveOwnContext();
  const session = await apiSession();

  if (context.kind !== "INVESTOR" || session === null) {
    const tab: GateqTab =
      one(params["tab"]) === "claim" ? "claim" : "applications";
    const applications: readonly FounderApplicationDto[] | null =
      session === null || tab !== "applications"
        ? []
        : await listMyGateqApplications(session)
            .then((result) => result.applications)
            .catch(() => null);
    return (
      <PageContainer>
        <GateqChrome
          role="FOUNDER"
          active={tab}
          maxWidth={tab === "claim" ? 760 : 860}
        >
          {tab === "claim" ? (
            <ClaimView state="full" />
          ) : (
            <FounderApplications
              state={
                applications === null
                  ? "error"
                  : applications.length === 0
                    ? "empty"
                    : "full"
              }
              applications={applications ?? []}
            />
          )}
        </GateqChrome>
      </PageContainer>
    );
  }

  const requested = one(params["tab"]);
  const tab: GateqTab =
    requested === "find" || requested === "gate" ? requested : "inbox";
  const gateways = await listGateways(session, context.investorOrganisationId)
    .then((result) => result.gateways)
    .catch(() => null);
  const gateway = gateways?.find((item) => item.status === "ACTIVE") ?? null;
  const origin = appOrigin();
  const link = gateway === null ? "" : `${origin}/g/${gateway.publicId}`;

  if (gateway === null && tab !== "find") {
    return (
      <PageContainer>
        <GateqChrome role="INVESTOR" active={tab}>
          <GateEmpty onOpen={<OpenGatewayButton />} />
        </GateqChrome>
      </PageContainer>
    );
  }

  const action = gateway === null ? undefined : <CopyLink text={link} />;

  if (tab === "find") {
    return (
      <PageContainer>
        <GateqChrome
          role="INVESTOR"
          active="find"
          action={action}
          maxWidth={900}
        >
          <FindView state="full" />
        </GateqChrome>
      </PageContainer>
    );
  }

  // Narrowed above: only the find tab renders without a gateway.
  const gatewayId = gateway?.id ?? "";

  if (tab === "gate") {
    const [policy, published] = await Promise.all([
      getGatewayPolicy(session, gatewayId).catch(
        (): GatewayPolicyDto | null => null,
      ),
      publicGateway(gateway?.publicId ?? ""),
    ]);
    const inbox = await getGateqInbox(session, gatewayId, "INBOX").catch(
      () => null,
    );
    const snippet = `<script src="${origin}/gateq.js" data-gate="${gateway?.publicId ?? ""}" async></script>`;
    const publishedPolicy =
      policy?.version.status === "PUBLISHED" ? policy : null;
    return (
      <PageContainer>
        <GateqChrome
          role="INVESTOR"
          active="gate"
          action={action}
          maxWidth={900}
          unread={inbox?.counts.INBOX}
        >
          <GateView
            state={policy === null && published === null ? "error" : "full"}
            gatewayId={gatewayId}
            policy={publishedPolicy}
            link={link}
            snippet={snippet}
            qr={qrSvg(link)}
            replyWithinDays={
              published?.replyWithinDays ??
              inbox?.gateway.replyWithinDays ??
              null
            }
            canDecide={inbox?.viewer.canDecide ?? false}
            editor={
              <PolicyEditor
                hasRules={(publishedPolicy?.criteria.length ?? 0) > 0}
              />
            }
          />
        </GateqChrome>
      </PageContainer>
    );
  }

  const view = GateqInboxViewSchema.catch("INBOX").parse(one(params["view"]));
  const inbox: GateqInboxDto | null = await getGateqInbox(
    session,
    gatewayId,
    view,
  ).catch(() => null);
  const first = inbox?.items[0];
  const detail: GateqInboxDetailDto | null =
    first === undefined
      ? null
      : await getGateqInboxItem(session, gatewayId, first.applicationId).catch(
          () => null,
        );
  return (
    <PageContainer>
      <GateqChrome
        role="INVESTOR"
        active="inbox"
        action={action}
        unread={inbox?.counts.INBOX}
      >
        <InboxView
          inbox={inbox}
          state={
            inbox === null
              ? "error"
              : inbox.items.length === 0 && view === "INBOX"
                ? "empty"
                : "full"
          }
          initialDetail={detail}
          gateLink={link}
          fund={context.label ?? "your firm"}
        />
      </GateqChrome>
    </PageContainer>
  );
}
