import type {
  SiteBlock,
  SiteBlockType,
  SiteLeafBlock,
  SitePageKind,
} from "@capital-q/contracts";

/**
 * The block palette (decision 107): what each block is called, what it is
 * for, and the empty block it inserts. Ids are short random strings, so a
 * block keeps its identity through every reorder and save.
 */

export function newBlockId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `b${Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10)}`;
}

export type PaletteEntry = {
  readonly type: SiteBlockType;
  readonly label: string;
  readonly hint: string;
  /** Kinds this block belongs on first (the palette lists those at the top). */
  readonly suits: readonly SitePageKind[];
};

export const PALETTE: readonly PaletteEntry[] = [
  {
    type: "heading",
    label: "Heading",
    hint: "A section title",
    suits: ["landing-section", "pricing", "faq", "legal"],
  },
  {
    type: "richText",
    label: "Text",
    hint: "Paragraphs and lists, with bold, italic and links",
    suits: ["landing-section", "pricing", "faq", "legal"],
  },
  {
    type: "legalClause",
    label: "Legal clause",
    hint: "A numbered clause, with a note for the lawyer",
    suits: ["legal"],
  },
  {
    type: "summary",
    label: "Summary box",
    hint: "The plain-language summary at the top",
    suits: ["legal"],
  },
  {
    type: "callout",
    label: "Callout",
    hint: "A highlighted note or warning",
    suits: ["legal", "pricing", "faq"],
  },
  {
    type: "faq",
    label: "FAQ group",
    hint: "Questions with answers that open in place",
    suits: ["faq", "pricing"],
  },
  {
    type: "pricing",
    label: "Pricing table",
    hint: "Plans, monthly and yearly prices, perks",
    suits: ["pricing"],
  },
  {
    type: "table",
    label: "Table",
    hint: "Rows and columns of plain text",
    suits: ["pricing", "legal", "landing-section"],
  },
  {
    type: "features",
    label: "Feature list",
    hint: "Short titled points in two columns",
    suits: ["landing-section", "pricing"],
  },
  {
    type: "button",
    label: "Button",
    hint: "One call to action",
    suits: ["landing-section", "pricing"],
  },
  {
    type: "image",
    label: "Image",
    hint: "A PNG or JPEG you upload; scanned before it shows",
    suits: ["landing-section", "pricing", "faq", "legal"],
  },
  {
    type: "columns",
    label: "Two columns",
    hint: "Side by side on wide screens, stacked on a phone",
    suits: ["landing-section", "pricing"],
  },
  {
    type: "divider",
    label: "Divider",
    hint: "A quiet line between sections",
    suits: ["landing-section", "pricing", "faq", "legal"],
  },
];

export const BLOCK_LABEL: Readonly<Record<SiteBlockType, string>> =
  Object.fromEntries(
    PALETTE.map((entry) => [entry.type, entry.label]),
  ) as Record<SiteBlockType, string>;

const paragraph = (text: string) => [
  { kind: "paragraph" as const, spans: text === "" ? [] : [{ text }] },
];

export function newLeafBlock(
  type: Exclude<SiteBlockType, "columns">,
): SiteLeafBlock {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { type, id, level: 2, text: "" };
    case "richText":
      return { type, id, content: paragraph("") };
    case "image":
      return { type, id, documentId: null, alt: "", caption: "" };
    case "callout":
      return { type, id, tone: "note", title: "", content: paragraph("") };
    case "summary":
      return { type, id, title: "In short", content: paragraph("") };
    case "faq":
      return {
        type,
        id,
        title: "",
        items: [{ id: newBlockId(), question: "", answer: paragraph("") }],
      };
    case "pricing":
      return {
        type,
        id,
        title: "Plans",
        currency: "USD",
        showIntervalToggle: true,
        plans: [
          {
            id: newBlockId(),
            name: "Free",
            description: "",
            monthly: "0",
            annual: "0",
            priceNote: "",
            perks: [""],
            highlight: false,
            ctaLabel: "Get started",
            ctaHref: "/auth/sign-up",
          },
        ],
      };
    case "table":
      return { type, id, caption: "", header: ["", ""], rows: [["", ""]] };
    case "features":
      return {
        type,
        id,
        title: "",
        items: [{ id: newBlockId(), title: "", description: "" }],
      };
    case "button":
      return {
        type,
        id,
        label: "Get started",
        href: "/auth/sign-up",
        variant: "primary",
      };
    case "divider":
      return { type, id };
    case "legalClause":
      return { type, id, title: "", content: paragraph(""), lawyerNote: null };
  }
}

export function newBlock(type: SiteBlockType): SiteBlock {
  return type === "columns"
    ? {
        type: "columns",
        id: newBlockId(),
        left: [newLeafBlock("richText")],
        right: [newLeafBlock("richText")],
      }
    : newLeafBlock(type);
}

/** A copy with fresh ids throughout (duplicate). */
export function cloneBlock(block: SiteBlock): SiteBlock {
  const fresh = <T extends { id: string }>(item: T): T => ({
    ...item,
    id: newBlockId(),
  });
  const leaf = (b: SiteLeafBlock): SiteLeafBlock => {
    const copy = fresh(b);
    if (copy.type === "faq") return { ...copy, items: copy.items.map(fresh) };
    if (copy.type === "features")
      return { ...copy, items: copy.items.map(fresh) };
    if (copy.type === "pricing")
      return { ...copy, plans: copy.plans.map(fresh) };
    return copy;
  };
  return block.type === "columns"
    ? {
        ...fresh(block),
        left: block.left.map(leaf),
        right: block.right.map(leaf),
      }
    : leaf(block);
}

export const PAGE_KIND_LABEL: Readonly<Record<SitePageKind, string>> = {
  "landing-section": "Landing section",
  pricing: "Pricing",
  faq: "FAQ",
  legal: "Legal",
};
