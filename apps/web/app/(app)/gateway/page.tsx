import type { Metadata } from "next";

import {
  getGatewayPolicy,
  listGatewayApplications,
  listGateways,
} from "@capital-q/api-client";
import type { GatewayApplicationDto } from "@capital-q/contracts";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import { formatDay } from "@/components/date-format";
import {
  CopyButton,
  OpenGatewayButton,
} from "@/features/gateq/gateway-controls";
import { PolicyEditor } from "@/features/gateq/policy-editor";
import { publicGateway } from "@/features/gateq/public-gateway";
import { appOrigin } from "@/features/q-card/public-card-data";
import { qrSvg } from "@/features/q-card/qr";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Gateway" };
export const dynamic = "force-dynamic";

const ACCESS_WORDS: Readonly<Record<string, string>> = {
  MAY_APPLY: "Fits",
  MAY_NOT_APPLY: "Not a fit",
  NEEDS_INFORMATION: "Partial",
};

const DIMENSION_WORDS: Readonly<Record<string, string>> = {
  TAXONOMY: "Sector",
  EXCLUDED_TAXONOMY: "Excluded sectors",
  GEOGRAPHY: "Geography",
  STAGE: "Stage",
  RAISE_SIZE: "Raise size",
  CHEQUE_COMPATIBILITY: "Cheque size",
};

/**
 * GateQ in the wild (GateQ spec §1, §7): the investor organisation's own
 * gateway -- one link, a QR code, a snippet for their website -- and the
 * applications it has received. Founders apply by talking to Q.
 */
export default async function GatewayPage() {
  const context = await resolveOwnContext();
  const session = await apiSession();
  if (context.kind !== "INVESTOR" || session === null) {
    return (
      <PageContainer>
        <PageHeader title="Gateway" />
        <p className="cq-body text-(--cq-text-secondary)">
          A gateway belongs to an investor organisation.
        </p>
      </PageContainer>
    );
  }
  const gateways = await listGateways(session, context.investorOrganisationId)
    .then((result) => result.gateways)
    .catch(() => []);
  const gateway = gateways.find((item) => item.status === "ACTIVE") ?? null;
  const published =
    gateway === null ? null : await publicGateway(gateway.publicId);

  if (gateway === null || published === null) {
    return (
      <PageContainer>
        <PageHeader
          title="Gateway"
          description="Founders apply to you by talking to Q, from a link, a QR code or your own website."
        />
        <OpenGatewayButton />
      </PageContainer>
    );
  }

  const origin = appOrigin();
  const link = `${origin}/g/${gateway.publicId}`;
  // P7: one line on any website; a "Do we fit? Ask Q" launcher.
  const snippet = `<script src="${origin}/gateq.js" data-gate="${gateway.publicId}" async></script>`;
  const policy = await getGatewayPolicy(session, gateway.id).catch(() => null);
  const rules = policy?.version.status === "PUBLISHED" ? policy.criteria : [];
  const applications: readonly GatewayApplicationDto[] =
    await listGatewayApplications(session, gateway.id)
      .then((result) => result.applications)
      .catch(() => []);

  return (
    <PageContainer>
      <PageHeader
        title="Gateway"
        description="Q checks founders against your mandate on your own website, and tells them whether they fit."
      />
      <div className="flex flex-col gap-10">
        <PageSection id="rules" title="Your rules">
          <div className="flex flex-col gap-6">
            {rules.length === 0 ? (
              <p className="cq-body text-(--cq-text-secondary)">
                No rules yet: every founder can share. Give Q your mandate and
                it drafts them.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex items-baseline justify-between gap-3 py-2.5"
                  >
                    <span className="cq-body text-(--cq-text-primary)">
                      {rule.label}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {DIMENSION_WORDS[rule.config.type] ?? rule.config.type} ·{" "}
                      {rule.requiredness === "REQUIRED"
                        ? "Required"
                        : "Preferred"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <PolicyEditor hasRules={rules.length > 0} />
          </div>
        </PageSection>

        <PageSection id="share" title="Share">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <div
              className="size-40 shrink-0 rounded-2xl bg-(--cq-surface) p-2 text-(--cq-text-primary)"
              aria-label="QR code for your gateway"
              role="img"
              // Server-rendered SVG from our own encoder, no user markup.
              dangerouslySetInnerHTML={{ __html: qrSvg(link) }}
            />
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-2">
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cq-body break-all text-(--cq-text-primary) hover:underline"
                >
                  {link}
                </a>
                <div>
                  <CopyButton text={link} label="Copy link" />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className="cq-caption text-(--cq-text-secondary)">
                  On your website: paste once, before the closing body tag
                </span>
                <code className="cq-caption block rounded-xl bg-(--cq-surface-subtle) p-3 break-all text-(--cq-text-primary)">
                  {snippet}
                </code>
                <div>
                  <CopyButton text={snippet} label="Copy snippet" />
                </div>
              </div>
            </div>
          </div>
        </PageSection>

        <PageSection id="preview" title="Preview">
          <div className="flex flex-col gap-2">
            <p className="cq-body-sm text-(--cq-text-secondary)">
              What a founder sees when they press &ldquo;Do we fit? Ask
              Q&rdquo; on your website. Trying it here starts a real, anonymous
              conversation.
            </p>
            <iframe
              src={`/g/${gateway.publicId}/embed`}
              title="Preview of your fit check"
              loading="lazy"
              className="h-[640px] w-full max-w-[400px] rounded-2xl border border-(--cq-border-subtle)"
            />
          </div>
        </PageSection>

        <PageSection id="applications" title="Founders who shared">
          {applications.length === 0 ? (
            <p className="cq-body text-(--cq-text-secondary)">
              None yet. Founders appear here only when they choose to share
              with you after their fit check.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-(--cq-border-subtle)">
              {applications.map((item) => (
                <li
                  key={item.applicationId}
                  className="flex flex-col gap-1 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="cq-body text-(--cq-text-primary)">
                      {item.application.declaredName ?? "A company"}
                    </span>
                    <span className="cq-caption text-(--cq-text-secondary)">
                      {ACCESS_WORDS[item.application.access] ??
                        item.application.access}{" "}
                      · {formatDay(item.submittedAt.slice(0, 10))}
                    </span>
                  </div>
                  {item.application.facts.length === 0 ? null : (
                    <p className="cq-body-sm text-(--cq-text-secondary)">
                      {item.application.facts
                        .slice(0, 4)
                        .map((fact) => fact.summary)
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}
