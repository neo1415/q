import type {
  QArtifactContent,
  QDocumentEdit,
  QSlide,
  QSlideImage,
} from "@capital-q/contracts";

import type { StockPhotoPort } from "./deck-photos.js";
import {
  reviewDocument,
  SLIDE_BODY_WORDS_MAX,
  type DocumentKind,
} from "./document-pipeline.js";
import { auditDocument } from "./document-studio.js";
import { inventsFigures } from "./investment-brief.js";

/**
 * Edits of a document Q made (Q room W5, R8): "make slide 3 shorter",
 * "swap this image", "change the title", "drop slide 5", "move the team
 * slide to the end", and a picture dropped on a placeholder.
 *
 * Every edit is code over the version the person was looking at, and
 * none adds a figure: a new title that states a number the document does
 * not already carry is refused. The result is re-checked (the same audit
 * and rubric) and filed as a new version; the old one is never touched.
 */

export type ComposedDocument = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
};

export type DocumentEditOutcome =
  | { readonly status: "EDITED"; readonly composed: ComposedDocument }
  | {
      readonly status: "NOT_APPLICABLE";
      /** Why, in the person's terms. */
      readonly reason: string;
    };

/** What the history shows for an edit, canonical so a retry replays it. */
export function editInstruction(edit: QDocumentEdit): string {
  const at = `Slide ${String(edit.slide)}`;
  switch (edit.kind) {
    case "SHORTEN":
      return `${at}: shorter`;
    case "CHANGE_TITLE":
      return `${at}: title "${edit.title}"`;
    case "SWAP_IMAGE":
      return `${at}: a different picture`;
    case "REMOVE_IMAGE":
      return `${at}: picture removed`;
    case "REMOVE_SLIDE":
      return `${at}: removed`;
    case "MOVE_SLIDE":
      return `${at}: moved to ${String(edit.to)}`;
    case "USE_PICTURE":
      // The same words as a drop on the placeholder, so a retried drop
      // and Q's own "use my photo" replay rather than stack.
      return fillInstruction(edit.slide);
  }
}

/** The statements a document already rests on: what an edit may restate. */
export function groundingOf(content: QArtifactContent): string[] {
  return content.sections.flatMap((section) => [
    section.heading,
    section.body,
    ...section.findings.map((finding) => finding.statement),
  ]);
}

function kindOf(type: string, content: QArtifactContent): DocumentKind {
  if (content.deck !== undefined) return "PITCH_DECK";
  return type === "ONE_PAGER" ? "ONE_PAGER" : "MEMO";
}

/** The re-check every edited version carries. */
function rechecked(
  content: QArtifactContent,
  grounding: readonly string[],
  type: string,
): QArtifactContent {
  const review = reviewDocument(content, grounding, kindOf(type, content));
  return {
    ...content,
    audit: {
      ...auditDocument(content, grounding),
      rubric: { ...review.rubric, rounds: 0 },
    },
  };
}

const words = (text: string) =>
  text.split(/\s+/).filter((word) => word.length > 0);

function shorterSlide(slide: QSlide): QSlide | null {
  if (slide.bullets.length + slide.bulletsRight.length > 1) {
    return slide.bulletsRight.length > 0
      ? { ...slide, bulletsRight: slide.bulletsRight.slice(0, -1) }
      : { ...slide, bullets: slide.bullets.slice(0, -1) };
  }
  const only = slide.bullets[0];
  if (only !== undefined && words(only).length > 8) {
    const keep = Math.max(
      6,
      Math.min(SLIDE_BODY_WORDS_MAX, Math.round(words(only).length * 0.6)),
    );
    const sentence = only.match(/^[^.!?]+[.!?]/)?.[0];
    const next =
      sentence !== undefined && words(sentence).length <= keep
        ? sentence
        : `${words(only).slice(0, keep).join(" ")}…`;
    return { ...slide, bullets: [next] };
  }
  if (slide.subtitle !== undefined && words(slide.subtitle).length > 8) {
    return {
      ...slide,
      subtitle: `${words(slide.subtitle).slice(0, 8).join(" ")}…`,
    };
  }
  return null;
}

