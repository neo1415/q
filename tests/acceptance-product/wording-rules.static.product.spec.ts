import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

/**
 * Static check (ADR 0011): an ACTIVE prompt template or conversation code
 * must not carry instructions keyed to a quoted user phrasing, e.g.
 *   if they say "just give me the PDF", ...
 *   when the person asked "what do you know about me", answer ...
 * Such a rule passes the exact fixture and fails every paraphrase: the
 * model must read meaning, not match wording.
 *
 * Comments are stripped before scanning, so quoting a fixture in a header
 * comment is fine. Superseded prompt versions are ignored; only the one
 * `status: "ACTIVE"` version of each prompt (and every prompt schema,
 * whose descriptions reach the model) is scanned.
 */

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const CONVERSATION_CODE: readonly string[] = [
  "packages/q-core/src/conversation",
  "packages/onboarding/src/domain/interview-moves.ts",
  "packages/investor-onboarding/src/definition/interview-cues.ts",
  "packages/founder-onboarding/src/definition/interview-cues.ts",
  "packages/model-gateway/src/q/turn-reader.ts",
  "packages/gateq-intake/src/application/interviewer.ts",
  "packages/gateq-intake/src/application/conversation-service.ts",
  "apps/api/src/q/interview-client.ts",
  "apps/q-api/src/voice/interviewer.ts",
  "apps/q-api/src/voice/interview-route.ts",
  "apps/web/src/features/onboarding-conversation",
  "apps/web/src/features/q/conversation.ts",
  "apps/web/src/features/q/use-q-conversation.ts",
];

const PROMPTS = "packages/q-core/src/prompts";

function isSource(path: string): boolean {
  return (
    /\.(ts|tsx)$/.test(path) &&
    !/\.(test|spec)\.tsx?$/.test(path) &&
    !/[\\/](test|tests|__tests__|dist)[\\/]/.test(path)
  );
}

function walk(path: string): string[] {
  const full = join(ROOT, path);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    return [];
  }
  if (stat.isFile()) return isSource(full) ? [full] : [];
  return readdirSync(full).flatMap((name) => walk(join(path, name)));
}

function activePromptFiles(): string[] {
  const versioned = [
    ...walk(`${PROMPTS}/tasks`),
    ...walk(`${PROMPTS}/charter`),
  ];
  const active = versioned.filter((file) =>
    /status:\s*["']ACTIVE["']/.test(readFileSync(file, "utf8")),
  );
  return [...active, ...walk(`${PROMPTS}/schemas`)];
}

/** Remove block and line comments, keeping line numbers stable. */
function stripComments(source: string): string {
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
  // A line comment only where `//` starts the code on that line or follows
  // code after whitespace; `https://` inside strings is left alone.
  return blanked.replace(
    /(^|[\s;,{}()])\/\/[^\n]*/g,
    (_m, lead: string) => lead,
  );
}

const OPEN = `["'\\u201C\\u2018\`]`;
const CLOSE = `["'\\u201D\\u2019\`]`;
// Words someone could say: letters, spaces and light punctuation, with at
// least one lowercase letter. Enum literals ("SINGLE_SELECT") and
// interpolations ("${item.said}", the person's own words rendered in) are
// not keyed phrasings.
const QUOTED = `\\\\?${OPEN}(?=[^"\\n]*[a-z])([A-Za-z][A-Za-z0-9 ,.!?'\\u2019-]{2,89})\\\\?${CLOSE}`;

/** Instruction shapes keyed to a quoted phrase the person utters. */
const RULES: readonly { id: string; pattern: RegExp }[] = [
  {
    id: "speech-verb-then-quote",
    // Case-sensitive verbs (optionally capitalised): "ANSWER" is an enum,
    // and "type" is a TypeScript key, so neither is a speech verb here.
    pattern: new RegExp(
      `\\b(?:[Ss]ays?|[Ss]aid|[Aa]sks?|[Aa]sked|[Tt]yped|[Ww]rites?|[Ww]rote|[Rr]epl(?:y|ies|ied)|[Aa]nswer(?:s|ed)?|[Tt]ells? you|[Mm]entions?|[Rr]esponds?(?: with)?)\\b\\s*(?:something like|anything like|words like|e\\.g\\.)?\\s*[:,]?\\s*${QUOTED}`,
      "g",
    ),
  },
  {
    id: "conditional-on-person-saying",
    pattern: new RegExp(
      `\\b(?:if|when|whenever|once)\\s+(?:they|the (?:person|user|founder|investor|human)|someone|he|she)\\s+(?:says?|asks?|types?|writes?|repl(?:y|ies))\\b[^\\n]{0,40}?${QUOTED}`,
      "gi",
    ),
  },
  {
    id: "phrase-list",
    pattern: new RegExp(
      `\\b(?:phrases?|words?|replies|answers|utterances?)\\s+(?:like|such as)\\s*[:,]?\\s*${QUOTED}`,
      "gi",
    ),
  },
];

type Hit = { file: string; line: number; rule: string; text: string };

function scan(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of new Set(files)) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const rule of RULES) {
      for (const match of code.matchAll(rule.pattern)) {
        const at = match.index ?? 0;
        const line = code.slice(0, at).split("\n").length;
        hits.push({
          file: relative(ROOT, file).replace(/\\/g, "/"),
          line,
          rule: rule.id,
          text: match[0].replace(/\s+/g, " ").slice(0, 160),
        });
      }
    }
  }
  // One finding per location, whichever rule matched first.
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${h.file}:${h.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

test.describe("static: no wording-keyed rules", () => {
  test("the rule shapes are detected (self-check)", () => {
    const probe = [
      `If they say "just give me the PDF", export it.`,
      `When the person asked 'what do you know about me', summarise.`,
      `Treat replies like "yeah go on" as consent.`,
    ].join("\n");
    const found = RULES.flatMap((r) => [...probe.matchAll(r.pattern)]).length;
    expect(found).toBeGreaterThanOrEqual(3);
    // A comment quoting a fixture is not a rule.
    expect(
      stripComments(`// the person said "Adult content."\nconst x = 1;`),
    ).not.toContain("Adult content");
  });

  test("active prompt templates", () => {
    const files = activePromptFiles();
    expect(files.length, "no active prompts found").toBeGreaterThan(5);
    const hits = scan(files);
    test.info().annotations.push(
      ...hits.map((h) => ({
        type: "wording-rule",
        description: `${h.file}:${h.line} [${h.rule}] ${h.text}`,
      })),
    );
    expect(
      hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`),
      "instructions keyed to a quoted user phrasing",
    ).toEqual([]);
  });

  test("conversation code", () => {
    const files = CONVERSATION_CODE.flatMap(walk);
    expect(files.length, "no conversation code found").toBeGreaterThan(5);
    const hits = scan(files);
    test.info().annotations.push(
      ...hits.map((h) => ({
        type: "wording-rule",
        description: `${h.file}:${h.line} [${h.rule}] ${h.text}`,
      })),
    );
    expect(
      hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`),
      "instructions keyed to a quoted user phrasing",
    ).toEqual([]);
  });
});
