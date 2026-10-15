// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SlidePictures } from "../src/features/q/slide-pictures";
import { firstSlideOf } from "../src/features/q/q-board";
import { withoutRemoteImages } from "../src/features/q/slide-source";

/**
 * Lead 2026-10-16: the Board's deck preview drew a broken image where
 * slide 1's photo belongs. A slide is an SVG shown as an image, which
 * cannot load a photo by URL; the photos come beside the slides and are
 * drawn over them, in the preview as in the viewer.
 */
const photo = {
  slide: 0,
  x: 480,
  y: 0,
  width: 480,
  height: 540,
  url: "https://storage.example/signed/photo.png?token=t",
  alt: "Port cranes at dusk",
  credit: "",
  fit: "cover",
};

describe("the Board's first slide", () => {
  it("keeps the first slide's pictures, checked, and drops other slides' and non-https ones", () => {
    const slide = firstSlideOf({
      slides: ["<svg/>", "<svg/>"],
      images: [
        photo,
        { ...photo, slide: 1 },
        { ...photo, url: "http://insecure.example/p.png" },
        { nonsense: true },
      ],
    });
    expect(slide?.svg).toBe("<svg/>");
    expect(slide?.pictures).toEqual([photo]);
  });

  it("is nothing when the response has no slides", () => {
    expect(firstSlideOf({ images: [photo] })).toBeNull();
    expect(firstSlideOf(null)).toBeNull();
  });

  it("draws each picture over its place on the slide", () => {
    const { container } = render(
      <SlidePictures
        pictures={
          firstSlideOf({ slides: ["<svg/>"], images: [photo] })?.pictures ?? []
        }
      />,
    );
    const figure = container.querySelector<HTMLElement>(
      "[data-q-slide-picture]",
    );
    expect(figure?.style.left).toBe("50%");
    expect(figure?.style.width).toBe("50%");
    expect(figure?.querySelector("img")?.getAttribute("src")).toBe(photo.url);
  });
});

describe("a slide as an image source", () => {
  it("drops photos named by URL, which an image cannot load, and keeps inline ones", () => {
    const svg =
      '<svg><image href="https://cdn.example/p.jpg" x="0" y="0"><title>Photo</title></image>' +
      '<image href="data:image/png;base64,AAAA" x="1"/><rect/></svg>';
    expect(withoutRemoteImages(svg)).toBe(
      '<svg><image href="data:image/png;base64,AAAA" x="1"/><rect/></svg>',
    );
  });
});
