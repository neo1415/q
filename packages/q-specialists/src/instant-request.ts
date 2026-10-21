import {
  pageRequestOf,
  selfCorrected,
  takenBack,
  withoutLeadIn,
} from "./page-request.js";
import { tabAskOf } from "./tab-request.js";

/**
 * Lane 7 (owner 2026-10-21: "from any page ... it happens immediately,
 * every time"): the requests a screen can do by itself, read by code with
 * no model -- close what is open, go back or forward, scroll, press one of
 * the page's own registered controls by its visible name -- and a document
 * asked for by its name, which the Q API then finds among the documents
 * the person may open (open_page / open_company_document, as the person).
 *
 * Words only: nothing here knows what is on screen or who may see what.
 * The browser matches a PRESS against the controls the page registered;
 * the server authorises every document. Deliberately narrow: the whole
 * sentence must be the request, so a question never matches.
 */

export type InstantPageAct =
  | "BACK"
  | "FORWARD"
  | "SCROLL_DOWN"
  | "SCROLL_UP"
  | "SCROLL_TOP"
  | "SCROLL_BOTTOM";

export type InstantRequest =
  /** Close whatever is open over the page ("close it", "dismiss that"). */
  | { readonly kind: "CLOSE" }
  | { readonly kind: "PAGE_ACT"; readonly act: InstantPageAct }
  /**
   * One of the page's own controls, by the name a person reads on it
   * ("press Book a call", "open the Readiness tab"). TAB: only a tab.
   */
  | {
      readonly kind: "PRESS";
      readonly label: string;
      readonly as: "TAB" | "ANY";
    };

/** The longest visible name a PRESS carries (registry CONTROL_LABEL_MAX). */
export const INSTANT_LABEL_MAX = 48;

/** "can you", "please", "Q," and trailing courtesies around a command. */
function bare(text: string): string | null {
  const said = text.trim();
  if (said.length === 0 || said.length > 160 || takenBack(said)) return null;
  const words = withoutLeadIn(selfCorrected(said))
    .replace(/[’]/gu, "'")
    .replace(/[.!?…]+$/u, "")
    .replace(/^(?:(?:hey|ok|okay)\s+q\b[,\s]*)/iu, "")
    .replace(
      /^(?:(?:can|could|would|will)\s+you\s+|please\s+|q\b[,\s]+|just\s+)+/iu,
      "",
    )
    .replace(
      /[\s,]+(?:please|for\s+me|now|thanks|thank\s+you|q)(?=[\s,]*$)/giu,
      "",
    )
    .trim();
  return words.length === 0 ? null : words;
}

const OVERLAY =
  "document|doc|file|pdf|viewer|preview|modal|dialog|popup|pop-up|window|panel|card|deck|overlay|sheet|slides?|menu|answer|comparison|summary";

const CLOSE = new RegExp(
  `^(?:close|dismiss|hide|shut|exit)(?:\\s+(?:it|that|this|them|(?:the|this|that)\\s+(?:${OVERLAY})))?(?:\\s+(?:down|up|out))?$|^(?:get\\s+rid\\s+of|put\\s+away|take\\s+away)\\s+(?:it|that|this)$|^(?:i'?m|i\\s+am)\\s+done\\s+with\\s+(?:it|this|that)$`,
  "iu",
);

const PAGE_ACTS: readonly (readonly [InstantPageAct, RegExp])[] = [
  [
    "BACK",
    /^(?:go\s+)?back(?:\s+(?:a|one)\s+(?:page|step))?$|^(?:take|bring)\s+me\s+back$|^(?:go\s+to\s+)?(?:the\s+)?previous\s+(?:page|screen)$|^go\s+back\s+a\s+page$/iu,
  ],
  ["FORWARD", /^(?:go\s+)?forward(?:\s+(?:a|one)\s+(?:page|step))?$/iu],
  [
    "SCROLL_TOP",
    /^(?:scroll\s+|go\s+|take\s+me\s+|jump\s+)?(?:back\s+)?(?:up\s+)?to\s+(?:the\s+)?top(?:\s+of\s+(?:the|this)\s+page)?$|^(?:the\s+)?top(?:\s+of\s+(?:the|this)\s+page)?$/iu,
  ],
  [
    "SCROLL_BOTTOM",
    /^(?:scroll\s+|go\s+|take\s+me\s+|jump\s+)?(?:down\s+)?to\s+(?:the\s+)?(?:bottom|end)(?:\s+of\s+(?:the|this)\s+page)?$|^(?:the\s+)?bottom(?:\s+of\s+(?:the|this)\s+page)?$/iu,
  ],
  [
    "SCROLL_DOWN",
    /^(?:scroll|go|move|page)\s+down(?:\s+(?:more|a\s+bit|a\s+little|some))?$|^scroll(?:\s+(?:a\s+bit|a\s+little|more|some))?$|^keep\s+scrolling$|^(?:scroll\s+)?down\s+(?:a\s+bit|a\s+little)$/iu,
  ],
  [
    "SCROLL_UP",
    /^(?:scroll|go|move|page)\s+up(?:\s+(?:more|a\s+bit|a\s+little|some))?$|^(?:scroll\s+)?up\s+(?:a\s+bit|a\s+little)$/iu,
  ],
];

const PRESS_VERB =
  /^(?:press|click|tap|hit|push|select|choose)(?:\s+on)?\s+(?:the\s+)?(.+?)(?:\s+(button|tab|link|option|toggle|switch))?$/iu;
