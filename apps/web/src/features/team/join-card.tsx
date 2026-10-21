"use client";

import "@/features/relationships/crm.css";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import type { InvitationPreviewDto } from "@capital-q/contracts";
import {
  Check,
  Clock,
  ICON_STROKE,
  Link as LinkIcon,
  X,
} from "@capital-q/ui/icons";

import { SignOutButton } from "@/features/auth";
import { accountButton, Pending } from "@/features/settings/account-kit";

import {
  acceptInvitationAction,
  declineInvitationAction,
} from "./team-actions";
import { teamWords } from "./team-words";
import { useT } from "@/features/i18n/language";

/**
 * Accept an invitation (G2; chosen design "Who you'll work with, and every
 * link state", 2026-10-21): one card, centred. Who invited them, to what,
 * as which role and what that role may do, who is already there (by
 * initials only: they are not in yet), when it expires and which email
 * they are signed in as; Decline or Join. Every state of the link has its
 * own card: not valid, expired, cancelled, declined, already used, and
 * signed in with another email. Joining and declining are the API's to
 * allow, as the invited, confirmed email only.
 */

const CARD =
  "cq-crm-stagger mx-auto flex w-full max-w-[480px] flex-col gap-4 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5 shadow-(--cq-shadow-sm) sm:p-7";

const ROLE = { ADMIN: "Admin", MEMBER: "Member" } as const;

function Logo({ name }: { readonly name: string }) {
  const letters = name
    .trim()
    .split(/\s+/u)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word))
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="grid size-10 flex-none place-items-center rounded-[10px] bg-[var(--cq-tile,var(--cq-text-primary))] text-sm font-semibold text-[var(--cq-on-tile,var(--cq-text-inverse))]"
    >
      {letters || "?"}
    </span>
  );
}

function Frame({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-8rem)] place-items-center px-4 py-10">
      <div className="w-full max-w-[520px]">{children}</div>
    </div>
  );
}

function Problem({
  icon,
  title,
  body,
  children,
}: {
  readonly icon: "link" | "clock" | "x";
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}) {
  const t = useT();
  const Icon = icon === "link" ? LinkIcon : icon === "clock" ? Clock : X;
  return (
    <Frame>
      <div className={CARD} data-join-state="error">
        <span className="grid size-12 place-items-center rounded-full bg-(--cq-surface-subtle) text-(--cq-text-secondary)">
          <Icon size={22} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </span>
        <h1 className="m-0 text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
          {title}
        </h1>
        <p className="m-0 text-sm leading-normal text-(--cq-text-secondary)">
          {body}
        </p>
        {children ?? (
          <Link
            href="/home"
            className={accountButton("secondary", "regular", "self-start")}
          >
            {t("Go to Capital Q")}
          </Link>
        )}
      </div>
    </Frame>
  );
}

function expiresIn(iso: string, now: Date = new Date()): string {
  const days = Math.ceil(
    (new Date(iso).getTime() - now.getTime()) / 86_400_000,
  );
  if (!Number.isFinite(days)) return "";
  if (days <= 1) return "Expires within a day";
  return `Expires in ${String(days)} days`;
}

