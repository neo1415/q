import type {
  MemoryBundle,
  MemoryConversationDigest,
  MemoryItem,
  MemoryPastTurn,
  MemoryRehearsalDigest,
} from "./contracts.js";
import { renderConnectedRecall } from "./graph.js";
import {
  memoryTruthClass,
  Q_READING_LABEL,
  Q_READING_SUFFIX,
} from "./provenance.js";

/**
 * From a memory bundle to the bounded text a prompt receives (doc 14
 * §131: typed sections, rendered last, never one blob stored anywhere).
 *
 * Order is by usefulness to the next sentence Q says: earlier conversations
 * about what was just asked, then how to address the person, how names are
 * said, what was corrected, then facts, then this conversation's summary,
 * then other recent conversations. Each section yields
 * from the end when the bound is reached, so the first things stay.
 */

export const MEMORY_TEXT_MAX = 4_000;

const TYPE_LABEL: Record<MemoryItem["memoryType"], string> = {
  preference: "Preference",
  pronunciation: "Pronunciation",
  correction: "Correction",
  fact: "They said",
  episodic: "Earlier",
  // Never rendered: recall leaves small talk out (ADR 0062), and the
  // order below does not list it either.
  small_talk: "In passing",
};

/** What kind of reading it is: never "They said", which it is not. */
const READING_KIND: Record<MemoryItem["memoryType"], string> = {
  preference: "Preference",
  pronunciation: "Pronunciation",
  correction: "Correction",
  fact: "About them",
  episodic: "Earlier",
  small_talk: "In passing",
};

/** Their quoted words, bounded, for beside Q's reading of them. */
const QUOTE_SHOWN_MAX = 200;

/**
 * One remembered item. Step 9: who said it decides the label. Their own
 * words (or what they confirmed) keep the type's label; Q's reading of
 * their words is labelled as Q's, never "They said" or "Preference", and
 * carries the words it was read from, so the answer can say it back as a
 * reading and they can correct it.
 */
function line(item: MemoryItem): string {
  const when = item.createdAt.slice(0, 10);
  if (memoryTruthClass(item) === "USER_CLAIM") {
    return `- ${TYPE_LABEL[item.memoryType]} (${when}): ${item.content}`;
  }
  const words =
    item.quote === null
      ? ""
      : `; their words: "${
          item.quote.length > QUOTE_SHOWN_MAX
            ? `${item.quote.slice(0, QUOTE_SHOWN_MAX - 1).trimEnd()}…`
            : item.quote
        }"`;
  return `- ${Q_READING_LABEL} — ${READING_KIND[item.memoryType]} (${when}), ${Q_READING_SUFFIX}: ${item.content}${words}`;
}

export const RELEVANT_LABEL =
  "Earlier conversations about what they asked (what was discussed, not verified evidence):";
/** Per relevant summary: four of them stay well inside MEMORY_TEXT_MAX. */
const RELEVANT_SUMMARY_MAX = 600;

function digestLine(
  c: MemoryConversationDigest,
  max: number = Number.POSITIVE_INFINITY,
): string {
  const summary =
    c.summary.length > max
      ? `${c.summary.slice(0, max - 1).trimEnd()}…`
      : c.summary;
  return `${c.lastMessageAt.slice(0, 10)}${
    c.title === null ? "" : ` ${c.title}`
  }: ${summary}`;
}

export const PAST_TURNS_LABEL =
  'Their own earlier conversations, word for word (what was said, not verified evidence; "they said" lines are their own words, "Q said" lines are Q\'s):';
/** Per past turn: eight stay inside MEMORY_TEXT_MAX with room left. */
const PAST_TURN_MAX = 320;

function pastTurnLine(turn: MemoryPastTurn): string {
  const where =
    turn.conversationTitle === null ? "" : ` (in "${turn.conversationTitle}")`;
  const who = turn.role === "USER" ? "they said" : "Q said";
  return `- ${turn.at.slice(0, 10)}${where}, ${who}: "${clip(
    turn.content.replace(/\s+/gu, " ").trim(),
    PAST_TURN_MAX,
  )}"`;
}

/** The past-turn section, or "" when none was searched or found. */
export function renderPastTurns(turns: MemoryBundle["pastTurns"]): string {
  if (turns === undefined || turns.length === 0) return "";
  return `${PAST_TURNS_LABEL}\n${turns.map(pastTurnLine).join("\n")}`;
}

export const REHEARSALS_LABEL =
  "Their own pitch rehearsals with Q, newest first (Q's coaching feedback on practice meetings, not verified facts about the company; scores are computed from Q's ratings):";
export const NO_REHEARSALS_LINE =
  "Their own pitch rehearsals with Q: none on record.";
/** Per rehearsal: three of them stay inside MEMORY_TEXT_MAX with room left. */
const REHEARSAL_MAX = 750;

