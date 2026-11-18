import {
  isSafeSiteHref,
  parseSiteBlocks,
  SitePageKindSchema,
  type RichNode,
  type RichSpan,
  type RichText,
  type SiteBlock,
  type SitePageKind,
  type SitePricingPlan,
} from "./site-content.js";

/**
 * Turns one file of `content/defaults/` (decision 107) into a page and its
 * blocks, following that folder's README: YAML-style front matter, then
 * Markdown whose headings, lists, tables, blockquotes and lawyer comments
 * map onto the block types. Deterministic -- the same file gives the same
 * blocks and ids every time -- so importing twice changes nothing.
 *
 * Raw HTML is never passed through: anything that looks like markup stays
 * literal text, and HTML comments other than `<!-- LAWYER: -->` notes are
 * dropped.
 */

export type ImportedSitePage = {
  readonly slug: string;
  readonly kind: SitePageKind;
  readonly title: string;
  readonly summary: string;
  readonly status: "DRAFT" | "DRAFT_PENDING_LEGAL_REVIEW";
  readonly order: number | null;
  readonly anchor: string | null;
  readonly effectiveDate: string | null;
  readonly currency: string | null;
  readonly blocks: SiteBlock[];
};

export function parseFrontMatter(source: string): {
  readonly fields: Readonly<Record<string, string>>;
  readonly body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u.exec(source);
  if (match === null) return { fields: {}, body: source };
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/u)) {
    const pair = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/u.exec(line);
    if (pair === null) continue;
    let value = (pair[2] ?? "").trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
    } else if (
      value.startsWith("'") &&
      value.endsWith("'") &&
      value.length >= 2
    ) {
      value = value.slice(1, -1).replace(/''/gu, "'");
    }
    fields[pair[1] ?? ""] = value;
  }
  return { fields, body: source.slice(match[0].length) };
}

// --- inline ------------------------------------------------------------------

type Marks = {
  readonly bold?: true | undefined;
  readonly italic?: true | undefined;
};

function span(text: string, marks: Marks, href?: string): RichSpan {
  return {
    text,
    ...(marks.bold === true ? { bold: true as const } : {}),
    ...(marks.italic === true ? { italic: true as const } : {}),
    ...(href !== undefined && isSafeSiteHref(href) ? { href } : {}),
  };
}

/** `**bold**`, `*italic*` / `_italic_` and `[label](href)`; nothing else. */
export function parseInline(text: string, marks: Marks = {}): RichSpan[] {
  const out: RichSpan[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push(span(plain, marks));
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    if (rest.startsWith("**")) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push(
          ...parseInline(text.slice(i + 2, end), { ...marks, bold: true }),
        );
        i = end + 2;
        continue;
      }
    }
    const italic = rest[0] === "*" || rest[0] === "_";
    if (italic && rest[1] !== " " && rest[1] !== rest[0]) {
      const marker = rest[0] ?? "*";
      const end = text.indexOf(marker, i + 1);
      // `_` inside a word (snake_case) is not emphasis.
      const wordBefore = i > 0 && /\w/u.test(text[i - 1] ?? "");
      if (end > i + 1 && !(marker === "_" && wordBefore)) {
        flush();
        out.push(
          ...parseInline(text.slice(i + 1, end), { ...marks, italic: true }),
        );
        i = end + 1;
        continue;
      }
    }
    if (rest[0] === "[") {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)/u.exec(rest);
      if (link !== null) {
        flush();
        for (const inner of parseInline(link[1] ?? "", marks)) {
          out.push(span(inner.text, inner, link[2]));
        }
        i += link[0].length;
        continue;
      }
    }
    plain += rest[0] ?? "";
    i += 1;
  }
  flush();
  return out;
}

const plainOf = (text: string) =>
  parseInline(text)
    .map((s) => s.text)
    .join("");

// --- block-level -------------------------------------------------------------

type Line = { readonly text: string };

function tableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/\|$/u, "")
    .split("|")
    .map((cell) => plainOf(cell.trim()));
}

const isTableSeparator = (line: string) =>
  /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/u.test(line.trim());

