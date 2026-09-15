"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { FounderOnboardingAdapter } from "@capital-q/config/web";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { EmptyState, InlineNotice, Skeleton } from "@capital-q/ui/states";

import { createInvestorOnboardingClient } from "./adapters/compose";
import { INVESTOR_VOCABULARY } from "./conversation-adapter";
import { QOnboardingWorkspace } from "../onboarding-conversation/q-onboarding-workspace";
import { OnboardingProgress } from "../onboarding-kit/components/onboarding-progress";
import { OnboardingShell } from "../onboarding-kit/components/onboarding-shell";
import { useOnboardingJourney } from "../onboarding-kit/controller";
import type {
  InvestorOnboardingSessionView,
  StepResponse,
} from "./models/presentation";
import { renderStep } from "./steps/registry";

const STEP_FORM_ID = "investor-onboarding-step";

/**
 * The investor onboarding controller. Composes the configured client, drives
 * one session through the adapter, and renders whichever screen the session
 * says is current. Nothing about the journey lives here.
 */
export function InvestorOnboardingScreen({
  adapter,
  seed,
  startTalking = false,
}: {
  /** Open already talking with Q (arrival hands over with the voice on). */
  readonly startTalking?: boolean | undefined;
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}) {
  const router = useRouter();
  const client = useMemo(
    () => createInvestorOnboardingClient({ adapter, seed }),
    [adapter, seed],
  );
  const [state, actions] = useOnboardingJourney<
    InvestorOnboardingSessionView,
    StepResponse
  >(client);
  // Q leads by default (CQ-PRE-REC-001 §16); the structured screens remain
  // for direct editing (§30) and as the fallback when a step needs them.
  const [mode, setMode] = useState<"conversation" | "form">("conversation");
  // Set when the person asks for Q's voice from the form: the workspace
  // opens already talking, then this is cleared so it happens once.
  const [talkOnOpen, setTalkOnOpen] = useState(startTalking);

  if (state.phase === "unavailable") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-narrow) flex-col justify-center gap-6 px-4 py-10">
        <EmptyState
          title="Investor setup isn't available right now."
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
          <InlineNotice tone="danger" title="Investor setup couldn't load.">
            {state.errorMessage ?? "Please try again."}
          </InlineNotice>
        ) : (
          <div
            aria-busy="true"
            aria-label="Loading investor setup"
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
          title="Investor setup is complete."
          description="Your mandate is stored and private to your organisation. Discover will use it once recommendations are built; nothing is ranked for you yet."
          action={
            <Link href="/discover" className={buttonClassName("primary")}>
              Go to Discover
            </Link>
          }
        />
      </div>
    );
  }

  const step = session.step;
  const isFirst = session.steps[0]?.id === step.id;
  const isFinal = step.kind === "handoff";

  const finishFromQ = async () => {
    await actions.submit({ kind: "handoff", confirmed: true });
    if (await actions.complete()) {
      router.push("/discover");
    }
  };

  if (mode === "conversation" && session.raw !== undefined) {
    const investorOrganisationId = session.raw.session.subject?.id;
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between gap-2">
          <Link href="/home" className="cq-label text-(--cq-text-tertiary)">
            Save &amp; leave
          </Link>
          <span className="cq-label text-(--cq-text-primary)">
            Investor setup
          </span>
          <Button
            variant="quiet"
            size="compact"
            onClick={() => setMode("form")}
          >
            Use the form
          </Button>
        </div>
        <QOnboardingWorkspace
          session={session}
          vocabulary={INVESTOR_VOCABULARY}
          actions={actions}
          busy={state.busy}
          errorMessage={state.errorMessage}
          talkOnOpen={talkOnOpen}
          onEdit={(editorId) => {
            setTalkOnOpen(false);
            setMode("form");
            void actions.openStep(editorId);
          }}
          onFinish={() => void finishFromQ()}
          qSubject={
            investorOrganisationId === undefined
              ? undefined
              : { investorOrganisationId }
          }
          contextLabel={
            session.raw.session.subject === null
              ? undefined
              : "Your organisation"
          }
        />
      </div>
    );
  }

  const backToQ = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="quiet"
        size="compact"
        onClick={() => {
          setTalkOnOpen(false);
          setMode("conversation");
        }}
      >
        Back to Q
      </Button>
      <Button
        variant="primary"
        size="compact"
        onClick={() => {
          setTalkOnOpen(true);
          setMode("conversation");
        }}
      >
        Talk with Q
      </Button>
    </div>
  );

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
    // Acknowledge the handoff, then mark the journey complete. Completion is
    // journey completion only; Discover is an honest empty state until
    // recommendations exist.
    await actions.submit({ kind: "handoff", confirmed: true });
    if (await actions.complete()) {
      router.push("/discover");
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
          ? { label: "Go to Discover", onClick: () => void finish() }
          : {
              label: step.primaryActionLabel ?? "Continue",
              formId: STEP_FORM_ID,
            }
      }
      secondaryAction={
        isFinal
          ? {
              label: "Review my mandate",
              onClick: () => void actions.openStep("review"),
            }
          : step.optional
            ? { label: "Skip for now", onClick: () => void actions.skip() }
            : undefined
      }
    >
      <div key={step.id} className="contents">
        {backToQ}
        {renderStep({ step, formId: STEP_FORM_ID, busy: state.busy, actions })}
      </div>
    </OnboardingShell>
  );
}
