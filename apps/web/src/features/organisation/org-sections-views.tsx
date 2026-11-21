import Link from "next/link";
import type { ReactNode } from "react";

import type {
  GatewayAppearanceDto,
  GatewayDto,
  GoogleConnectionDto,
  InboundEmailAddressDto,
  KybDto,
  MyEtiquetteGuideDto,
  VerificationProvidersDto,
} from "@capital-q/contracts";

import {
  AccountCard,
  GroupHead,
  SRow,
} from "@/features/settings/account-layout";
import { accountButton } from "@/features/settings/account-styles";

/**
 * Organisation admin sections built from what already exists (owner
 * decision 112; admin design 2026-11-19 §2.2). Each line is the server's
 * own answer, read as the person; a read that failed says so, and nothing
 * here claims a connection or a setting that is not there. These views
 * only draw: every change happens on the screen that already makes it,
 * and the API refuses anyone who may not make it.
 */

type T = (english: string) => string;

/** A state in words, never colour alone. */
function State({
  tone,
  children,
}: {
  readonly tone: "ok" | "off" | "unknown";
  readonly children: ReactNode;
}) {
  return (
    <span
      className="text-[13px] font-medium text-(--cq-text-secondary)"
      data-org-state={tone}
    >
      {children}
    </span>
  );
}

function Go({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} className={accountButton("secondary", "sm")}>
      {children}
    </Link>
  );
}

const UNREAD = "Couldn't be read just now.";

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const KYB_WORDS: Readonly<Record<KybDto["standing"], string>> = {
  NOT_REQUESTED: "Not requested",
  PENDING: "Being reviewed",
  VERIFIED: "Verified",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
};

const GOOGLE_WORDS: Readonly<Record<GoogleConnectionDto["status"], string>> = {
  UNAVAILABLE: "Not available on Capital Q yet",
  NOT_CONNECTED: "Not connected",
  CONNECTED: "Connected",
  REVOKED: "Disconnected by Google",
};