/** Pulls a price like "$29", "$2,990" or "$79 per person" apart. */
function priceOf(cell: string | undefined): {
  readonly amount: string | null;
  readonly note: string;
} {
  const match = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)/u.exec(cell ?? "");
  if (match === null) return { amount: null, note: "" };
  const amount = (match[1] ?? "").replace(/,/gu, "");
  const after = (cell ?? "").slice(
    (match.index ?? 0) + (match[1] ?? "").length,
  );
  return { amount, note: after.trim() };
}

export function importSiteMarkdown(source: string): ImportedSitePage {
  const { fields, body } = parseFrontMatter(source);
  const kind = SitePageKindSchema.parse(fields["kind"]);
  const slug = fields["slug"] ?? "";
  const title = fields["title"] ?? slug;
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `b${String(counter)}`;
  };

  const blocks: unknown[] = [];
  const lines: Line[] = body.split(/\r?\n/u).map((text) => ({ text }));

  // State for the current container.
  let clause: {
    id: string;
    title: string;
    content: RichNode[];
    lawyerNote: string | null;
  } | null = null;
  let pendingNotes: string[] = [];
  let faq: {
    id: string;
    title: string;
    items: { id: string; question: string; answer: RichNode[] }[];
  } | null = null;
  let faqMode = kind === "faq";
  let loose: RichNode[] | null = null;
  let sawPageTitle = false;

  // Pricing: one plan table per "## For …" section.
  let pricing: {
    id: string;
    title: string;
    rows: string[][] | null;
    header: string[] | null;
    plans: {
      name: string;
      description: string;
      perks: string[];
      heading: string;
    }[];
  } | null = null;

  const closeLoose = () => {
    if (loose !== null && loose.length > 0) {
      blocks.push({ type: "richText", id: nextId(), content: loose });
    }
    loose = null;
  };
  const closeClause = () => {
    if (clause !== null) blocks.push({ type: "legalClause", ...clause });
    clause = null;
  };
  const closeFaq = () => {
    if (faq !== null) blocks.push({ type: "faq", ...faq });
    faq = null;
  };
  const closePricing = () => {
    if (pricing === null) return;
    const { header, rows } = pricing;
    const row = (label: RegExp) =>
      rows?.find((cells) => label.test(cells[0] ?? "")) ?? null;
    const monthlyRow = row(/a month/iu);
    const annualRow = row(/a year/iu);
    const plans: SitePricingPlan[] = pricing.plans.map((plan, index) => {
      const column =
        header === null
          ? -1
          : header.findIndex(
              (cell, i) =>
                i > 0 && plan.name.toLowerCase().endsWith(cell.toLowerCase()),
            );
      const monthly = priceOf(column > 0 ? monthlyRow?.[column] : plan.heading);
      const annual = priceOf(column > 0 ? annualRow?.[column] : undefined);
      return {
        id: nextId(),
        name: plan.name,
        description: plan.description,
        monthly: monthly.amount,
        annual: annual.amount,
        priceNote: monthly.note,
        perks: plan.perks,
        highlight: pricing !== null && index === 1 && pricing.plans.length >= 3,
        ctaLabel: "Get started",
        ctaHref: "/auth/sign-up",
      };
    });
    blocks.push({
      type: "pricing",
      id: pricing.id,
      title: pricing.title,
      currency: fields["currency"] ?? "USD",
      showIntervalToggle: true,
      plans,
    });
    if (header !== null && rows !== null) {
      blocks.push({
        type: "table",
        id: nextId(),
        caption: `${pricing.title}: what each plan includes`,
        header,
        rows,
      });
    }
    pricing = null;
  };
  const closeAll = () => {
    closeLoose();
    closeClause();
    closeFaq();
    closePricing();
  };

  /** Where paragraphs and lists go right now. */
  const sink = (): RichNode[] => {
    if (faq !== null) {
      const item = faq.items.at(-1);
      if (item !== undefined) return item.answer;
    }
    if (clause !== null) return clause.content;
    loose ??= [];
    return loose;
  };

  const pushParagraph = (text: string) => {
    if (pricing !== null) {
      const plan = pricing.plans.at(-1);
      if (plan !== undefined) {
        plan.description =
          plan.description === "" ? plainOf(text) : plan.description;
        return;
      }
    }
    sink().push({ kind: "paragraph", spans: parseInline(text) });
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]?.text ?? "";
    const line = raw.trim();
    if (line === "") {
      i += 1;
      continue;
    }

    // Comments: lawyer notes kept for the editor, the rest dropped.
    if (line.startsWith("<!--")) {
      let comment = line;
      while (!comment.includes("-->") && i + 1 < lines.length) {
        i += 1;
        comment += `\n${lines[i]?.text ?? ""}`;
      }
      const note = /^<!--\s*LAWYER:\s*([\s\S]*?)\s*-->$/u.exec(comment.trim());
      if (note !== null) {
        const text = (note[1] ?? "").trim();
        if (clause !== null) {
          clause.lawyerNote =
            clause.lawyerNote === null
              ? text
              : `${clause.lawyerNote}\n\n${text}`;
        } else pendingNotes.push(text);
      }
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/u.exec(line);
    if (heading !== null) {
      const level = (heading[1] ?? "#").length;
      const text = (heading[2] ?? "").trim();
      i += 1;
      if (level === 1 && kind !== "landing-section" && !sawPageTitle) {
        // The page's own title; the page chrome shows it.
        sawPageTitle = true;
        continue;
      }
      if (kind === "legal" && level === 2) {
        closeAll();
        clause = {
          id: nextId(),
          title: plainOf(text),
          content: [],
          lawyerNote:
            pendingNotes.length === 0 ? null : pendingNotes.join("\n\n"),
        };
        pendingNotes = [];
        continue;
      }
      if (kind === "legal" && level >= 3 && clause !== null) {
        clause.content.push({
          kind: "paragraph",
          spans: [{ text: plainOf(text), bold: true }],
        });
        continue;
      }
      if (kind === "pricing" && level === 2) {
        closeAll();
        if (/^questions/iu.test(text)) {
          faqMode = true;
          faq = { id: nextId(), title: plainOf(text), items: [] };
          continue;
        }
        faqMode = false;
        if (/^for /iu.test(text)) {
          pricing = {
            id: nextId(),
            title: plainOf(text),
            rows: null,
            header: null,
            plans: [],
          };
          continue;
        }
      }
      if (kind === "pricing" && level === 3 && pricing !== null) {
        const name = plainOf(text).split(",")[0]?.trim() ?? plainOf(text);
        pricing.plans.push({ name, description: "", perks: [], heading: text });
        continue;
      }
      if (faqMode && level === 2) {
        closeAll();
        faq = { id: nextId(), title: plainOf(text), items: [] };
        continue;
      }
      if (faqMode && level === 3) {
        closeLoose();
        faq ??= { id: nextId(), title: "", items: [] };
        faq.items.push({ id: nextId(), question: plainOf(text), answer: [] });
        continue;
      }
      closeAll();
      blocks.push({
        type: "heading",
        id: nextId(),
        level: Math.min(level, 3),
        text: plainOf(text),
      });
      continue;
    }

    // Blockquote: the summary box, or a callout.
    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (
        i < lines.length &&
        (lines[i]?.text ?? "").trim().startsWith(">")
      ) {
        quoted.push((lines[i]?.text ?? "").trim().replace(/^>\s?/u, ""));
        i += 1;
      }
      const first = quoted.find((q) => q.trim() !== "") ?? "";
      const isSummary = /^\*\*In short\*\*/u.test(first.trim());
      const content = richTextOf(
        isSummary ? quoted.slice(quoted.indexOf(first) + 1) : quoted,
      );
      closeAll();
      blocks.push(
        isSummary
          ? { type: "summary", id: nextId(), title: "In short", content }
          : { type: "callout", id: nextId(), tone: "note", title: "", content },
      );
      continue;
    }

    // Tables.
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (
        i < lines.length &&
        (lines[i]?.text ?? "").trim().startsWith("|")
      ) {
        const row = (lines[i]?.text ?? "").trim();
        if (!isTableSeparator(row)) rows.push(tableRow(row));
        i += 1;
      }
      const [header = [], ...rest] = rows;
      if (pricing !== null && pricing.header === null) {
        pricing.header = header;
        pricing.rows = rest;
        continue;
      }
      closeLoose();
      closeClause();
      closeFaq();
      blocks.push({
        type: "table",
        id: nextId(),
        caption: "",
        header,
        rows: rest,
      });
      continue;
    }

    // Lists.
    const bullet = /^([-*]|\d+\.)\s+(.*)$/u;
    if (bullet.test(line)) {
      const ordered = /^\d+\./u.test(line);
      const items: RichSpan[][] = [];
      while (i < lines.length) {
        const item = bullet.exec((lines[i]?.text ?? "").trim());
        if (item === null) break;
        const text = (item[2] ?? "").trim();
        i += 1;
        const button = /^Button:\s*\[([^\]]+)\]\(([^)\s]+)\)$/u.exec(text);
        if (button !== null) {
          if (items.length > 0) {
            sink().push({ kind: "list", ordered, items: items.splice(0) });
          }
          closeLoose();
          const href = button[2] ?? "";
          if (isSafeSiteHref(href)) {
            blocks.push({
              type: "button",
              id: nextId(),
              label: button[1] ?? "",
              href,
              variant: blocks.some(
                (b) => (b as { type?: string }).type === "button",
              )
                ? "secondary"
                : "primary",
            });
          }
          continue;
        }
        const link = /^Link:\s*(.*)$/u.exec(text);
        if (pricing !== null && pricing.plans.length > 0) {
          pricing.plans.at(-1)?.perks.push(plainOf(text));
          continue;
        }
        items.push(parseInline(link === null ? text : (link[1] ?? "")));
      }
      if (items.length > 0) sink().push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph: consecutive plain lines.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = (lines[i]?.text ?? "").trim();
      if (next === "" || /^(#{1,4}\s|>|\||<!--|[-*]\s|\d+\.\s)/u.test(next)) {
        break;
      }
      paragraph.push(next);
      i += 1;
    }
    const text = paragraph.join(" ");
    const caption = /^Caption:\s*(.*)$/u.exec(text);
    if (caption !== null) {
      sink().push({
        kind: "paragraph",
        spans: [{ text: plainOf(caption[1] ?? ""), italic: true }],
      });
    } else pushParagraph(text);
  }
  closeAll();
  if (pendingNotes.length > 0 && kind === "legal") {
    blocks.push({
      type: "legalClause",
      id: nextId(),
      title: "Notes for review",
      content: [],
      lawyerNote: pendingNotes.join("\n\n"),
    });
  }

  const order = fields["order"] === undefined ? null : Number(fields["order"]);
  const status =
    fields["status"] === "DRAFT_PENDING_LEGAL_REVIEW" || kind === "legal"
      ? "DRAFT_PENDING_LEGAL_REVIEW"
      : "DRAFT";
  return {
    slug,
    kind,
    title,
    summary: fields["summary"] ?? "",
    status,
    order: order === null || !Number.isInteger(order) ? null : order,
    anchor: fields["anchor"] ?? null,
    effectiveDate: fields["effective_date"] ?? null,
    currency: fields["currency"] ?? null,
    blocks: parseSiteBlocks(blocks),
  };
}

function richTextOf(lines: readonly string[]): RichText {
  const out: RichNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: RichSpan[][] } | null = null;
  const flush = () => {
    if (paragraph.length > 0) {
      out.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ")) });
    }
    paragraph = [];
    if (list !== null) out.push({ kind: "list", ...list });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const item = /^([-*]|\d+\.)\s+(.*)$/u.exec(line);
    if (line === "") {
      flush();
    } else if (item !== null) {
      if (paragraph.length > 0) {
        out.push({
          kind: "paragraph",
          spans: parseInline(paragraph.join(" ")),
        });
        paragraph = [];
      }
      list ??= { ordered: /^\d/u.test(line), items: [] };
      list.items.push(parseInline(item[2] ?? ""));
    } else {
      if (list !== null) flush();
      paragraph.push(line);
    }
  }
  flush();
  return out;
}
