// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ExternalSimulationDto } from "@capital-q/contracts";

import { CounterpartIdentity } from "../src/features/rehearsal/counterpart-identity";

const base: ExternalSimulationDto = {
  label: "Research-informed simulation",
  title:
    "AI simulation: a QInvest investment professional (not a real employee)",
  disclaimer:
    "AI simulation: a QInvest investment professional (not a real employee). AI rehearsal informed by public sources.",
  entityKind: "ORGANIZATION",
  imageUrl: null,
  headline: "Organisation, Doha, Qatar",
  description: "Qatar-based Islamic investment group.",
  quotes: [
    {
      quote: "Watch what people spend.",
      sourceLabel: "Profile",
      sourceUrl: "https://example.org/s3",
    },
  ],
  sources: [{ label: "About", url: "https://example.org/about" }],
};

describe("counterpart identity", () => {
  it("shows a monogram, name, category, chip and sources when no image is stored", () => {
    render(<CounterpartIdentity name="QInvest LLC" simulation={base} />);
    expect(screen.getByText("QL")).toBeTruthy();
    expect(screen.getByText("QInvest LLC")).toBeTruthy();
    expect(screen.getByText("Organisation, Doha, Qatar")).toBeTruthy();
    expect(screen.getByText("Research-informed simulation")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link", { name: "About" })).toBeTruthy();
    // A source quote is labelled as public, never as Q's words.
    expect(screen.getByText(/Public quote \(not Q’s words\)/u)).toBeTruthy();
    expect(screen.getByText(/not a real employee/u)).toBeTruthy();
  });

  it("uses our stored portrait or logo when one is attached", () => {
    render(
      <CounterpartIdentity
        name="Muhannad Taslaq"
        simulation={{
          ...base,
          entityKind: "PERSON",
          imageUrl: "https://assets.example.test/muhannad.jpg",
        }}
      />,
    );
    const image = screen.getByRole("img");
    expect(image.getAttribute("src")).toBe(
      "https://assets.example.test/muhannad.jpg",
    );
  });
});
