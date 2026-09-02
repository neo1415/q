"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  FounderOnboardingClientError,
  type FounderOnboardingClient,
} from "../adapters/client";
import type {
  FounderOnboardingSessionView,
  StepResponse,
} from "../models/presentation";

/**
 * One cohesive state boundary for the onboarding screen: the current session
 * view from the adapter, the interaction phase, and the save status. Steps
 * hold only their own draft; everything durable comes back from the client.
 *
 * Save status announces transitions (saving → saved / failed), not
 * keystrokes. A failed operation keeps the draft on screen and can be
 * retried; nothing is wiped.
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
};

export type FounderOnboardingActions = {
  readonly submit: (response: StepResponse) => Promise<void>;
  readonly skip: () => Promise<void>;
  readonly back: () => Promise<void>;
  readonly openStep: (stepId: string) => Promise<void>;
  readonly attachFile: (file: {
    name: string;
    sizeBytes: number;
    type: string;
  }) => Promise<void>;
  readonly removeFile: (fileId: string) => Promise<void>;
  readonly retryFile: (fileId: string) => Promise<void>;
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
    ) => {
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
        if (isSave) {
          setSave("saved");
          savedTimer.current = setTimeout(
            () => setSave("idle"),
            SAVED_NOTICE_MS,
          );
        }
        lastOperation.current = null;
        setCanRetry(false);
      } catch (error) {
        const retryable =
          error instanceof FounderOnboardingClientError && error.retryable;
        const message =
          error instanceof Error
            ? error.message
            : "Something went wrong. Please try again.";
        setErrorMessage(message);
        if (isSave) {
          setSave("failed");
        }
        // Only a transient failure keeps the operation available to retry.
        if (!retryable) {
          lastOperation.current = null;
        }
        setCanRetry(retryable);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const requireClient = (): FounderOnboardingClient => {
    if (client === null) {
      throw new Error("Onboarding client is not ready.");
    }
    return client;
  };

  const stepId = () => session?.currentStepId ?? "";

  const actions: FounderOnboardingActions = {
    submit: (response) =>
      run(
        () => requireClient().saveResponse({ stepId: stepId(), response }),
        true,
      ),
    skip: () => run(() => requireClient().skipStep({ stepId: stepId() }), true),
    back: () => run(() => requireClient().goBack({ stepId: stepId() }), false),
    openStep: (target) =>
      run(() => requireClient().openStep({ stepId: target }), false),
    attachFile: (file) =>
      run(() => requireClient().attachFile({ stepId: stepId(), file }), true),
    removeFile: (fileId) =>
      run(() => requireClient().removeFile({ stepId: stepId(), fileId }), true),
    retryFile: (fileId) =>
      run(() => requireClient().retryFile({ stepId: stepId(), fileId }), true),
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
    },
    actions,
  ];
}
