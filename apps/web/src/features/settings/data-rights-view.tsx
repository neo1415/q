"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import type { DataRightsDto } from "@capital-q/contracts";

import { useT } from "@/features/i18n/language";

import { AccountToastProvider, Field, useAccountToast } from "./account-kit";
import {
  AccountCard,
  AccountColumn,
  AccountHead,
  GroupHead,
} from "./account-layout";
import { accountButton, fieldClassName } from "./account-styles";
import {
  cancelDeletionAction,
  downloadLinkAction,
  requestDataExportAction,
  scheduleDeletionAction,
  sendDeletionCodeAction,
} from "./data-rights-actions";

/**
 * Your data (owner decision 107): download a copy, or delete the account.
 * Plain words for what is deleted, what is kept and why. Deleting asks
 * the person to confirm it is them and to type the words; it then waits
 * the grace period, during which they can cancel. Q can start a download
 * from chat; only this page schedules a deletion.
 */

function day(iso: string | null): string {
  if (iso === null) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function size(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataRightsView({
  data,
}: {
  readonly data: DataRightsDto | null;
}) {
  const t = useT();
  return (
    <AccountToastProvider>
      <AccountColumn width="form">
        <AccountHead
          title={t("Your data")}
          back={{ href: "/settings#privacy", label: t("Settings") }}
          sub={t(
            "Download a copy of the data Capital Q keeps as yours, or delete your account. Your rights are described in the Privacy Policy.",
          )}
        />
        {data === null ? (
          <p
            className="text-[15px] text-(--cq-text-secondary)"
            data-state="unavailable"
          >
            {t("Your data couldn't be loaded just now. Reload in a moment.")}
          </p>
        ) : (
          <>
            <DownloadCard data={data} />
            <DeleteSection data={data} />
          </>
        )}
        <p className="mt-6 text-[13px] text-(--cq-text-tertiary)">
          <Link href="/legal/privacy" className="underline underline-offset-2">
            {t("Privacy Policy")}
          </Link>
        </p>
      </AccountColumn>
    </AccountToastProvider>
  );
}

function DownloadCard({ data }: { readonly data: DataRightsDto }) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const latest = data.latestExport;
  const building =
    latest !== null &&
    (latest.status === "REQUESTED" || latest.status === "BUILDING");
  const ready = latest !== null && latest.status === "READY";

  const prepare = () =>
    start(async () => {
      const result = await requestDataExportAction();
      if (!result.ok) toast(result.message);
      else
        toast(
          t("Preparing your download. We'll let you know when it's ready."),
        );
      router.refresh();
    });
  const download = (exportId: string) =>
    start(async () => {
      const result = await downloadLinkAction(exportId);
      if (result.ok && result.url !== undefined)
        window.location.assign(result.url);
      else if (!result.ok) toast(result.message);
    });

  return (
    <>
      <GroupHead title={t("Download your data")} id="download-title" />
      <AccountCard data-section="download">
        <p className="m-0 text-[15px] text-(--cq-text-primary)">
          {t(
            "A ZIP file with your profile, what you wrote and uploaded, your conversations with Q, what Q remembers about you, and your activity. Other people's private notes are not included.",
          )}
        </p>
        <p
          className="m-0 text-[13px] text-(--cq-text-secondary)"
          aria-live="polite"
          data-state={latest?.status ?? "NONE"}
        >
          {ready
            ? `${t("Ready")} · ${size(latest.byteSize)} · ${t("available until")} ${day(latest.expiresAt)}`
            : building
              ? t("Being prepared. This usually takes a few minutes.")
              : latest?.status === "FAILED"
                ? t("The last download couldn't be prepared. Try again.")
                : t("Downloads stay available for 7 days.")}
        </p>
        <div className="flex flex-wrap gap-2">
          {ready ? (
            <button
              type="button"
              className={accountButton("primary")}
              disabled={pending}
              onClick={() => download(latest.id)}
            >
              {t("Download")}
            </button>
          ) : null}
          <button
            type="button"
            className={accountButton(ready ? "secondary" : "primary")}
            disabled={pending || building || data.exportsLeftToday === 0}
            onClick={prepare}
          >
            {ready ? t("Prepare a new download") : t("Prepare a download")}
          </button>
        </div>
        {data.exportsLeftToday === 0 ? (
          <p className="m-0 text-[13px] text-(--cq-text-tertiary)">
            {t("You can ask three times a day. Try again tomorrow.")}
          </p>
        ) : null}
      </AccountCard>
    </>
  );
}

function DeleteSection({ data }: { readonly data: DataRightsDto }) {
  const t = useT();
  const deletion = data.deletion;
  return (
    <>
      <GroupHead title={t("Delete your account")} id="delete-title" />
      {deletion !== null &&
      deletion.status !== "CANCELLED" &&
      deletion.status !== "COMPLETED" ? (
        <ScheduledCard data={data} />
      ) : (
        <DeleteForm data={data} />
      )}
      <GroupHead title={t("What is kept, and why")} />
      <AccountCard>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.kept.map((kept) => (
            <li key={kept.what} className="flex flex-col gap-0.5">
              <span className="text-[15px] font-medium text-(--cq-text-primary)">
                {t(kept.what)}
              </span>
              <span className="text-[13px] text-(--cq-text-secondary)">
                {t(kept.why)}
              </span>
              <span className="text-xs text-(--cq-text-tertiary)">
                {t(kept.howLong)}
              </span>
            </li>
          ))}
        </ul>
      </AccountCard>
    </>
  );
}

