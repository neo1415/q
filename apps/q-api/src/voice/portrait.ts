/**
 * "What do you have on me so far?" answered the way a person would (H,
 * the product-acceptance directive of 2026-09-24).
 *
 * The answer used to be arithmetic and a field dump: "19 of 33 answered,
 * 14 to go. On your record so far: How do you invest: Angel investor;
 * Your firm: Zino Aviation; …". The person asked twice, then told Q it
 * talked like a robot. This composes a few plain sentences from what the
 * session actually holds — the owning service's record, never the
 * conversation, never the model — and names what is left in words.
 *
 * Platform copy keyed by step, like step-copy.ts: nothing here reads what
 * the person said. A step without a sentence of its own falls back to a
 * plain one built from its noun. Only declared values appear; a step with
 * nothing on the record is not mentioned as "any" or "none".
 */

import { STEP_NOUNS } from "./step-copy.js";

/** One recorded answer, already said the way a person says it. */
export type PortraitEntry = {
  readonly stepKey: string;
  /** Option labels, category names, or a single figure or text. */
  readonly items: readonly string[];
};

/** "and" for a list of things that all hold; "or" for alternatives. */
function join(items: readonly string[], word: "and" | "or" = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1) ?? ""}`;
}

/**
 * A label read inside a sentence: "Deep domain expertise" becomes "deep
 * domain expertise", but "Series A", "US dollar" and "SaaS" keep their
 * capitals, because their second letter already says they are names.
 */
function inline(label: string): string {
  // "Series A", "US dollar", "B2B SaaS": a capital after the first letter
  // says the label is a name, and it is read as written.
  if (/[A-Z]/.test(label.slice(1))) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function article(phrase: string): string {
  return /^[aeiou]/i.test(phrase) ? `an ${phrase}` : `a ${phrase}`;
}

type Clause = (items: readonly string[]) => string;

const lower = (items: readonly string[]) => items.map(inline);

/** Sentences for single steps, read from the stored value alone. */
const CLAUSES: Readonly<Record<string, Clause>> = {
  "I2.investment_role": (i) => `You ${join(lower(i), "or")}.`,
  "I3.geography": (i) => `You look at companies in ${join(i)}.`,
  "I3.sectors": (i) => `Your focus is ${join(i)}.`,
  "I3.sectors_avoid": (i) => `You'd rather not see ${join(i)}.`,
  "I4.business_models": (i) => `You back ${join(lower(i), "or")} models.`,
  "I4.customer_types": (i) =>
    `You back companies selling to ${join(lower(i), "or")}.`,
  "I4.capital_intensity": (i) => `On capital intensity: ${join(lower(i))}.`,
  "I4.regulatory_appetite": (i) => `On regulated markets: ${join(lower(i))}.`,
  "I4.revenue_state": (i) => `On revenue: ${join(lower(i))}.`,
  "I5.founder_preferences": (i) =>
    `In founders you look for ${join(lower(i))}.`,
  "I6.green_flags": (i) => `Your green flags are ${join(lower(i))}.`,
  "I6.custom_criteria": (i) => `You also told me: "${i[0] ?? ""}".`,
  "I7.avoid": (i) => `You'd rather not see ${join(lower(i))}.`,
  "I7.hard_exclusions": (i) => `You never want to be shown ${join(lower(i))}.`,
  "I7.sector_exclusions": (i) => `You exclude ${join(i)} outright.`,
  "I8.portfolio": (i) => `Your portfolio includes ${i[0] ?? ""}.`,
  "I9.discovery_mode": (i) => `Discovery is set to ${join(lower(i))}.`,
  "I10.inbound_preference": (i) =>
    `Founders can reach you on ${join(lower(i))} terms.`,
  "F1.description": (i) => `You describe the company as: ${i[0] ?? ""}.`,
  "F1.categories": (i) => `It sits in ${join(i)}.`,
  "F4.founder_role": (i) => `Your role is ${i[0] ?? ""}.`,
  "F5.customers": (i) => `You have ${i[0] ?? ""} paying customers.`,
  "F6.use_of_funds": (i) => `The money is for ${i[0] ?? ""}.`,
};

/**
 * Steps said together, or not at all: the organisation, role and type
 * make one sentence; the cheque range, stages and deployment another; a
 * strength ("must match") qualifies a list rather than standing alone.
 */
const COMPOSED = new Set([
  "I0.investor_type",
  "I0.organisation_name",
  "I0.business_title",
  "I1.deployment_status",
  "I1.mandate_context",
  "I2.stages",
  "I2.currency",
  "I2.cheque_min",
  "I2.cheque_typical",
  "I2.cheque_max",
  "I3.geography_strength",
  "I3.sector_strength",
  "I5.founder_strength",
  "I6.green_flag_strength",
  "I11.review",
  "I12.handoff",
  "F0.intent",
  "F1.company_name",
  "F1.website",
  "F1.country",
  "F1.stage",
  "F2.materials",
  "F3.review",
  "F6.raising",
  "F6.currency",
  "F6.target_amount",
  "F6.instrument",
  "F8.snapshot",
]);

