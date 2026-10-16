"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import type { QMessage } from "@capital-q/contracts";
import {
  routeMatchesPattern,
  runShortRehearsal,
  type TranscriptSegment,
  type ActionOutcome,
  type SceneScript,
  type TourAction,
  type TourActor,
  demoApplication,
  demoInvestor,
  TOUR_PAGES,
  type TourPorts,
  type TourScript,
} from "@capital-q/q-pitch";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { openDocumentViewer } from "@/features/documents/document-ready";
import { controlOf, registeredControlIds } from "@/features/q/control/registry";
import { currentManifest } from "@/features/q/manifest";
import {
  useQSessionOptional,
  type QSessionValue,
} from "@/features/q/q-session";
import { performUiAct, requestMove } from "@/features/q/ui-act-controller";
import { destinationPath } from "@/features/voice/destinations";
import { isLineLive } from "@/features/voice/session";

import {
  fixtureKeysOf,
  receiptCompanies,
  resolveCompanyFixture,
  type ResolvedCompany,
} from "./fixtures";
import {
  abortableWait,
  createNarrator,
  narrationVoiceOn,
  prefetchStandardVoice,
  speakRehearsalTurns,
  standardVoiceLine,
  type Narrator,
} from "./narrator";
import { rehearsalPorts } from "./rehearsal-ports";
import { lightSection, unlightAll } from "./section-light";
import { TOUR_BRIEF } from "./tour-voice";

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
/** How long a question may take to become a run the Q API accepted. */
const RUN_START_WAIT_MS = 15_000;

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

/** How long a question waits for the page under it to finish loading. */
export const PAGE_SETTLE_MS = 8_000;

/**
 * Before the tour asks Q about the page: the page has finished loading and,
 * on a company page, declares that company in focus. A question goes with
 * the screen Q is told about; asked while the new page was still loading,
 * "this company" was resolved from the previous page's card (run 5, 16 Oct:
 * on Harbourline, Q answered about the feed's last company). Bounded: a
 * page that never settles is asked about anyway, and the answer's own
 * receipt decides the scene.
 */
