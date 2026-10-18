/**
 * Whether a person's own words decide a card Q showed them, read by code
 * (owner, 2026-10-16: "it always brings up a card for me to approve stuff
 * by clicking even when i say i have given my approval").
 *
 * The model readings (TURN_READER, DECISION_READER) stay for everything
 * nuanced. This is the deterministic floor under them: an utterance made
 * of nothing but approval words ("I approve", "yes, send it", "go ahead",
 * "confirmed", "approve both", "موافق، أرسلها") or nothing but refusal
 * words ("no, don't send it", "cancel that", "ألغها") is read here, with
 * no model call, so a clear decision never depends on a classifier.
 *
 * It is deliberately narrow. Every word must be known: a decision word, a
 * word pointing at the card ("it", "both", "the follow-up", a name from
 * the card's own summary), or filler ("please", "Q"). One unknown word
 * ("send it on Friday" against a Thursday card) and nothing is read here;
 * the turn goes to the model readings as before. A word asking for a
 * change ("but", "change", "instead", "wait", "لكن", "غير") makes the
 * whole utterance an EDIT, which never approves anything: the change is
 * prepared again and approved afresh.
 *
 * This reads words only. It authorises nothing: the Approval Engine's own
 * approve, bound to the card's stored payload hash, does that.
 */

export type ApprovalScope = "ONE" | "BOTH" | "ALL";

export type ApprovalWords =
  /**
   * Approval words. EXPLICIT: a word that is itself approval ("approve",
   * "go ahead", "send it", "confirmed"); PLAIN: only "yes", "ok", "sure".
   */
  | {
      readonly kind: "APPROVE";
      readonly scope: ApprovalScope;
      readonly strength: "EXPLICIT" | "PLAIN";
      /** "the first one", "the second": a 1-based position, when said. */
      readonly ordinal: number | null;
    }
  | {
      readonly kind: "DECLINE";
      readonly scope: ApprovalScope;
      readonly strength: "EXPLICIT" | "PLAIN";
      readonly ordinal: number | null;
    }
  /** Only words pointing at a card ("both", "the Harbourline one"). */
  | {
      readonly kind: "REFER";
      readonly scope: ApprovalScope;
      readonly ordinal: number | null;
    }
  /** Asks for something different: never an approval of this card. */
  | { readonly kind: "EDIT" }
  /** Not read here: the model readings decide, as before. */
  | { readonly kind: "NONE" };

type Role =
  | "APPROVE"
  | "YES"
  | "DECLINE"
  | "NO"
  | "BOTH"
  | "ALL"
  | "REF"
  | "FILLER"
  | "EDIT"
  | { readonly ordinal: number };

