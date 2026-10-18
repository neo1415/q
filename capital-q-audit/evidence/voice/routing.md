# Evidence: apps/q-api/src/voice/duplex/routing.ts (lines 1-183)

- Original path: `apps/q-api/src/voice/duplex/routing.ts`
- Line range: 1-183 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: Deterministic routeDuplexTurn and smalltalk word list.

```ts
    1  /**
    2   * Who answers a finished turn on a routed duplex line (VOICE-BRAIN,
    3   * founder live 2026-10-08).
    4   *
    5   * On 2026-10-08 09:59-10:01 UTC one duplex call ran a single ask_q: every
    6   * other thing the founder said was answered by the realtime model on its
    7   * own, without Q's records, documents or tools. That is where "I can't
    8   * open files" and the know-nothing answers came from. The realtime model
    9   * is the voice, never the brain: this code, not the model, decides.
   10   *
   11   * Deterministic and deliberately narrow: only an utterance made entirely
   12   * of greeting, acknowledgement, thanks, farewell or filler words is small
   13   * talk the voice may answer. Everything else -- any question, any noun,
   14   * any "can you open my deck" -- goes to Q. A miss costs a little latency
   15   * (Q answers small talk); the opposite miss costs the person's trust.
   16   */
   17
   18  export type DuplexTurnRoute = "ASK_Q" | "SMALLTALK" | "MODEL";
   19
   20  /** The routed= value in the per-turn log line and the transcript store. */
   21  export type DuplexRoutedAs = "ask_q" | "smalltalk" | "model_only";
   22
   23  export const routedAs = (route: DuplexTurnRoute): DuplexRoutedAs =>
   24    route === "ASK_Q"
   25      ? "ask_q"
   26      : route === "SMALLTALK"
   27        ? "smalltalk"
   28        : "model_only";
   29
   30  /** Words that, on their own, carry no request (English; any case). */
   31  const TRIVIAL = new Set([
   32    // greetings and address
   33    "hi",
   34    "hello",
   35    "hey",
   36    "hiya",
   37    "there",
   38    "q",
   39    "good",
   40    "morning",
   41    "afternoon",
   42    "evening",
   43    "yo",
   44    // acknowledgements and continuers
   45    "ok",
   46    "okay",
   47    "k",
   48    "yeah",
   49    "yes",
   50    "yep",
   51    "yup",
   52    "ya",
   53    "sure",
   54    "right",
   55    "alright",
   56    "all",
   57    "mm",
   58    "mmm",
   59    "hmm",
   60    "mhm",
   61    "uh",
   62    "huh",
   63    "um",
   64    "er",
   65    "ah",
   66    "oh",
   67    "wow",
   68    "cool",
   69    "great",
   70    "nice",
   71    "perfect",
   72    "awesome",
   73    "lovely",
   74    "fine",
   75    "fair",
   76    "enough",
   77    "sounds",
   78    "really",
   79    "indeed",
   80    "exactly",
   81    "true",
   82    "of",
   83    "course",
   84    "no",
   85    "nope",
   86    "nah",
   87    "so",
   88    "and",
   89    "well",
   90    "i",
   91    // thanks and farewells
   92    "thanks",
   93    "thank",
   94    "you",
   95    "cheers",
   96    "appreciate",
   97    "bye",
   98    "goodbye",
   99    "later",
  100    "talk",
  101    "soon",
  102    "take",
  103    "care",
  104    // "I'm good, you?"
  105    "i'm",
  106    "im",
  107    "too",
  108    "also",
  109  ]);
  110
  111  /**
  112   * Phrases that are trivial only as a whole: "can", "see" or "it" alone
  113   * belong to real questions ("can you see it?", "open it").
  114   */
  115  const TRIVIAL_PHRASES = [
  116    "how are you doing",
  117    "how are you",
  118    "how's it going",
  119    "hows it going",
  120    "how is it going",
  121    "are you there",
  122    "you there",
  123    "still with me",
  124    "got it",
  125    "i see",
  126    "can you hear me",
  127    "you hear me",
  128    "not bad",
  129    "that makes sense",
  130    "makes sense",
  131    "that's great",
  132    "that's fine",
  133    "that's good",
  134    "that's right",
  135    "thats great",
  136    "thats right",
  137  ] as const;
  138
  139  /** At most this many words for small talk; anything longer is Q's. */
  140  const SMALLTALK_MAX_WORDS = 7;
  141
  142  function words(transcript: string): readonly string[] {
  143    return transcript
  144      .toLowerCase()
  145      .replace(/[’`]/g, "'")
  146      .replace(/[^a-z0-9'\s-]+/g, " ")
  147      .split(/[\s-]+/)
  148      .map((w) => w.replace(/^'+|'+$/g, ""))
  149      .filter((w) => w.length > 0);
  150  }
  151
  152  /** True when the whole utterance is greeting/acknowledgement/filler. */
  153  export function isSmallTalk(transcript: string): boolean {
  154    const said = words(transcript);
  155    if (said.length === 0) return true;
  156    if (said.length > SMALLTALK_MAX_WORDS) return false;
  157    let rest = ` ${said.join(" ")} `;
  158    for (const phrase of TRIVIAL_PHRASES)
  159      rest = rest.split(` ${phrase} `).join(" ");
  160    return rest
  161      .trim()
  162      .split(" ")
  163      .filter((w) => w.length > 0)
  164      .every((w) => TRIVIAL.has(w));
  165  }
  166
  167  export function routeDuplexTurn(
  168    transcript: string,
  169    situation: {
  170      /** Q leads this line (welcome, interview): every word is Q's. */
  171      readonly guided: boolean;
  172      /** Q's last answer asked for their yes: the reply is Q's to take. */
  173      readonly awaitingApproval: boolean;
  174      /** A decision card is in focus: a short reply goes to decide_card. */
  175      readonly cardInFocus: boolean;
  176    },
  177  ): DuplexTurnRoute {
  178    if (situation.guided || situation.awaitingApproval) return "ASK_Q";
  179    // The card's own code reads the reply (the same typed action a button
  180    // sends); the voice only passes the words through decide_card.
  181    if (situation.cardInFocus && words(transcript).length <= 12) return "MODEL";
  182    return isSmallTalk(transcript) ? "SMALLTALK" : "ASK_Q";
  183  }
```