const TAB_VERB =
  /^(?:open(?:\s+up)?|go\s+to|switch\s+to|jump\s+to|show(?:\s+me)?)\s+(?:the\s+)?(.+?)\s+tab$/iu;

/** Words that are pointers, not a control's name. */
const NOT_A_LABEL = /^(?:it|that|this|them|one|here|there|something)$/iu;

function label(words: string | undefined): string | null {
  const out = (words ?? "").replace(/^["'“]|["'”]$/gu, "").trim();
  if (out.length === 0 || out.length > INSTANT_LABEL_MAX) return null;
  if (out.split(/\s+/u).length > 6 || NOT_A_LABEL.test(out)) return null;
  return out;
}

/**
 * The instant request the words make, or null when they make none. A
 * taken-back sentence ("close it... no wait") makes none.
 */
export function instantRequestOf(text: string): InstantRequest | null {
  const said = bare(text);
  if (said === null) return null;
  if (CLOSE.test(said)) return { kind: "CLOSE" };
  for (const [act, pattern] of PAGE_ACTS) {
    if (pattern.test(said)) return { kind: "PAGE_ACT", act };
  }
  const tab = TAB_VERB.exec(said);
  if (tab !== null) {
    const name = label(tab[1]);
    return name === null ? null : { kind: "PRESS", label: name, as: "TAB" };
  }
  const press = PRESS_VERB.exec(said);
  if (press !== null) {
    const name = label(press[1]);
    if (name === null) return null;
    return {
      kind: "PRESS",
      label: name,
      as: press[2]?.toLowerCase() === "tab" ? "TAB" : "ANY",
    };
  }
  return null;
}

/**
 * A control a code path may never press on its own: anything that sends,
 * commits, approves, deletes, pays or changes a relationship keeps Prepare
 * -> Recommend -> Human Approval -> Execute through Q (CLAUDE.md, Q
 * Authority). Matched on the control's visible name and on the words.
 */
const CONSEQUENTIAL =
  /\b(?:express|interest(?:ed)?|send|submit|approve|reject|decline|accept|delete|remove|archive|pay|payment|purchase|buy|checkout|subscribe|upgrade|downgrade|confirm|sign|publish|invite|share|withdraw|cancel|revoke|grant|request|apply|book|schedule|transfer|pass|save|commit|propose|connect|disconnect|unlink|erase|reset|leave|block|report|post|reply|introduce|intro|offer|close\s+(?:the\s+)?(?:round|deal)|mark\s+as)\b/iu;

export function consequentialLabel(name: string): boolean {
  return CONSEQUENTIAL.test(name);
}

/** What a document is called when it is asked for by name. */
const DOCUMENT_WORDS =
  /\b(?:document|doc|file|pdf|certificate|incorporation|agreement|contract|memo|memorandum|brief|report|statements?|financials|financial\s+model|cap\s*table|term\s*sheet|questions|notes|one[\s-]pager|policy|minutes|letter|articles|bylaws|register|licen[cs]e|deck|slides|presentation|spreadsheet|audit|accounts|nda|shareholders?(?:'|\s+agreement)?|resolution|kyc|summary|proof|invoice)\b/iu;

const DOCUMENT_VERB =
  /^(?:open(?:\s+up)?|show(?:\s+me)?|pull\s+up|bring\s+up|view|let\s+me\s+see|display|read|(?:i\s+(?:want|need|would\s+like|'d\s+like)\s+to\s+)?(?:see|view|open|read|look\s+at))\s+(.+)$/iu;

export type DocumentAsk = {
  /** The document as said ("certificate of incorporation"). */
  readonly document: string;
  /** The company as said ("Halyard"); null: the one on screen, or their own. */
  readonly company: string | null;
};

/**
 * A document asked for by its name ("open the certificate of
 * incorporation", "show me Halyard's term sheet", "open the questions for
 * Priya"), or null. A page ("my documents"), a tab ("Nixo's deck", "the
 * data room") or a drawing is never one: those readers answer first.
 */
export function documentAskOf(text: string): DocumentAsk | null {
  const said = bare(text);
  if (said === null) return null;
  const object = DOCUMENT_VERB.exec(said)?.[1]?.trim();
  if (object === undefined || object.length === 0 || object.length > 140) {
    return null;
  }
  if (!DOCUMENT_WORDS.test(object)) return null;
  if (pageRequestOf(text) !== null || tabAskOf(text) !== null) return null;
  // A plural with nothing else ("the documents", "my files") is a list.
  if (
    /^(?:the|my|our|their|its|all\s+(?:the|my)?)?\s*(?:documents|docs|files)$/iu.test(
      object,
    )
  ) {
    return null;
  }
  let company: string | null = null;
  let rest = object;
  const owned = /^(\p{Lu}[\p{L}\p{N}&.\- ]{0,60}?)'s\s+(.+)$/u.exec(object);
  const from =
    owned === null
      ? /^(.+?)\s+(?:from|in|at)\s+(\p{Lu}[\p{L}\p{N}&.\- ]{0,60}?)(?:'s)?(?:\s+data\s*room)?$/u.exec(
          object,
        )
      : null;
  if (owned?.[1] !== undefined && owned[2] !== undefined) {
    company = owned[1].trim();
    rest = owned[2];
  } else if (from?.[1] !== undefined && from[2] !== undefined) {
    company = from[2].trim();
    rest = from[1];
  }
  const document = rest
    .replace(/^(?:the|my|our|their|its|this|that|a|an)\s+/iu, "")
    .trim();
  if (document.length === 0 || !DOCUMENT_WORDS.test(document)) return null;
  return { document: document.slice(0, 120), company };
}
