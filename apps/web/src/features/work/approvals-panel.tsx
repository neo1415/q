"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import type { QApprovalView, QPendingApproval } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { ErrorState, Skeleton } from "@capital-q/ui/states";

import { EmailDraftEditor } from "@/features/integrations/email-draft-editor";
import {
  approveQApprovalAction,
  readQApprovalAction,
  rejectQApprovalAction,
} from "@/features/q/actions";

/**
 * "Needs you" on Q's work (design-48; CQ-Q-008). The approvals waiting on
 * this person, read on the server. One is open at a time and shows the
 * exact content the decision binds to before the yes; approving and
 * declining are buttons, never gestures. "Not now" changes nothing.
 * Edited email text is saved through the draft editor, which asks again.
 */

function requested(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "ready"; readonly view: QApprovalView };

function OpenApproval({
  item,
  position,
  total,
  onDone,
  onClose,
}: {
  readonly item: QPendingApproval;
  readonly position: number;
  readonly total: number;
  readonly onDone: (words: string) => void;
  readonly onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await readQApprovalAction(item.approvalId).catch(() => null);
    setLoaded(
      result?.ok === true
        ? { state: "ready", view: result.value }
        : {
            state: "failed",
            message: result?.message ?? "This approval couldn't load.",
          },
    );
  }, [item.approvalId]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(first);
  }, [load]);

  const decide = (approve: boolean) =>
    startTransition(async () => {
      setMessage(null);
      const result = await (
        approve
          ? approveQApprovalAction(item.approvalId)
          : rejectQApprovalAction(item.approvalId)
      ).catch(() => null);
      if (result?.ok === true) {
        onDone(
          approve
            ? "Approved. Q is doing it now."
            : "Declined. Nothing was sent.",
        );
      } else {
        setMessage(
          result?.message ?? "That didn't go through. Nothing was sent.",
        );
      }
    });

  const view = loaded.state === "ready" ? loaded.view : null;
  const canDecide = view?.canDecide ?? false;

  return (
    <div className="flex flex-col gap-3 py-3" data-approval-open>
      <div className="flex items-center justify-between gap-3">
        <p className="cq-caption cq-numeric text-(--cq-text-tertiary)">
          {position} of {total}
          <span className="sr-only">
            , asked {requested(item.requestedAt)} UTC
          </span>
        </p>
        <Button
          variant="quiet"
          size="compact"
          disabled={pending}
          onClick={onClose}
        >
          Not now
        </Button>
      </div>
      <h3 className="cq-title-sm text-(--cq-text-primary)">
        {view?.action.summary ?? item.summary}
      </h3>
      {loaded.state === "loading" ? <Skeleton lines={3} /> : null}
      {loaded.state === "failed" ? (
        <ErrorState
          title="This approval couldn't load"
          description="Nothing was sent. It still waits for your yes."
          action={
            <Button
              variant="secondary"
              size="compact"
              onClick={() => {
                setLoaded({ state: "loading" });
                void load();
              }}
            >
              Try again
            </Button>
          }
          compact
        />
      ) : null}
      {view?.action.preview === undefined ? null : (
        <div className="flex flex-col gap-1">
          <span className="sr-only">What Q will send</span>
          <p
            className="cq-body-sm border-l-2 border-(--cq-border-strong) pl-3 whitespace-pre-wrap text-(--cq-text-primary)"
            data-approval-preview
          >
            {view.action.preview}
          </p>
        </div>
      )}
      {view?.action.actionType === "email.send" && canDecide ? (
        <EmailDraftEditor
          approvalId={item.approvalId}
          onRevised={() => void load()}
        />
      ) : null}
      {view !== null && !canDecide ? (
        <p className="cq-body-sm text-(--cq-text-secondary)">
          Already decided or expired.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending || !canDecide}
          onClick={() => decide(true)}
        >
          Approve and send
        </Button>
        <Button
          variant="secondary"
          disabled={pending || !canDecide}
          onClick={() => decide(false)}
        >
          Decline
        </Button>
      </div>
      {message === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

export function ApprovalsPanel({
  initial,
}: {
  /** Null when the server read failed; the panel then says so. */
  readonly initial: readonly QPendingApproval[] | null;
}) {
  const [items, setItems] = useState<readonly QPendingApproval[]>(
    initial ?? [],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (initial === null) {
    return (
      <section aria-labelledby="work-needs-you" className="flex flex-col gap-2">
        <h2 id="work-needs-you" className="sr-only">
          Needs you
        </h2>
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          Approvals couldn&rsquo;t load. Nothing is sent without your yes.
        </p>
      </section>
    );
  }
  if (items.length === 0 && notice === null) return null;
  const openIndex = items.findIndex((item) => item.approvalId === openId);
  const open = openIndex < 0 ? undefined : items[openIndex];
  const first = items[0];

  return (
    <section
      aria-labelledby="work-needs-you"
      className="flex flex-col"
      data-work-needs-you
    >
      <h2 id="work-needs-you" className="sr-only">
        Needs you
      </h2>
      {open !== undefined ? (
        <OpenApproval
          key={open.approvalId}
          item={open}
          position={openIndex + 1}
          total={items.length}
          onClose={() => setOpenId(null)}
          onDone={(words) => {
            const rest = items.filter(
              (one) => one.approvalId !== open.approvalId,
            );
            setItems(rest);
            // The next one opens, so a run of approvals is one pass.
            setOpenId(rest[0]?.approvalId ?? null);
            setNotice(words);
          }}
        />
      ) : first === undefined ? null : (
        <div className="flex min-h-14 items-center gap-3 border-b border-(--cq-border-subtle) py-2">
          <span className="cq-body flex-1 font-medium text-(--cq-text-primary)">
            <span className="cq-numeric">{items.length}</span> to approve
          </span>
          <Button
            variant="primary"
            size="compact"
            onClick={() => {
              setNotice(null);
              setOpenId(first.approvalId);
            }}
          >
            Review
          </Button>
        </div>
      )}
      {notice === null ? null : (
        <p className="cq-body-sm text-(--cq-text-secondary)" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
