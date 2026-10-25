import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Q's last sentence, held until the screen has re-read the session, then
 * bound to the step it is now on, so it becomes the heading.
 *
 * Coordinator 25 Oct (fresh founder e2e-f-1403): after Q read the deck
 * back, the heading still showed Q's previous question. The reply was
 * bound only when the prompt changed, and a read-back that does not move
 * the step leaves the prompt as it was, so the new sentence never reached
 * the heading. Every reply held is now bound, whether or not the step
 * moved.
 */
export function useHeldReply(
  prompt: { readonly stepKey: string } | null,
  bind: (question: { stepKey: string; text: string } | null) => void,
): { readonly hold: (reply: string) => void; readonly drop: () => void } {
  const held = useRef<string | null>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const reply = held.current;
    if (reply === null) return;
    held.current = null;
    bind(prompt === null ? null : { stepKey: prompt.stepKey, text: reply });
  }, [prompt, round, bind]);
  return useMemo(
    () => ({
      hold: (reply: string) => {
        held.current = reply;
        setRound((n) => n + 1);
      },
      drop: () => {
        held.current = null;
      },
    }),
    [],
  );
}
