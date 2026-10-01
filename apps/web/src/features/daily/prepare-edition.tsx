"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@capital-q/ui/button";

import { formatDayTime } from "@/components/date-format";

import { requestDailyEditionAction } from "./daily-actions";

/**
 * "Prepare my edition" (DAILY spec §3), and the quiet wait after it. The
 * edition is gathered by Capital Q's worker within a few minutes; while
 * it is, the page re-reads itself every 20 seconds for up to 15 minutes,
 * then stops and says so. One request per 20 hours; the server decides.
 */

const REFRESH_MS = 20_000;
const GIVE_UP_MS = 15 * 60_000;

export function PreparingNotice() {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > GIVE_UP_MS) {
        window.clearInterval(timer);
        setGaveUp(true);
        return;
      }
      router.refresh();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [router]);
  return (
    <p
      role="status"
      className="cq-body text-(--cq-text-secondary)"
      data-daily-preparing
    >
      {gaveUp
        ? "Your edition is taking longer than usual. It will appear here and in your email when it's ready."
        : "Q is gathering your edition. It appears here in a few minutes."}
    </p>
  );
}

export function PrepareEditionButton({
  label = "Prepare my edition",
}: {
  readonly label?: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const prepare = () => {
    setMessage(null);
    startTransition(async () => {
      const outcome = await requestDailyEditionAction();
      if (!outcome.ok) {
        setMessage(outcome.message);
        return;
      }
      switch (outcome.result.status) {
        case "QUEUED":
        case "ALREADY_QUEUED":
          router.refresh();
          return;
        case "TOO_SOON":
          setMessage(
            outcome.result.retryAfter === null
              ? "You have a recent edition. Ask again tomorrow."
              : `You have a recent edition. You can ask for another after ${formatDayTime(outcome.result.retryAfter)}.`,
          );
          return;
        case "OFF":
          setMessage("The Q Daily is off. Turn it on in Settings first.");
          return;
      }
    });
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="primary"
        onClick={prepare}
        disabled={pending}
        data-daily-prepare
      >
        {pending ? "Starting…" : label}
      </Button>
      {message === null ? null : (
        <p role="alert" className="cq-caption text-(--cq-text-secondary)">
          {message}
        </p>
      )}
    </div>
  );
}
