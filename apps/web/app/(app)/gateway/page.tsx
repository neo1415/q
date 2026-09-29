import type { Metadata } from "next";

import { listGatewayApplications, listGateways } from "@capital-q/api-client";
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
import { publicGateway } from "@/features/gateq/public-gateway";
import { appOrigin } from "@/features/q-card/public-card-data";
import { qrSvg } from "@/features/q-card/qr";
import { apiSession, resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Gateway" };
export const dynamic = "force-dynamic";

const ACCESS_WORDS: Readonly<Record<string, string>> = {
  MAY_APPLY: "Fits",
  MAY_NOT_APPLY: "Outside your rules",
  NEEDS_INFORMATION: "Needs more",
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
  const snippet = `<script src="${origin}/gateq-embed.js" data-gateway="${gateway.publicId}" async></script>`;
  const applications: readonly GatewayApplicationDto[] =
    await listGatewayApplications(session, gateway.id)
      .then((result) => result.applications)
      .catch(() => []);

  return (
    <PageContainer>
      <PageHeader title="Gateway" description={published.title} />
      <div className="flex flex-col gap-10">
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
                  On your website
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

        <PageSection id="applications" title="Applications">
          {applications.length === 0 ? (
            <p className="cq-body text-(--cq-text-secondary)">
              None yet. Share the link and they arrive here.
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
