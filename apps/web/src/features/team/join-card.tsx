"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import type { InvitationPreviewDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { CircleAlert, ICON_STROKE } from "@capital-q/ui/icons";

import { SignOutButton } from "@/features/auth";

import { acceptInvitationAction } from "./team-actions";
import { teamWords } from "./team-words";

/**
 * Accept an invitation (G2), built to the mockup's accept view: one card,
 * centred. The states: ready to join, signed in with another email, the
 * link expired / cancelled / used / not valid, and loading.
 */

const CARD =
  "cq-panel mx-auto mt-[6vh] flex w-full max-w-[460px] flex-col items-center gap-4.5 px-6 py-8 text-center";

const ROLE = { ADMIN: "Admin", MEMBER: "Member" } as const;

function Logo({ name }: { readonly name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-16 place-items-center rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-[26px] font-semibold text-(--cq-text-primary)"
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Problem({
  title,
  body,
  children,
}: {
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="px-4">
      <div className={CARD} data-join-state="error">
        <CircleAlert aria-hidden="true" size={28} strokeWidth={ICON_STROKE} className="text-(--cq-text-secondary)" />
        <h1 className="cq-title-lg text-(--cq-text-primary)">{title}</h1>
        <p className="cq-body text-(--cq-text-secondary)">{body}</p>
        {children ?? (
          <Link href="/home" className={buttonClassName("secondary")}>
            Go to Capital Q
          </Link>
        )}
      </div>
    </div>
  );
}

export function JoinCard({
  token,
  preview,
  signedInAs,
  keeps,
  alreadyIn,
}: {
  readonly token: string;
  readonly preview: InvitationPreviewDto | null;
  readonly signedInAs: string | null;
  readonly keeps: string | null;
  readonly alreadyIn: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (preview === null) {
    return (
      <Problem
        title="This invitation link isn't valid"
        body="It may have been copied only in part. Open the link from the email again, or ask for a new invitation."
      />
    );
  }
  const inviter = preview.invitedByName ?? "Your colleague";
  const inviterFirst = inviter.split(" ")[0] ?? inviter;
  const words = teamWords(preview.kind);
  if (preview.state === "EXPIRED") {
    return (
      <Problem
        title="This invitation has expired"
        body={`Invitations last 7 days. Ask ${inviterFirst} at ${preview.organisationName} to send a new one.`}
      />
    );
  }
  if (preview.state === "REVOKED") {
    return (
      <Problem
        title="This invitation was cancelled"
        body={`Ask ${inviterFirst} at ${preview.organisationName} if you should still join.`}
      />
    );
  }
  if (preview.state === "ACCEPTED") {
    return alreadyIn ? (
      <Problem title={`You're in ${preview.organisationName}`} body="This invitation was already used to join.">
        <Link href="/settings/team" className={buttonClassName("primary")}>
          Open your team
        </Link>
      </Problem>
    ) : (
      <Problem title="This invitation was already used" body={`Ask ${inviterFirst} at ${preview.organisationName} for a new one.`} />
    );
  }
  const mismatch =
    signedInAs !== null && signedInAs.trim().toLowerCase() !== preview.email;
  if (mismatch) {
    return (
      <div className="px-4">
        <div className={CARD} data-join-state="limited">
          <Logo name={preview.organisationName} />
          <h1 className="cq-title-lg text-(--cq-text-primary)">This invitation is for {preview.email}</h1>
          <p className="cq-body text-(--cq-text-secondary)">
            You&apos;re signed in as {signedInAs}. Sign in with the invited email, or ask {inviterFirst} to invite this one.
          </p>
          <div className="w-full [&>*]:w-full">
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }
  const others = Math.max(0, preview.memberCount - preview.memberInitials.length);
  return (
    <div className="px-4">
      <div className={CARD} data-join-state={keeps === null ? "empty" : "full"}>
        <Logo name={preview.organisationName} />
        <h1 className="cq-title-lg text-(--cq-text-primary)">Join {preview.organisationName}</h1>
        <p className="cq-body text-(--cq-text-secondary)">
          {inviter} invited you as {preview.role === "ADMIN" ? "an" : "a"}{" "}
          <b className="font-medium text-(--cq-text-primary)">{ROLE[preview.role]}</b>.{" "}
          {preview.kind === "COMPANY"
            ? "You'll work on the company's profile, data room and investor conversations."
            : `You'll share the ${words.word}'s inbox, notes and relationships.`}
        </p>
        {preview.memberInitials.length > 0 ? (
          <div className="flex items-center">
            {preview.memberInitials.map((initials, index) => (
              <span
                key={`${initials}-${String(index)}`}
                aria-hidden="true"
                className="grid size-9 place-items-center rounded-full border-2 border-(--cq-surface-raised) bg-(--cq-surface-subtle) cq-caption font-medium text-(--cq-text-secondary)"
                style={{ marginLeft: index === 0 ? 0 : -8 }}
              >
                {initials}
              </span>
            ))}
            <span className="ml-2 cq-caption text-(--cq-text-secondary)">
              {others > 0 ? `and ${String(others)} ${others === 1 ? "other" : "others"}` : `${String(preview.memberCount)} ${preview.memberCount === 1 ? "person" : "people"}`}
            </span>
          </div>
        ) : null}
        {keeps === null ? null : (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            You&apos;ll keep <b className="font-medium text-(--cq-text-primary)">{keeps}</b> too, and switch between them from the top of the sidebar (on a phone, from More).
          </p>
        )}
        {error === null ? null : (
          <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
            {error}
          </p>
        )}
        <button
          type="button"
          disabled={pending}
          className={buttonClassName("primary", "regular", "w-full")}
          onClick={() => {
            start(async () => {
              const out = await acceptInvitationAction(token);
              if (!out.ok) {
                setError(out.message);
                return;
              }
              router.push("/settings/team");
              router.refresh();
            });
          }}
          data-join-accept
        >
          Join {preview.organisationName}
        </button>
        <Link href="/home" className={buttonClassName("quiet", "regular", "w-full")}>
          Not now
        </Link>
      </div>
    </div>
  );
}

export function JoinCardSkeleton() {
  const bar = "rounded-sm bg-(--cq-surface-subtle) motion-safe:animate-pulse";
  return (
    <div className="px-4">
      <div className={CARD} aria-busy="true" data-join-state="loading">
        <div className={`size-16 rounded-2xl ${bar}`} />
        <div className={`h-7 w-[70%] ${bar}`} />
        <div className={`h-4 w-[90%] ${bar}`} />
        <div className={`h-11 w-full rounded-md ${bar}`} />
      </div>
    </div>
  );
}