/** Phrases, longest matched first. Arabic is written normalised (see `normalise`). */
const PHRASES: readonly (readonly [string, Role])[] = [
  // Refusals that contain approval words: read before them.
  ["don't send it", "DECLINE"],
  ["don't send them", "DECLINE"],
  ["don't send", "DECLINE"],
  ["do not send", "DECLINE"],
  ["don't approve", "DECLINE"],
  ["do not approve", "DECLINE"],
  ["don't go ahead", "DECLINE"],
  ["do not go ahead", "DECLINE"],
  ["don't do it", "DECLINE"],
  ["don't do that", "DECLINE"],
  ["do not do it", "DECLINE"],
  ["not approved", "DECLINE"],
  ["i don't approve", "DECLINE"],
  ["i do not approve", "DECLINE"],
  ["never mind", "DECLINE"],
  ["forget it", "DECLINE"],
  ["forget about it", "DECLINE"],
  ["scrap it", "DECLINE"],
  ["scrap that", "DECLINE"],
  ["drop it", "DECLINE"],
  ["no thanks", "DECLINE"],
  ["no thank you", "DECLINE"],
  ["لا ترسل", "DECLINE"],
  ["لا ترسلها", "DECLINE"],
  ["لا ترسله", "DECLINE"],
  ["لا ترسلهم", "DECLINE"],
  ["لا توافق", "DECLINE"],
  ["لا تفعل", "DECLINE"],
  ["لا تنفذ", "DECLINE"],
  ["انسى الموضوع", "DECLINE"],
  // Not a decision yet: a hold is an edit (nothing approved).
  ["not yet", "EDIT"],
  ["hold on", "EDIT"],
  ["hold off", "EDIT"],
  ["one sec", "EDIT"],
  ["one second", "EDIT"],
  ["ليس الان", "EDIT"],
  ["مش الان", "EDIT"],
  ["مو الحين", "EDIT"],
  // "No" that is not a refusal.
  ["no problem", "YES"],
  ["no worries", "YES"],
  // Approval stated, in the words people use.
  ["you have my approval", "APPROVE"],
  ["you've got my approval", "APPROVE"],
  ["you have my go ahead", "APPROVE"],
  ["you have the green light", "APPROVE"],
  ["green light", "APPROVE"],
  ["i give my approval", "APPROVE"],
  ["i give you my approval", "APPROVE"],
  ["i give the approval", "APPROVE"],
  ["i've given my approval", "APPROVE"],
  ["i have given my approval", "APPROVE"],
  ["i've given you my approval", "APPROVE"],
  ["i have given you my approval", "APPROVE"],
  ["i gave my approval", "APPROVE"],
  ["i gave you my approval", "APPROVE"],
  ["i already approved", "APPROVE"],
  ["i've approved", "APPROVE"],
  ["i have approved", "APPROVE"],
  ["i approve", "APPROVE"],
  ["approved", "APPROVE"],
  ["approve", "APPROVE"],
  ["approval", "APPROVE"],
  ["go ahead", "APPROVE"],
  ["go for it", "APPROVE"],
  ["send it", "APPROVE"],
  ["send them", "APPROVE"],
  ["send", "APPROVE"],
  ["do it", "APPROVE"],
  ["let's do it", "APPROVE"],
  ["lets do it", "APPROVE"],
  ["make it so", "APPROVE"],
  ["book it", "APPROVE"],
  ["ship it", "APPROVE"],
  ["i confirm", "APPROVE"],
  ["confirmed", "APPROVE"],
  ["confirm", "APPROVE"],
  ["proceed", "APPROVE"],
  ["توكل على الله", "APPROVE"],
  ["انا موافق", "APPROVE"],
  ["موافق", "APPROVE"],
  ["موافقه", "APPROVE"],
  ["اوافق", "APPROVE"],
  ["وافقت", "APPROVE"],
  ["اعتمد", "APPROVE"],
  ["اعتمدها", "APPROVE"],
  ["اعتمده", "APPROVE"],
  ["معتمد", "APPROVE"],
  ["ارسل", "APPROVE"],
  ["ارسلها", "APPROVE"],
  ["ارسله", "APPROVE"],
  ["ارسلهم", "APPROVE"],
  ["ابعث", "APPROVE"],
  ["ابعثها", "APPROVE"],
  ["اكد", "APPROVE"],
  ["اكدها", "APPROVE"],
  ["اكده", "APPROVE"],
  ["مؤكد", "APPROVE"],
  ["موكد", "APPROVE"],
  ["تاكيد", "APPROVE"],
  ["نفذ", "APPROVE"],
  ["نفذها", "APPROVE"],
  ["نفذه", "APPROVE"],
  ["امض", "APPROVE"],
  ["امضي", "APPROVE"],
  ["قدما", "FILLER"],
  // A plain yes: not enough on its own here (the model readings judge it).
  ["sounds good", "YES"],
  ["looks good", "YES"],
  ["looks great", "YES"],
  ["that's fine", "YES"],
  ["that's good", "YES"],
  ["all right", "YES"],
  ["of course", "YES"],
  ["please do", "YES"],
  ["yes", "YES"],
  ["yeah", "YES"],
  ["yep", "YES"],
  ["yup", "YES"],
  ["yea", "YES"],
  ["sure", "YES"],
  ["ok", "YES"],
  ["okay", "YES"],
  ["alright", "YES"],
  ["fine", "YES"],
  ["great", "YES"],
  ["perfect", "YES"],
  ["good", "YES"],
  ["correct", "YES"],
  ["absolutely", "YES"],
  ["definitely", "YES"],
  ["نعم", "YES"],
  ["ايوه", "YES"],
  ["ايوا", "YES"],
  ["اي", "YES"],
  ["اجل", "YES"],
  ["تمام", "YES"],
  ["طيب", "YES"],
  ["اوكي", "YES"],
  ["ماشي", "YES"],
  ["حسنا", "YES"],
  ["يلا", "YES"],
  // A plain no.
  ["no", "NO"],
  ["nope", "NO"],
  ["nah", "NO"],
  ["لا", "NO"],
  // Refusal words.
  ["cancel", "DECLINE"],
  ["cancelled", "DECLINE"],
  ["decline", "DECLINE"],
  ["declined", "DECLINE"],
  ["i decline", "DECLINE"],
  ["reject", "DECLINE"],
  ["rejected", "DECLINE"],
  ["i reject", "DECLINE"],
  ["don't", "DECLINE"],
  ["dont", "DECLINE"],
  ["do not", "DECLINE"],
  ["stop", "DECLINE"],
  ["الغ", "DECLINE"],
  ["الغي", "DECLINE"],
  ["الغها", "DECLINE"],
  ["الغيها", "DECLINE"],
  ["الغاء", "DECLINE"],
  ["ارفض", "DECLINE"],
  ["ارفضها", "DECLINE"],
  ["رفض", "DECLINE"],
  ["مرفوض", "DECLINE"],
  ["رافض", "DECLINE"],
  // Which: both, all, a position.
  ["both of them", "BOTH"],
  ["both cards", "BOTH"],
  ["both changes", "BOTH"],
  ["the two", "BOTH"],
  ["both", "BOTH"],
  ["الاثنين", "BOTH"],
  ["الاثنتين", "BOTH"],
  ["الثنين", "BOTH"],
  ["كلاهما", "BOTH"],
  ["كليهما", "BOTH"],
  ["all of them", "ALL"],
  ["all of it", "ALL"],
  ["all three", "ALL"],
  ["all four", "ALL"],
  ["everything", "ALL"],
  ["each of them", "ALL"],
  ["all", "ALL"],
  ["الكل", "ALL"],
  ["كلهم", "ALL"],
  ["كلها", "ALL"],
  ["جميعها", "ALL"],
  ["جميعهم", "ALL"],
  ["الجميع", "ALL"],
  ["the first one", { ordinal: 1 }],
  ["the second one", { ordinal: 2 }],
  ["the third one", { ordinal: 3 }],
  ["the first", { ordinal: 1 }],
  ["the second", { ordinal: 2 }],
  ["the third", { ordinal: 3 }],
  ["first one", { ordinal: 1 }],
  ["second one", { ordinal: 2 }],
  ["third one", { ordinal: 3 }],
  ["first", { ordinal: 1 }],
  ["second", { ordinal: 2 }],
  ["third", { ordinal: 3 }],
  ["الاول", { ordinal: 1 }],
  ["الاولى", { ordinal: 1 }],
  ["الثاني", { ordinal: 2 }],
  ["الثانيه", { ordinal: 2 }],
  ["الثالث", { ordinal: 3 }],
  ["الثالثه", { ordinal: 3 }],
  // The card itself, by what it is.
  ["the change", "REF"],
  ["that change", "REF"],
  ["this change", "REF"],
  ["the changes", "REF"],
  ["these changes", "REF"],
  ["those changes", "REF"],
  ["the update", "REF"],
  ["that update", "REF"],
  ["the edit", "REF"],
  ["follow up", "REF"],
  ["followup", "REF"],
  ["that one", "REF"],
  ["this one", "REF"],
  ["the one", "REF"],
  ["one", "REF"],
  ["it", "REF"],
  ["that", "REF"],
  ["this", "REF"],
  ["them", "REF"],
  ["those", "REF"],
  ["these", "REF"],
  ["the", "REF"],
  ["a", "REF"],
  ["an", "REF"],
  ["my", "REF"],
  ["your", "REF"],
  ["our", "REF"],
  ["card", "REF"],
  ["cards", "REF"],
  ["email", "REF"],
  ["emails", "REF"],
  ["message", "REF"],
  ["messages", "REF"],
  ["reply", "REF"],
  ["meeting", "REF"],
  ["invite", "REF"],
  ["invitation", "REF"],
  ["intro", "REF"],
  ["introduction", "REF"],
  ["reminder", "REF"],
  ["note", "REF"],
  ["draft", "REF"],
  ["proposal", "REF"],
  ["request", "REF"],
  ["action", "REF"],
  ["booking", "REF"],
  ["to", "REF"],
  ["with", "REF"],
  ["for", "REF"],
  ["هذا", "REF"],
  ["هذه", "REF"],
  ["هذي", "REF"],
  ["ذلك", "REF"],
  ["الرساله", "REF"],
  ["الايميل", "REF"],
  ["البريد", "REF"],
  ["الاجتماع", "REF"],
  ["الطلب", "REF"],
  ["المتابعه", "REF"],
  ["الى", "REF"],
  ["مع", "REF"],
  ["على", "REF"],
  // Filler.
  ["thank you", "FILLER"],
  ["right now", "FILLER"],
  ["i said", "FILLER"],
  ["i told you", "FILLER"],
  ["like i said", "FILLER"],
  ["as i said", "FILLER"],
  ["you can", "FILLER"],
  ["please", "FILLER"],
  ["pls", "FILLER"],
  ["thanks", "FILLER"],
  ["q", "FILLER"],
  ["hey", "FILLER"],
  ["and", "FILLER"],
  ["then", "FILLER"],
  ["now", "FILLER"],
  ["just", "FILLER"],
  ["so", "FILLER"],
  ["well", "FILLER"],
  ["um", "FILLER"],
  ["uh", "FILLER"],
  ["i", "FILLER"],
  ["you", "FILLER"],
  ["i've", "FILLER"],
  ["have", "FILLER"],
  ["has", "FILLER"],
  ["given", "FILLER"],
  ["gave", "FILLER"],
  ["give", "FILLER"],
  ["got", "FILLER"],
  ["already", "FILLER"],
  ["go", "FILLER"],
  ["on", "FILLER"],
  ["out", "FILLER"],
  ["really", "FILLER"],
  ["is", "FILLER"],
  ["are", "FILLER"],
  ["of", "FILLER"],
  ["من فضلك", "FILLER"],
  ["لو سمحت", "FILLER"],
  ["رجاء", "FILLER"],
  ["رجاءا", "FILLER"],
  ["شكرا", "FILLER"],
  ["يا", "FILLER"],
  ["كيو", "FILLER"],
  ["الان", "FILLER"],
  ["الحين", "FILLER"],
  ["انا", "FILLER"],
];

