"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import type { QMessage } from "@capital-q/contracts";
import {
  routeMatchesPattern,
  type ActionOutcome,
  type SceneScript,
  type TourAction,
  type TourActor,
  type TourPorts,
  type TourScript,
} from "@capital-q/q-pitch";

import { useGlobalQ } from "@/components/app-shell/global-q";
import {
  useQSessionOptional,
  type QSessionValue,
} from "@/features/q/q-session";
import { performUiAct, requestMove } from "@/features/q/ui-act-controller";
import { destinationPath } from "@/features/voice/destinations";

import { fixtureKeysOf, resolveCompanyFixture } from "./fixtures";
import { captionSpeak } from "./narrator";

/**
 * The tour's ports onto the real app (blueprint §5 "No per-click LLM
 * browsing"): every action goes through an existing acknowledged path and
 * reports what the browser actually observed.
 *
 *   openRoute / openCompany / showReview → requestMove (navigation
 *     lifecycle; DONE only once the router settled there)
 *   selectTab / scrollTo                 → performUiAct (receipt DONE)
 *   askApprovedQuestion / buildComparison→ the one Q conversation (the
 *     governed run; DONE only when the run COMPLETED and its settled
 *     answer is rendered on screen)
 *
 * Nothing here holds data across actors: the fixture cache is cleared on
 * CLEAR_SCOPED, and resolution reads only the actor's own conversation.
 */

const VISIBLE_WAIT_MS = 4_000;
const ABORT_GRACE_MS = 2_500;

type QRef = { current: QSessionValue | null };

function outcome(
  ok: boolean,
  failureCode: ActionOutcome["failureCode"],
  visible = ok,
): ActionOutcome {
  return {
    ok,
    visible,
    failureCode: ok ? null : (failureCode ?? "FAILED"),
    observedRoute: currentPath(),
  };
}

function currentPath(): string | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname;
  return /^\/[A-Za-z0-9/_.~%-]{0,300}$/u.test(path) ? path : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** A settled Q answer is rendered and laid out (not merely in state). */
async function answerVisible(): Promise<boolean> {
  const until = Date.now() + VISIBLE_WAIT_MS;
  while (Date.now() < until) {
    const settled = document.querySelectorAll('[data-q-answer="settled"]');
    for (const element of settled) {
      if (element.getClientRects().length > 0) return true;
    }
    await sleep(100);
  }
  return false;
}

let actSequence = 0;
function nextActId(): string {
  actSequence += 1;
  return `uia_qpitch${String(Date.now() % 1_000_000)}${String(actSequence)}`;
}