const plain = (label: string) => label.toLowerCase().replace(/_/g, " ");
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

function rehearsalLines(r: MemoryRehearsalDigest): string {
  const head = [
    `${r.at.slice(0, 10)}, practice meeting with ${r.counterpartName}`,
    `${plain(r.difficulty)} difficulty`,
    ...(r.outcome === null ? [] : [`ended ${plain(r.outcome)}`]),
    ...(r.score === null ? [] : [`score ${String(r.score)}/100`]),
  ].join(", ");
  const rows = [`- ${head}`];
  if (r.needsWork.length > 0) {
    rows.push(`  Needed work: ${r.needsWork.map(plain).join(", ")}`);
  }
  if (r.strong.length > 0) {
    rows.push(`  Strong: ${r.strong.map(plain).join(", ")}`);
  }
  for (const w of r.wentWrong.slice(0, 3)) {
    rows.push(
      `  Struggled: ${clip(w.moment, 140)} (${clip(w.why, 140)}) Better: ${clip(w.better, 160)}`,
    );
  }
  if (r.wentRight.length > 0) {
    rows.push(
      `  Went well: ${r.wentRight
        .slice(0, 2)
        .map((m) => clip(m, 120))
        .join("; ")}`,
    );
  }
  if (r.tips.length > 0) {
    rows.push(
      `  Practise: ${r.tips
        .slice(0, 3)
        .map((t) => clip(t, 140))
        .join("; ")}`,
    );
  }
  if (rows.length === 1 && r.overall.length > 0) {
    rows.push(`  Overall: ${clip(r.overall, 300)}`);
  }
  return clip(rows.join("\n"), REHEARSAL_MAX);
}

/** The rehearsal section, or "" when the turn did not ask about them. */
export function renderRehearsals(
  rehearsals: MemoryBundle["rehearsals"],
): string {
  if (rehearsals === undefined) return "";
  if (rehearsals.length === 0) return NO_REHEARSALS_LINE;
  return `${REHEARSALS_LABEL}\n${rehearsals.map(rehearsalLines).join("\n")}`;
}

function fit(sections: readonly string[], max: number): string {
  let out = "";
  for (const section of sections) {
    if (section.length === 0) continue;
    const next = out.length === 0 ? section : `${out}\n\n${section}`;
    if (next.length > max) {
      const room = max - out.length - 2;
      if (room > 80) {
        out = `${out}\n\n${section.slice(0, room - 1).trimEnd()}…`;
      }
      break;
    }
    out = next;
  }
  return out;
}

export function renderMemoryBundle(
  bundle: MemoryBundle,
  max: number = MEMORY_TEXT_MAX,
): string {
  const order: MemoryItem["memoryType"][] = [
    "preference",
    "pronunciation",
    "correction",
    "fact",
    "episodic",
  ];
  const byType = (items: readonly MemoryItem[]) =>
    order.flatMap((type) => items.filter((item) => item.memoryType === type));
  const person = byType(bundle.person).map(line);
  const company = byType(bundle.company).map(line);
  const sections: string[] = [];
  // First when present: it is only read when the turn is about pitch
  // practice, so it is what the person is asking about.
  sections.push(renderRehearsals(bundle.rehearsals));
  // Read only when the turn asks across linked things, so when present it
  // is the spine of the answer; bounded on its own (CONNECTED_MAX).
  sections.push(renderConnectedRecall(bundle.connected));
  // Found by search for what they are asking now: their own words, so it
  // comes before any summary of the same conversations.
  sections.push(renderPastTurns(bundle.pastTurns));
  // First, because it is what the person is asking about: an earlier
  // conversation found by subject or name, however long ago. Each summary
  // is clipped so a few long ones cannot push everything else past the
  // bound, and the label says it is talk, not evidence.
  if (bundle.relevant.length > 0) {
    sections.push(
      `${RELEVANT_LABEL}\n${bundle.relevant
        .map((c) => `- ${digestLine(c, RELEVANT_SUMMARY_MAX)}`)
        .join("\n")}`,
    );
  }
  if (person.length > 0) {
    sections.push(`About the person:\n${person.join("\n")}`);
  }
  if (company.length > 0) {
    sections.push(
      `About their company, in their words:\n${company.join("\n")}`,
    );
  }
  if (bundle.thisConversation !== null) {
    sections.push(
      `Earlier in this conversation${
        bundle.thisConversation.title === null
          ? ""
          : ` (${bundle.thisConversation.title})`
      }:\n${bundle.thisConversation.summary}`,
    );
  }
  // Asked "last time", the connected section lists them, dated, with jobs.
  if (
    bundle.otherConversations.length > 0 &&
    bundle.connected?.recent === undefined
  ) {
    sections.push(
      `Other recent conversations:\n${bundle.otherConversations
        .map((c) => `- ${digestLine(c)}`)
        .join("\n")}`,
    );
  }
  return fit(sections, max);
}