function investorOpening(get: (key: string) => readonly string[] | undefined) {
  const type = get("I0.investor_type")?.[0];
  const firm = get("I0.organisation_name")?.[0];
  const role = get("I0.business_title")?.[0];
  const sentences: string[] = [];
  if (type !== undefined || firm !== undefined) {
    const who =
      type === undefined
        ? "You invest"
        : `You invest as ${article(inline(type))}`;
    const where = firm === undefined ? "" : ` through ${firm}`;
    const title = role === undefined ? "" : `, where your role is ${role}`;
    sentences.push(`${who}${where}${title}.`);
  } else if (role !== undefined) {
    sentences.push(`Your role is ${role}.`);
  }
  const status = get("I1.deployment_status")?.[0];
  const stages = get("I2.stages");
  const min = get("I2.cheque_min")?.[0];
  const max = get("I2.cheque_max")?.[0];
  const typical = get("I2.cheque_typical")?.[0];
  const currency = get("I2.currency")?.[0];
  const parts: string[] = [];
  if (status !== undefined) parts.push(`Right now you're ${inline(status)}`);
  if (stages !== undefined && stages.length > 0) {
    parts.push(
      `${parts.length === 0 ? "You back" : "backing"} ${join(lower(stages), "and")} companies`,
    );
  }
  const cheque =
    min !== undefined && max !== undefined
      ? `cheques from ${min} to ${max}`
      : min !== undefined
        ? `a minimum cheque of ${min}`
        : max !== undefined
          ? `cheques of up to ${max}`
          : undefined;
  if (cheque !== undefined) {
    parts.push(
      `${parts.length === 0 ? "You write" : "with"} ${cheque}${typical === undefined ? "" : `, typically ${typical}`}`,
    );
  } else if (typical !== undefined) {
    parts.push(
      `${parts.length === 0 ? "Your" : "with a"} typical cheque of ${typical}`,
    );
  } else if (currency !== undefined) {
    parts.push(
      `${parts.length === 0 ? "You write" : "writing"} cheques in ${currency}`,
    );
  }
  if (parts.length > 0) sentences.push(`${parts.join(", ")}.`);
  return sentences;
}

function founderOpening(get: (key: string) => readonly string[] | undefined) {
  const name = get("F1.company_name")?.[0];
  const country = get("F1.country");
  const stage = get("F1.stage")?.[0];
  const website = get("F1.website")?.[0];
  const sentences: string[] = [];
  if (name !== undefined) {
    const at = country === undefined ? "" : `, based in ${join(country)}`;
    const site = website === undefined ? "" : ` (${website})`;
    sentences.push(`Your company is ${name}${site}${at}.`);
  }
  if (stage !== undefined) sentences.push(`It's at ${inline(stage)} stage.`);
  const amount = get("F6.target_amount")?.[0];
  const instrument = get("F6.instrument")?.[0];
  if (amount !== undefined) {
    sentences.push(
      `You're raising ${amount}${instrument === undefined ? "" : ` on ${article(inline(instrument))}`}.`,
    );
  } else if (instrument !== undefined) {
    sentences.push(`You're raising on ${article(inline(instrument))}.`);
  }
  return sentences;
}

/**
 * The portrait: what is on the record, in a few sentences, then what is
 * left, in words. `remaining` are the nouns of the steps still open,
 * required first; nothing here counts them.
 */
export function portrait(
  journey: "investor" | "founder",
  entries: readonly PortraitEntry[],
  remaining: readonly {
    readonly stepKey: string;
    readonly required: boolean;
  }[],
): string {
  const byKey = new Map(
    entries
      .filter((entry) => entry.items.length > 0)
      .map((entry) => [entry.stepKey, entry.items] as const),
  );
  const get = (key: string) => byKey.get(key);
  const sentences =
    journey === "investor" ? investorOpening(get) : founderOpening(get);
  for (const entry of entries) {
    if (COMPOSED.has(entry.stepKey) || entry.items.length === 0) continue;
    const clause = CLAUSES[entry.stepKey];
    const noun = STEP_NOUNS[entry.stepKey];
    if (clause !== undefined) sentences.push(clause(entry.items));
    else if (noun !== undefined) {
      sentences.push(
        `For your ${noun}, you've told me ${join(lower(entry.items))}.`,
      );
    }
  }
  const head =
    sentences.length === 0
      ? "I don't have anything from you on your record yet."
      : `Here's what I have so far. ${sentences.slice(0, 8).join(" ")}`;
  const nouns = (items: readonly { readonly stepKey: string }[]) =>
    items
      .map((item) => STEP_NOUNS[item.stepKey])
      .filter((noun): noun is string => noun !== undefined);
  const required = nouns(remaining.filter((item) => item.required));
  const optional = nouns(remaining.filter((item) => !item.required));
  // Unnamed open steps still count: "that covers everything" is said
  // only when nothing is open at all.
  const unnamed = remaining.length > required.length + optional.length;
  const left =
    required.length > 0
      ? `Still to cover: your ${join(required.slice(0, 3))}${required.length > 3 || optional.length > 0 || unnamed ? ", and a few other details" : ""}.`
      : optional.length > 0
        ? `What's left is optional: your ${join(optional.slice(0, 3))}${optional.length > 3 || unnamed ? " and a little more" : ""}.`
        : remaining.length > 0
          ? "There's a little more to cover."
          : "That covers everything I need.";
  return `${head} ${left}`;
}
