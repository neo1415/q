/**
 * Deck and document rendering (QX-004 §5, §6, §7; BIZ-001).
 *
 * One deterministic layout over a composed deck, inspected for the faults
 * a slide can have, and drawn from that same layout as SVG, PPTX and PDF.
 *
 * Invariants: nothing here decides what a deck says — no number, label or
 * ordering originates in this package; every renderer reads the same
 * computed geometry, so three outputs cannot disagree about what fits; and
 * a fault is a property of the layout rather than something spotted in a
 * picture afterwards.
 */
export {
  layOutDeck,
  measure,
  wrap,
  type ChartBar,
  type ChartBox,
  type CircleBox,
  type LaidOutBox,
  type LaidOutDeck,
  type LaidOutSlide,
  type PathBox,
  type RuleBox,
  type TextBox,
} from "./layout.js";

export {
  contrastRatio,
  inspectDeck,
  DECK_FAULTS,
  type DeckFault,
  type DeckIssue,
} from "./inspect.js";

export { deckToSvg, slideToSvg } from "./svg.js";
export { deckToPptx } from "./pptx.js";
export { deckToPdf } from "./pdf.js";

/**
 * Every other artifact as a document (BIZ-001): one renderer for any type
 * made of sections and gaps, and one function that picks the renderer.
 */
export {
  artifactKindName,
  documentFromArtifact,
  documentToPdf,
  DOCUMENT_PAGE,
  type ArtifactDocument,
  type DocumentFinding,
  type DocumentSection,
} from "./document.js";
export {
  exportFormatsForVersion,
  renderArtifactFile,
  EXPORT_CONTENT_TYPES,
  type ArtifactFile,
} from "./export.js";

export {
  themeFor,
  MARGIN,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type BrandInput,
  type BrandLogo,
  type DeckTheme,
} from "./theme.js";

// DOCS block: design reference data.
export {
  designDirectionFor,
  fontPairing,
  FONT_PAIRINGS,
  type DesignDirection,
  type FontPairing,
} from "./design.js";
export { mix } from "./contrast.js";

export { fetchSlideImages, imageKind, type SlideImages } from "./images.js";
