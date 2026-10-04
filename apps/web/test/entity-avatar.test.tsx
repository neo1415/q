// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ENTITY_AVATAR_SIZES,
  EntityAvatar,
  EntityCover,
  entityImageSource,
  entityInitials,
} from "@/features/entity/entity-avatar";

afterEach(cleanup);

const COMPANY_ID = "6f0c2a1e-9d1b-4c55-8a51-2f3e8b7c9d10";
const SIGNED = "https://storage.example.test/img/t/1.webp?token=abc";

describe("EntityAvatar (founder ask 2026-10-04)", () => {
  it("falls back to initials on a token disc when there is no picture", () => {
    const { container } = render(
      <EntityAvatar kind="person" name="Amara Okafor" />,
    );
    const avatar = screen.getByRole("img", { name: "Amara Okafor" });
    expect(avatar.textContent).toBe("AO");
    expect(container.querySelector("img")).toBeNull();
    expect(avatar.className).toContain("bg-(--cq-surface-subtle)");
    expect(avatar.getAttribute("data-entity-avatar-state")).toBe("fallback");
  });

  it("ignores words that are not names in the initials", () => {
    expect(entityInitials("Rift Valley (fictional)")).toBe("RV");
    expect(entityInitials("  ")).toBe("?");
  });

  it.each(Object.entries(ENTITY_AVATAR_SIZES))(
    "holds fixed %s dimensions so nothing shifts",
    (size, px) => {
      render(
        <EntityAvatar
          kind="investor"
          name="Rift Valley Seed Fund"
          src={SIGNED}
          size={size as keyof typeof ENTITY_AVATAR_SIZES}
        />,
      );
      const avatar = screen.getByRole("img", { name: "Rift Valley Seed Fund" });
      expect(avatar.style.width).toBe(`${String(px)}px`);
      expect(avatar.style.height).toBe(`${String(px)}px`);
      const img = avatar.querySelector("img");
      expect(img?.getAttribute("width")).toBe(String(px));
      expect(img?.getAttribute("loading")).toBe("lazy");
    },
  );

  it("carries the name as its accessible label, once", () => {
    render(<EntityAvatar kind="person" name="Amara Okafor" src={SIGNED} />);
    const avatar = screen.getByRole("img", { name: "Amara Okafor" });
    // The image inside is part of the labelled frame, not a second name.
    expect(avatar.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("is hidden from assistive tech when the name sits beside it", () => {
    const { container } = render(
      <EntityAvatar kind="person" name="Amara Okafor" decorative />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(
      container
        .querySelector("[data-entity-avatar]")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("never shows a broken image: a failed load goes back to the fallback", () => {
    const { container } = render(
      <EntityAvatar kind="person" name="Amara Okafor" src={SIGNED} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img !== null) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "Amara Okafor" }).textContent).toBe(
      "AO",
    );
  });

  it("shows the image once it has loaded", () => {
    const { container } = render(
      <EntityAvatar kind="investor" name="Rift Valley" src={SIGNED} />,
    );
    const img = container.querySelector("img");
    if (img !== null) fireEvent.load(img);
    expect(
      container
        .querySelector("[data-entity-avatar]")
        ?.getAttribute("data-entity-avatar-state"),
    ).toBe("image");
  });
});

describe("EntityAvatar visibility", () => {
  it("a viewer the server gave no image gets the fallback, not a URL", () => {
    // Null is the server's "not for you": no route is asked, no URL drawn.
    const { container } = render(
      <EntityAvatar
        kind="company"
        name="Kijani Grid"
        companyId={COMPANY_ID}
        src={null}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[src]")).toBeNull();
    expect(container.innerHTML).not.toContain("/api/");
  });

  it("an unknown company picture asks the gated company photo route only", () => {
    expect(entityImageSource({ kind: "company", companyId: COMPANY_ID })).toBe(
      `/api/company-photo/${COMPANY_ID}`,
    );
  });

  it("never invents a URL for a person or investor it was not handed", () => {
    expect(entityImageSource({ kind: "person" })).toBeNull();
    expect(entityImageSource({ kind: "investor" })).toBeNull();
    // An investor id is not a way to ask for its image.
    const { container } = render(
      <EntityAvatar
        kind="investor"
        name="Rift Valley"
        companyId={COMPANY_ID}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("EntityCover", () => {
  it("draws a quiet band, never a placeholder picture, without a cover", () => {
    const { container } = render(<EntityCover src={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(
      container
        .querySelector("[data-entity-cover]")
        ?.getAttribute("data-entity-cover"),
    ).toBe("none");
  });

  it("drops a cover that fails to load", () => {
    const { container } = render(<EntityCover src={SIGNED} />);
    const img = container.querySelector("img");
    if (img !== null) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
  });
});
