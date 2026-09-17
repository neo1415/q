import { focusFromQuestion } from "./dimensions.js";

/**
 * Whether a question is about the company in the conversation at all.
 *
 * The company specialist used to take EVERY question asked while a company
 * was the subject, because that is who the person is and what they are
 * here for. Live, that meant "what's up", "who is the CEO of Paystack" and
 * "just search online" all went to a path that answers only from the
 * company's own records, and the person was told each fell outside the
 * scope of The Vaultlyne's data. None of the general-knowledge, lookup or
 * research behaviour applied, because none of it lives on that path.
 *
 * So the specialist is only for questions that are actually about the
 * subject company. Everything else goes to the conversational path, which
 * has the tools, the research, ordinary knowledge and streaming, and
 * which can still read the company's records through those same tools
 * when a question turns out to need them.
 *
 * Deterministic, and deliberately tilted: a question that is plainly
 * about the company goes to the deeper analysis; a question that is
 * plainly about something else, or about nothing in particular, does not.
 * The words are data; this reads them and never obeys them.
 */

/**
 * The person talking about their own company: "our runway", "my deck",
 * "are we ready", "how do we look". The specialist is the right place for
 * these even when no dimension word appears.
 */
const FIRST_PERSON_COMPANY = new RegExp(
  String.raw`\b(?:my|our)\s+(?:company|business|startup|firm|venture|deck|pitch|raise|round|runway|team|numbers|metrics|revenue|traction|customers|investors?|valuation|cap ?table|financials?|model|market|product|profile)\b|\b(?:are|do|should|how do|how are|what do)\s+(?:we|us)\b|\bhow\s+(?:we|us)\s+(?:look|stand|compare|do)\b`,
  "i",
);

/**
 * An analysis asked for outright. "Analyse Northstar", "assess the
 * company", "run diligence". This is the specialist's whole purpose, and
 * a person on their own company's page asking for an analysis means their
 * company, whatever they call it. It is checked before the capitalised
 * name below, which would otherwise read the company's own name as a
 * stranger's.
 */
const ANALYSIS_REQUEST = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:analy[sz]e|assess|review|evaluate|investigate|audit|look\s+(?:at|into)|run\s+(?:a\s+)?(?:diligence|review|assessment)|give\s+me\s+(?:an?\s+)?(?:analysis|assessment|review))\b`,
  "i",
);

/**
 * Somebody else, by role or by preposition: "the CEO of paystack", "tell
 * me about flutterwave". Speech recognisers lower-case names as often as
 * not, so this does not rely on a capital letter.
 */
const ABOUT_SOMEONE_ELSE = new RegExp(
  String.raw`\b(?:ceo|cto|cfo|coo|founders?|co-?founders?|owners?|head|boss|chairman|chair|president|team|valuation|revenue|funding|investors?)\s+(?:of|at|behind)\s+(?!(?:our|my|us|the company|this company)\b)\S+|\b(?:about|on|regarding)\s+(?!(?:us|our|my|the company|this company|it|them|that|this)\b)[a-z][\w.-]+`,
  "i",
);

/**
 * Somebody else, named with a capital letter. A capitalised word that is
 * not the start of the sentence and not a common opener is most likely a
 * proper noun, and a question naming another company or person is not a
 * question about this one.
 */
const OTHER_NAMED_ENTITY = new RegExp(
  String.raw`(?:^|[\s,;:(])(?!(?:I|I'm|I'd|I'll|I've|Q|OK|Okay|Yes|No|The|A|An|And|But|So|Can|Could|Would|Should|What|Who|Where|When|Why|How|Is|Are|Do|Does|Did|Tell|Give|Show|Please|Let|Search|Look|Find|Check|Compare|Explain)\b)[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*`,
);

/**
 * Words that say the person wants the outside world, not the records.
 * "current", "latest" and "recent" are not here: "our current runway" is
 * about us, and "the current CEO of Paystack" is somebody else's business
 * for a different reason. The conversational path reads research cues of
 * its own, so nothing is lost by keeping this list to the unambiguous.
 */
const OUTSIDE_WORLD = new RegExp(
  String.raw`\b(?:online|internet|the web|google|search|news|public(?:ly)?|competitors?|market rate)\b`,
  "i",
);

/** The one outside-world phrasing that is still about us. */
const OWN_PUBLIC_PROFILE = new RegExp(
  String.raw`\b(?:our|my)\s+(?:public|online)\s+profile\b`,
  "i",
);

export type AboutCompanyReading =
  | {
      readonly about: true;
      readonly reason: "FIRST_PERSON" | "ANALYSIS" | "DIMENSION";
    }
  | {
      readonly about: false;
      readonly reason:
        "OTHER_ENTITY" | "OUTSIDE_WORLD" | "NOTHING_IN_PARTICULAR";
    };

export function readAboutCompany(question: string): AboutCompanyReading {
  const text = question.trim();
  if (text.length === 0) {
    return { about: false, reason: "NOTHING_IN_PARTICULAR" };
  }
  // The outside world wins even over a first-person phrasing: "search
  // online for our competitors" is a research question, and the research
  // tools live on the other path.
  if (OUTSIDE_WORLD.test(text) && !OWN_PUBLIC_PROFILE.test(text)) {
    return { about: false, reason: "OUTSIDE_WORLD" };
  }
  if (FIRST_PERSON_COMPANY.test(text)) {
    return { about: true, reason: "FIRST_PERSON" };
  }
  // Somebody else, by role or preposition, before anything else can claim
  // the question: "the CEO of Paystack" is not an analysis of us.
  if (ABOUT_SOMEONE_ELSE.test(text)) {
    return { about: false, reason: "OTHER_ENTITY" };
  }
  if (ANALYSIS_REQUEST.test(text)) {
    return { about: true, reason: "ANALYSIS" };
  }
  // Somebody else named with a capital letter, and not us.
  const afterFirstWord = text.replace(/^\s*\S+/, "");
  if (OTHER_NAMED_ENTITY.test(afterFirstWord)) {
    return { about: false, reason: "OTHER_ENTITY" };
  }
  if (focusFromQuestion(text).length > 0) {
    return { about: true, reason: "DIMENSION" };
  }
  return { about: false, reason: "NOTHING_IN_PARTICULAR" };
}

/** Whether the company specialist should take this question. */
export function isAboutSubjectCompany(question: string): boolean {
  return readAboutCompany(question).about;
}