/** Words that ask for something different. Any one makes it an EDIT. */
const EDIT_WORDS: ReadonlySet<string> = new Set([
  "but",
  "except",
  "change",
  "changes",
  "changed",
  "edit",
  "modify",
  "update",
  "instead",
  "rather",
  "different",
  "differently",
  "tweak",
  "adjust",
  "rewrite",
  "reword",
  "fix",
  "add",
  "remove",
  "move",
  "make",
  "wait",
  "later",
  "after",
  "before",
  "if",
  "unless",
  "however",
  "though",
  "although",
  "لكن",
  "بس",
  "غير",
  "غيرها",
  "عدل",
  "عدلها",
  "بدل",
  "انتظر",
  "استنى",
  "بعدين",
  "اذا",
  "لو",
  "الا",
]);

/** Refusal words that are also verbs a card can do ("Cancel the call"). */
const REFUSAL_VERBS: ReadonlySet<string> = new Set([
  "cancel",
  "cancelled",
  "decline",
  "declined",
  "reject",
  "rejected",
  "stop",
  "drop",
  "scrap",
  "الغ",
  "الغاء",
  "ارفض",
  "رفض",
]);

/**
 * Lowercase; one apostrophe; Arabic without diacritics, tatweel or hamza
 * seat variants, so "أرسلها" and "ارسلها" are one word.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ`]/gu, "'")
    .replace(/[ً-ْٰـ]/gu, "")
    .replace(/[آأإٱ]/gu, "ا")
    .replace(/ة/gu, "ه")
    .replace(/ى/gu, "ي");
}

function tokens(text: string): string[] {
  return normalise(text)
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/u)
    .map((word) => word.replace(/^'+|'+$/gu, ""))
    .filter((word) => word.length > 0);
}

const TABLE: readonly (readonly [readonly string[], Role])[] = PHRASES.map(
  ([phrase, role]) => [tokens(phrase), role] as const,
).sort((a, b) => b[0].length - a[0].length);

const MAX_WORDS = 24;

/** The words of a card's summary that may point at it ("Harbourline"). */
function summaryWords(summaries: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const summary of summaries) {
    for (const word of tokens(summary)) {
      if (word.length >= 3 && !EDIT_WORDS.has(word)) words.add(word);
    }
  }
  return words;
}

