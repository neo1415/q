"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { useInView } from "./use-in-view";

/**
 * The GateQ engine (and its contracts) is a separate chunk, fetched when
 * the section is a screen or so away. The server's identical, unanswered
 * markup stays until the chunk has arrived, so the swap never shifts
 * anything.
 */
export function GateQIsland({ fallback }: { readonly fallback: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { rootMargin: "1200px 0px" });
  const [Live, setLive] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!near) return;
    let alive = true;
    void import("./gateq-live").then((m) => {
      if (alive) setLive(() => m.GateQLive);
    });
    return () => {
      alive = false;
    };
  }, [near]);
  return (
    <div className="gate" ref={ref} data-live={Live === null ? undefined : ""}>
      {Live === null ? fallback : <Live />}
    </div>
  );
}
