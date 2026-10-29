"use client";

import { useActionState, useState, useTransition } from "react";

import {
  confirmTwoStepAction,
  startTwoStepAction,
  turnOffTwoStepAction,
  type TwoStepCodeState,
  type TwoStepSetupState,
} from "@/auth/two-step-actions";
import { CodeField } from "@/features/auth";
import { FormNotice } from "@/features/auth/components/form-notice";
import { SubmitButton } from "@/features/auth/components/submit-button";
import { useT } from "@/features/i18n/language";

import { AccountCard } from "./account-layout";
import { accountButton } from "./account-styles";

const IDLE_SETUP: TwoStepSetupState = { status: "idle" };
const IDLE_CODE: TwoStepCodeState = { status: "idle" };

/**
 * Settings → Security → Two-step verification. Off: one button, then the
 * QR code (and the secret, for an app that cannot scan), then the first
 * code. On: what it means, and turning it off with a code from the app.
 */
export function TwoStepSettings({ enabled }: { readonly enabled: boolean }) {
  return enabled ? <TurnOff /> : <TurnOn />;
}

function TurnOn() {
  const t = useT();
  const [starting, startTransition] = useTransition();
  const [current, setSetup] = useState<TwoStepSetupState>(IDLE_SETUP);
  const [confirmed, confirmAction] = useActionState(
    confirmTwoStepAction,
    IDLE_CODE,
  );

  if (current.status !== "enrolling") {
    return (
      <AccountCard data-two-step="off">
        <p className="m-0 text-[15px] text-(--cq-text-primary)">
          {t("Two-step verification is off.")}
        </p>
        <p className="m-0 text-[13px] text-(--cq-text-secondary)">
          {t(
            "Each time you sign in, you will also enter a code from an authenticator app on your phone, such as Google Authenticator, 1Password or Microsoft Authenticator.",
          )}
        </p>
        {current.status === "error" ? (
          <FormNotice tone="danger">{t(current.message)}</FormNotice>
        ) : null}
        <div>
          <button
            type="button"
            className={accountButton("primary")}
            disabled={starting}
            aria-busy={starting}
            onClick={() => {
              startTransition(async () => {
                setSetup(await startTwoStepAction());
              });
            }}
          >
            {starting ? t("Preparing…") : t("Turn on two-step verification")}
          </button>
        </div>
      </AccountCard>
    );
  }

  return (
    <AccountCard data-two-step="enrolling">
      <ol className="m-0 flex list-decimal flex-col gap-4 ps-5 text-[15px] text-(--cq-text-primary)">
        <li>
          {t("Scan this code with your authenticator app.")}
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URI from the Auth server, never fetched */}
          <img
            src={current.qrCode}
            alt={t("QR code to add Capital Q to your authenticator app")}
            width={176}
            height={176}
            className="mt-3 block rounded-(--cq-radius-md) border border-(--cq-border-subtle) bg-white p-2"
          />
          <p className="mt-3 mb-0 text-[13px] text-(--cq-text-secondary)">
            {t("Can't scan it? Enter this key in the app instead:")}
          </p>
          <code
            className="mt-1 block font-mono text-sm break-all text-(--cq-text-primary) select-all"
            data-two-step-secret
          >
            {current.secret}
          </code>
        </li>
        <li>
          {t("Enter the 6-digit code the app shows.")}
          <form action={confirmAction} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="factorId" value={current.factorId} />
            <CodeField label={t("6-digit code")} />
            {confirmed.status === "error" ? (
              <FormNotice tone="danger">{t(confirmed.message)}</FormNotice>
            ) : null}
            <div>
              <SubmitButton
                fullWidth={false}
                size="regular"
                pendingLabel={t("Checking…")}
              >
                {t("Turn on")}
              </SubmitButton>
            </div>
          </form>
        </li>
      </ol>
    </AccountCard>
  );
}

function TurnOff() {
  const t = useT();
  const [state, action] = useActionState(turnOffTwoStepAction, IDLE_CODE);
  const [open, setOpen] = useState(false);

  return (
    <AccountCard data-two-step="on">
      <p className="m-0 text-[15px] text-(--cq-text-primary)">
        {t("Two-step verification is on.")}
      </p>
      <p className="m-0 text-[13px] text-(--cq-text-secondary)">
        {t(
          "Signing in asks for a code from your authenticator app as well as your password, email link or Google.",
        )}
      </p>
      {open ? (
        <form action={action} className="flex flex-col gap-3">
          <CodeField
            label={t("6-digit code")}
            description={t(
              "To turn it off, enter a code from your authenticator app.",
            )}
            autoFocus
          />
          {state.status === "error" ? (
            <FormNotice tone="danger">{t(state.message)}</FormNotice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              variant="secondary"
              size="regular"
              fullWidth={false}
              pendingLabel={t("Turning off…")}
            >
              {t("Turn off")}
            </SubmitButton>
            <button
              type="button"
              className={accountButton("quiet")}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("Cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button
            type="button"
            className={accountButton("secondary")}
            onClick={() => {
              setOpen(true);
            }}
          >
            {t("Turn off two-step verification")}
          </button>
        </div>
      )}
    </AccountCard>
  );
}
