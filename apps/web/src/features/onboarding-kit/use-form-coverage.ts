"use client";

import { useCallback, useEffect, useState } from "react";

import type { OnboardingCoverage } from "@capital-q/contracts";

import { onboardingCoverageAction } from "./api-actions";

/**
 * The coverage of the session the form shows, from lane ob1's route
 * (`onboardingCoverageAction` → `GET /v1/onboarding/sessions/:id/coverage`),
 * read again whenever the session moves (every save returns a new version).
 *
 * Unlike a bare fetch it says where it is: LOADING before the first answer,
 * READY with the latest coverage, ERROR when it could not be read (the last
 * good coverage stays on screen, marked stale, with a retry). NONE when the
 * composed client has no runtime session (fixture previews) or the server
 * has no coverage for it: the form then shows its progress bar alone.
 */
export type FormCoverage =
  | { readonly status: "NONE" }
  | { readonly status: "LOADING" }
  | { readonly status: "READY"; readonly coverage: OnboardingCoverage }
  | {
      readonly status: "ERROR";
      readonly message: string;
      readonly stale: OnboardingCoverage | null;
    };

type Read = {
  readonly key: string;
  readonly result:
    | { readonly ok: true; readonly coverage: OnboardingCoverage | null }
    | { readonly ok: false; readonly message: string };
};

export function useFormCoverage(
  session:
    | {
        readonly raw?:
          | {
              readonly session: {
                readonly id: string;
                readonly version: number;
              };
            }
          | undefined;
      }
    | undefined,
): FormCoverage & { readonly retry: () => void } {
  const sessionId = session?.raw?.session.id;
  const version = session?.raw?.session.version;
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<Read | null>(null);
  const [lastGood, setLastGood] = useState<OnboardingCoverage | null>(null);
  const key =
    sessionId === undefined
      ? null
      : `${sessionId}:${String(version)}:${String(attempt)}`;

  useEffect(() => {
    if (sessionId === undefined || key === null) return;
    let live = true;
    void onboardingCoverageAction(sessionId)
      .then((result) => {
        if (!live) return;
        if (result.ok) {
          setRead({ key, result: { ok: true, coverage: result.value } });
          if (result.value !== null) setLastGood(result.value);
        } else {
          setRead({ key, result: { ok: false, message: result.message } });
        }
      })
      .catch(() => {
        if (live) {
          setRead({
            key,
            result: { ok: false, message: "Couldn't reach Capital Q." },
          });
        }
      });
    return () => {
      live = false;
    };
  }, [sessionId, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (key === null) return { status: "NONE", retry };
  if (read === null || read.key !== key) {
    // A newer version is being read: keep showing the last good coverage.
    return lastGood === null
      ? { status: "LOADING", retry }
      : { status: "READY", coverage: lastGood, retry };
  }
  if (!read.result.ok) {
    return {
      status: "ERROR",
      message: read.result.message,
      stale: lastGood,
      retry,
    };
  }
  return read.result.coverage === null
    ? { status: "NONE", retry }
    : { status: "READY", coverage: read.result.coverage, retry };
}
