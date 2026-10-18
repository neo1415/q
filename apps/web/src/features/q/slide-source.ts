/**
 * A slide's SVG as an image source. Its own module (Q room W7) so the
 * Board can draw a slide without loading the whole document viewer.
 *
 * An SVG shown as an image loads nothing of its own, so a photo it names
 * by URL would draw as the browser's broken-image mark (lead 2026-10-16,
 * the Board's deck preview). Those `<image>` elements are dropped here;
 * the server sends the same photos beside the slides and they are drawn
 * over it (SlidePictures). Inline (data URI) pictures, such as a logo,
 * stay, since an image can draw those.
 */
export function slideSource(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withoutRemoteImages(svg))}`;
}

const REMOTE_IMAGE =
  /<image\b(?![^>]*\bhref="data:)[^>]*?(?:\/>|>[\s\S]*?<\/image>)/gu;

export function withoutRemoteImages(svg: string): string {
  return svg.replace(REMOTE_IMAGE, "");
}
