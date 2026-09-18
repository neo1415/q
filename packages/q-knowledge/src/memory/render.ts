import type { MemoryBundle, MemoryItem } from "./contracts.js";

/**
 * From a memory bundle to the bounded text a prompt receives (doc 14
 * §131: typed sections, rendered last, never one blob stored anywhere).
 *
 * Order is by usefulness to the next sentence Q says: how to address the
 * person, how names are said, what was corrected, then facts, then this
 * conversation's summary, then other conversations. Each section yields
 * from the end when the bound is reached, so the first things stay.
 */

export const MEMORY_TEXT_MAX = 4_000;

const TYPE_LABEL: Record<MemoryItem["memoryType"], string> = {
  preference: "Preference",
  pronunciation: "Pronunciation",
  correction: "Correction",
  fact: "They said",
  episodic: "Earlier",
};

function line(item: MemoryItem): string {
  const when = item.createdAt.slice(0, 10);
  return `- ${TYPE_LABEL[item.memoryType]} (${when}): ${item.content}`;
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
  if (bundle.otherConversations.length > 0) {
    sections.push(
      `Other recent conversations:\n${bundle.otherConversations
        .map(
          (c) =>
            `- ${c.lastMessageAt.slice(0, 10)}${
              c.title === null ? "" : ` ${c.title}`
            }: ${c.summary}`,
        )
        .join("\n")}`,
    );
  }
  return fit(sections, max);
}