export async function applyDocumentEdit(
  base: ComposedDocument & { readonly type: string },
  edit: QDocumentEdit,
  ports: {
    readonly photos?: StockPhotoPort | undefined;
    /**
     * Their own uploaded picture, read as them and filed for the document;
     * NOT_READY while the upload is still being checked.
     */
    readonly ownPicture?:
      | ((documentId: string) => Promise<QSlideImage | "NOT_READY" | null>)
      | undefined;
    readonly signal?: AbortSignal | undefined;
  } = {},
): Promise<DocumentEditOutcome> {
  if (edit.kind === "USE_PICTURE") {
    if (ports.ownPicture === undefined) {
      return {
        status: "NOT_APPLICABLE",
        reason: "Pictures cannot be placed here yet.",
      };
    }
    const picture = await ports.ownPicture(edit.documentId).catch(() => null);
    if (picture === "NOT_READY") {
      return {
        status: "NOT_APPLICABLE",
        reason: "That picture is still being checked. Try again in a moment.",
      };
    }
    if (picture === null) {
      return {
        status: "NOT_APPLICABLE",
        reason: "Only their own PNG or JPEG pictures can go on a slide.",
      };
    }
    return fillPlaceholder(base, edit.slide, picture);
  }
  const grounding = groundingOf(base.content);
  const deck = base.content.deck;
  const index = edit.slide - 1;
  const done = (content: QArtifactContent, title = base.title) => ({
    status: "EDITED" as const,
    composed: {
      title,
      summary: base.summary,
      content: rechecked(content, grounding, base.type),
    },
  });
  const no = (reason: string) => ({
    status: "NOT_APPLICABLE" as const,
    reason,
  });

  // A document without slides: its sections.
  if (deck === undefined) {
    const section = base.content.sections[index];
    if (section === undefined) return no("There is no such section.");
    const sections = [...base.content.sections];
    switch (edit.kind) {
      case "SHORTEN": {
        const all = words(section.body);
        if (all.length <= 12) return no("That section is already short.");
        const keep = Math.max(12, Math.round(all.length * 0.6));
        const sentences = section.body.match(/[^.!?]+[.!?]+/g) ?? [];
        let body = "";
        for (const sentence of sentences) {
          if (words(`${body}${sentence}`).length > keep) break;
          body = `${body}${sentence}`;
        }
        sections[index] = {
          ...section,
          body:
            body.trim().length > 0
              ? body.trim()
              : `${all.slice(0, keep).join(" ")}…`,
        };
        return done({ ...base.content, sections });
      }
      case "CHANGE_TITLE": {
        if (inventsFigures(edit.title, grounding)) {
          return no(
            "A title cannot state a figure the document does not carry.",
          );
        }
        if (index === 0) return done(base.content, edit.title);
        sections[index] = { ...section, heading: edit.title };
        return done({ ...base.content, sections });
      }
      case "REMOVE_SLIDE": {
        if (sections.length <= 1) return no("It is the only section.");
        sections.splice(index, 1);
        return done({ ...base.content, sections });
      }
      case "MOVE_SLIDE": {
        const to = Math.min(sections.length, edit.to) - 1;
        const [moved] = sections.splice(index, 1);
        if (moved === undefined) return no("There is no such section.");
        sections.splice(to, 0, moved);
        return done({ ...base.content, sections });
      }
      case "SWAP_IMAGE":
      case "REMOVE_IMAGE":
        return no("This document has no pictures.");
    }
  }

  const slide = deck.slides[index];
  if (slide === undefined) return no("There is no such slide.");
  const slides = [...deck.slides];
  const withSlides = (next: QSlide[]): QArtifactContent => ({
    ...base.content,
    deck: { ...deck, slides: next },
  });
  switch (edit.kind) {
    case "SHORTEN": {
      const shorter = shorterSlide(slide);
      if (shorter === null)
        return no("That slide is already as short as it goes.");
      slides[index] = shorter;
      return done(withSlides(slides));
    }
    case "CHANGE_TITLE": {
      if (inventsFigures(edit.title, grounding)) {
        return no("A title cannot state a figure the document does not carry.");
      }
      slides[index] = { ...slide, title: edit.title };
      // The cover's title is the document's title too.
      return done(withSlides(slides), index === 0 ? edit.title : base.title);
    }
    case "REMOVE_IMAGE": {
      if (slide.image === undefined) return no("That slide has no picture.");
      const { image: _image, ...rest } = slide;
      slides[index] = rest;
      return done(withSlides(slides));
    }
    case "SWAP_IMAGE": {
      const current = slide.image?.url;
      const used = new Set(
        deck.slides.flatMap((each) =>
          each.image === undefined ? [] : [each.image.url],
        ),
      );
      const query = `${slide.title} ${deck.slides[0]?.subtitle ?? ""}`
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2)
        .slice(0, 6)
        .join(" ");
      const found =
        ports.photos === undefined || query.length === 0
          ? []
          : await ports.photos
              .search(query, { signal: ports.signal })
              .catch(() => []);
      const next = found.find((photo) => !used.has(photo.url));
      const { image: _old, ...rest } = slide;
      if (next === undefined) {
        if (current === undefined) return no("No other picture was found.");
        // Nothing better to show: their own space to fill.
        slides[index] = {
          ...rest,
          layout: rest.layout === "TITLE" ? "TITLE" : "BULLETS",
          placeholder: { kind: "IMAGE", label: "Your picture: drop it here" },
        };
        return done(withSlides(slides));
      }
      const { placeholder: _space, ...open } = rest;
      slides[index] = {
        ...open,
        layout: open.layout === "TITLE" ? "TITLE" : "BULLETS",
        image: next,
        note: `${(open.note ?? "").replace(/\n?Picture: .*$/u, "")}\nPicture: ${next.credit}`
          .trim()
          .slice(0, 1_000),
      };
      return done(withSlides(slides));
    }
    case "REMOVE_SLIDE": {
      if (index === 0) return no("The cover stays.");
      slides.splice(index, 1);
      return done(withSlides(slides));
    }
    case "MOVE_SLIDE": {
      if (index === 0 || edit.to === 1) return no("The cover stays first.");
      const to = Math.min(slides.length, edit.to) - 1;
      const [moved] = slides.splice(index, 1);
      if (moved === undefined) return no("There is no such slide.");
      slides.splice(to, 0, moved);
      return done(withSlides(slides));
    }
  }
}