export function OrgConnectionsView({
  t,
  kyb,
  providers,
  google,
  inbound,
}: {
  readonly t: T;
  /** Null: could not be read. */
  readonly kyb: KybDto | null;
  readonly providers: VerificationProvidersDto | null;
  readonly google: GoogleConnectionDto | null;
  readonly inbound: InboundEmailAddressDto | null;
}) {
  return (
    <>
      <GroupHead title={t("Verification")} />
      <AccountCard data-org-connections="verification">
        <SRow
          title={t("Verify you and the organisation")}
          description={t(
            "The organisation's business verification, reviewed by Capital Q.",
          )}
        >
          {kyb === null ? (
            <State tone="unknown">{t(UNREAD)}</State>
          ) : (
            <State tone={kyb.standing === "VERIFIED" ? "ok" : "off"}>
              {t(KYB_WORDS[kyb.standing])}
            </State>
          )}
          <Go href="/verification">{t("Open verification")}</Go>
        </SRow>
        {providers === null ? (
          <SRow title={t("Verification providers")}>
            <State tone="unknown">{t(UNREAD)}</State>
          </SRow>
        ) : (
          providers.providers.map((provider) => (
            <SRow
              key={provider.provider}
              title={provider.label}
              description={provider.covers}
            >
              <State tone={provider.connected ? "ok" : "off"}>
                {provider.connected ? t("Connected") : t("Not connected")}
              </State>
            </SRow>
          ))
        )}
      </AccountCard>

      <GroupHead
        title={t("Your own connections")}
        note={t("Each person connects their own")}
      />
      <AccountCard data-org-connections="personal">
        <SRow
          title={t("Google: email and calendar")}
          description={
            google?.status === "CONNECTED"
              ? `${google.email ?? ""}${
                  google.calendar === undefined
                    ? ""
                    : ` · ${
                        google.calendar === "GRANTED"
                          ? t("Calendar connected")
                          : t("Calendar not granted")
                      }`
                }`
              : undefined
          }
        >
          {google === null ? (
            <State tone="unknown">{t(UNREAD)}</State>
          ) : (
            <State tone={google.status === "CONNECTED" ? "ok" : "off"}>
              {t(GOOGLE_WORDS[google.status])}
            </State>
          )}
          <Go href="/settings#connections">{t("Open your connections")}</Go>
        </SRow>
        <SRow
          title={t("Q's email address")}
          description={t("Forward email to Q; it files what arrives.")}
        >
          {inbound === null ? (
            <State tone="unknown">{t(UNREAD)}</State>
          ) : inbound.status === "ACTIVE" ? (
            <State tone="ok">{inbound.address}</State>
          ) : (
            <State tone="off">{t("Not available on Capital Q yet")}</State>
          )}
        </SRow>
      </AccountCard>

      <GroupHead title={t("CRM")} />
      <AccountCard data-org-connections="crm">
        <SRow
          title={t("CRM import")}
          description={t(
            "From a CRM or spreadsheet export. There is no live CRM connection.",
          )}
        >
          <State tone="off">{t("Not connected")}</State>
          <Go href="/organisation/import">{t("Open Import")}</Go>
        </SRow>
      </AccountCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// How Q speaks for us
// ---------------------------------------------------------------------------

export function OrgSpeakingView({
  t,
  guide,
}: {
  readonly t: T;
  /** Null: could not be read. */
  readonly guide: MyEtiquetteGuideDto | null;
}) {
  return (
    <>
      <GroupHead title={t("The guide Q follows now")} />
      <AccountCard data-org-speaking="house">
        <SRow
          title={t("Capital Q's house guide")}
          description={t(
            "How Q writes and speaks for everyone, unless a person has their own guide.",
          )}
        >
          {guide === null ? (
            <State tone="unknown">{t(UNREAD)}</State>
          ) : (
            <State tone="ok">
              {guide.house.title}
              {guide.house.source === "BUILT_IN"
                ? ` · ${t("Built in")}`
                : ` · ${guide.house.version}`}
            </State>
          )}
        </SRow>
        <SRow
          title={t("Your own guide")}
          description={t("Yours only: how Q writes and speaks for you.")}
        >
          {guide === null ? (
            <State tone="unknown">{t(UNREAD)}</State>
          ) : guide.guide === null ? (
            <State tone="off">{t("None")}</State>
          ) : (
            <State tone="ok">{guide.guide.fileName ?? t("Pasted text")}</State>
          )}
          <Go href="/settings#speaking">{t("Open your guide")}</Go>
        </SRow>
      </AccountCard>
      <p
        className="mt-3 max-w-[70ch] cq-body-sm text-(--cq-text-secondary)"
        data-org-speaking="none"
      >
        {t(
          "An organisation-wide guide isn't built yet: Capital Q doesn't store one, so nothing here can be changed and nothing is saved.",
        )}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gateway and Q Card brand: the gateways' own appearance
// ---------------------------------------------------------------------------

export function OrgGatewayBrandRows({
  t,
  gateways,
}: {
  readonly t: T;
  /** Null: could not be read; empty: none. Each with its appearance, or null. */
  readonly gateways:
    | readonly {
        readonly gateway: GatewayDto;
        readonly appearance: GatewayAppearanceDto | null;
      }[]
    | null;
}) {
  return (
    <>
      <GroupHead title={t("GateQ gateways")} />
      <AccountCard data-org-brand="gateways">
        {gateways === null ? (
          <SRow title={t("Gateways")}>
            <State tone="unknown">{t(UNREAD)}</State>
          </SRow>
        ) : gateways.length === 0 ? (
          <SRow
            title={t("No gateway yet")}
            description={t(
              "A gateway's look is set on the gateway itself in GateQ.",
            )}
          >
            <Go href="/gateq">{t("Open GateQ")}</Go>
          </SRow>
        ) : (
          gateways.map(({ gateway, appearance }) => (
            <SRow
              key={gateway.id}
              title={appearance?.displayName ?? gateway.name}
              description={
                appearance === null
                  ? t(UNREAD)
                  : appearance.revision === 0
                    ? t("Capital Q's own look")
                    : `${
                        appearance.accentHex === null
                          ? t("Capital Q's colours")
                          : `${t("Accent")} ${appearance.accentHex}`
                      } · ${appearance.logo === null ? t("No logo") : t("Logo set")}`
              }
            >
              <Go href="/gateq">{t("Open GateQ")}</Go>
            </SRow>
          ))
        )}
      </AccountCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Privacy: what is a person's own, linked rather than moved
// ---------------------------------------------------------------------------

export function OrgPrivacyLinks({ t }: { readonly t: T }) {
  return (
    <>
      <GroupHead
        title={t("Each person's own")}
        note={t("Set by each person")}
      />
      <AccountCard data-org-privacy="personal">
        <SRow
          title={t("Your Q Card")}
          description={t(
            "Which of your card's fields show, and to whom: Capital Q members or anyone with the link.",
          )}
        >
          <Go href="/profile">{t("Open your profile")}</Go>
        </SRow>
      </AccountCard>
    </>
  );
}
