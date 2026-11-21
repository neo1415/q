import type { Metadata } from "next";

import {
  getGatewayAppearance,
  getQBrandKit,
  listGateways,
} from "@capital-q/api-client";

import { BrandKitPanel } from "@/features/documents/brand-kit-panel";
import { serverT } from "@/features/i18n/server";
import { orgAdminContext } from "@/features/organisation/org-admin-context";
import { OrgReadOnly } from "@/features/organisation/org-admin-shell";
import { OrgGatewayBrandRows } from "@/features/organisation/org-sections-views";
import {
  apiSession,
  qApiSession,
  resolveOwnContext,
} from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";

export const metadata: Metadata = {
  title: "Gateway and Q Card brand · Organisation",
};
export const dynamic = "force-dynamic";

/**
 * Organisation → Gateway and Q Card brand (owner decision 112): the
 * organisation's brand kit (the colours and logo its documents are drawn
 * in), the same panel Documents shows, and each GateQ gateway's own look.
 * A member sees them read-only; the API refuses their changes too (brand
 * kit: organisation.admin; a gateway's look: its own admin rule).
 */
export default async function OrganisationBrandPage() {
  const t = await serverT();
  const context = await orgAdminContext();
  if (context === null) return null;
  const [session, qSession, own] = await Promise.all([
    apiSession(),
    qApiSession(),
    resolveOwnContext(),
  ]);
  const [brand, gateways] = await Promise.all([
    qSession === null ? null : getQBrandKit(qSession).catch(() => null),
    session === null || own.kind !== "INVESTOR"
      ? Promise.resolve(undefined)
      : listGateways(session, own.investorOrganisationId)
          .then((list) =>
            Promise.all(
              list.gateways.map(async (gateway) => ({
                gateway,
                appearance: await getGatewayAppearance(
                  session,
                  gateway.id,
                ).catch(() => null),
              })),
            ),
          )
          .catch(() => null),
  ]);
  return (
    <OrgReadOnly readOnly={!context.canManage}>
      <AccountColumn>
        <QSection id="brand" kind="OTHER" label={t("the organisation's brand")}>
          <AccountHead
            title={t("Gateway and Q Card brand")}
            sub={t(
              "The organisation's brand on its GateQ gateway and Q Cards.",
            )}
          />
          <BrandKitPanel initial={brand} />
          {gateways === undefined ? null : (
            <OrgGatewayBrandRows t={t} gateways={gateways} />
          )}
        </QSection>
      </AccountColumn>
    </OrgReadOnly>
  );
}
