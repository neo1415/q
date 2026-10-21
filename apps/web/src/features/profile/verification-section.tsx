import Link from "next/link";

import { Check, Clock } from "@capital-q/ui/icons";

import { requestVerificationFromProfileAction } from "@/features/verification/verification-actions";
import { accountButton } from "@/features/settings/account-styles";

import { ProfileSectionShell } from "./editable-section";

/**
 * Signals and verification on the person's own profile (chosen design "One
 * page, edit in place", 2026-10-21): each claim Capital Q can check, with
 * where it stands in words. Verification is its own workflow (ADR-001): it
 * is never folded into how well a fact is supported, and nothing here says
 * "verified" unless Capital Q decided so.
 */

export type VerificationLine = {
  readonly key: string;
  readonly label: string;
  readonly words: string;
  readonly state: "VERIFIED" | "WAITING" | "NONE";
};

export function VerificationSection({
  lines,
  request,
  href,
  translate = (english) => english,
}: {
  readonly lines: readonly VerificationLine[];
  /**
   * The inline request (a company whose claims are not yet asked for):
   * the company and a key minted by this render, so a double press is one
   * request. Null: the button links to the verification page instead.
   */
  readonly request: {
    readonly companyId: string;
    readonly requestKey: string;
  } | null;
  readonly href: string;
  readonly translate?: ((english: string) => string) | undefined;
}) {
  const t = translate;
  const needsAsking = lines.some((line) => line.state === "NONE");
  return (
    <ProfileSectionShell
      id="verification"
      title={t("Signals and verification")}
      variant="brief"
    >
      {lines.length === 0 ? (
        <p className="m-0 text-sm text-(--cq-text-secondary)">
          {t("Where verification stands couldn't be read just now.")}
        </p>
      ) : (
        <dl className="m-0 flex flex-col" data-profile-verification>
          {lines.map((line, index) => (
            <div
              key={line.key}
              data-claim={line.key}
              data-status={line.state}
              className="flex flex-col gap-1 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0 sm:grid sm:grid-cols-[180px_minmax(0,1fr)] sm:items-center sm:gap-0"
            >
              <dt className="text-[13px] text-(--cq-text-secondary)">
                {t(line.label)}
              </dt>
              <dd className="m-0 flex flex-wrap items-center justify-between gap-2 text-sm">
                {line.state === "VERIFIED" ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-(--cq-text-primary)">
                    <span className="grid size-5 place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)">
                      <Check size={12} strokeWidth={2.4} aria-hidden="true" />
                    </span>
                    {t(line.words)}
                  </span>
                ) : line.state === "WAITING" ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-(--cq-text-primary)">
                    <Clock
                      size={16}
                      strokeWidth={1.75}
                      aria-hidden="true"
                      className="text-(--cq-warning)"
                    />
                    {t(line.words)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[13px] text-(--cq-text-tertiary)">
                    <span
                      aria-hidden="true"
                      className="size-2.5 rounded-full border-[1.5px] border-dashed border-(--cq-text-tertiary)"
                    />
                    {t(line.words)}
                  </span>
                )}
                {index === 0 && needsAsking ? (
                  request === null ? (
                    <Link
                      href={href}
                      className={accountButton("secondary", "sm")}
                      data-request-verification
                    >
                      {t("Request verification")}
                    </Link>
                  ) : (
                    <form action={requestVerificationFromProfileAction}>
                      <input
                        type="hidden"
                        name="companyId"
                        value={request.companyId}
                      />
                      <input
                        type="hidden"
                        name="requestKey"
                        value={request.requestKey}
                      />
                      <button
                        type="submit"
                        className={accountButton("secondary", "sm")}
                        data-request-verification
                      >
                        {t("Request verification")}
                      </button>
                    </form>
                  )
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Link
        href={href}
        className={accountButton("quiet", "sm", "-ms-2.5 self-start")}
      >
        {t("How verification works")}
      </Link>
    </ProfileSectionShell>
  );
}
