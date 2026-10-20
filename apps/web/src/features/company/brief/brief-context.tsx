"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import {
  ASSUMPTION_QUESTION_MAX_LENGTH,
  ASSUMPTION_QUESTIONS_SEND_MAX,
  type AssumptionBoardDto,
  type QViewDto,
} from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";
import { Check, ICON_SIZE, X } from "@capital-q/ui/icons";
import { SheetContent, SheetRoot } from "@capital-q/ui/sheet";

import { sendQuestionsAction } from "@/features/assumptions/assumption-actions";
import type { QuestionsRoute } from "@/features/assumptions/assumptions-section";
import { useQView } from "@/features/fit/q-view-note";
import { useT } from "@/features/i18n/language";

import {
  RequestSheet,
  type RoomRequestTarget,
} from "../material/request-sheet";

/**
 * The decision brief's shared state (profile option 1, owner 2026-10-20):
 * the questions for the founders, the data-room requests, and one quiet
 * notice. The ribbon, the Overview's gaps, the Pitch deck's gaps and the
 * Diligence tab all read and add to the same list, so "A gap becomes a
 * question" is one list wherever it is pressed.
 *
 * Sending is Prepare -> Recommend -> Human approval -> Execute: Q drafted
 * the questions from the gaps (prepare), the ribbon says why they matter
 * (recommend), the sheet shows the exact words the company will receive
 * and only "Approve and send" sends them (approval), under one idempotency
 * key bound to exactly that text; any edit mints a new key (execute once).
 */

export type QuestionDraft = {
  readonly id: string;
  readonly question: string;
  /** What it is about, in a few words ("Lead investor"). */
  readonly topic: string;
  /** The assumption it came from, so the board can show it answered. */
  readonly about: { readonly assumptionId: string; readonly label: string } | null;
  readonly from: "BOARD" | "GAP" | "Q";
};

/** The questions Q drafted from the gaps this investor can see, unsent. */
export function draftsFromBoard(
  board: AssumptionBoardDto | null,
  qUnknowns: readonly string[],
): readonly QuestionDraft[] {
  if (board === null) {
    return qUnknowns.slice(0, 3).map((question, index) => ({
      id: `q:${String(index)}`,
      question: question.slice(0, ASSUMPTION_QUESTION_MAX_LENGTH),
      topic: question.replace(/\?$/u, "").split(/\s+/u).slice(0, 5).join(" "),
      about: null,
      from: "Q" as const,
    }));
  }
  const rank = { UNKNOWN: 0, CLAIMED: 1, EVIDENCED: 2 } as const;
  return board.assumptions
    .filter((a) => a.asked === undefined && a.standing !== "EVIDENCED")
    .map((a, order) => ({ a, order }))
    .sort(
      (x, y) => rank[x.a.standing] - rank[y.a.standing] || x.order - y.order,
    )
    .slice(0, 3)
    .map(({ a }) => ({
      id: a.id,
      question: a.question,
      topic: a.label,
      about: { assumptionId: a.id, label: a.label.slice(0, 120) },
      from: "BOARD" as const,
    }));
}

type Brief = {
  readonly companyId: string;
  readonly companyName: string;
  /** Who the questions go to, in words. */
  readonly who: string;
  readonly route: QuestionsRoute;
  /** Q's view of the company (a labelled inference); null: none. */
  readonly qView: Extract<QViewDto, { status: "READY" }> | null;
  readonly drafts: readonly QuestionDraft[];
  /** Asked and waiting for the founders' answer. */
  readonly waiting: number;
  readonly sentAt: string | null;
  readonly addGap: (key: string, topic: string, question: string) => void;
  readonly hasGap: (key: string) => boolean;
  readonly openQuestions: () => void;
  readonly requested: ReadonlySet<string>;
  readonly requestDocuments: (target: RoomRequestTarget) => void;
  readonly markRequested: (target: RoomRequestTarget) => void;
  readonly notify: (words: string) => void;
};

const BriefContext = createContext<Brief | null>(null);

/** The brief, or null outside an investor's profile (the owner, tests). */
export function useBrief(): Brief | null {
  return useContext(BriefContext);
}

/**
 * The data room's requests: the brief's when there is one, so the ribbon
 * and the room agree, else the room's own.
 */
