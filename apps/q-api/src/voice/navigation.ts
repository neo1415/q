import type { QVoiceDestination } from "@capital-q/contracts";

/**
 * What a spoken sentence asks the screen to do, read deterministically
 * (CQ-Q-VOICE-001 rework). The interviewer reads these through its model;
 * the welcome and the open conversation had no reader at all, so "take me
 * to Discover" reached Q as a question and Q, correctly, could not do it.
 * These patterns are narrow on purpose: a sentence that merely mentions a
 * page ("what is Discover?") is a question, not a request to go there.
 */

const GO = String.raw`(?:take me|bring me|go|move|jump|switch|head|navigate|send me)(?: over| back| straight)? to|open(?: up)?|show me|let'?s (?:go|see)|i(?: would|'d) like to (?:see|go to)|can (?:i|we) (?:see|go to)`;

const PAGES: readonly (readonly [QVoiceDestination, RegExp])[] = [
  ["DISCOVER", /\b(?:discover(?:y)?|discover page|feed)\b/i],
  ["HOME", /\b(?:home|the home page|the main page|the dashboard|the start)\b/i],
  ["PROFILE", /\b(?:my )?(?:profile|profile page|my page|my details)\b/i],
  [
    "CAPITAL",
    /\b(?:capital|the capital page|fundraising|my raise|the raise)\b/i,
  ],
  [
    "COMPANY_VISIBILITY",
    /\b(?:visibility|company visibility|who can see (?:us|me|my company))\b/i,
  ],
  [
    "INTERVIEW",
    /\b(?:interview|setup|onboarding|questions|where we left off)\b/i,
  ],
  ["FORM", /\b(?:the form|forms?|typing it in|fill (?:it|the form) in)\b/i],
];

const GO_RE = new RegExp(
  String.raw`\b(?:${GO})\b\s+(?:the |my |our )?([a-z' ]{2,40})`,
  "i",
);

/** A destination the person asked to be taken to, or null when they did not. */
export function spokenDestination(text: string): QVoiceDestination | null {
  const match = GO_RE.exec(text);
  if (match === null) return null;
  const named = match[1] ?? "";
  for (const [destination, pattern] of PAGES) {
    if (pattern.test(named)) return destination;
  }
  return null;
}

/**
 * The person is done talking and wants the typed conversation (or nothing):
 * "end the chat", "stop talking", "let me type", "that's all, thanks".
 */
const END_RE =
  /^(?:(?:okay|ok|alright|right|so|well|thanks?|thank you|please)[,.!\s]*)*(?:(?:let'?s )?(?:end|stop|finish|close|leave|quit|exit)(?: the| this| our)? (?:chat|call|conversation|voice|talk(?:ing)?|session)|stop talking|(?:i(?:'ll| will| want to| would rather| prefer to)? )?(?:switch|go|move|change) to (?:typing|text|chat|the chat|keyboard)|let me type|i(?:'d| would) rather type|(?:that'?s|that is|that was) (?:all|it|everything)(?: for now)?(?:,? thanks?| thank you)?|(?:good)?bye(?: for now)?|see you(?: later)?|talk (?:to you )?later|i(?:'m| am) done(?: for now)?|we(?:'re| are) done)(?:,? please| thanks?| thank you)?[.!?\s]*$/i;

export function wantsToEndVoice(text: string): boolean {
  return END_RE.test(text.trim());
}

/**
 * A sound the recogniser wrote down that carries no words: a cough, a
 * laugh, a throat cleared, a bare "uh". Not a turn. Also the browser's own
 * cue after a false interruption.
 */
const NON_LEXICAL_RE =
  /^[\s\W]*(?:\[?\(?(?:cough(?:s|ing)?|laughs?|laughter|laughing|sighs?|sniff(?:s|les)?|sneezes?|clears? throat|throat clearing|breath(?:s|ing)?|hmm+|mm+|hm+|uh+|um+|ah+|er+|erm+|oh+|huh)\)?\]?[\s\W]*)+$/i;

export const CONTINUE_SIGNAL = "[continue]";

export function isNonLexical(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === CONTINUE_SIGNAL || NON_LEXICAL_RE.test(trimmed);
}

