"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  OnboardingClientError,
  type OnboardingClient,
  type TaxonomyCandidateView,
} from "./client";
import type { SessionPresentation } from "./session";

/**
 * One cohesive state boundary for an onboarding screen: the current session
 * view from the adapter, the interaction phase and the save status. Steps
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

export type OnboardingState<TView> = {
  readonly phase: OnboardingPhase;
  readonly session: TView | undefined;
  readonly save: SaveStatus;
  readonly busy: boolean;
  readonly errorMessage: string | undefined;
  readonly canRetry: boolean;
  /** Set after a conflict reload, cleared on the next successful action. */
  readonly conflictNotice: string | undefined;
};

export type OnboardingActions<TResponse> = {
  readonly submit: (response: TResponse) => Promise<void>;
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

export function useOnboardingJourney<
  TView extends SessionPresentation<unknown>,
  TResponse,
>(
  client: OnboardingClient<TView, TResponse> | null,
): [OnboardingState<TView>, OnboardingActions<TResponse>] {
  const [phase, setPhase] = useState<OnboardingPhase>("loading");
  const [session, setSession] = useState<TView | undefined>(undefined);
  const [save, setSave] = useState<SaveStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  const [conflictNotice, setConflictNotice] = useState<string | undefined>(
    undefined,
  );
  const [canRetry, setCanRetry] = useState(false);
  const lastOperation = useRef<(() => Promise<TView>) | null>(null);
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
          error instanceof OnboardingClientError &&
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
      operation: () => Promise<TView>,
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
          error instanceof OnboardingClientError && error.kind === "CONFLICT";
        const retryable =
          error instanceof OnboardingClientError && error.retryable;
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

  const requireClient = (): OnboardingClient<TView, TResponse> => {
    if (client === null) {
      throw new Error("Onboarding client is not ready.");
    }
    return client;
  };

  const stepId = () => session?.currentStepId ?? "";

  const actions: OnboardingActions<TResponse> = {
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
    { phase, session, save, busy, errorMessage, canRetry, conflictNotice },
    actions,
  ];
}
