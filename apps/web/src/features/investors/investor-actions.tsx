"use client";

import Link from "next/link";
import { useState } from "react";

import { RequestToConnect } from "@/features/network/request-to-connect";
import {
  CrmSheet,
  CrmToastProvider,
  crmButton,
} from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import { LogoTile } from "./match-marks";

/**
 * The actions under an investor's name (app prototype "investor", option
 * 2): the one way forward, then Rehearse. In touch already, the record
 * leads; otherwise "Request to connect" opens a short sheet that says what
 * they will see and sends only on the founder's press, server-confirmed.
 * A Connection Request carries no message on Capital Q (ADR 0023): the
 * sheet says what travels instead of offering a note box.
 */
export function InvestorActions({
  investorOrganisationId,
  investorName,
  photoUrl,
  lead,
  recordHref,
  rehearseHref,
}: {
  readonly investorOrganisationId: string;
  readonly investorName: string;
  readonly photoUrl: string | null;
  /** From the canonical relationship: the record, or a request. */
  readonly lead: "REQUEST" | "OPEN" | "ANSWER";
  readonly recordHref: string;
  readonly rehearseHref: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <CrmToastProvider>
      <div
        className="-mt-1.5 mb-3.5 flex flex-wrap items-center gap-2.5"
        data-investor-actions
        data-qp-anchor="fdr.04.investor.connect"
      >
        {lead === "REQUEST" ? (
          <button
            type="button"
            className={crmButton("primary", "px-4 text-sm")}
            onClick={() => setOpen(true)}
            data-open-request
          >
            {t("Request to connect")}
          </button>
        ) : (
          <Link
            href={recordHref}
            className={crmButton("primary", "px-4 text-sm")}
          >
            {lead === "ANSWER" ? t("Answer their interest") : t("Open in CRM")}
          </Link>
        )}
        <Link
          href={rehearseHref}
          className={crmButton("secondary", "px-4 text-sm")}
        >
          {t("Rehearse")}
        </Link>
      </div>
      <CrmSheet
        open={open}
        onOpenChange={setOpen}
        title={t("Request to connect")}
        sub={`${t("To")} ${investorName}`}
        avatar={
          <LogoTile
            kind="investor"
            name={investorName}
            src={photoUrl}
            investorOrganisationId={investorOrganisationId}
          />
        }
        charcoal
        data-request-sheet
      >
        <p className="text-sm leading-normal text-(--cq-text-secondary)">
          {t(
            "They see your company profile and what it shares with investors on Capital Q. Accepting connects you; it isn’t an investment.",
          )}
        </p>
        <p className="cq-caption text-(--cq-text-tertiary)">
          {t(
            "A request carries no message on Capital Q. Once they accept, messages open in your CRM.",
          )}
        </p>
        {open ? (
          <RequestToConnect
            investorOrganisationId={investorOrganisationId}
            investorName={investorName}
          />
        ) : null}
      </CrmSheet>
    </CrmToastProvider>
  );
}
