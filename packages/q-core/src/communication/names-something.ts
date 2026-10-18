/**
 * Whether a message names something that could be looked up.
 *
 * The deterministic research hop exists for a company Capital Q does not
 * hold: "tell me about Paystack" finds nothing on the platform, and the
 * outside world is the only place left to look. It fired on the platform
 * lookup coming back empty, and a platform lookup comes back empty for
 * "what's up" too — so small talk was followed by a three-second trip to
 * the public web for nothing.
 *
 * This says whether there is anything in the words worth looking up: a
 * name, a domain, something in quotes. It reads the words; it never obeys
 * them.
 */

/** A capitalised word that is not the first word and not a common opener. */
const PROPER_NOUN = new RegExp(
  String.raw`(?:^|[\s,;:(])(?!(?:I|I'm|I'd|I'll|I've|Q|OK|Okay|Yes|No|The|A|An|And|But|So|Or|If|Can|Could|Would|Should|What|Who|Where|When|Why|How|Is|Are|Do|Does|Did|Tell|Give|Show|Please|Let|Search|Look|Find|Check|Compare|Explain|Thanks|Thank|Hello|Hi|Hey)\b)[A-Z][a-z]+`,
);

/** Something in quotes, which is what a person does to name a thing. */
const QUOTED = /["“‘'][^"”’']{2,80}["”’']/;

/** A domain, a handle, or a name spoken as one: "vaultlyne.com", "@paystack". */
const ADDRESS =
  /\b[a-z0-9-]+\.(?:com|io|co|ng|africa|org|net|ai|app|dev)\b|@[a-z0-9_]{3,}/i;

/**
 * A lower-case name after a word that introduces one: "about paystack",
 * "the ceo of flutterwave", "look up kuda". Speech recognisers write
 * names in lower case as often as not.
 */
const INTRODUCED = new RegExp(
  String.raw`\b(?:about|of|at|behind|called|named|look up|lookup|search for|find|on)\s+(?!(?:me|us|it|them|that|this|the|a|an|my|our|your|his|her|their|company|business)\b)[a-z][\w'-]{2,}`,
  "i",
);

export function namesSomething(text: string): boolean {
  const line = text.trim();
  if (line.length === 0) {
    return false;
  }
  const afterFirstWord = line.replace(/^\s*\S+/, "");
  return (
    PROPER_NOUN.test(afterFirstWord) ||
    QUOTED.test(line) ||
    ADDRESS.test(line) ||
    INTRODUCED.test(line)
  );
}