export function useTourPorts(script: TourScript): TourPorts | null {
  const session = useQSessionOptional();
  const { setOpen } = useGlobalQ();
  const router = useRouter();
  const qRef: QRef = useRef<QSessionValue | null>(null);
  const waiters = useRef(new Set<() => void>());
  const companies = useRef(
    new Map<string, { companyId: string; name: string }>(),
  );

  // The latest session, and a nudge for whoever waits on a run.
  useEffect(() => {
    qRef.current = session;
    for (const wake of [...waiters.current]) wake();
  }, [session]);

  const hasSession = session !== null;
  return useMemo<TourPorts | null>(() => {
    if (!hasSession) return null;

    const messages = (): readonly QMessage[] =>
      qRef.current?.q.state.messages ?? [];

    const companyOf = (key: string) => {
      const known = companies.current.get(key);
      if (known !== undefined) return known;
      const found = resolveCompanyFixture(key, messages());
      if (found !== null) companies.current.set(key, found);
      return found;
    };

    const waitFor = (
      ready: () => boolean,
      signal: AbortSignal,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        if (ready()) {
          resolve(true);
          return;
        }
        const check = () => {
          if (ready()) {
            waiters.current.delete(check);
            resolve(true);
          }
        };
        waiters.current.add(check);
        signal.addEventListener(
          "abort",
          () => {
            waiters.current.delete(check);
            resolve(false);
          },
          { once: true },
        );
      });

    const navigate = async (
      path: string,
      signal: AbortSignal,
    ): Promise<ActionOutcome> => {
      setOpen(false);
      const handle = requestMove({ path });
      const settled = await Promise.race([
        handle.settled,
        new Promise<null>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              // Give a move already under way a moment to land: the port
              // reports whether it happened, not just that we stopped waiting.
              void sleep(ABORT_GRACE_MS).then(() => resolve(null));
            },
            { once: true },
          );
        }),
      ]);
      if (settled === null) return outcome(false, "CANCELLED");
      if (settled.status === "DONE") {
        return {
          ok: true,
          visible: true,
          failureCode: null,
          observedRoute: settled.route.split(/[?#]/u)[0] ?? null,
        };
      }
      return outcome(false, settled.reason);
    };

    const ask = async (
      text: string,
      signal: AbortSignal,
    ): Promise<ActionOutcome> => {
      const q = qRef.current?.q;
      if (q === undefined) return outcome(false, "Q_RUN_FAILED");
      const prior = q.state.runId;
      setOpen(true);
      await q.ask(text);
      const finished = await waitFor(() => {
        const state = qRef.current?.q.state;
        return state !== undefined && state.runId !== prior && state.terminal;
      }, signal);
      if (!finished) {
        // Interrupted mid-run: stop it rather than let it land unseen.
        await qRef.current?.q.stop().catch(() => undefined);
        return outcome(false, "CANCELLED");
      }
      const state = qRef.current?.q.state;
      if (state?.runStatus !== "COMPLETED" || state.failure !== null) {
        return outcome(false, "Q_RUN_FAILED");
      }
      const visible = await answerVisible();
      return visible
        ? outcome(true, null)
        : outcome(false, "NOT_VISIBLE", false);
    };

    const questionText = (id: string): string | null =>
      script.questions.find((q) => q.questionId === id)?.text ?? null;

    const execute = async (
      action: TourAction,
      signal: AbortSignal,
    ): Promise<ActionOutcome> => {
      switch (action.kind) {
        case "openRoute": {
          const path = destinationPath(action.destination);
          return path === null
            ? outcome(false, "NOT_FOUND")
            : navigate(path, signal);
        }
        case "openCompany": {
          const company = companyOf(action.company);
          return company === null
            ? outcome(false, "FIXTURE_UNRESOLVED")
            : navigate(
                `/company/${encodeURIComponent(company.companyId.toLowerCase())}`,
                signal,
              );
        }
        case "showReview": {
          const path = destinationPath("REVIEWS");
          return path === null
            ? outcome(false, "NOT_FOUND")
            : navigate(path, signal);
        }
        case "showQJob":
          // No certified job fixture yet: never guess one.
          return outcome(false, "FIXTURE_UNRESOLVED");
        case "selectTab":
        case "scrollTo": {
          const receipt = await performUiAct({
            kind: "UI_ACT",
            actId: nextActId(),
            act: action.kind === "selectTab" ? "SELECT_TAB" : "SCROLL_TO",
            target: action.target,
          });
          return receipt.status === "DONE"
            ? outcome(true, null)
            : outcome(
                false,
                receipt.status === "TARGET_MISSING"
                  ? "TARGET_MISSING"
                  : receipt.status === "NOT_APPLICABLE"
                    ? "NOT_APPLICABLE"
                    : "FAILED",
              );
        }
        case "askApprovedQuestion": {
          const text = questionText(action.question);
          if (text === null) return outcome(false, "FIXTURE_UNRESOLVED");
          return ask(text, signal);
        }
        case "buildComparison": {
          const template = questionText(action.question);
          const named = action.companies.map((key) => companyOf(key));
          if (template === null || named.some((c) => c === null)) {
            return outcome(false, "FIXTURE_UNRESOLVED");
          }
          const names = named.flatMap((c) => (c === null ? [] : [c.name]));
          return ask(
            template.replace("{companies}", names.join(" and ")),
            signal,
          );
        }
      }
    };

    const prepare: TourPorts["prepare"] = (
      scene: SceneScript,
      actor: TourActor,
    ) => {
      const resolved = fixtureKeysOf(scene.actions).map((key) =>
        companyOf(key),
      );
      // A key that names a record the actor has not been shown yet may be
      // produced by an earlier action of this same scene; only fixtures
      // used by the scene's FIRST action must resolve up front.
      const first = scene.actions[0];
      const firstKeys = first === undefined ? [] : fixtureKeysOf([first]);
      if (firstKeys.some((key) => companyOf(key) === null)) {
        return Promise.resolve({
          ok: false,
          failureCode: "FIXTURE_UNRESOLVED",
        });
      }
      return Promise.resolve({
        ok: true,
        capsule: {
          sceneId: scene.sceneId,
          actor,
          sourceIds: [],
          resourceIds: resolved.flatMap((c) =>
            c === null ? [] : [c.companyId],
          ),
        },
      });
    };

    return {
      prepare,
      prefetch: (scenes) => {
        for (const scene of scenes) {
          for (const action of scene.actions) {
            const path =
              action.kind === "openRoute"
                ? destinationPath(action.destination)
                : action.kind === "openCompany"
                  ? (() => {
                      const company = companyOf(action.company);
                      return company === null
                        ? null
                        : `/company/${encodeURIComponent(company.companyId.toLowerCase())}`;
                    })()
                  : null;
            if (path !== null) router.prefetch(path);
          }
        }
      },
      execute,
      speak: captionSpeak,
      clearScoped: () => {
        companies.current.clear();
      },
      routeIntact: (pattern) => {
        const path = currentPath();
        return path !== null && routeMatchesPattern(pattern, path);
      },
      schedule: (ms, run) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
    };
    // The ports read the session through a ref; they are rebuilt only
    // when Q itself appears or goes.
  }, [hasSession, script, router, setOpen]);
}
