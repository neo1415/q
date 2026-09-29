"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import type {
  ConnectionRequestDto,
  ConnectionRequestResultDto,
  ConnectionStatusDto,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";

import { formatDay } from "@/components/date-format";

import {
  requestConnectionAction,
  type ConnectionActionResult,
} from "./connection-actions";

/**
 * A founder's Connection Request to one investor (ADR 0023).
 *
 * The request itself is a structured introduction of the founder's
 * company: no message box, no cold note. It is sent only when the
 * investor takes requests (their own choice), and it reads "sent" only
 * from the server's answer. A decline is neutral and says nothing more.
 */

export type RequestConnectionPort = (input: {
  readonly investorOrganisationId: string;
  readonly idempotencyKey: string;
}) => Promise<ConnectionActionResult<ConnectionRequestResultDto>>;

const NOT_ACCEPTED: Readonly<
  Record<NonNullable<ConnectionStatusDto["notAccepted"]>, string>
> = {
  CLOSED: "This investor isn't taking requests from founders right now.",
  NOT_STATED: "This investor hasn't said founders can reach them yet.",
  NOT_QUALIFIED:
    "This investor only takes requests from companies that meet the criteria they set, and yours doesn't yet.",
};

type Phase =
  | { readonly kind: "IDLE" }
  | { readonly kind: "CONFIRMING" }
  | { readonly kind: "SENDING" }
  | {
      readonly kind: "REFUSED";
      readonly message: string;
      readonly retryable: boolean;
    };

export function ConnectionRequest({
  investorOrganisationId,
  investorName,
  status,
  send = requestConnectionAction,
}: {
  readonly investorOrganisationId: string;
  readonly investorName: string;
  readonly status: ConnectionStatusDto;
  readonly send?: RequestConnectionPort;
}) {
  const [request, setRequest] = useState<ConnectionRequestDto | null>(
    status.request,
  );
  const [phase, setPhase] = useState<Phase>({ kind: "IDLE" });
  // One key per intended request, reused across retries of it.
  const key = useRef<string | null>(null);

  const submit = useCallback(async () => {
    key.current ??= `connect:${crypto.randomUUID()}`;
    setPhase({ kind: "SENDING" });
    let result: ConnectionActionResult<ConnectionRequestResultDto>;
    try {
      result = await send({
        investorOrganisationId,
        idempotencyKey: key.current,
      });
    } catch {
      result = {
        ok: false,
        message: "Your request was not sent. Try again.",
        retryable: true,
      };
    }
    if (result.ok) {
      setRequest(result.value.request);
      setPhase({ kind: "IDLE" });
      return;
    }
    if (!result.retryable) key.current = null;
    setPhase({
      kind: "REFUSED",
      message: result.message,
      retryable: result.retryable,
    });
  }, [investorOrganisationId, send]);

  if (request !== null) {
    if (request.response === "ACCEPTED") {
      return (
        <div className="flex flex-col gap-2" data-connection="ACCEPTED">
          <p className="cq-status-line" role="status">
            Connected. {investorName} accepted your request.
          </p>
          <Link
            href={`/relationships/investor/${investorOrganisationId}`}
            className={buttonClassName("primary")}
          >
            Open the relationship
          </Link>
        </div>
      );
    }
    if (request.response === "DECLINED") {
      return (
        <p className="cq-status-line" role="status" data-connection="DECLINED">
          {investorName} hasn&apos;t taken this forward. No reason is shared.
        </p>
      );
    }
    return (
      <p className="cq-status-line" role="status" data-connection="PENDING">
        Request sent {formatDay(request.requestedAt)}. {investorName} will see
        your company and can accept or decline.
      </p>
    );
  }

  if (status.notAccepted !== null) {
    return (
      <p
        className="cq-body-sm text-(--cq-text-secondary)"
        data-connection="NOT_ACCEPTED"
      >
        {NOT_ACCEPTED[status.notAccepted]}
      </p>
    );
  }

  if (phase.kind === "CONFIRMING") {
    return (
      <div
        role="group"
        aria-label={`Request to connect with ${investorName}`}
        className="flex flex-col gap-2"
      >
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Send {investorName} a Connection Request? They will see your
          company&apos;s name and what it shares with investors on Capital Q,
          and can accept or decline. Accepting opens a conversation; it is not
          an investment.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void submit()}>
            Send request
          </Button>
          <Button variant="quiet" onClick={() => setPhase({ kind: "IDLE" })}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  if (phase.kind === "SENDING") {
    return (
      <Button variant="primary" disabled aria-busy="true">
        Sending…
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {phase.kind === "REFUSED" ? (
        <p className="cq-status-line" role="status">
          {phase.message}
        </p>
      ) : null}
      {phase.kind === "REFUSED" && !phase.retryable ? null : (
        <div>
          <Button
            variant="primary"
            onClick={() =>
              phase.kind === "REFUSED"
                ? void submit()
                : setPhase({ kind: "CONFIRMING" })
            }
            data-connection-request
          >
            {phase.kind === "REFUSED" ? "Try again" : "Request connection"}
          </Button>
        </div>
      )}
    </div>
  );
}
