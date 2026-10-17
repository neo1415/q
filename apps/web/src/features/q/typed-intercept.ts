/**
 * A typed message that is not a question for Q, taken before it is sent:
 * Q Pitch's step commands ("next", "go to step 7", "back two"), answered
 * by code with no model call and no conversation turn (v6, owner 16 Oct).
 * One interceptor at a time, held by whatever is running (the tour host);
 * everything it declines is sent to Q exactly as before.
 */
type Interceptor = (text: string) => boolean;

let current: Interceptor | null = null;

/** Hold the interceptor; the returned function releases it (only if still held). */
export function setTypedInterceptor(interceptor: Interceptor): () => void {
  current = interceptor;
  return () => {
    if (current === interceptor) current = null;
  };
}

/** True when the text was taken; the composer then sends nothing. */
export function interceptTyped(text: string): boolean {
  if (current === null) return false;
  try {
    return current(text);
  } catch {
    return false;
  }
}
