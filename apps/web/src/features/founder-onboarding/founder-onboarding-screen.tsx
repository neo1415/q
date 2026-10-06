"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { FounderOnboardingAdapter } from "@capital-q/config/web";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { QMark } from "@capital-q/ui/q-mark";
import { EmptyState, InlineNotice, Skeleton } from "@capital-q/ui/states";

import { createFounderOnboardingClient } from "./adapters/compose";
import { FOUNDER_VOCABULARY } from "./conversation-adapter";
import { QOnboardingWorkspace } from "../onboarding-conversation/q-onboarding-workspace";
import { OnboardingProgress } from "../onboarding-kit/components/onboarding-progress";
import { OnboardingShell } from "../onboarding-kit/components/onboarding-shell";
import { VoiceHandover } from "../voice/voice-handover";
import { useFounderOnboarding } from "./controller/use-founder-onboarding";
import { renderStep } from "./steps/registry";

const STEP_FORM_ID = "founder-onboarding-step";

/**
 * The founder onboarding controller. Composes the configured client, drives
 * one session through the adapter, and renders whichever screen the session
 * says is current. Nothing about the journey lives here.
 */
const MODE_KEY = "cq.onboarding.founder.mode";
/** F17: how long "Go to Home" waits for Q's first reading, in tries. */
const FINISH_TRIES = 8;
const FINISH_WAIT_MS = 2500;

