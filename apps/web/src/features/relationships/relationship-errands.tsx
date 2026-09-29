"use client";

import { useEffect, useState, useTransition } from "react";

import type { QErrandDto } from "@capital-q/contracts";
import { Button } from "@capital-q/ui/button";

import { useGlobalQ } from "@/components/app-shell/global-q";
import { QSwarm } from "@/features/q-swarm/q-swarm";

import { readErrandsAction, stopErrandAction } from "./errand-actions";

/**
 * Q looking after one relationship (founder direction 2026-09-29): while an
 * errand runs, what Q did last and a Stop; otherwise one tap hands the
 * relationship to Q, which drafts the plan for the person's approval.
 */
export function RelationshipErrands({
  relationshipId,
  counterpart,
  connected,
}: {
  readonly relationshipId: string;
  readonly counterpart: string;
  readonly connected: boolean;
}) {
  const { askAbout } = useGlobalQ();
  const [errands, setErrands] = useState<readonly QErrandDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void readErrandsAction(relationshipId).then((result) => {
      if (live) setErrands(result.ok ? result.value : []);
    });
    return () => {
      live = false;
    };
  }, [relationshipId]);

  if (errands === null) return null;
  const active = errands.find((errand) => errand.status === "ACTIVE");

  if (active === undefined) {
    return (
      <Button
        variant="quiet"
        onClick={() =>
          askAbout(
            connected
              ? `Look after ${counterpart} for me: answer their questions, book a call and tell me with the link.`
              : `Look after ${counterpart} for me: express interest, and when they accept, say hello, answer their questions, book a call and tell me with the link.`,
          )
        }
      >
        Let Q handle this
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-errand={active.status}>
      <div className="flex items-center gap-2">
        <QSwarm state="WORKING" pixels={28} />
        <span className="cq-body-sm text-(--cq-text-primary)">
          Q is looking after this
        </span>
      </div>
      {active.lastStep === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)">
          {active.lastStep}
        </span>
      )}
      <Button
        variant="quiet"
        size="compact"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await stopErrandAction(active.id);
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            setErrands(
              errands.map((errand) =>
                errand.id === active.id
                  ? { ...errand, status: "STOPPED" }
                  : errand,
              ),
            );
          })
        }
      >
        Stop
      </Button>
      {message === null ? null : (
        <span className="cq-caption text-(--cq-text-secondary)" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
