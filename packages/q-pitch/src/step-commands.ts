/**
 * Q Pitch v6 step commands (owner 16 Oct): "next", "go back", "back two
 * steps", "forward three steps", "go to step 7", "skip this", "pause",
 * "resume", said or typed at any time, obeyed exactly. Deterministic: a
 * closed phrase table per language plus number words and digits, never a
 * model. Anything that is not a whole command is not one (it is a
 * question), so a sentence that merely contains "next" never moves the
 * tour.
 *
 * Languages: English, French, Spanish, Portuguese, German, Italian and
 * Swahili, with digits everywhere. Another language's viewer can still use
 * digits ("7", "-2") and the Tour menu.
 */

export type StepCommand =
  | { readonly kind: "NEXT" }
  | { readonly kind: "BACK"; readonly count: number }
  | { readonly kind: "FORWARD"; readonly count: number }
  | { readonly kind: "GOTO"; readonly step: number }
  | { readonly kind: "PAUSE" }
  | { readonly kind: "RESUME" };

/** Number words 1-20 by language; digits are read separately. */
const NUMBER_WORDS: Readonly<Record<string, number>> = Object.fromEntries(
  (
    [
      // English
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
      // French
      "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize dixsept dixhuit dixneuf vingt",
      // Spanish
      "uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte",
      // Portuguese
      "um dois tres quatro cinco seis sete oito nove dez onze doze treze catorze quinze dezesseis dezessete dezoito dezenove vinte",
      // German
      "eins zwei drei vier funf sechs sieben acht neun zehn elf zwolf dreizehn vierzehn funfzehn sechzehn siebzehn achtzehn neunzehn zwanzig",
      // Italian
      "uno due tre quattro cinque sei sette otto nove dieci undici dodici tredici quattordici quindici sedici diciassette diciotto diciannove venti",
      // Swahili
      "moja mbili tatu nne tano sita saba nane tisa kumi",
    ] as const
  ).flatMap((line) =>
    line.split(" ").map((word, index) => [word, index + 1] as const),
  ),
);
// Words that are numbers in one language and something else in another
// are read as numbers only after a step word or a move word (see below).
const ORDINALS: Readonly<Record<string, number>> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: -1,
  premier: 1,
  premiere: 1,
  primero: 1,
  primera: 1,
  primeiro: 1,
  erste: 1,
  primo: 1,
};

