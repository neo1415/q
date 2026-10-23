/**
 * Final words heard on a voice line that are not a question for Q, taken
 * the moment the transcript is final and before the line's model may
 * answer: the story's own ask ("Hey Q, pitch yourself"), by code (owner,
 * 23 Oct: said in the voice room, the live model answered with a self
 * introduction instead).
 *
 * The voice line asks; whoever holds the interceptor decides. When it is
 * taken, the line stops its own answer and closes, so nothing it was
 * saying plays over what starts. Held as a stack, as typed words are
 * (typed-intercept.ts): the latest holder decides first.
 */
type Interceptor = (said: string) => boolean;

const held: Interceptor[] = [];

/** Hold an interceptor; the returned function releases that one only. */
export function setHeardInterceptor(interceptor: Interceptor): () => void {
  held.push(interceptor);
  return () => {
    const at = held.lastIndexOf(interceptor);
    if (at >= 0) held.splice(at, 1);
  };
}

/** True when the words were taken; the voice line then ends itself. */
export function interceptHeard(said: string): boolean {
  const words = said.trim();
  if (words.length === 0) return false;
  for (let i = held.length - 1; i >= 0; i -= 1) {
    try {
      if (held[i]?.(words) === true) return true;
    } catch {
      // A failing holder takes nothing; the one before it decides.
    }
  }
  return false;
}