function ScheduledCard({ data }: { readonly data: DataRightsDto }) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const deletion = data.deletion;
  if (deletion === null) return null;
  const cancel = () =>
    start(async () => {
      const result = await cancelDeletionAction();
      toast(
        result.ok
          ? t("Deletion cancelled. Your account stays.")
          : result.message,
      );
      router.refresh();
    });
  return (
    <AccountCard data-state={deletion.status}>
      <p
        className="m-0 text-[15px] font-medium text-(--cq-text-primary)"
        role="status"
      >
        {deletion.status === "PROCESSING"
          ? t("Your account is being deleted.")
          : `${t("Your account will be deleted on")} ${day(deletion.scheduledFor)}.`}
      </p>
      {deletion.status === "BLOCKED" ? (
        <p className="m-0 text-[13px] text-(--cq-text-secondary)">
          {deletion.blockedReason === "LAST_OWNER"
            ? t("It is waiting: make someone else an owner of your team first.")
            : t(
                "It is waiting: your organisations changed. Cancel and ask again to review them.",
              )}
        </p>
      ) : (
        <p className="m-0 text-[13px] text-(--cq-text-secondary)">
          {t("Until then you can keep using Capital Q and change your mind.")}
        </p>
      )}
      {deletion.status === "PROCESSING" ? null : (
        <div>
          <button
            type="button"
            className={accountButton("secondary")}
            disabled={pending}
            onClick={cancel}
          >
            {t("Keep my account")}
          </button>
        </div>
      )}
    </AccountCard>
  );
}