export async function pageSettled(
  signal: AbortSignal,
  maxMs: number = PAGE_SETTLE_MS,
  /**
   * The company Q will be asked about (the session's page subject). Run 6,
   * 16 Oct: the page had settled, but the subject was still the feed's
   * last card, and the question was sent about it. On a company page the
   * question waits until the subject is that company too.
   */
  subjectCompany?: () => string | undefined,
): Promise<boolean> {
  const until = Date.now() + maxMs;
  for (;;) {
    const manifest = currentManifest();
    const loading = (manifest?.notices ?? []).some(
      (notice) => notice.kind === "LOADING",
    );
    const company = /^\/company\/([0-9a-f-]{36})/iu.exec(
      window.location.pathname,
    )?.[1];
    const focused =
      company === undefined ||
      (manifest?.focus?.id.toLowerCase() === company.toLowerCase() &&
        (subjectCompany === undefined ||
          subjectCompany()?.toLowerCase() === company.toLowerCase()));
    if (!loading && focused) return true;
    if (signal.aborted || Date.now() > until) return false;
    await sleep(150);
  }
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

/**
 * Before every move: no panel the last scene opened (notifications, a
 * booking dialog, a memo in the viewer) is left over the next scene
 * (lead 16 Oct). Closing is never consequential; each close is a receipted
 * UI act, run only when something is open.
 */
async function closePanels(): Promise<void> {
  openDocumentViewer(null);
  if (
    document.querySelector('[role="dialog"], [role="alertdialog"]') === null
  ) {
    return;
  }
  for (const id of registeredControlIds()) {
    if (controlOf(id)?.kind !== "DIALOG") continue;
    await performUiAct({
      kind: "UI_ACT",
      actId: nextActId(),
      act: "CLOSE",
      target: id,
    });
  }
}

/**
 * The questions the tour itself put to Q (by text), so the host tells a
 * viewer's own question (an interruption) from the tour's scripted ones.
 */
const TOUR_ASKS = new Set<string>();

export function isTourAsk(text: string): boolean {
  return TOUR_ASKS.has(text.trim());
}

/** How long a uiAct waits for a just-opened page to register its control. */
const UI_ACT_WAIT_MS = 6_000;

/**
 * The page for an `openRecord` key: a GateQ application in the actor's own
 * inbox (named demo application), or the actor's relationship with a named
 * company (the record page, or its call-booking dialog, which the page
 * opens from its own hash). The pages authorise the viewer themselves.
 */
/** v6 founder track: a fictional investor's page, by fixture key. */
export function investorPath(
  page: "PROFILE" | "RELATIONSHIP" | "REHEARSE",
  key: string,
): string | null {
  const investor = demoInvestor(key);
  if (investor === null) return null;
  const id = encodeURIComponent(investor.investorOrganisationId);
  return page === "PROFILE"
    ? `/investors/${id}`
    : page === "RELATIONSHIP"
      ? `/relationships/investor/${id}`
      : `/rehearsals/investor/${id}`;
}

export function recordPath(
  record: "GATEQ_APPLICATION" | "RELATIONSHIP" | "RELATIONSHIP_CALLS",
  key: string,
  companyOf: (key: string) => ResolvedCompany | null,
): string | null {
  if (record === "GATEQ_APPLICATION") {
    const id = demoApplication(key);
    return id === null
      ? null
      : `/gateq?tab=inbox&item=${encodeURIComponent(id)}`;
  }
  const company = companyOf(key);
  if (company === null) return null;
  const base = `/relationships/company/${encodeURIComponent(company.companyId.toLowerCase())}`;
  return record === "RELATIONSHIP_CALLS" ? `${base}#calls` : base;
}

/** Where rehearsal transcript segments go: the host's runner and captions. */
export type TranscriptSink = {
  current: ((segment: TranscriptSegment) => void) | null;
};

/**
 * The tour's narrator over the person's own Q voice session (owner 15 Oct):
 * the open GPT-Live line when there is one, else Q's standard TTS voice.
 * It reads the session at speaking time, never during render.
 */
function sessionNarrator(current: () => QSessionValue | null): Narrator {
  // A live line that comes up mid-tour is briefed once, on first use.
  let briefed = false;
  return createNarrator({
    live: () => {
      const voice = current()?.voice;
      const client = voice?.client;
      if (
        !narrationVoiceOn() ||
        voice === undefined ||
        client === undefined ||
        !voice.active ||
        !isLineLive(client) ||
        client.narrate === undefined
      ) {
        briefed = false;
        return null;
      }
      if (!briefed) briefed = client.brief?.(TOUR_BRIEF) ?? false;
      return {
        say: (text) => client.narrate?.(text) ?? false,
        speaking: () => current()?.voice.client.state === "Q_SPEAKING",
        hush: (on) => client.hush?.(on),
      };
    },
    tts: (text, signal) =>
      standardVoiceLine(text, current()?.voice.voice ?? "FEMALE", signal),
    now: () => performance.now(),
    wait: abortableWait,
  });
}

export function useTourPorts(
  script: TourScript,
  transcript: TranscriptSink,
  subject: ResolvedCompany | null,
): TourPorts | null {
  const session = useQSessionOptional();
  const { setOpen } = useGlobalQ();
  const router = useRouter();
  const qRef: QRef = useRef<QSessionValue | null>(null);
  const waiters = useRef(new Set<() => void>());
  // The company cards of the last acknowledged Q answer that had any,
  // snapshotted at its DONE receipt: `card-N` keys resolve from it alone.
  const receipt = useRef<readonly ResolvedCompany[]>([]);

  // The latest session, and a nudge for whoever waits on a run.
  useEffect(() => {
    qRef.current = session;
    for (const wake of [...waiters.current]) wake();
  }, [session]);

  const hasSession = session !== null;
  return useMemo<TourPorts | null>(() => {
    if (!hasSession) return null;
    // Q's own voice for the tour's lines (owner 15 Oct); captions stay.
    // Built on the first line, so the session is read only when speaking.
    let narrator: Narrator | null = null;

    const messages = (): readonly QMessage[] =>
      qRef.current?.q.state.messages ?? [];

    const companyOf = (key: string) =>
      resolveCompanyFixture(key, receipt.current, subject);

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
      unlightAll();
      await closePanels();
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
      // The receipt binds to the run THIS question starts: a run id the
      // conversation did not already hold. A refused or failed ask leaves
      // the id unchanged, so an older finished run (for example one read
      // back when the conversation opened) can never acknowledge it
      // (browser rehearsal 2026-10-15: exactly that false DONE).
      const known = new Set<string>(messages().map((m) => m.runId));
      if (q.runId !== null) known.add(q.runId);
      if (q.state.runId !== null) known.add(q.state.runId);
      await pageSettled(signal, PAGE_SETTLE_MS, () => {
        const subject = qRef.current?.subject;
        return subject?.kind === "COMPANY" ? subject.companyId : undefined;
      });
      if (signal.aborted) return outcome(false, "CANCELLED");
      setOpen(true);
      TOUR_ASKS.add(text.trim());
      if (TOUR_ASKS.size > 64) {
        const oldest = TOUR_ASKS.values().next().value;
        if (oldest !== undefined) TOUR_ASKS.delete(oldest);
      }
      await q.ask(text);
      const started = new AbortController();
      const stopWaiting = setTimeout(() => started.abort(), RUN_START_WAIT_MS);
      signal.addEventListener("abort", () => started.abort(), { once: true });
      let mine: string | null = null;
      await waitFor(() => {
        const id = qRef.current?.q.runId ?? null;
        if (id !== null && !known.has(id)) mine = id;
        return mine !== null;
      }, started.signal);
      clearTimeout(stopWaiting);
      if (signal.aborted) return outcome(false, "CANCELLED");
      const run = mine;
      if (run === null) return outcome(false, "Q_RUN_FAILED");
      const finished = await waitFor(() => {
        const state = qRef.current?.q.state;
        return state !== undefined && state.runId === run && state.terminal;
      }, signal);
      if (!finished) {
        // Interrupted mid-run: stop it rather than let it land unseen.
        await qRef.current?.q.stop().catch(() => undefined);
        return outcome(false, "CANCELLED");
      }
      const state = qRef.current?.q.state;
      if (
        state?.runId !== run ||
        state.runStatus !== "COMPLETED" ||
        state.failure !== null
      ) {
        return outcome(false, "Q_RUN_FAILED");
      }
      const visible = await answerVisible();
      if (!visible) return outcome(false, "NOT_VISIBLE", false);
      // This acknowledged answer becomes the receipt `card-N` keys use.
      const cards = receiptCompanies(state.messages, run);
      if (cards.length > 0) receipt.current = cards;
      return outcome(true, null);
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
        case "uiAct": {
          // A page just opened may not have registered its control yet:
          // retry a missing target briefly, never another act. A panel
          // opened in place starts a scene too: the last one's goes first.
          if (action.act === "OPEN") await closePanels();
          const until = Date.now() + UI_ACT_WAIT_MS;
          for (;;) {
            const receipt = await performUiAct({
              kind: "UI_ACT",
              actId: nextActId(),
              act: action.act,
              target: action.target,
              ...(action.index === undefined ? {} : { index: action.index }),
            });
            if (receipt.status === "DONE") return outcome(true, null);
            if (
              receipt.status !== "TARGET_MISSING" ||
              Date.now() > until ||
              signal.aborted
            ) {
              return outcome(
                false,
                signal.aborted
                  ? "CANCELLED"
                  : receipt.status === "TARGET_MISSING"
                    ? "TARGET_MISSING"
                    : receipt.status === "NOT_APPLICABLE"
                      ? "NOT_APPLICABLE"
                      : "FAILED",
              );
            }
            await sleep(400);
          }
        }
        case "openRecord": {
          const path = recordPath(action.record, action.key, companyOf);
          return path === null
            ? outcome(false, "FIXTURE_UNRESOLVED")
            : navigate(path, signal);
        }
        case "openInvestor": {
          const path = investorPath(action.page, action.investor);
          return path === null
            ? outcome(false, "FIXTURE_UNRESOLVED")
            : navigate(path, signal);
        }
        case "openTourPage":
          return navigate(TOUR_PAGES[action.page], signal);
        case "askApprovedQuestion": {
          const text = questionText(action.question);
          if (text === null) return outcome(false, "FIXTURE_UNRESOLVED");
          return ask(text, signal);
        }
        case "runShortRehearsal": {
          const lines = action.lines.flatMap((id) => {
            const text = questionText(id);
            return text === null ? [] : [text];
          });
          if (lines.length !== action.lines.length) {
            return outcome(false, "FIXTURE_UNRESOLVED");
          }
          // Real model turns: only in an approved live run (owner cap).
          const result = await runShortRehearsal(
            {
              ...rehearsalPorts(action.counterpart),
              // Q plays both sides, in two voices (owner 15 Oct).
              speakTurns: (segments, speaking) =>
                speakRehearsalTurns(
                  segments,
                  qRef.current?.voice.voice ?? "FEMALE",
                  speaking,
                ),
            },
            {
              narratorLines: lines,
              maxMs: action.maxMs,
              // Spoken turns make the exchange longer, and the review is
              // written after the finish (15 Oct: not ready within 9 s).
              reviewReads: 12,
              reviewReadGapMs: 2_000,
            },
            signal,
            (segment) => transcript.current?.(segment),
          );
          if (signal.aborted) return outcome(false, "CANCELLED");
          if (!result.ok) {
            return outcome(
              false,
              result.reason === "START_FAILED"
                ? "FIXTURE_UNRESOLVED"
                : "FAILED",
            );
          }
          // The review must exist before Q says it is saved.
          if (!result.reviewReady) return outcome(false, "NOT_VISIBLE", false);
          return navigate(
            `/rehearsals/r/${encodeURIComponent(result.rehearsalId)}`,
            signal,
          );
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

    // The coming lines in Q's standard voice, unless the live line speaks
    // them (it needs no synthesis ahead).
    const prefetchLines = (scenes: readonly SceneScript[]) => {
      const voice = qRef.current?.voice;
      const live =
        voice !== undefined &&
        voice.active &&
        isLineLive(voice.client) &&
        voice.client.narrate !== undefined;
      if (live) return;
      for (const scene of scenes) {
        for (const line of scene.lines) {
          prefetchStandardVoice(line.text, voice?.voice ?? "FEMALE");
        }
      }
    };

    const prepare: TourPorts["prepare"] = (
      scene: SceneScript,
      actor: TourActor,
    ) => {
      prefetchLines([scene]);
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
        prefetchLines(scenes);
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
                  : action.kind === "openRecord"
                    ? recordPath(action.record, action.key, companyOf)
                    : action.kind === "openInvestor"
                      ? investorPath(action.page, action.investor)
                      : action.kind === "openTourPage"
                        ? TOUR_PAGES[action.page]
                        : null;
            if (path !== null) router.prefetch(path);
          }
        }
      },
      execute,
      speak: async (lines, signal) => {
        narrator ??= sessionNarrator(() => qRef.current);
        // v6: a line about a section lights that section first, so the
        // light moves with the narration (owner, 16 Oct).
        for (const line of lines) {
          if (signal.aborted) return;
          if (line.anchor !== undefined) {
            await lightSection(line.anchor, { open: line.open }, signal);
          }
          await narrator.speak([line], signal);
        }
      },
      clearScoped: () => {
        receipt.current = [];
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
  }, [hasSession, script, router, setOpen, transcript, subject]);
}