/** A picture dropped on a slide's placeholder: the space is filled. */
export function fillPlaceholder(
  base: ComposedDocument & { readonly type: string },
  slideNumber: number,
  picture: QSlideImage,
): DocumentEditOutcome {
  const deck = base.content.deck;
  const slide = deck?.slides[slideNumber - 1];
  if (deck === undefined || slide === undefined) {
    return { status: "NOT_APPLICABLE", reason: "There is no such slide." };
  }
  if (slide.placeholder?.kind !== "IMAGE" && slide.image === undefined) {
    return {
      status: "NOT_APPLICABLE",
      reason: "That slide has no space for a picture.",
    };
  }
  const { placeholder: _filled, ...rest } = slide;
  const slides = [...deck.slides];
  slides[slideNumber - 1] = {
    ...rest,
    layout: rest.layout === "TITLE" ? "TITLE" : "BULLETS",
    image: picture,
    note: `${(rest.note ?? "").replace(/\n?Picture: .*$/u, "")}\nPicture: ${picture.credit}`
      .trim()
      .slice(0, 1_000),
  };
  const content = { ...base.content, deck: { ...deck, slides } };
  const grounding = groundingOf(base.content);
  return {
    status: "EDITED",
    composed: {
      title: base.title,
      summary: base.summary,
      content: rechecked(content, grounding, base.type),
    },
  };
}

export function fillInstruction(slideNumber: number): string {
  return `Slide ${String(slideNumber)}: your picture`;
}
