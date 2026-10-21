"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type {
  ConnectionRequestDto,
  ConnectionStatusDto,
} from "@capital-q/contracts";
import { Clock } from "@capital-q/ui/icons";

import { formatDay } from "@/components/date-format";
import {
  ProgressButton,
  crmButton,
  useCrmToast,
} from "@/features/relationships/crm-kit";
import { useT } from "@/features/i18n/language";

import {
  connectionStatusAction,
  requestConnectionAction,
  type ConnectionActionResult,
} from "./connection-actions";

/**
 * "Request to connect" in a sheet (ADR 0023; app prototypes "investors"
 * and "investor"). Where the company already stands is read when the
 * sheet opens: a request already sent says so (and how it was answered),
 * an investor who does not take requests says why in their own terms, and
 * otherwise the one press sends it. "Request sent" is shown only from the
 * server's answer, with one idempotency key per intended request.
 */

export type ConnectPorts = {
  readonly status: (
    investorOrganisationId: string,
  ) => Promise<ConnectionActionResult<ConnectionStatusDto>>;
  readonly send: typeof requestConnectionAction;
};

const LIVE: ConnectPorts = {
  status: connectionStatusAction,
  send: requestConnectionAction,
};

const NOT_ACCEPTED: Readonly<
  Record<NonNullable<ConnectionStatusDto["notAccepted"]>, string>
> = {
  CLOSED: "This investor isn’t taking requests from founders right now.",
  NOT_STATED: "This investor hasn’t said founders can reach them yet.",
  NOT_QUALIFIED:
    "This investor only takes requests from companies that meet the criteria they set, and yours doesn’t yet.",
};

type Loaded =
  | { readonly kind: "LOADING" }
  | { readonly kind: "FAILED"; readonly message: string }
  | { readonly kind: "READY"; readonly status: ConnectionStatusDto };

export function RequestToConnect({
  investorOrganisationId,
  investorName,
  ports = LIVE,
  onSent,
}: {
  readonly investorOrganisationId: string;
  readonly investorName: string;
  readonly ports?: ConnectPorts | undefined;
  /** After the server recorded a new request. */
  readonly onSent?: ((request: ConnectionRequestDto) => void) | undefined;
}) {
  const t = useT();
  const toast = useCrmToast();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "LOADING" });
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [refusal, setRefusal] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ports
      .status(investorOrganisationId)
      .catch(() => null)
      .then((result) => {
        if (cancelled) return;
        setLoaded(
          result === null || !result.ok
            ? {
                kind: "FAILED",
                message:
                  result?.message ??
                  "Whether you can send a request couldn't be checked just now.",
              }
            : { kind: "READY", status: result.value },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [investorOrganisationId, ports]);

  const send = async () => {
    key.current ??= `connect:${crypto.randomUUID()}`;
    setPhase("pending");
    setRefusal(null);
    const result = await ports
      .send({ investorOrganisationId, idempotencyKey: key.current })
      .catch(() => null);
    if (result === null || !result.ok) {
      if (result !== null && !result.retryable) key.current = null;
      setPhase("idle");
      setRefusal(result?.message ?? "Your request was not sent. Try again.");
      return;
    }
    setPhase("done");
    onSent?.(result.value.request);
    toast(t("Request sent. You’ll see their answer in CRM."));
  };

  if (loaded.kind === "LOADING") {
    return (
      <button
        type="button"
        disabled
        aria-busy="true"
        className={crmButton("primary", "self-start")}
      >
        {t("Checking…")}
      </button>
    );
  }
  if (loaded.kind === "FAILED") {
    return (
      <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
        {loaded.message}
      </p>
    );
  }
  const { status } = loaded;
  const request = status.request;
  if (request !== null && phase !== "done") {
    if (request.response === "ACCEPTED") {
      return (
        <div className="flex flex-col gap-2" data-connection="ACCEPTED">
          <p className="cq-body-sm text-(--cq-text-primary)" role="status">
            {t("Connected.")} {investorName} {t("accepted your request.")}
          </p>
          <Link
            href={`/relationships/investor/${encodeURIComponent(investorOrganisationId)}`}
            className={crmButton("primary", "self-start")}
          >
            {t("Open in CRM")}
          </Link>
        </div>
      );
    }
    if (request.response === "DECLINED") {
      return (
        <p
          className="cq-body-sm text-(--cq-text-secondary)"
          role="status"
          data-connection="DECLINED"
        >
          {investorName} {t("hasn’t taken this forward. No reason is shared.")}
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-2" data-connection="PENDING">
        <button
          type="button"
          disabled
          className={crmButton("secondary", "self-start")}
        >
          <Clock size={14} aria-hidden="true" />
          {t("Waiting on")} {investorName}
        </button>
        <span className="cq-caption text-(--cq-text-tertiary)">
          {t("Request sent")} {formatDay(request.requestedAt)}.
        </span>
      </div>
    );
  }
  if (status.notAccepted !== null && phase !== "done") {
    return (
      <div
        className="flex flex-col items-center gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) px-6 py-8 text-center"
        data-connection="NOT_ACCEPTED"
      >
        <b className="text-base text-(--cq-text-primary)">
          {status.notAccepted === "CLOSED"
            ? t("Not taking requests")
            : t("Not open to your request yet")}
        </b>
        <p className="max-w-[44ch] text-sm text-(--cq-text-secondary)">
          {t(NOT_ACCEPTED[status.notAccepted])}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <ProgressButton
        phase={phase}
        idle={t("Request to connect")}
        done={t("Request sent")}
        onClick={() => void send()}
        className="self-stretch"
        data-connection-request
      />
      {refusal === null ? null : (
        <p className="cq-body-sm text-(--cq-text-primary)" role="status">
          {refusal}
        </p>
      )}
    </div>
  );
}
