/**
 * A slide's SVG as an image source. Its own module (Q room W7) so the
 * Board can draw a slide without loading the whole document viewer.
 */
export function slideSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
