/**
 * A typed message that is not a question for Q, taken before it is sent:
 * Q Pitch's step commands ("next", "go to step 7", "back two") and the
 * story's own ask ("Hey Q, pitch yourself"), answered by code with no
 * model call and no conversation turn (v6, owner 16 Oct).
 *
 * Held as a stack: the latest holder (a playing story) decides first, and
 * what it declines goes to the one before it (the story trigger), so a new
 * holder never silently switches an earlier one off. Everything every
 * holder declines is sent to Q exactly as before.
 */
type Interceptor = (text: string) => boolean;

const held: Interceptor[] = [];

/** Hold an interceptor; the returned function releases that one only. */
export function setTypedInterceptor(interceptor: Interceptor): () => void {
  held.push(interceptor);
  return () => {
    const at = held.lastIndexOf(interceptor);
    if (at >= 0) held.splice(at, 1);
  };
}

/** True when the text was taken; the composer then sends nothing. */
export function interceptTyped(text: string): boolean {
  for (let i = held.length - 1; i >= 0; i -= 1) {
    try {
      if (held[i]?.(text) === true) return true;
    } catch {
      // A failing holder takes nothing; the one before it decides.
    }
  }
  return false;
}