export function FounderOnboardingScreen({
  adapter,
  seed,
  startTalking = false,
  greeted: arrivedGreeted = false,
  openReview = false,
}: {
  /** Open already talking with Q (arrival hands over with the voice on). */
  readonly startTalking?: boolean | undefined;
  /** Q welcomed them on the way here; the screen does not welcome again. */
  readonly greeted?: boolean | undefined;
  /** Open the review of a finished setup, to change what the profile says. */
  readonly openReview?: boolean | undefined;
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}) {
  const router = useRouter();
  const client = useMemo(
    () => createFounderOnboardingClient({ adapter, seed }),
    [adapter, seed],
  );
  const [state, actions] = useFounderOnboarding(client);
  // Q leads by default (CQ-PRE-REC-001 §16); the structured screens remain
  // for direct editing (§30) and as the fallback when a step needs them.
  const [mode, setMode] = useState<"conversation" | "form">("conversation");
  // F15: a founder who chose the form resumes in the form; voice opens only
  // when asked for (`?talk=1` or "Talk with Q"). A per-browser convenience.
  useEffect(() => {
    if (startTalking) return;
    try {
      if (window.localStorage.getItem(MODE_KEY) === "form") setMode("form");
    } catch {
      // Storage unavailable: Q leads, as before.
    }
  }, [startTalking]);
  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // Nothing to remember it in; harmless.
    }
  }, [mode]);
  // F17: "Go to Home" waits for Q's first reading instead of failing.
  const [finishing, setFinishing] = useState(false);
  // Set when the person asks for Q's voice from the form: the workspace
  // opens already talking, then this is cleared so it happens once.
  const [talkOnOpen, setTalkOnOpen] = useState(startTalking);
  // One welcome per visit: arriving already welcomed, or having been
  // welcomed here once before stepping out to the form and back.
  const [greeted, setGreeted] = useState(arrivedGreeted);
  if (mode === "form" && !greeted) {
    setGreeted(true);
  }
  // A finished setup asked to be reviewed opens its review step once.
  const reviewOpened = useRef(false);
  const sessionStatus = state.session?.status;
  const sessionStep = state.session?.step;
  const openStep = actions.openStep;
  useEffect(() => {
    if (
      openReview === true &&
      !reviewOpened.current &&
      sessionStatus === "complete" &&
      sessionStep === undefined
    ) {
      reviewOpened.current = true;
      void openStep("review");
    }
  }, [openReview, sessionStatus, sessionStep, openStep]);

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

  // Handed over by voice from Q's first minute: the voice stage holds
  // while the setup loads, so no skeleton flashes between two lines.
  if (startTalking && state.phase === "loading") {
    return <VoiceHandover line="Q is getting your setup ready" />;
  }

  if (state.phase === "error" || state.session === undefined) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 py-10">
        {state.phase === "error" ? (
          <InlineNotice tone="danger" title="Founder setup couldn't load.">
            {state.errorMessage ?? "Try again in a moment."}
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
        <h1 className="sr-only">Founder setup</h1>
        {/* Whether investors see the company is the visibility setting's
            to say; this screen does not know it, so it does not claim it
            (R30 #19). */}
        <EmptyState
          title="Founder setup is complete."
          description="Your company profile is in place. Tell Q what to change, in your own words, and approve it. What investors can see follows your visibility settings."
          action={
            <div className="flex flex-wrap gap-2">
              <Link href="/home" className={buttonClassName("primary")}>
                Go to Home
              </Link>
              {/*
               * A finished setup cannot be stepped back into: the review
               * step belongs to an active session, and the button that
               * tried did nothing. Changes go through Q now (ADR 0011).
               */}
              <Link
                href="/company/visibility"
                className={buttonClassName("secondary")}
              >
                See what investors will see
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const step = session.step;
  const isFirst = session.steps[0]?.id === step.id;
  const isFinal = step.kind === "snapshot";

  const finishFromQ = async () => {
    await actions.submit({ kind: "snapshot", confirmed: true });
    if (await actions.complete()) {
      // ADMIN-4 block (founder direction 2026-10-02): straight into
      // "Verify you and <company>", skippable; skipping goes on to the
      // profile, where the founder checks what Q put together (2026-09-30).
      router.push("/verification?from=setup&next=profile");
    }
  };

  if (mode === "conversation" && session.raw !== undefined) {
    const companyId = session.raw.session.subject?.id;
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between gap-2">
          <Link href="/discover" className="cq-label text-(--cq-text-tertiary)">
            Save &amp; leave
          </Link>
          <span className="cq-label text-(--cq-text-primary)">
            Founder setup
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
          vocabulary={FOUNDER_VOCABULARY}
          actions={actions}
          busy={state.busy}
          errorMessage={state.errorMessage}
          talkOnOpen={talkOnOpen}
          greeted={greeted}
          onEdit={(editorId) => {
            setTalkOnOpen(false);
            setMode("form");
            void actions.openStep(editorId);
          }}
          onFinish={() => void finishFromQ()}
          qSubject={companyId === undefined ? undefined : { companyId }}
          contextLabel={
            session.raw.session.subject === null ? undefined : "Your company"
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
      {/* The form's one primary is Continue; Q's voice is the alternative. */}
      <Button
        variant="secondary"
        size="regular"
        onClick={() => {
          setTalkOnOpen(true);
          setMode("conversation");
        }}
      >
        <QMark size="sm" />
        Talk with Q
      </Button>
    </div>
  );

  const notice = finishing ? (
    <InlineNotice tone="info" title="Almost there">
      Q is finishing its first reading of your company. This takes a few
      seconds; you&apos;ll go on by yourself.
    </InlineNotice>
  ) : state.errorMessage !== undefined ? (
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
            Try again
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
      Development preview: synthetic data from {session.source.adapter}. Nothing
      is sent or stored outside this browser tab.
    </p>
  ) : undefined;

  const finish = async () => {
    // Confirm the snapshot, then mark the journey complete. Completion is
    // journey completion only; Home decides what comes next.
    setFinishing(true);
    try {
      await actions.submit({ kind: "snapshot", confirmed: true });
      // F17: while Q's first reading runs, completing is refused for a few
      // seconds. Wait it out here, with a calm line on screen, rather than
      // showing the refusal.
      for (let attempt = 0; attempt < FINISH_TRIES; attempt += 1) {
        if (await actions.complete()) {
          // ADMIN-4 block (founder direction 2026-10-02): straight into
          // "Verify you and <company>", skippable; skipping goes on to the
          // profile, where the founder checks what Q put together.
          router.push("/verification?from=setup&next=profile");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, FINISH_WAIT_MS));
      }
    } finally {
      setFinishing(false);
    }
  };

  return (
    <OnboardingShell
      stepKey={step.id}
      progress={<OnboardingProgress session={session} />}
      onBack={isFirst ? undefined : () => void actions.back()}
      busy={state.busy}
      saveStatus={state.save}
      notice={notice}
      primaryAction={
        isFinal
          ? {
              label: finishing ? "Preparing your analysis…" : "Go to Home",
              onClick: () => {
                if (!finishing) void finish();
              },
            }
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
        {backToQ}
        {renderStep({ step, formId: STEP_FORM_ID, busy: state.busy, actions })}
      </div>
    </OnboardingShell>
  );
}
