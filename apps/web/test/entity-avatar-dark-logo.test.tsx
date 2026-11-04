// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const verdict = vi.hoisted(() => {
  const holder: { value: "unreadable" | "ok" | "unknown" } = {
    value: "unreadable",
  };
  return holder;
});
vi.mock("@/features/entity/logo-legibility", () => ({
  probeLogo: () => Promise.resolve(verdict.value),
}));

import {
  EntityAvatar,
  companyLogoPath,
  companyPhotoPath,
} from "@/features/entity/entity-avatar";

afterEach(cleanup);

const MIZAN = "6f0c2a1e-9d1b-4c55-8a51-2f3e8b7c9d10";

function avatarOf(container: HTMLElement) {
  return container.querySelector("[data-entity-avatar]") as HTMLElement;
}

/**
 * Acceptance 2026-11-04 J5: Mizan's logo loaded as an opaque black square
 * with a near-black mark. Such a picture counts as none: the next picture
 * is tried, and past the last the initials show.
 */
describe("a logo that loads dark all over (J5)", () => {
  it("is passed over for the next picture, then the initials", async () => {
    verdict.value = "unreadable";
    const { container } = render(
      <EntityAvatar
        kind="company"
        name="Mizan"
        companyId={MIZAN}
        fallback="initials"
        siteLogo="first"
      />,
    );
    const img = () => avatarOf(container).querySelector("img");
    expect(img()?.getAttribute("src")).toBe(companyLogoPath(MIZAN));
    await act(async () => {
      fireEvent.load(img() as HTMLImageElement);
      await Promise.resolve();
    });
    expect(img()?.getAttribute("src")).toBe(companyPhotoPath(MIZAN));
    await act(async () => {
      fireEvent.load(img() as HTMLImageElement);
      await Promise.resolve();
    });
    expect(img()).toBeNull();
    expect(avatarOf(container).dataset.entityAvatarState).toBe("fallback");
    expect(avatarOf(container).textContent).toBe("M");
  });

  it("a readable logo stays, on the light logo tile in both themes", async () => {
    verdict.value = "ok";
    const { container } = render(
      <EntityAvatar kind="company" name="Mizan" companyId={MIZAN} />,
    );
    await act(async () => {
      fireEvent.load(avatarOf(container).querySelector("img") as HTMLElement);
      await Promise.resolve();
    });
    expect(avatarOf(container).dataset.entityAvatarState).toBe("logo");
    expect(avatarOf(container).querySelector("img")?.className).toContain(
      "bg-(--cq-logo-tile)",
    );
  });

  it("a picture whose pixels cannot be read is left as it was", async () => {
    verdict.value = "unknown";
    const { container } = render(
      <EntityAvatar kind="company" name="Mizan" companyId={MIZAN} />,
    );
    await act(async () => {
      fireEvent.load(avatarOf(container).querySelector("img") as HTMLElement);
      await Promise.resolve();
    });
    expect(avatarOf(container).dataset.entityAvatarState).toBe("logo");
  });
});
