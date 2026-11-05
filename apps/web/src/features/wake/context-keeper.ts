/**
 * Keep the wake word's AudioContext running. A context made without a tap
 * starts suspended (Chrome's and Safari's autoplay rules), and Safari
 * suspends or "interrupts" a running one when other audio takes over (Q's
 * own voice on a call). A suspended context delivers no frames, so the
 * gate never opens and "Hey Q" silently stops working. Each time it is not
 * running, the next tap or key anywhere resumes it.
 */

export type ResumableContext = EventTarget & {
  readonly state: string;
  readonly resume: () => Promise<void>;
};

const GESTURES = ["pointerdown", "keydown"] as const;

export function keepContextRunning(
  context: ResumableContext,
  target: EventTarget = window,
): () => void {
  let armed = false;
  const resume = () => {
    void context.resume().catch(() => undefined);
  };
  const onGesture = () => {
    disarm();
    resume();
  };
  const arm = () => {
    if (armed) return;
    armed = true;
    for (const type of GESTURES) target.addEventListener(type, onGesture);
  };
  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const type of GESTURES) target.removeEventListener(type, onGesture);
  };
  const onState = () => {
    if (context.state === "running") disarm();
    else if (context.state !== "closed") {
      arm();
      resume();
    }
  };
  context.addEventListener("statechange", onState);
  if (context.state !== "running") {
    arm();
    resume();
  }
  return () => {
    disarm();
    context.removeEventListener("statechange", onState);
  };
}