export function useRoomRequests(): {
  readonly requested: ReadonlySet<string>;
  readonly markRequested: (target: RoomRequestTarget) => void;
  readonly shared: boolean;
} {
  const brief = useContext(BriefContext);
  const [local, setLocal] = useState<ReadonlySet<string>>(new Set());
  const markLocal = useCallback(
    (target: RoomRequestTarget) =>
      setLocal(
        (previous) =>
          new Set([...previous, target === "ALL" ? "*" : target.documentId]),
      ),
    [],
  );
  return brief === null
    ? { requested: local, markRequested: markLocal, shared: false }
    : {
        requested: brief.requested,
        markRequested: brief.markRequested,
        shared: true,
      };
}

export function BriefProvider({
  companyId,
  companyName,
  who,
  route,
  board,
  qView: initialView,
  children,
}: {
  readonly companyId: string;
  readonly companyName: string;
  readonly who: string;
  readonly route: QuestionsRoute;
  readonly board: AssumptionBoardDto | null;
  /** A view in hand (design review); undefined asks the Q API once. */
  readonly qView?: QViewDto | null | undefined;
  readonly children: ReactNode;
}) {
  const view = useQView(companyId, initialView);
  const qView = view !== null && view.status === "READY" ? view : null;
  const qUnknowns = useMemo(() => qView?.unknowns ?? [], [qView]);
  const [gaps, setGaps] = useState<readonly QuestionDraft[]>([]);
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [asking, setAsking] = useState<RoomRequestTarget | null>(null);
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ words: string; at: number } | null>(
    null,
  );

  const drafts = useMemo(
    () =>
      [...draftsFromBoard(board, qUnknowns), ...gaps]
        .filter((draft) => !sent.has(draft.id))
        .slice(0, ASSUMPTION_QUESTIONS_SEND_MAX),
    [board, qUnknowns, gaps, sent],
  );
  const waiting =
    (board?.assumptions.filter(
      (a) => a.asked !== undefined && a.asked.answer === null,
    ).length ?? 0) + sent.size;

  const notify = useCallback(
    (words: string) => setNotice({ words, at: Date.now() }),
    [],
  );
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  const addGap = useCallback((key: string, topic: string, question: string) => {
    setGaps((current) =>
      current.some((draft) => draft.id === `gap:${key}`)
        ? current
        : [
            ...current,
            {
              id: `gap:${key}`,
              question: question.slice(0, ASSUMPTION_QUESTION_MAX_LENGTH),
              topic,
              about: null,
              from: "GAP",
            },
          ],
    );
  }, []);
  const hasGap = useCallback(
    (key: string) =>
      gaps.some((draft) => draft.id === `gap:${key}`) ||
      sent.has(`gap:${key}`),
    [gaps, sent],
  );
  const markRequested = useCallback(
    (target: RoomRequestTarget) =>
      setRequested(
        (previous) =>
          new Set([...previous, target === "ALL" ? "*" : target.documentId]),
      ),
    [],
  );

  const value = useMemo<Brief>(
    () => ({
      companyId,
      companyName,
      who,
      route,
      qView,
      drafts,
      waiting,
      sentAt,
      addGap,
      hasGap,
      openQuestions: () => setSheet(true),
      requested,
      requestDocuments: setAsking,
      markRequested,
      notify,
    }),
    [
      companyId,
      companyName,
      who,
      route,
      qView,
      drafts,
      waiting,
      sentAt,
      addGap,
      hasGap,
      requested,
      markRequested,
      notify,
    ],
  );

  return (
    <BriefContext.Provider value={value}>
      {children}
      <QuestionsSheet
        open={sheet}
        onOpenChange={setSheet}
        drafts={drafts}
        who={who}
        companyName={companyName}
        route={route}
        onSent={(ids, via) => {
          setSent((previous) => new Set([...previous, ...ids]));
          setSentAt(new Date().toISOString());
          setSheet(false);
          notify(
            via === "DILIGENCE_REQUEST"
              ? `${String(ids.length)} ${ids.length === 1 ? "question" : "questions"} sent to ${who}. They see them on their diligence checklist.`
              : `${String(ids.length)} ${ids.length === 1 ? "question" : "questions"} sent to ${who} in your chat.`,
          );
        }}
      />
      <RequestSheet
        companyId={companyId}
        companyName={companyName}
        target={asking}
        onClose={() => setAsking(null)}
        onSent={(target) => {
          markRequested(target);
          setAsking(null);
          notify(
            `Requested. ${companyName} decides who sees ${target === "ALL" ? "them" : "it"}.`,
          );
        }}
      />
      {notice === null ? null : (
        <div className="cq-brief-toast" key={notice.at}>
          <p role="status">
            <Check size={ICON_SIZE.compact} aria-hidden="true" />
            {notice.words}
          </p>
        </div>
      )}
    </BriefContext.Provider>
  );
}

