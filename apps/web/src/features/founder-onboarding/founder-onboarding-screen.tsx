"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import type { FounderOnboardingAdapter } from "@capital-q/config/web";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { EmptyState, InlineNotice, Skeleton } from "@capital-q/ui/states";

import { createFounderOnboardingClient } from "./adapters/compose";
import { OnboardingProgress } from "./components/onboarding-progress";
import { OnboardingShell } from "./components/onboarding-shell";
import { useFounderOnboarding } from "./controller/use-founder-onboarding";
import { renderStep } from "./steps/registry";

const STEP_FORM_ID = "founder-onboarding-step";

/**
 * The founder onboarding controller. Composes the configured client, drives
 * one session through the adapter, and renders whichever screen the session
 * says is current. Nothing about the journey lives here.
 */
export function FounderOnboardingScreen({
  adapter,
  seed,
}: {
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}) {
  const router = useRouter();
  const client = useMemo(
    () => createFounderOnboardingClient({ adapter, seed }),
    [adapter, seed],
  );
  const [state, actions] = useFounderOnboarding(client);

  if (state.phase === "unavailable") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-narrow) flex-col justify-center gap-6 px-4 py-10">
        <EmptyState
          title="Founder setup isn't available right now."
          description={
            state.errorMessage ??
            "When it is, you'll start here. Nothing you've done so far is lost."
          }
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              Back to Home
            </Link>
          }
        />
      </div>
    );
  }

  if (state.phase === "error" || state.session === undefined) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 py-10">
        {state.phase === "error" ? (
          <InlineNotice tone="danger" title="Founder setup couldn't load.">
            {state.errorMessage ?? "Please try again."}
          </InlineNotice>
        ) : (
          <div
            aria-busy="true"
            aria-label="Loading founder setup"
            className="flex flex-col gap-4"
          >
            <Skeleton lines={1} className="w-1/2" />
            <Skeleton lines={3} />
          </div>
        )}
      </div>
    );
  }

  const { session } = state;

  if (session.status === "complete" || session.step === undefined) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-narrow) flex-col justify-center gap-6 px-4 py-10">
        <EmptyState
          title="Founder setup is complete."
          description="Your company profile is in place. You can keep improving it from Home; investors don't see any of it until you choose to become discoverable."
          action={
            <Link href="/home" className={buttonClassName("primary")}>
              Go to Home
            </Link>
          }
        />
      </div>
    );
  }

  const step = session.step;
  const isFirst = session.steps[0]?.id === step.id;
  const isFinal = step.kind === "snapshot";

  const notice =
    state.errorMessage !== undefined ? (
      <InlineNotice
        tone="danger"
        title="Couldn't save"
        action={
          state.canRetry ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={() => void actions.retry()}
            >
              Retry
            </Button>
          ) : undefined
        }
      >
        {state.errorMessage} Your answers on this screen are kept.
      </InlineNotice>
    ) : state.conflictNotice !== undefined ? (
      <InlineNotice tone="info" title="Updated elsewhere">
        {state.conflictNotice}
      </InlineNotice>
    ) : session.source.synthetic ? (
      <p className="cq-caption text-(--cq-text-tertiary)">
        Development preview: synthetic data from {session.source.adapter}.
        Nothing is sent or stored outside this browser tab.
      </p>
    ) : undefined;

  const finish = async () => {
    // Confirm the snapshot, then mark the journey complete. Completion is
    // journey completion only; Home decides what comes next.
    await actions.submit({ kind: "snapshot", confirmed: true });
    if (await actions.complete()) {
      router.push("/home");
    }
  };

  return (
    <OnboardingShell
      progress={<OnboardingProgress session={session} />}
      onBack={isFirst ? undefined : () => void actions.back()}
      busy={state.busy}
      saveStatus={state.save}
      notice={notice}
      primaryAction={
        isFinal
          ? { label: "Go to Home", onClick: () => void finish() }
          : {
              label: step.primaryActionLabel ?? "Continue",
              formId: STEP_FORM_ID,
            }
      }
      secondaryAction={
        isFinal
          ? {
              label: "Keep improving",
              onClick: () => void actions.openStep("review"),
            }
          : step.optional
            ? { label: "Skip for now", onClick: () => void actions.skip() }
            : undefined
      }
    >
      <div key={step.id} className="contents">
        {renderStep({ step, formId: STEP_FORM_ID, busy: state.busy, actions })}
      </div>
    </OnboardingShell>
  );
}