/** An Arabic "and"/"so" written onto the next word ("وأرسلها"). */
function arabicPrefixed(word: string): string | null {
  return /^[وف]\p{L}{2,}$/u.test(word) ? word.slice(1) : null;
}

/**
 * The decision in an utterance, if it is made of nothing but decision
 * words. `summaries`: the waiting cards' summaries, whose names point at
 * them.
 */
export function readApprovalWords(
  utterance: string,
  options: { readonly summaries?: readonly string[] | undefined } = {},
): ApprovalWords {
  // A question is not a decision ("approve it?", "should I send it?").
  if (/[?؟]/u.test(utterance)) return { kind: "NONE" };
  const words = tokens(utterance);
  if (words.length === 0 || words.length > MAX_WORDS) return { kind: "NONE" };
  const named = summaryWords(options.summaries ?? []);
  const cardWords = new Set(
    (options.summaries ?? []).flatMap((summary) => tokens(summary)),
  );
  const roles: Role[] = [];
  // A decision word that is also the card's own verb ("cancel it" to a
  // card that cancels a meeting) says nothing about the card: not read.
  let ownVerb = false;
  let unknown = false;
  let index = 0;
  while (index < words.length) {
    let matched = false;
    for (const [phrase, role] of TABLE) {
      if (phrase.length === 0 || index + phrase.length > words.length) continue;
      if (phrase.every((word, offset) => words[index + offset] === word)) {
        if (
          role === "DECLINE" &&
          phrase.some((word) => REFUSAL_VERBS.has(word) && cardWords.has(word))
        ) {
          ownVerb = true;
        }
        roles.push(role);
        index += phrase.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const word = words[index] ?? "";
    index += 1;
    if (EDIT_WORDS.has(word)) {
      roles.push("EDIT");
      continue;
    }
    if (named.has(word)) {
      roles.push("REF");
      continue;
    }
    const bare = arabicPrefixed(word);
    if (bare !== null) {
      const role = TABLE.find(
        ([phrase]) => phrase.length === 1 && phrase[0] === bare,
      )?.[1];
      if (role !== undefined) {
        roles.push(role);
        continue;
      }
      if (EDIT_WORDS.has(bare)) {
        roles.push("EDIT");
        continue;
      }
    }
    unknown = true;
  }
  // A request for something different wins over everything else said.
  if (roles.includes("EDIT")) return { kind: "EDIT" };
  if (unknown || ownVerb) return { kind: "NONE" };
  const has = (role: Role) => roles.includes(role);
  const approve = has("APPROVE");
  const yes = has("YES");
  const decline = has("DECLINE");
  const no = has("NO");
  const scope: ApprovalScope = has("ALL")
    ? "ALL"
    : has("BOTH")
      ? "BOTH"
      : "ONE";
  const ordinals = roles.flatMap((role) =>
    typeof role === "object" ? [role.ordinal] : [],
  );
  const ordinal = ordinals.length === 1 ? (ordinals[0] ?? null) : null;
  if (ordinals.length > 1) return { kind: "NONE" };
  // Yes and no in one breath ("no, go ahead"): not read here.
  if ((approve || yes) && (decline || no)) return { kind: "NONE" };
  if (approve || yes) {
    return {
      kind: "APPROVE",
      scope,
      strength: approve ? "EXPLICIT" : "PLAIN",
      ordinal,
    };
  }
  if (decline || no) {
    return {
      kind: "DECLINE",
      scope,
      strength: decline ? "EXPLICIT" : "PLAIN",
      ordinal,
    };
  }
  if (scope !== "ONE" || ordinal !== null || roles.includes("REF")) {
    return { kind: "REFER", scope, ordinal };
  }
  return { kind: "NONE" };
}

/** What an edit names as the thing to change ("change the date"). */
const FIELD_WORDS: ReadonlySet<string> = new Set([
  "date",
  "day",
  "time",
  "hour",
  "amount",
  "title",
  "wording",
  "words",
  "text",
  "subject",
  "recipient",
  "place",
  "location",
  "duration",
  "length",
  "name",
  "التاريخ",
  "اليوم",
  "الوقت",
  "الساعه",
  "المبلغ",
  "العنوان",
  "النص",
  "المكان",
]);

/** Words an edit request may hold that carry no new value. */
const EDIT_FILLER: ReadonlySet<string> = new Set(
  [
    ...TABLE.flatMap(([phrase]) => phrase),
    "can",
    "could",
    "would",
    "want",
    "wanna",
    "need",
    "needs",
    "like",
    "let's",
    "lets",
    "us",
    "me",
    "maybe",
    "different",
    "another",
    "new",
    "bit",
    "little",
  ].map((word) => tokens(word)[0] ?? word),
);

/**
 * An edit request read by code (owner 2026-10-16): what it asks to change,
 * and whether it says the new value. "Sounds good but change the date"
 * names the date and gives none, so Q asks for it; "change it to Friday"
 * gives one, so the change is prepared again with it. Null: not an edit.
 */
export function readEditRequest(
  utterance: string,
  options: { readonly summaries?: readonly string[] | undefined } = {},
): { readonly field: string | null; readonly valueGiven: boolean } | null {
  if (readApprovalWords(utterance, options).kind !== "EDIT") return null;
  const named = summaryWords(options.summaries ?? []);
  let field: string | null = null;
  let valueGiven = false;
  for (const word of tokens(utterance)) {
    if (FIELD_WORDS.has(word)) {
      field ??= word;
      continue;
    }
    if (/\p{N}/u.test(word)) {
      valueGiven = true;
      continue;
    }
    if (EDIT_WORDS.has(word) || EDIT_FILLER.has(word) || named.has(word)) {
      continue;
    }
    const bare = arabicPrefixed(word);
    if (bare !== null && (EDIT_WORDS.has(bare) || EDIT_FILLER.has(bare))) {
      continue;
    }
    valueGiven = true;
  }
  return { field, valueGiven };
}

/** An explicit approval, read by code: the words alone may approve. */
export function explicitlyApproves(words: ApprovalWords): boolean {
  return words.kind === "APPROVE" && words.strength === "EXPLICIT";
}

/**
 * Whether an utterance may stand as the person's approval of a card at
 * all: neither a refusal nor a request for something different. The gate
 * under every approval by conversation, the model's tool included.
 */
export function mayStandAsApproval(
  utterance: string,
  summaries: readonly string[] = [],
): boolean {
  const words = readApprovalWords(utterance, { summaries });
  return words.kind !== "EDIT" && words.kind !== "DECLINE";
}
