"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A logo this wide spells the name itself (a wordmark: Stripe 60×25,
 * Linear 400×100), so the bar does not repeat the name beside it. A mark
 * on its own, or a mark with a short name, is narrower.
 */
export const WORDMARK_MIN_ASPECT = 2.2;

export function isWordmark(width: number, height: number): boolean {
  return width > 0 && height > 0 && width / height >= WORDMARK_MIN_ASPECT;
}

/**
 * A gateway's full logo with its name (live re-check 2026-11-15: the
 * header read "[Stripe wordmark] Stripe"). When the logo, as drawn, is a
 * wordmark, the separate name text is left out and the name becomes the
 * image's text alternative, so it is still announced once. Until the
 * image has loaded, and for any logo that is not a wordmark, the name is
 * shown beside it and the image stays decorative.
 *
 * The drawn size is measured, not the file's: an SVG with only a viewBox
 * has no reliable natural size, but the browser draws it at its own
 * proportions inside the fixed height.
 */
export function GatewayLogoWithName({
  src,
  name,
  imageClassName,
  nameClassName,
  imageData,
}: {
  readonly src: string;
  readonly name: string;
  readonly imageClassName: string;
  readonly nameClassName: string;
  /** data-* attributes for the image (tests and evidence scripts). */
  readonly imageData?: Readonly<Record<`data-${string}`, string>>;
}) {
  const ref = useRef<HTMLImageElement>(null);
  // Keyed by the image it was measured on, so a new logo starts unmeasured.
  const [measured, setMeasured] = useState<{
    readonly src: string;
    readonly wordmark: boolean;
  } | null>(null);
  const wordmark = measured?.src === src && measured.wordmark;

  const measure = useCallback(() => {
    const image = ref.current;
    if (image === null || image.naturalWidth === 0) return;
    const width = image.clientWidth || image.naturalWidth;
    const height = image.clientHeight || image.naturalHeight;
    setMeasured({ src, wordmark: isWordmark(width, height) });
  }, [src]);

  // A cached image can finish before hydration, when onLoad never fires.
  useEffect(() => {
    if (ref.current?.complete === true) measure();
  }, [measure]);

  return (
    <span
      className="flex min-w-0 items-center gap-3"
      data-logo-wordmark={wordmark ? "true" : "false"}
    >
      {/* Capital Q's stored copy (a data URL or our logo route). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={src}
        alt={wordmark ? name : ""}
        className={imageClassName}
        onLoad={measure}
        {...imageData}
      />
      {wordmark ? null : <span className={nameClassName}>{name}</span>}
    </span>
  );
}
