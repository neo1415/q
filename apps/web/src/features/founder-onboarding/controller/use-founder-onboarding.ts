"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FounderOnboardingClientError,
  type FounderOnboardingClient,
} from "../adapters/client";
import type {
  FounderOnboardingSessionView,
  StepResponse,
  TaxonomyCandidateView,
} from "../models/presentation";

/**
 * One cohesive state boundary for the onboarding screen: the current session
 * view from the adapter, the interaction phase, and the save status. Steps
 * hold only their own draft; everything durable comes back from the client.
 *
 * Save status announces transitions (saving → saved / failed), not
 * keystrokes. A failed operation keeps the draft on screen and can be
 * retried; nothing is wiped. A version conflict (the session moved on in
 * another tab) reloads the latest view and says so, without retrying the
 * stale write.
 */

export type OnboardingPhase = "loading" | "ready" | "unavailable" | "error";
export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export type FounderOnboardingState = {
  readonly phase: OnboardingPhase;
  readonly session: FounderOnboardingSessionView | undefined;
  readonly save: SaveStatus;
  readonly busy: boolean;
  readonly errorMessage: string | undefined;
  readonly canRetry: boolean;
  /** Set after a conflict reload, cleared on the next successful action. */
  readonly conflictNotice: string | undefined;
};

export type FounderOnboardingActions = {
  readonly submit: (response: StepResponse) => Promise<void>;
  readonly skip: () => Promise<void>;
  readonly back: () => Promise<void>;
  readonly openStep: (stepId: string) => Promise<void>;
  /** Marks the journey complete; navigation is the screen's decision. */
  readonly complete: () => Promise<boolean>;
  readonly findTaxonomyCandidates: (
    text: string,
  ) => Promise<readonly TaxonomyCandidateView[]>;
  readonly retry: () => Promise<void>;
};

const SAVED_NOTICE_MS = 2500;

export function useFounderOnboarding(
  client: FounderOnboardingClient | null,
): [FounderOnboardingState, FounderOnboardingActions] {
  const [phase, setPhase] = useState<OnboardingPhase>("loading");
  const [session, setSession] = useState<
    FounderOnboardingSessionView | undefined
  >(undefined);
  const [save, setSave] = useState<SaveStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  const [conflictNotice, setConflictNotice] = useState<string | undefined>(
    undefined,
  );
  const [canRetry, setCanRetry] = useState(false);
  const lastOperation = useRef<
    (() => Promise<FounderOnboardingSessionView>) | null
  >(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (client === null) {
      return;
    }
    let cancelled = false;
    client
      .getSession()
      .then((view) => {
        if (!cancelled) {
          setSession(view);
          setPhase("ready");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (
          error instanceof FounderOnboardingClientError &&
          error.kind === "UNAVAILABLE"
        ) {
          setErrorMessage(error.message);
          setPhase("unavailable");
        } else {
          setErrorMessage(
            error instanceof Error ? error.message : "Something went wrong.",
          );
          setPhase("error");
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(savedTimer.current);
    };
  }, [client]);

  const run = useCallback(
    async (
      operation: () => Promise<FounderOnboardingSessionView>,
      isSave: boolean,
    ): Promise<boolean> => {
      lastOperation.current = operation;
      setCanRetry(false);
      setBusy(true);
      setErrorMessage(undefined);
      if (isSave) {
        clearTimeout(savedTimer.current);
        setSave("saving");
      }
      try {
        const view = await operation();
        setSession(view);
        setConflictNotice(undefined);
        if (isSave) {
          setSave("saved");
          savedTimer.current = setTimeout(
            () => setSave("idle"),
            SAVED_NOTICE_MS,
          );
        }
        lastOperation.current = null;
        setCanRetry(false);
        return true;
      } catch (error) {
        const conflict =
          error instanceof FounderOnboardingClientError &&
          error.kind === "CONFLICT";
        const retryable =
          error instanceof FounderOnboardingClientError && error.retryable;
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.";
        if (isSave) {
          setSave(conflict ? "idle" : "failed");
        }
        if (conflict && client !== null) {
          // The stale write is never retried; the latest session replaces it.
          lastOperation.current = null;
          setCanRetry(false);
          try {
            setSession(await client.getSession());
            setConflictNotice(message);
          } catch {
            setErrorMessage(message);
          }
          return false;
        }
        setErrorMessage(message);
        if (!retryable) {
          lastOperation.current = null;
        }
        setCanRetry(retryable);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const requireClient = (): FounderOnboardingClient => {
    if (client === null) {
      throw new Error("Onboarding client is not ready.");
    }
    return client;
  };

  const stepId = () => session?.currentStepId ?? "";

  const actions: FounderOnboardingActions = {
    submit: async (response) => {
      await run(
        () => requireClient().saveResponse({ stepId: stepId(), response }),
        true,
      );
    },
    skip: async () => {
      await run(() => requireClient().skipStep({ stepId: stepId() }), true);
    },
    back: async () => {
      await run(() => requireClient().goBack({ stepId: stepId() }), false);
    },
    openStep: async (target) => {
      await run(() => requireClient().openStep({ stepId: target }), false);
    },
    complete: () => run(() => requireClient().complete(), true),
    findTaxonomyCandidates: (text) =>
      requireClient().findTaxonomyCandidates({ text }),
    retry: async () => {
      const operation = lastOperation.current;
      if (operation !== null) {
        await run(operation, true);
      }
    },
  };

  return [
    {
      phase,
      session,
      save,
      busy,
      errorMessage,
      canRetry,
      conflictNotice,
    },
    actions,
  ];
}
