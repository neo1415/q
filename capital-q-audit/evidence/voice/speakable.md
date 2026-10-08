# Evidence: apps/q-api/src/voice/speech.ts (lines 262-340)

- Original path: `apps/q-api/src/voice/speech.ts`
- Line range: 262-340 (repo HEAD 520bd123, branch recovery/2026-09-12-8y2j4w)
- Why included: speakable(): markdown/tables/lists stripped; bounded 1200 chars.

```ts
  262  export function withoutStageDirections(text: string): string {
  263    return text
  264      .replace(STAGE_DIRECTION, " ")
  265      .replace(/[ \t]{2,}/g, " ")
  266      .replace(/ +([.,;:!?])/g, "$1")
  267      .trim();
  268  }
  269
  270  /** Markdown and machine punctuation → plain sentences. */
  271  export function speakable(text: string): string {
  272    return (
  273      spokenFigures(withoutStageDirections(text))
  274        // Headings, list bullets, block quotes.
  275        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
  276        .replace(/^\s*[-*+]\s+/gm, "")
  277        .replace(/^\s*\d+[.)]\s+/gm, "")
  278        .replace(/^\s*>\s?/gm, "")
  279        // A callout's marker ("> [!RISK]") is said as its meaning.
  280        .replace(
  281          /^\s*\[!([A-Za-z]+)\]\s*/gm,
  282          (_marker, kind: string) =>
  283            `${kind.charAt(0).toUpperCase()}${kind.slice(1).toLowerCase()}: `,
  284        )
  285        // Emphasis and code.
  286        .replace(/(\*\*|__)(.*?)\1/g, "$2")
  287        .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, "$2")
  288        .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
  289        // Links: keep the words, drop the address.
  290        .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]*\)/g, "$1")
  291        // A bare address is said as its domain (lead 2026-10-03: "Website:
  292        // It's being applied now." when the address was dropped whole).
  293        .replace(/\bhttps?:\/\/[^\s)\]]+/g, spokenDomain)
  294        // Bracketed citations and source markers.
  295        .replace(/\s*\((?:public web )?source\s+S\d{1,2}\)/gi, "")
  296        .replace(/\s*\[(?:S\d{1,2}|\d{1,2})\]/g, "")
  297        // Tables become nothing a voice can carry.
  298        .replace(/^\s*\|.*\|\s*$/gm, "")
  299        .replace(/[ \t]+/g, " ")
  300        // A removed address leaves no orphaned space before punctuation.
  301        .replace(/ +([.,;:!?])/g, "$1")
  302        .replace(/\n{2,}/g, "\n")
  303        .trim()
  304    );
  305  }
  306
  307  /** Bound a spoken answer to what a listener can take in (§66). */
  308  export function bounded(text: string, max = SPOKEN_MAX_CHARS): string {
  309    if (text.length <= max) {
  310      return text;
  311    }
  312    // Whole sentences only (founder live 2026-10-07: "the voice just cuts").
  313    // A small room used to return the first `max` characters mid-word; now
  314    // it is the sentences that fit, or none, and the screen has the rest.
  315    const cut = text.slice(0, max + 1);
  316    const end = Math.max(
  317      cut.lastIndexOf(". "),
  318      cut.lastIndexOf("? "),
  319      cut.lastIndexOf("! "),
  320    );
  321    const kept = end > 0 ? cut.slice(0, end + 1).trim() : "";
  322    return kept.length === 0
  323      ? "The rest is on your screen."
  324      : `${kept} The rest is on your screen.`;
  325  }
  326
  327  /**
  328   * Split text into sentence-sized chunks, so a stream can be spoken as it
  329   * arrives and an interruption loses at most one sentence.
  330   */
  331  const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[A-Z0-9"'(])/g;
  332
  333  export function sentences(text: string): readonly string[] {
  334    return text
  335      .split(SENTENCE_BOUNDARY)
  336      .map((part) => part.trim())
  337      .filter((part) => part.length > 0);
  338  }
  339
  340  /**
```
