/**
 * What a sentence a person reads or hears may not contain.
 *
 * Capital Q shows one Q. Which provider answered, which status code came
 * back, which internal stage gave up and how many times it was retried are
 * ours to absorb. A person gets a sentence in Q's voice that says what is
 * true and what they can do next.
 *
 * This existed only as a rule in prose, so it was followed unevenly: a
 * voice failure reached someone as "Voice isn't working right now. You can
 * keep typing. (FAILED_TO_THINK)", which names a leg of our architecture
 * and tells them nothing they can act on. The rule is checkable now, and
 * a test checks it.
 *
 * It is a wording rule, not a security control. Nothing here decides what
 * may be disclosed; the Context Firewall does that, long before a sentence
 * is written.
 */

export type PlainLineProblem = {
  readonly pattern: string;
  readonly reason: string;
};

type Rule = {
  readonly pattern: RegExp;
  readonly reason: string;
};

/**
 * Names of things a person has no relationship with. A person signed up to
 * Capital Q; they did not choose a speech vendor or an inference host, and
 * naming one in a failure asks them to care about our supply chain.
 */
const VENDOR_NAMES =
  /\b(?:deepgram|elevenlabs|livekit|openai|anthropic|groq|gemini|google ai|vertex|supabase|postgres|redis|vercel|render|bright\s?data|serp\s?api|qwen|llama|gpt-|claude-)/i;

/**
 * Machine vocabulary. `SCREAMING_SNAKE` is the shape of every failure class
 * and diagnostic code we have, and a bare number after "code"/"status" is
 * an HTTP status. Neither is a sentence.
 */
const MACHINE_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/;
const HTTP_STATUS = /\b(?:status|code|http)\b[^.]{0,12}\b[1-5][0-9]{2}\b/i;

/**
 * Words that describe our internals rather than the person's situation.
 * "Error" in particular is the word a log uses; a person is told what
 * happened to the thing they asked for.
 */
const INTERNAL_WORDS =
  /\b(?:error|exception|stack\s?trace|null|undefined|NaN|timeout exceeded|internal server|unhandled|traceback|socket|websocket|endpoint|api key|token expired)\b/i;

/** The shape of a thrown thing that reached a screen by accident. */
const LEAKED_SHAPE = /\[object |\bat\s+\w+\s+\(|\bERR_[A-Z_]+\b|\{\{|\$\{/;

const RULES: readonly Rule[] = [
  {
    pattern: VENDOR_NAMES,
    reason: "names a supplier the person has no relationship with",
  },
  {
    pattern: MACHINE_CODE,
    reason: "carries a failure class or diagnostic code",
  },
  { pattern: HTTP_STATUS, reason: "carries an HTTP status" },
  { pattern: INTERNAL_WORDS, reason: "uses our vocabulary, not theirs" },
  { pattern: LEAKED_SHAPE, reason: "looks like something that leaked" },
];

/**
 * Every reason this line should not be shown to a person. Empty means it
 * is fine.
 *
 * Deliberately returns all of them rather than the first: a line being
 * rewritten should be rewritten once.
 */
export function plainLineProblems(line: string): readonly PlainLineProblem[] {
  const problems: PlainLineProblem[] = [];
  for (const rule of RULES) {
    const found = rule.pattern.exec(line);
    if (found !== null) {
      problems.push({ pattern: found[0], reason: rule.reason });
    }
  }
  return problems;
}

export function isPlainLine(line: string): boolean {
  return plainLineProblems(line).length === 0;
}