function numberOf(word: string | undefined): number | null {
  if (word === undefined) return null;
  if (/^\d{1,3}$/u.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? ORDINALS[word] ?? null;
}

/** Lower case, accents and punctuation removed, one space between words. */
export function normaliseCommand(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/(\p{L})[-‐–](\p{L})/gu, "$1$2")
    .replace(/[-‐–](?=\s|$)/gu, " ")
    .replace(/(\d)\s*(st|nd|rd|th|e|er|eme|o|a)\b/gu, "$1")
    .replace(/[^\p{L}\p{N}\s+-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// Polite padding a command may carry: "Q, please go back two steps now".
const PAD =
  /^(?:(?:q|hey q|ok|okay|please|now|so|alors|bitte|por favor|per favore|tafadhali|can you|could you|let s|lets)\s+)*/u;
const TAIL =
  /(?:\s+(?:please|now|thanks|thank you|svp|sil vous plait|bitte|por favor|per favore|tafadhali))*$/u;
const STEPWORD =
  "(?:steps?|etapes?|etape|pasos?|passos?|etapas?|schritte?|schritt|passi|passo|hatua)";

const NEXT =
  /^(?:next|next one|next step|skip|skip this|skip that|suivant|suivante|etape suivante|passe|passer|siguiente|siguiente paso|saltar|proximo|proxima|proximo passo|pular|weiter|nachster schritt|nachste|uberspringen|avanti|prossimo|salta|ijayo|endelea mbele|ruka)$/u;
const PAUSE =
  /^(?:pause|stop|stop talking|hold on|hold on a second|hold on a sec|wait|wait a second|wait a moment|one moment|pause the tour|stop the tour|attends|attendez|arrete|pausa|para|espera|halt|warte|anhalten|aspetta|ferma|subiri|simama)$/u;
const RESUME =
  /^(?:resume|continue|carry on|go on|keep going|resume the tour|reprends|reprendre|continuer|continua|continuar|sigue|seguir|weiter machen|fortsetzen|riprendi|continuare|endelea)$/u;
const BACK_ONE =
  /^(?:go back|back|i want to go back|take me back|previous|previous step|rewind|retour|reviens|precedent|precedente|atras|volver|anterior|voltar|zuruck|vorherige|indietro|precedente|rudi|nyuma)$/u;

const BACK_N = new RegExp(
  `^(?:go back|back|rewind|recule|reviens|retour|retrocede|vuelve|atras|volta|voltar|zuruck|geh zuruck|torna indietro|indietro|rudi nyuma|rudi)\\s+(?:by\\s+|de\\s+|um\\s+|di\\s+)?(?:${STEPWORD}\\s+)?(\\S+)(?:\\s+${STEPWORD})?(?:\\s+(?:back|en arriere|atras|zuruck|indietro|nyuma))?$`,
  "u",
);
const FORWARD_N = new RegExp(
  `^(?:go forward|forward|skip ahead|skip|avance|avancer|saute|adelante|avanza|salta|avancar|pula|vor|geh vor|vorwarts|uberspringe|vai avanti|avanti|salta|songa mbele|ruka)\\s+(?:by\\s+|de\\s+|um\\s+|di\\s+)?(?:${STEPWORD}\\s+)?(\\S+)(?:\\s+${STEPWORD})?(?:\\s+(?:forward|ahead|en avant|adelante|vorwarts|avanti|mbele))?$`,
  "u",
);
const GOTO_N = new RegExp(
  `^(?:go to|jump to|skip to|take me to|show me|aller a|va a|vas a|allez a|ir a|ve a|vai para|ir para|geh zu|gehe zu|springe zu|vai a|vai al|vai alla|nenda|enda)?\\s*(?:the\\s+|l\\s+|la\\s+|el\\s+|o\\s+|zu\\s+|al\\s+)?${STEPWORD}\\s+(?:number\\s+|numero\\s+|nummer\\s+|namba\\s+)?(\\S+)$`,
  "u",
);
// "the third step", "la troisieme etape", "last step"
const GOTO_ORDINAL = new RegExp(
  `^(?:go to|jump to|take me to)?\\s*(?:the\\s+)?(first|second|third|fourth|fifth|last)\\s+${STEPWORD}$`,
  "u",
);
// "go to 7", "aller à 7": a move word and a number, no step word.
const GOTO_BARE =
  /^(?:go to|jump to|skip to|aller a|va a|ir a|vai para|geh zu|gehe zu|vai a|nenda)\s+(\S+)$/u;
// A bare signed number typed into the box: "7" goes there, "-2" back, "+3" on.
const SIGNED = /^([+-]?)(\d{1,3})$/u;

/**
 * The step command in `text`, or null when it is not a whole command.
 * Counts and steps are whole numbers 1-200; "last" is -1 (the last step).
 */
export function parseStepCommand(text: string): StepCommand | null {
  const said = normaliseCommand(text).replace(PAD, "").replace(TAIL, "");
  if (said.length === 0 || said.length > 60) return null;
  const signed = SIGNED.exec(said);
  if (signed !== null) {
    const value = Number(signed[2]);
    if (value < 1 || value > 200) return null;
    if (signed[1] === "-") return { kind: "BACK", count: value };
    if (signed[1] === "+") return { kind: "FORWARD", count: value };
    return { kind: "GOTO", step: value };
  }
  if (NEXT.test(said)) return { kind: "NEXT" };
  if (PAUSE.test(said)) return { kind: "PAUSE" };
  if (RESUME.test(said)) return { kind: "RESUME" };
  if (BACK_ONE.test(said)) return { kind: "BACK", count: 1 };
  const ordinal = GOTO_ORDINAL.exec(said);
  if (ordinal !== null) {
    const step = numberOf(ordinal[1]);
    if (step !== null) return { kind: "GOTO", step };
  }
  for (const [pattern, kind] of [
    [GOTO_N, "GOTO"],
    [GOTO_BARE, "GOTO"],
    [BACK_N, "BACK"],
    [FORWARD_N, "FORWARD"],
  ] as const) {
    const match = pattern.exec(said);
    if (match === null) continue;
    const value = numberOf(match[1]);
    if (value === null || value === 0 || value > 200) continue;
    if (kind === "GOTO") return { kind, step: value };
    if (value < 1) continue;
    return { kind, count: value };
  }
  return null;
}

/** What a command does from `current` (0-based) in a tour of `total` steps. */
export type StepMove =
  | { readonly kind: "STEP"; readonly step: number }
  | { readonly kind: "SKIP" }
  | { readonly kind: "PAUSE" }
  | { readonly kind: "RESUME" }
  | { readonly kind: "OUT_OF_RANGE" };

/**
 * The move a command makes. "Next" on the last step finishes the tour
 * (SKIP); every other move names the 1-based step it lands on, and one
 * outside the tour is refused (OUT_OF_RANGE), never clamped, so Q says so
 * instead of landing somewhere it was not asked to go.
 */
export function resolveStepCommand(
  command: StepCommand,
  current: number,
  total: number,
): StepMove {
  const to = (index: number): StepMove =>
    index >= 0 && index < total
      ? { kind: "STEP", step: index + 1 }
      : { kind: "OUT_OF_RANGE" };
  switch (command.kind) {
    case "PAUSE":
      return { kind: "PAUSE" };
    case "RESUME":
      return { kind: "RESUME" };
    case "NEXT":
      return current + 1 >= total ? { kind: "SKIP" } : to(current + 1);
    case "BACK":
      return to(current - command.count);
    case "FORWARD":
      return to(current + command.count);
    case "GOTO":
      return command.step === -1 ? to(total - 1) : to(command.step - 1);
  }
}
