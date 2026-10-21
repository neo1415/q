"use client";

import { useEffect, useState } from "react";

import { preparedAction, type Prepared } from "./work-page-actions";

const POLL_MS = 1_200;
const POLL_LIMIT = 75;

/** Follows a run Q was asked to prepare until a card, an answer or a failure. */
export function usePrepared(runId: string): Prepared | null {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  useEffect(() => {
    let live = true;
    let tries = 0;
    let timer = 0;
    const read = async () => {
      tries += 1;
      const result = await preparedAction(runId).catch(() => null);
      if (!live) return;
      const value: Prepared =
        result?.ok === true ? result.value : { state: "FAILED" };
      if (value.state === "WORKING" && tries < POLL_LIMIT) {
        setPrepared(value);
        timer = window.setTimeout(() => void read(), POLL_MS);
        return;
      }
      setPrepared(value.state === "WORKING" ? { state: "FAILED" } : value);
    };
    void read();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [runId]);
  return prepared;
}