export function JoinCard({
  token,
  preview,
  signedInAs,
  keeps,
  alreadyIn,
  invitation = null,
  reviewPhase = "idle",
}: {
  readonly token: string;
  readonly preview: InvitationPreviewDto | null;
  readonly signedInAs: string | null;
  readonly keeps: string | null;
  readonly alreadyIn: boolean;
  /**
   * The same invitation in the person's own list (their verified email),
   * which carries its id for Decline and when it expires. Null when it is
   * not theirs to answer.
   */
  readonly invitation?: {
    readonly invitationId: string;
    readonly expiresAt: string;
  } | null;
  /** Design review only (/dev/account-review): after Join was pressed. */
  readonly reviewPhase?: "idle" | "joined" | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<
    "idle" | "joining" | "declining" | "joined" | "declined"
  >(reviewPhase);
  const [error, setError] = useState<string | null>(null);

  if (preview === null) {
    return (
      <Problem
        icon="link"
        title={t("This invitation link isn't valid")}
        body={t(
          "It may have been copied only in part. Open the link from the email again, or ask for a new invitation.",
        )}
      />
    );
  }
  const inviter = preview.invitedByName ?? "Your colleague";
  const inviterFirst = inviter.split(" ")[0] ?? inviter;
  const words = teamWords(preview.kind);
  const org = preview.organisationName;
  if (phase === "declined" || preview.state === "DECLINED") {
    return (
      <Problem
        icon="x"
        title={t("You declined this invitation")}
        body={t(
          `${inviter} is told you declined. If you change your mind, ask them for a new invitation.`,
        )}
      />
    );
  }
  if (phase === "joined") {
    return (
      <Frame>
        <div className={CARD} data-join-state="joined">
          <span className="cq-crm-tick-in grid size-10 place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)">
            <Check size={20} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <h1 className="m-0 text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
            {t(`You’re in ${org}`)}
          </h1>
          <p className="m-0 text-sm text-(--cq-text-secondary)">
            {preview.kind === "COMPANY"
              ? t(
                  "You’ll work on the company’s profile, data room and investor conversations. Your own workspace stays separate.",
                )
              : t(
                  "You’ll work on the firm’s relationships, notes and inbox. Your own workspace stays separate.",
                )}
          </p>
          <Link
            href="/home"
            className={accountButton("primary", "regular", "self-start")}
            data-join-go
          >
            {t("Go to Capital Q")}
          </Link>
        </div>
      </Frame>
    );
  }
  if (preview.state === "EXPIRED") {
    return (
      <Problem
        icon="clock"
        title={t("This invitation has expired")}
        body={t(
          `Invitations last 7 days. Ask ${inviterFirst} at ${org} for a new one.`,
        )}
      />
    );
  }
  if (preview.state === "REVOKED") {
    return (
      <Problem
        icon="x"
        title={t("This invitation was cancelled")}
        body={t(
          `The person who sent it cancelled it. Ask ${inviterFirst} at ${org} if you still need access.`,
        )}
      />
    );
  }
  if (preview.state === "ACCEPTED") {
    return alreadyIn ? (
      <Problem
        icon="x"
        title={t(`You're in ${org}`)}
        body={t("This invitation was already used to join.")}
      >
        <Link
          href="/settings/team"
          className={accountButton("primary", "regular", "self-start")}
        >
          {t("Open your team")}
        </Link>
      </Problem>
    ) : (
      <Problem
        icon="x"
        title={t("This invitation was already used")}
        body={t(
          "This invitation was already used to join. Sign in with the account that used it.",
        )}
      />
    );
  }
  const mismatch =
    signedInAs !== null && signedInAs.trim().toLowerCase() !== preview.email;
  if (mismatch) {
    return (
      <Frame>
        <div className={CARD} data-join-state="limited">
          <Logo name={org} />
          <h1 className="m-0 text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
            {t(`This invitation is for ${preview.email}`)}
          </h1>
          <p className="m-0 text-sm text-(--cq-text-secondary)">
            {t(
              `You're signed in as ${signedInAs}. Sign in with the invited email, or ask ${inviterFirst} to invite this one.`,
            )}
          </p>
          <div className="[&>*]:w-full">
            <SignOutButton />
          </div>
        </div>
      </Frame>
    );
  }
  const busy = phase === "joining" || phase === "declining";
  return (
    <Frame>
      <div className={CARD} data-join-state={keeps === null ? "empty" : "full"}>
        <Logo name={org} />
        <h1 className="m-0 text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-(--cq-text-primary)">
          {t(`${inviter} invited you to join ${org}`)}
        </h1>
        <div className="flex flex-col gap-1 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) bg-(--cq-surface) p-3.5">
          <b className="text-[15px] text-(--cq-text-primary)">
            {t(`As ${ROLE[preview.role].toLowerCase()}`)}
          </b>
          <span className="text-[13px] leading-[1.45] text-(--cq-text-secondary)">
            {t(preview.role === "ADMIN" ? words.admin : words.member)}
          </span>
        </div>
        {preview.memberCount > 0 ? (
          <div className="flex flex-col gap-2" data-join-team>
            <span className="text-xs text-(--cq-text-tertiary)">
              {t(`Already in ${org}`)}
            </span>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center">
                {preview.memberInitials.map((initials, index) => (
                  <span
                    key={`${initials}-${String(index)}`}
                    aria-hidden="true"
                    className="grid size-8 place-items-center rounded-full border-2 border-(--cq-surface-raised) bg-(--cq-surface-subtle) text-xs font-semibold text-(--cq-text-secondary)"
                    style={{ marginInlineStart: index === 0 ? 0 : -8 }}
                  >
                    {initials}
                  </span>
                ))}
              </span>
              <span className="text-sm text-(--cq-text-primary)">
                {preview.memberCount === 1
                  ? t("1 person works here")
                  : t(`${String(preview.memberCount)} people work here`)}
              </span>
            </div>
          </div>
        ) : null}
        <span className="text-xs text-(--cq-text-tertiary)">
          {[
            invitation === null ? null : t(expiresIn(invitation.expiresAt)),
            signedInAs === null ? null : t(`Signed in as ${signedInAs}`),
          ]
            .filter((part) => part !== null && part !== "")
            .join(". ")}
          {invitation === null && signedInAs === null ? null : "."}
        </span>
        {keeps === null ? null : (
          <p className="m-0 text-[13px] text-(--cq-text-secondary)">
            {t(
              `You'll keep ${keeps} too, and switch between them from the top of the sidebar (on a phone, from More).`,
            )}
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="m-0 text-sm text-(--cq-text-primary)">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {invitation === null ? (
            <Link
              href="/home"
              className={accountButton("secondary", "regular")}
              aria-disabled={busy || undefined}
            >
              {t("Not now")}
            </Link>
          ) : (
            <button
              type="button"
              className={accountButton("secondary")}
              disabled={busy}
              aria-busy={phase === "declining"}
              data-join-decline
              onClick={() => {
                setPhase("declining");
                setError(null);
                void declineInvitationAction(invitation.invitationId).then(
                  (out) => {
                    if (!out.ok) {
                      setPhase("idle");
                      setError(out.message);
                      return;
                    }
                    setPhase("declined");
                    router.refresh();
                  },
                );
              }}
            >
              {phase === "declining" ? (
                <Pending>{t("Declining…")}</Pending>
              ) : (
                t("Decline")
              )}
            </button>
          )}
          <button
            type="button"
            className={accountButton("primary")}
            disabled={busy}
            aria-busy={phase === "joining"}
            data-join-accept
            onClick={() => {
              setPhase("joining");
              setError(null);
              void acceptInvitationAction(token).then((out) => {
                if (!out.ok) {
                  setPhase("idle");
                  setError(out.message);
                  return;
                }
                setPhase("joined");
                router.refresh();
              });
            }}
          >
            {phase === "joining" ? (
              <Pending>{t("Joining…")}</Pending>
            ) : (
              <span className="truncate">{t(`Join ${org}`)}</span>
            )}
          </button>
        </div>
      </div>
    </Frame>
  );
}

export function JoinCardSkeleton() {
  const bar = "bg-(--cq-surface-subtle) motion-safe:animate-pulse";
  return (
    <Frame>
      <div className={CARD} aria-busy="true" data-join-state="loading">
        <div className={`size-10 rounded-[10px] ${bar}`} />
        <div className={`h-7 w-[70%] rounded-(--cq-radius-sm) ${bar}`} />
        <div className={`h-16 w-full rounded-(--cq-radius-lg) ${bar}`} />
        <div className={`h-11 w-full rounded-(--cq-radius-md) ${bar}`} />
      </div>
    </Frame>
  );
}
