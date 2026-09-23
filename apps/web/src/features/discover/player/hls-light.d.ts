/**
 * Types for hls.js's light build.
 *
 * `hls.js` maps types for its root entry only; the `./light` subpath
 * export has none. The light build is the same `Hls` class compiled
 * without DRM, alternate audio and the subtitles engine — none of which a
 * 60-second pitch uses — so the root declaration describes it accurately
 * for everything we call on it.
 *
 * This is a statement about the package, not a cast: nothing here widens a
 * type or silences an error at a call site.
 */
declare module "hls.js/light" {
  export { default } from "hls.js";
}