/**
 * The exact questions, as the company will read them. Editing is allowed;
 * an edit is a new payload, so it is approved afresh under a new key.
 */
function QuestionsSheet({
  open,
  onOpenChange,
  drafts,
  who,
  companyName,
  route,
  onSent,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly drafts: readonly QuestionDraft[];
  readonly who: string;
  readonly companyName: string;
  readonly route: QuestionsRoute;
  readonly onSent: (ids: readonly string[], via: string) => void;
}) {
  const t = useT();
  const [texts, setTexts] = useState<Readonly<Record<string, string>>>({});
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef<string | null>(null);

  // A new key each time the sheet opens, and on every change of wording.
  useEffect(() => {
    if (open) {
      key.current = `questions-${crypto.randomUUID()}`;
      setError(null);
    } else {
      setTexts({});
      setDropped(new Set());
    }
  }, [open]);

  const chosen = drafts.filter((draft) => !dropped.has(draft.id));
  const words = chosen.map((draft) =>
    (texts[draft.id] ?? draft.question).trim(),
  );
  const valid =
    chosen.length > 0 &&
    words.every(
      (text) => text.length >= 3 && text.length <= ASSUMPTION_QUESTION_MAX_LENGTH,
    );
  const rekey = () => {
    key.current = `questions-${crypto.randomUUID()}`;
  };

  const approve = () => {
    if (route.kind === "NOT_CONNECTED" || key.current === null || !valid)
      return;
    const idempotencyKey = key.current;
    start(async () => {
      const result = await sendQuestionsAction({
        relationshipId: route.relationshipId,
        questions: words,
        about: chosen.map((draft) => draft.about),
        idempotencyKey,
      });
      if (result.ok)
        onSent(
          chosen.map((draft) => draft.id),
          result.value.via,
        );
      else setError(result.message);
    });
  };

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      {!open ? null : (
        <SheetContent
          side="side"
          title={`${chosen.length === 1 ? "1 question" : `${String(chosen.length)} questions`} for ${who}`}
          description={t(
            "Q drafted these from gaps in what you can see. Nothing is sent until you approve.",
          )}
        >
          <div className="flex flex-col gap-4 pb-6" data-questions-sheet>
            {chosen.length === 0 ? (
              <p className="cq-body-sm text-(--cq-text-secondary)">
                {t("No questions left to send.")}
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {chosen.map((draft, index) => (
                  <li key={draft.id} className="flex items-start gap-3">
                    <span className="cq-brief-num mt-2.5" aria-hidden="true">
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <label className="sr-only" htmlFor={`q-${draft.id}`}>
                        Question {index + 1}
                      </label>
                      <textarea
                        id={`q-${draft.id}`}
                        rows={2}
                        maxLength={ASSUMPTION_QUESTION_MAX_LENGTH}
                        value={texts[draft.id] ?? draft.question}
                        onChange={(event) => {
                          rekey();
                          setTexts((current) => ({
                            ...current,
                            [draft.id]: event.target.value,
                          }));
                        }}
                        className="cq-body resize-none rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) p-3 text-(--cq-text-primary)"
                      />
                      <span className="cq-caption text-(--cq-text-tertiary)">
                        {draft.from === "GAP"
                          ? `You added this from a gap: ${draft.topic}`
                          : "Q drafted this from a gap in the deck"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        rekey();
                        setDropped((current) => new Set([...current, draft.id]));
                      }}
                      aria-label={`Remove question ${String(index + 1)}`}
                      className="cq-brief-iconbtn"
                    >
                      <X size={ICON_SIZE.compact} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <p className="cq-caption text-(--cq-text-tertiary)">
              {route.kind === "NOT_CONNECTED"
                ? `Questions go once ${companyName} accepts your interest.`
                : route.kind === "DILIGENCE"
                  ? `${companyName} sees these exactly as written, on their diligence checklist. Sending twice sends once.`
                  : `${companyName} sees these exactly as written, in your chat with them. Sending twice sends once.`}
            </p>
            {error === null ? null : (
              <p role="alert" className="cq-body-sm text-(--cq-text-primary)">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={approve}
                disabled={pending || !valid || route.kind === "NOT_CONNECTED"}
                aria-busy={pending}
                data-approve-questions
              >
                {pending ? t("Sending…") : t("Approve and send")}
              </Button>
              <Button variant="quiet" onClick={() => onOpenChange(false)}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        </SheetContent>
      )}
    </SheetRoot>
  );
}
