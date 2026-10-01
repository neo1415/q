"use client";

import type { QConduct, QSentenceGesture } from "@capital-q/contracts";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnboardingResponseValue,
  OnboardingUnderstanding,
} from "@capital-q/contracts";

import {
  OnboardingClientError,
  type MaterialUploadOutcome,
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

/**
 * What came back from one turn of the interview (QX-004 core gate: one Q).
 *
 * `reply` is Q's own words and is rendered as given; composing a sentence
 * from the fields beside it is how a second conversation gets built in a
 * browser, which is the defect this removes. `understood` is what the
 * deterministic runtime read into the sentence, and is null when the one
 * interviewer answered.
 */
export type OnboardingTurn = {
  readonly understood: OnboardingUnderstanding | null;
  readonly reply: string | null;
  /** Where Q is taking the person, if anywhere; "FORM" hands over to the form. */
  readonly navigate: string | null;
  /**
   * What Q said it would look into, when the turn asked for something
   * real (CQ-QX-005). The surface carries it to the same Q run a spoken
   * turn would start, then returns to the interview.
   */
  readonly researching: string | null;
  /** Q's patience after the turn (founder direction 2026-09-30). */
  readonly conduct?: QConduct | undefined;
  /** PRESENCE: what Q's particles form for which sentence. */
  readonly gestures?: readonly QSentenceGesture[] | undefined;
};

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
  /**
   * Upload a document for the current document-gathering step. Refuses
   * plainly when the composed client has no upload path, rather than
   * reporting a success nothing performed.
   */
  readonly uploadMaterial: (input: {
    readonly file: File;
    readonly documentType: string;
  }) => Promise<MaterialUploadOutcome>;
  readonly removeMaterial: (documentId: string) => Promise<void>;
  /**
   * Accept, correct or decline one of Q's proposals (CQ-C5-R2B §11).
   * Returns false when this build has no path to record the decision, so a
   * screen never shows a confirmation nothing performed.
   */
  readonly resolveSuggestion: (input: {
    readonly suggestionId: string;
    readonly resolution: "ACCEPT" | "EDIT" | "REJECT";
    readonly response?: OnboardingResponseValue | undefined;
  }) => Promise<boolean>;
  /**
   * Answer or set aside one of Q's questions (CQ-PRE-REC-001). Returns
   * false when this build has no path to record it.
   */
  readonly answerQuestion: (input: {
    readonly questionId: string;
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
  }) => Promise<boolean>;
  readonly dismissQuestion: (questionId: string) => Promise<boolean>;
  /**
   * A tapped option, as the structured value it stands for
   * (CQ-Q-VOICE-001 B §17-§18). Returns false when this build has no direct
   * path to record it.
   */
  readonly submitValue: (input: {
    readonly stepKey: string;
    readonly value: OnboardingResponseValue;
  }) => Promise<boolean>;
  /**
   * One turn of the conversational interview (CQ-PRE-REC-001 §16-§21),
   * held by the one Q interviewer (QX-004 core gate: one Q).
   *
   * Resolves to Q's own words and to whatever the deterministic runtime
   * read into the sentence, or to null when this build has no path — never
   * a fabricated acknowledgement.
   */
  readonly say: (
    text: string,
    recentTurns: readonly {
      readonly role: "person" | "q";
      readonly text: string;
    }[],
  ) => Promise<OnboardingTurn | null>;
  /** Re-read the session from the runtime (Q's reading may have landed). */
  readonly refresh: () => Promise<void>;
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
            error instanceof Error
              ? error.message
              : "That didn't work. Try again in a moment.",
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
            : "That didn't work. Try again in a moment.";
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
    uploadMaterial: async (input) => {
      const upload = requireClient().uploadMaterial;
      if (upload === undefined) {
        // No upload path is composed. Saying so is the honest answer; a
        // fabricated success would tell the founder their deck was read.
        return {
          ok: false,
          message: "Uploading isn't available here right now.",
        };
      }
      setBusy(true);
      try {
        const outcome = await upload(input);
        if (outcome.ok) {
          // The session view carries the document list and its processing
          // state, so a completed upload is reflected by re-reading it
          // rather than by the browser remembering what it sent.
          await run(() => requireClient().getSession(), false);
        }
        return outcome;
      } catch (error: unknown) {
        return {
          ok: false,
          message:
            error instanceof OnboardingClientError
              ? error.message
              : "We couldn't upload that file. Try again, or continue without it.",
        };
      } finally {
        setBusy(false);
      }
    },
    removeMaterial: async (documentId) => {
      const remove = requireClient().removeMaterial;
      if (remove === undefined) {
        return;
      }
      await run(() => remove({ documentId }), false);
    },
    resolveSuggestion: async (input) => {
      const resolve = requireClient().resolveSuggestion;
      if (resolve === undefined) {
        // No path to record the decision. Saying so is the honest answer;
        // a silent success would leave a proposal looking accepted.
        return false;
      }
      await run(() => resolve(input), true);
      return true;
    },
    answerQuestion: async (input) => {
      const answer = requireClient().answerQuestion;
      if (answer === undefined) {
        return false;
      }
      return run(() => answer(input), true);
    },
    dismissQuestion: async (questionId) => {
      const dismiss = requireClient().dismissQuestion;
      if (dismiss === undefined) {
        return false;
      }
      return run(() => dismiss({ questionId }), true);
    },
    submitValue: async (input) => {
      const submit = requireClient().submitValue;
      if (submit === undefined) {
        return false;
      }
      return run(() => submit(input), true);
    },
    say: async (text, recentTurns) => {
      const say = requireClient().say;
      if (say === undefined) {
        return null;
      }
      let turn: OnboardingTurn | null = null;
      /**
       * An opening turn is Q asking itself what to ask (QX-004 core gate:
       * one Q). Nothing is being saved and nothing of the person's is at
       * stake, so a Q that cannot answer must not take the screen down
       * with it: the step's own prompt is a worse question than Q's, and
       * a great deal better than "Investor setup couldn't load."
       */
      if (text.length === 0) {
        // Busy while Q opens, so the composer is closed until the opening
        // has settled. Left open, a person who typed straight away had a
        // second turn in flight against the same session version; the
        // opening answered last and took the screen, and the typed turn
        // came back a conflict the screen could not show.
        setBusy(true);
        try {
          const outcome = await say({ text, recentTurns });
          setSession(outcome.view);
          return {
            understood: outcome.understood,
            reply: outcome.reply,
            navigate: outcome.navigate,
            researching: outcome.researching,
            conduct: outcome.conduct,
            gestures: outcome.gestures,
          };
        } catch {
          return null;
        } finally {
          setBusy(false);
        }
      }
      const ok = await run(async () => {
        const outcome = await say({ text, recentTurns });
        turn = {
          understood: outcome.understood,
          reply: outcome.reply,
          navigate: outcome.navigate,
          researching: outcome.researching,
          conduct: outcome.conduct,
          gestures: outcome.gestures,
        };
        return outcome.view;
      }, true);
      return ok ? turn : null;
    },
    refresh: async () => {
      const reload = requireClient().reload;
      if (reload === undefined) {
        return;
      }
      await run(reload, false);
    },
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