function DeleteForm({ data }: { readonly data: DataRightsDto }) {
  const t = useT();
  const toast = useAccountToast();
  const router = useRouter();
  const ids = useId();
  const [pending, start] = useTransition();
  const [method, setMethod] = useState<"password" | "code">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [words, setWords] = useState("");
  const [agreed, setAgreed] = useState(false);
  const blocking = data.organisations.filter(
    (o) => o.outcome === "TRANSFER_REQUIRED",
  );
  const closing = data.organisations.filter(
    (o) => o.outcome === "CLOSES_WITH_ACCOUNT",
  );
  const leaving = data.organisations.filter((o) => o.outcome === "LEAVES");
  const confirmation = data.policy.confirmationWords;
  const ready =
    blocking.length === 0 &&
    agreed &&
    words.trim().toUpperCase() === confirmation &&
    (method === "password" ? password !== "" : /^\d{6,10}$/u.test(code.trim()));

  const sendCode = () =>
    start(async () => {
      const result = await sendDeletionCodeAction();
      toast(result.ok ? t("Code sent to your email.") : result.message);
    });
  const submit = () =>
    start(async () => {
      const result = await scheduleDeletionAction({
        ...(method === "password" ? { password } : { code }),
        confirmation: words,
        organisationsToClose: closing.map((o) => o.organisationId),
      });
      setPassword("");
      if (!result.ok) {
        toast(result.message);
        return;
      }
      toast(t("Deletion scheduled. You can cancel it on this page."));
      router.refresh();
    });

  return (
    <AccountCard data-section="delete">
      <p className="m-0 text-[15px] text-(--cq-text-primary)">
        {t(
          "Your profile, documents, conversations with Q, what Q remembers about you and your other content are deleted. You are signed out everywhere. Records other people need are kept without your name.",
        )}
      </p>
      <p className="m-0 text-[13px] text-(--cq-text-secondary)">
        {`${t("Nothing happens for")} ${data.policy.graceDays} ${t("days, so you can change your mind. Download your data first if you want a copy.")}`}
      </p>

      {blocking.length > 0 ? (
        <div
          className="flex flex-col gap-2 rounded-(--cq-radius-md) bg-(--cq-surface-subtle) px-4 py-3"
          role="note"
        >
          <p className="m-0 text-[13px] text-(--cq-text-primary)">
            {`${t("You are the only owner of")} ${blocking.map((o) => o.name).join(", ")}. ${t("Make someone else an owner first, or remove the other members.")}`}
          </p>
          <div>
            <Link
              href="/settings/team"
              className={accountButton("secondary", "sm")}
            >
              {t("Open Team")}
            </Link>
          </div>
        </div>
      ) : null}
      {closing.length > 0 ? (
        <p className="m-0 text-[13px] text-(--cq-text-primary)">
          {`${t("You are the only member of")} ${closing.map((o) => o.name).join(", ")}. ${t("It closes with your account: it leaves Discover and nobody can sign in to it. Other parties keep their own records of it.")}`}
        </p>
      ) : null}
      {leaving.length > 0 ? (
        <p className="m-0 text-[13px] text-(--cq-text-secondary)">
          {`${t("You leave")} ${leaving.map((o) => o.name).join(", ")}. ${t("Your team keeps its documents and records.")}`}
        </p>
      ) : null}

      <fieldset
        className="m-0 flex flex-col gap-3 border-0 p-0"
        disabled={pending || blocking.length > 0}
      >
        <legend className="mb-1 text-[13px] font-medium text-(--cq-text-secondary)">
          {t("Confirm it's you")}
        </legend>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t("Confirm it's you")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={method === "password"}
            className={accountButton(
              method === "password" ? "secondary" : "quiet",
              "sm",
            )}
            onClick={() => setMethod("password")}
          >
            {t("With my password")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={method === "code"}
            className={accountButton(
              method === "code" ? "secondary" : "quiet",
              "sm",
            )}
            onClick={() => setMethod("code")}
          >
            {t("With a code by email")}
          </button>
        </div>
        {method === "password" ? (
          <Field label={t("Password")} htmlFor={`${ids}-password`}>
            <input
              id={`${ids}-password`}
              type="password"
              autoComplete="current-password"
              className={fieldClassName}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        ) : (
          <Field
            label={t("Code")}
            htmlFor={`${ids}-code`}
            hint={t("We email it to the address you sign in with.")}
          >
            <div className="flex gap-2">
              <input
                id={`${ids}-code`}
                inputMode="numeric"
                autoComplete="one-time-code"
                className={fieldClassName}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <button
                type="button"
                className={accountButton("secondary")}
                onClick={sendCode}
              >
                {t("Send code")}
              </button>
            </div>
          </Field>
        )}
        <Field
          label={`${t("Type")} ${confirmation} ${t("to confirm")}`}
          htmlFor={`${ids}-words`}
        >
          <input
            id={`${ids}-words`}
            autoComplete="off"
            spellCheck={false}
            className={fieldClassName}
            value={words}
            onChange={(event) => setWords(event.target.value)}
          />
        </Field>
        <label className="flex min-h-11 items-start gap-3 text-[13px] text-(--cq-text-primary)">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0"
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
          />
          <span>
            {t(
              "I understand my account and content will be deleted after the grace period, and this cannot be undone after that.",
            )}
          </span>
        </label>
        <div>
          <button
            type="button"
            className={accountButton("primary")}
            disabled={!ready || pending}
            onClick={submit}
          >
            {t("Delete my account")}
          </button>
        </div>
      </fieldset>
    </AccountCard>
  );
}
