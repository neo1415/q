import type { DiligenceView } from "@capital-q/permissions";
import type { DiligenceFollowUp } from "@capital-q/q-tools";

/**
 * Addendum "resolving investor uncertainty" (14 Nov 2026, slice 6): the
 * diligence requests that named the uncertainty they were asked to resolve,
 * with what came back, from the diligence service's own per-party view
 * (read as the actor, so only what this side may see). A shared document
 * carries Q's labelled one-line summary of exactly the shared version when
 * the worker has read it; the founder's answers carry each answer's
 * evidence status. Nothing here judges whether the uncertainty is
 * resolved: the answer says that, from this and what it can read.
 */
export function diligenceFollowUps(
  view: DiligenceView,
): readonly DiligenceFollowUp[] {
  return view.requests.flatMap((request): DiligenceFollowUp[] => {
    if (request.about === null) return [];
    const share =
      request.fulfilledBy === null
        ? undefined
        : view.shares.find(
            (candidate) =>
              candidate.documentId === request.fulfilledBy?.documentId,
          );
    return [
      {
        title: request.title,
        about: {
          statement: request.about.statement,
          standing: request.about.standing,
        },
        status: request.status,
        requestedAt: request.requestedAt,
        fulfilledAt: request.fulfilledAt,
        document:
          request.fulfilledBy === null
            ? null
            : {
                title: request.fulfilledBy.title,
                summary: share?.qSummary ?? null,
              },
        answers: (request.questions ?? []).flatMap((question) =>
          question.answer === null
            ? []
            : [
                {
                  answeredAt: question.answer.answeredAt,
                  evidenceStatus: question.answer.evidenceStatus,
                },
              ],
        ),
        declineNote: request.declineNote,
      },
    ];
  });
}
