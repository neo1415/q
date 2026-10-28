"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { FounderOnboardingAdapter } from "@capital-q/config/web";
import { INVESTOR_STEPS } from "@capital-q/investor-onboarding";
import { Button, buttonClassName } from "@capital-q/ui/button";
import { QMark } from "@capital-q/ui/q-mark";
import { EmptyState, InlineNotice, Skeleton } from "@capital-q/ui/states";

import { createInvestorOnboardingClient } from "./adapters/compose";
import { INVESTOR_VOCABULARY } from "./conversation-adapter";
import { reviewLines } from "../onboarding-conversation/conversation";
import { QOnboardingWorkspace } from "../onboarding-conversation/q-onboarding-workspace";
import {
  ContinueLater,
  continueLaterDestination,
} from "../onboarding-kit/components/continue-later";
import { finishJourney } from "../onboarding-kit/finish";
import { FormCoverageArea } from "../onboarding-kit/components/coverage-overview";
import { OnboardingProgress } from "../onboarding-kit/components/onboarding-progress";
import { phasesFor } from "../onboarding-kit/coverage";
import { useFormCoverage } from "../onboarding-kit/use-form-coverage";
import { InvestorMaterials } from "./investor-materials";
import {
  openingMode,
  readLastMode,
  writeLastMode,
} from "../onboarding-kit/last-mode";
import { groupOf } from "./models/journey";
import { OnboardingShell } from "../onboarding-kit/components/onboarding-shell";
import { VoiceHandover } from "../voice/voice-handover";
import { useOnboardingJourney } from "../onboarding-kit/controller";
import type {
  InvestorOnboardingSessionView,
  StepResponse,
} from "./models/presentation";
import { renderStep } from "./steps/registry";
import { PreferenceLearningAsk } from "../settings/preference-learning";
import { useT } from "@/features/i18n/language";

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
  greeted: arrivedGreeted = false,
}: {
  /** Open already talking with Q (arrival hands over with the voice on). */
  readonly startTalking?: boolean | undefined;
  /** Q welcomed them on the way here; the screen does not welcome again. */
  readonly greeted?: boolean | undefined;
  readonly adapter: FounderOnboardingAdapter;
  readonly seed?: string | undefined;
}) {
  const t = useT();
  const router = useRouter();
  const client = useMemo(
    () => createInvestorOnboardingClient({ adapter, seed }),
    [adapter, seed],
  );
  const [state, actions] = useOnboardingJourney<
    InvestorOnboardingSessionView,
    StepResponse
  >(client);
  // The canonical coverage (lane ob1), the same picture Q works from.
  const coverage = useFormCoverage(state.session);
  // Q leads by default (CQ-PRE-REC-001 §16); the structured screens remain
  // for direct editing (§30) and as the fallback when a step needs them.
  // Owner 2026-10-16: resuming (`?from=home`) opens the mode they last
  // used, voice included, as the founder screen does.
  const [opening] = useState(() =>
    openingMode({
      journey: "investor",
      startTalking,
      resuming: arrivedGreeted === true,
    }),
  );
  const [mode, setMode] = useState<"conversation" | "form">(opening.mode);
  useEffect(() => {
    if (mode === "form") writeLastMode("investor", "form");
    else if (readLastMode("investor") === "form") {
      writeLastMode("investor", "conversation");
    }
  }, [mode]);
  // Set when the person asks for Q's voice from the form: the workspace
  // opens already talking, then this is cleared so it happens once.
  const [talkOnOpen, setTalkOnOpen] = useState(opening.talk);
  // One welcome per visit: arriving already welcomed, or having been
  // welcomed here once before stepping out to the form and back.
  const [greeted, setGreeted] = useState(arrivedGreeted);
  if (mode === "form" && !greeted) {
    setGreeted(true);
  }

  if (state.phase === "unavailable") {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-narrow) flex-col justify-center gap-6 px-4 py-10">
        <EmptyState
          title={t("Investor setup isn't available right now.")}
          description={
            state.errorMessage ??
            "When it is, you'll start here. Nothing you've done so far is lost."
          }
          action={
            <Link href="/home" className={buttonClassName("secondary")}>
              {t("Back to Home")}
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
          <InlineNotice
            tone="danger"
            title={t("Investor setup couldn't load.")}
          >
            {state.errorMessage ?? "Try again in a moment."}
          </InlineNotice>
        ) : (
          <div
            aria-busy="true"
            aria-label={t("Loading investor setup")}
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
    // The mandate itself, as recorded, is what "Review my mandate" is for.
    // Discover orders companies against it as soon as it is complete; this
    // screen never claims a ranking state it has not read.
    const review =
      session.raw === undefined
        ? []
        : reviewLines(session.raw, INVESTOR_VOCABULARY, session.labels);
    const { stated, unstated } = splitReview(review);
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 py-10">
        <header className="flex flex-col gap-2">
          <h1 className="cq-title-xl text-(--cq-text-primary)">
            {t("Your mandate")}
          </h1>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(
              "Private to your organisation. Discover orders the companies you see against it; change anything by telling Q.",
            )}
          </p>
        </header>
        {/* Lane ob1: the end of onboarding is a natural moment to ask, once. */}
        <PreferenceLearningAsk />
        {review.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(
              "Your mandate couldn't be shown here just now. It is still on record.",
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-6" data-mandate-review>
            {stated.map((group) => (
              <section key={group.label} className="flex flex-col gap-2">
                <h2 className="cq-label text-(--cq-text-secondary)">
                  {group.label}
                </h2>
                <dl className="flex flex-col gap-2">
                  {group.items.map((item) => (
                    <div
                      key={item.stepKey}
                      className="flex flex-col gap-0.5 sm:flex-row sm:gap-4"
                    >
                      <dt className="cq-body-sm text-(--cq-text-secondary) sm:w-48 sm:shrink-0">
                        {item.title}
                      </dt>
                      <dd className="cq-body-sm text-(--cq-text-primary)">
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            {unstated.length === 0 ? null : (
              // Unknown stays visible, one tap away: it is a valid state,
              // not a gap to fill before anything works.
              <details
                className="group border-t border-(--cq-border-subtle) pt-3"
                data-mandate-unstated
              >
                <summary className="cq-body-sm flex min-h-11 cursor-pointer items-center text-(--cq-text-secondary)">
                  Not stated yet ({unstated.length})
                </summary>
                <ul className="flex flex-col gap-1 pt-2">
                  {unstated.map((item) => (
                    <li
                      key={item.stepKey}
                      className="cq-body-sm text-(--cq-text-secondary)"
                    >
                      {item.title}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/discover" className={buttonClassName("primary")}>
            {t("Go to Discover")}
          </Link>
          <Link href="/home#q" className={buttonClassName("secondary")}>
            {t("Change it with Q")}
          </Link>
        </div>
      </div>
    );
  }

  const step = session.step;
  const isFirst = session.steps[0]?.id === step.id;
  const isFinal = step.kind === "handoff";

  const finishFromQ = async () => {
    if (await finishJourney(actions, INVESTOR_STEPS.handoff)) {
      // ADMIN-4 block: straight into "Verify you and <fund>", skippable.
      router.push("/verification?from=setup&next=discover");
    }
  };

  if (mode === "conversation" && session.raw !== undefined) {
    const investorOrganisationId = session.raw.session.subject?.id;
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-(--cq-layout-reading) flex-col gap-6 px-4 py-6">
        <div className="flex items-center justify-between gap-2">
          {/* Owner 2026-10-17: both ways out are plain buttons, not faint
              text, so nobody feels trapped in setup. */}
          <ContinueLater destination={continueLaterDestination("investor")} />
          <span className="cq-label text-(--cq-text-primary)">
            {t("Investor setup")}
          </span>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => setMode("form")}
            data-use-the-form
          >
            {t("Use the form")}
          </Button>
        </div>
        <QOnboardingWorkspace
          session={session}
          vocabulary={INVESTOR_VOCABULARY}
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
        {t("Back to Q")}
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
        {t("Talk with Q")}
      </Button>
    </div>
  );

  const notice =
    state.errorMessage !== undefined ? (
      <InlineNotice
        tone="danger"
        title={t("Couldn't save")}
        action={
          state.canRetry ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={() => void actions.retry()}
            >
              {t("Try again")}
            </Button>
          ) : undefined
        }
      >
        {state.errorMessage} Your answers on this screen are kept.
      </InlineNotice>
    ) : state.conflictNotice !== undefined ? (
      <InlineNotice tone="info" title={t("Updated elsewhere")}>
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
      // ADMIN-4 block: straight into "Verify you and <fund>", skippable.
      router.push("/verification?from=setup&next=discover");
    }
  };

  return (
    <OnboardingShell
      stepKey={step.id}
      progress={
        <div className="flex flex-col gap-2">
          <OnboardingProgress session={session} />
          <FormCoverageArea
            coverage={coverage}
            phases={phasesFor("investor")}
            busy={state.busy}
            onOpen={(fieldKey) => {
              const group = groupOf(fieldKey);
              if (group !== undefined) void actions.openStep(group.id);
            }}
            onResolve={(suggestionId, resolution) =>
              actions.resolveSuggestion({ suggestionId, resolution })
            }
          />
        </div>
      }
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
        {/* Optional fund materials, on every screen, never a gate. */}
        <div className="mt-8 border-t border-(--cq-border-subtle) pt-4">
          <InvestorMaterials
            firmReady={
              session.raw?.session.subject?.type === "INVESTOR_ORGANISATION"
            }
          />
        </div>
      </div>
    </OnboardingShell>
  );
}

type ReviewGroup = ReturnType<typeof reviewLines>[number];
type ReviewItem = ReviewGroup["items"][number];

/**
 * The review, readable (demo audit 2026-10-03: ~2,400 px of mostly "Not
 * stated" on a phone). Stated answers stay in their groups; every unstated
 * one is listed once, collapsed, at the end. A long free-text answer shown
 * word for word under a second heading is shown once.
 */
export function splitReview(review: readonly ReviewGroup[]): {
  readonly stated: readonly { label: string; items: readonly ReviewItem[] }[];
  readonly unstated: readonly ReviewItem[];
} {
  const seenText = new Set<string>();
  const unstated: ReviewItem[] = [];
  const stated = review
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => {
        const value = item.value;
        if (value === null || value === undefined || value.trim() === "") {
          unstated.push(item);
          return false;
        }
        if (value.length > 40) {
          if (seenText.has(value)) return false;
          seenText.add(value);
        }
        return true;
      }),
    }))
    .filter((group) => group.items.length > 0);
  return { stated, unstated };
}
