import type { Metadata } from "next";

import {
  getGatewayPolicy,
  getGateqInbox,
  getGateqInboxItem,
  listGateways,
  listMyGateqApplications,
  listClaimableCompanies,
} from "@capital-q/api-client";
import {
  GateqInboxViewSchema,
  type FounderApplicationDto,
  type GateqInboxDetailDto,
  type GateqInboxDto,
  type GatewayPolicyDto,
} from "@capital-q/contracts";

import { QPageState, QSection } from "@/features/q/q-section";
import { PageContainer } from "@/components/app-shell/page-container";
import { OpenGatewayButton } from "@/features/gateq/gateway-controls";
import {
  FounderApplications,
  ClaimView,
} from "@/features/gateq/page/founder-views";
import {
  ErrorBlock,
  GateqChrome,
  type GateqTab,
} from "@/features/gateq/page/gateq-chrome";
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
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("GateQ") };
}
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
  const t = await serverT();

  const params = await searchParams;
  // Side by side: the context resolves its own session read as well.
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);

  if (context.kind === "NONE" && context.unavailable === true) {
    return (
      <PageContainer>
        <ErrorBlock t={t} what="GateQ" retryHref="/gateq" />
      </PageContainer>
    );
  }

  if (context.kind !== "INVESTOR" || session === null) {
    const tab: GateqTab =
      one(params["tab"]) === "claim" ? "claim" : "applications";
    // F3 (2026-10-08): "Claim this company" from its page opens this tab
    // already searched for it.
    const claimQuery =
      tab === "claim" ? (one(params["q"]) ?? "").trim().slice(0, 120) : "";
    const claimResults =
      claimQuery.length < 2 || session === null
        ? []
        : await listClaimableCompanies(session, claimQuery)
            .then((result) => result.companies)
            .catch(() => []);
    const applications: readonly FounderApplicationDto[] | null =
      session === null || tab !== "applications"
        ? []
        : await listMyGateqApplications(session)
            .then((result) => result.applications)
            .catch(() => null);
    return (
      <PageContainer>
        <GateqChrome
          t={t}
          role="FOUNDER"
          active={tab}
          maxWidth={tab === "claim" ? 760 : 860}
        >
          {tab === "claim" ? (
            <ClaimView
              state="full"
              initialQuery={claimQuery}
              initialResults={claimResults}
            />
          ) : (
            // Lit by the founder track while Q explains the interview.
            <div data-qp-anchor="fdr.10.gateq.applications">
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
            </div>
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

  if (gateways === null) {
    return (
      <PageContainer>
        <GateqChrome t={t} role="INVESTOR" active={tab}>
          <ErrorBlock t={t} what="Your gate" retryHref={`/gateq?tab=${tab}`} />
        </GateqChrome>
      </PageContainer>
    );
  }

  if (gateway === null && tab !== "find") {
    return (
      <PageContainer>
        <GateqChrome t={t} role="INVESTOR" active={tab}>
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
          t={t}
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
    const [policy, published, inbox] = await Promise.all([
      getGatewayPolicy(session, gatewayId).catch(
        (): GatewayPolicyDto | null => null,
      ),
      publicGateway(gateway?.publicId ?? ""),
      getGateqInbox(session, gatewayId, "INBOX").catch(() => null),
    ]);
    const snippet = `<script src="${origin}/gateq.js" data-gate="${gateway?.publicId ?? ""}" async></script>`;
    const publishedPolicy =
      policy?.version.status === "PUBLISHED" ? policy : null;
    return (
      <PageContainer>
        <GateqChrome
          t={t}
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

  // Q room R2 / CRM record links: a deep link opens one application
  // (?item=) in WHICHEVER folder holds it (inbox, archived or passed), read
  // through the inbox's own authority. One they may not see is a clear "not
  // found", never the newest application opened silently in its place.
  const wantedRaw = one(params["item"]);
  const wanted =
    wantedRaw !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      wantedRaw,
    )
      ? wantedRaw.toLowerCase()
      : undefined;
  const explicitView = GateqInboxViewSchema.catch("INBOX").parse(
    one(params["view"]),
  );
  // Instant tabs (2026-10-18): the folder the address names is read beside
  // the linked application, not after it; it is read again only when the
  // application turns out to sit in another folder.
  const readInbox = (folder: typeof explicitView) =>
    getGateqInbox(session, gatewayId, folder).catch(
      (): GateqInboxDto | null => null,
    );
  const [wantedDetail, namedInbox] = await Promise.all([
    wanted === undefined
      ? null
      : getGateqInboxItem(session, gatewayId, wanted).catch(() => null),
    readInbox(explicitView),
  ]);
  const missingItem = wantedRaw !== undefined && wantedDetail === null;
  // The linked application's own folder wins, so the list holds it.
  const view = GateqInboxViewSchema.catch("INBOX").parse(
    wantedDetail?.item.folder ?? explicitView,
  );
  const inbox: GateqInboxDto | null =
    view === explicitView ? namedInbox : await readInbox(view);
  const first = wantedRaw === undefined ? inbox?.items[0] : undefined;
  const detail: GateqInboxDetailDto | null =
    wantedRaw !== undefined
      ? wantedDetail
      : first === undefined
        ? null
        : await getGateqInboxItem(
            session,
            gatewayId,
            first.applicationId,
          ).catch(() => null);
  return (
    <PageContainer>
      <GateqChrome
        t={t}
        role="INVESTOR"
        active="inbox"
        action={action}
        unread={inbox?.counts.INBOX}
      >
        {/* Q room R1: the inbox and the open application, by id, for Q. */}
        <QSection
          id="inbox"
          kind="GATEQ_INBOX"
          refs={(inbox?.items ?? []).slice(0, 12).map((item) => ({
            kind: "GATEQ_APPLICATION" as const,
            id: item.applicationId,
          }))}
          total={inbox?.items.length ?? 0}
          label={t(`${String(inbox?.items.length ?? 0)} applications`)}
        />
        {detail === null ? null : (
          <QPageState
            focus={{ kind: "GATEQ_APPLICATION", id: detail.item.applicationId }}
          />
        )}
        {missingItem ? (
          <p
            role="alert"
            className="cq-body-sm mb-4 border border-(--cq-border-subtle) px-4 py-3 text-(--cq-text-primary)"
            data-gateq-item-missing
          >
            {t(
              "That application isn't in your GateQ inbox, or you don't have access to it. Nothing else has been opened in its place.",
            )}
          </p>
        ) : null}
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
          missingItem={missingItem}
          gateLink={link}
          fund={context.label ?? "your firm"}
        />
      </GateqChrome>
    </PageContainer>
  );
}