/** Why a run stopped, in one spoken line that says what Q can still do. */
const RECOVERY_LINES: Readonly<Record<string, readonly string[]>> = {
  EVIDENCE_UNAVAILABLE: [
    "I couldn't get to the records behind that just now. I can still look at your website, talk through your pitch, or take you to Discover; which helps?",
    "That one didn't come through; the supporting records were out of reach for a moment. Ask me something narrower, or point me at a website and I'll read it.",
  ],
  Q_TIMEOUT: [
    "That took longer than I'm willing to keep you waiting. Ask it again in a moment, or ask me something smaller and I'll build up.",
  ],
  Q_UNAVAILABLE: [
    "I've hit a snag on my side. Give me a moment and ask again, or tell me what you'd like to do next and I'll find a way.",
  ],
  NOT_AVAILABLE_IN_CONTEXT: [
    "I can't see that from where we are. Tell me which company or investor you mean, or set one up, and I'll take it from there.",
  ],
  Q_FAILED: [
    "That didn't work, and I'd rather say so than guess. Try it another way, or ask me for something I can check directly.",
  ],
};
const RECOVERY_DEFAULT = [
  "I couldn't finish that one. Ask me again, or tell me what would help most and I'll go from there.",
];
let recoveryTurn = 0;

/**
 * Never the same apology twice in a row: the lines rotate, and each says
 * what Q can do instead of only what it couldn't.
 */
function rotate(lines: readonly string[], turn: number): string {
  return lines[turn % lines.length] ?? lines.join(" ");
}

export function recoveryLine(code: string): string {
  const lines = RECOVERY_LINES[code] ?? RECOVERY_DEFAULT;
  recoveryTurn += 1;
  return rotate(lines, recoveryTurn);
}

export const FILLERS_THINKING = [
  "Let me check that.",
  "One second.",
  "Give me a moment on that.",
  "Let me look.",
  "Hold on, checking.",
];
export const FILLERS_RESEARCH = [
  "Let me look at public sources.",
  "Checking the public web on that.",
  "Give me a moment to look that up.",
];
let fillerTurn = 0;

/** A short line for the wait, different each time. */
export function fillerLine(kind: "THINKING" | "RESEARCH"): string {
  const lines = kind === "THINKING" ? FILLERS_THINKING : FILLERS_RESEARCH;
  fillerTurn += 1;
  return rotate(lines, fillerTurn);
}

const RESUME_ACKS = [
  "Sorry, I got cut off. As I was saying,",
  "Picking up where I stopped.",
  "Right, where was I.",
];
let resumeTurn = 0;

/** Q acknowledges the cut and carries on from the same sentence. */
export function resumeAcknowledgement(): string {
  resumeTurn += 1;
  return rotate(RESUME_ACKS, resumeTurn);
}

const DESTINATION_LINES: Readonly<Record<QVoiceDestination, string>> = {
  HOME: "Taking you home now.",
  PROFILE: "Opening your profile.",
  CAPITAL: "Taking you to Capital.",
  DISCOVER: "Taking you to Discover.",
  COMPANY_VISIBILITY: "Opening your visibility settings.",
  INTERVIEW: "Taking you back to the setup.",
  INTERVIEW_FOUNDER: "Let's set up your company.",
  INTERVIEW_INVESTOR: "Let's set up your mandate.",
  FORM: "Leaving you with the form.",
};

export function destinationLine(destination: QVoiceDestination): string {
  return DESTINATION_LINES[destination];
}

/**
 * A spoken request to be seen, or not, by investors on Capital Q. A
 * consequential change: Q confirms first, and the platform's own
 * visibility API performs it under the person's authority.
 */
const VISIBLE_ON_RE =
  /\b(?:make|set|turn|get)\s+(?:me|us|my company|the company|our company|my profile|our profile|it)\s+(?:visible|public|discoverable|findable)|\b(?:i|we)(?:'d| would)? (?:want|like|wish) (?:to be|to go|to become) (?:visible|discoverable|public|findable)|\bgo (?:public|visible|live)\b|\b(?:be|become) (?:visible|discoverable) to investors\b/i;
const VISIBLE_OFF_RE =
  /\b(?:make|set|turn|keep)\s+(?:me|us|my company|the company|our company|my profile|our profile|it)\s+(?:private|hidden|invisible|not visible)|\bhide (?:me|us|my company|our company|my profile)\b|\b(?:i|we)(?:'d| would)? (?:want|like|prefer) to (?:be|stay|go) (?:private|hidden|invisible)\b|\bgo private\b/i;

export type SpokenVisibility = "network_visible" | "organisation_private";

export function spokenVisibility(text: string): SpokenVisibility | null {
  if (VISIBLE_OFF_RE.test(text)) return "organisation_private";
  if (VISIBLE_ON_RE.test(text)) return "network_visible";
  return null;
}

const DECLINE_RE =
  /^(?:(?:um+|uh+|no|nope|nah|not (?:now|yet|really)|leave it|don'?t|never mind|cancel|actually no|keep it as it is)[,.!\s]*)+$/i;

export function declines(text: string): boolean {
  return DECLINE_RE.test(text.trim());
}
