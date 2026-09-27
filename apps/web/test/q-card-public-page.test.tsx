// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  COMPANY_CARD_FIELDS,
  Q_CARD_SCOPES,
  type PublicCardDto,
  type PublicCardField,
} from "@capital-q/contracts";

import {
  cardDescriptor,
  fieldsForAudience,
  publicExternalFields,
} from "../src/features/q-card/card-content";
import { PublicCardView } from "../src/features/q-card/public-card-view";

/**
 * The scanned page (`/@handle`, BIZ-004, R26). The API decides the
 * audience; the page re-checks it, so a members-only (network_visible)
 * value never renders for an anonymous scanner even if a projection were
 * wrong. And the three things a scanner can do are real links: save the
 * contact, connect on Capital Q, visit the website.
 */

afterEach(cleanup);

const VALUES: Readonly<Record<string, string>> = {
  canonicalName: "Kivu Freight",
  shortDescription: "Cross-border freight booking for East Africa.",
  currentStageCode: "seed",
  headquartersCity: "Nairobi",
  headquartersCountry: "KE",
  websiteUrl: "https://www.kivu.example/",
  foundedDate: "2021-03-01",
};

function card(
  audience: PublicCardDto["audience"],
  fields: readonly PublicCardField[],
): PublicCardDto {
  return {
    kind: "CARD",
    handle: "kivu",
    subjectType: "COMPANY",
    name: "Kivu Freight",
    fields: [...fields],
    verified: [],
    demoAttested: [],
    audience,
    indexable: false,
  };
}

/** Every assignment of the two scopes over the company fields, seeded. */
function scopeAssignments(): PublicCardField[][] {
  const keys = COMPANY_CARD_FIELDS.filter((key) => key !== "canonicalName");
  const out: PublicCardField[][] = [];
  for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
    out.push(
      keys.map((key, index) => ({
        key,
        value: VALUES[key] ?? key,
        scope: Q_CARD_SCOPES[(mask >> index) & 1] ?? "public_external",
      })),
    );
  }
  return out;
}

describe("audience filtering on the public page", () => {
  it("never passes a network_visible field to an anonymous visitor, for any scope assignment", () => {
    for (const fields of scopeAssignments()) {
      const shown = fieldsForAudience(card("PUBLIC", fields));
      expect(shown.every((field) => field.scope === "public_external")).toBe(
        true,
      );
      expect(shown).toEqual(publicExternalFields(fields));
      // A participant keeps the whole projection the API built for them.
      expect(fieldsForAudience(card("PARTICIPANT", fields))).toEqual(fields);
    }
  });

  it("does not render a network_visible-only field publicly, even when the projection carries it", () => {
    const leaked: PublicCardField[] = [
      { key: "currentStageCode", value: "seed", scope: "public_external" },
      { key: "foundedDate", value: "2019-05-01", scope: "network_visible" },
      {
        key: "shortDescription",
        value: "Members-only one-liner.",
        scope: "network_visible",
      },
      {
        key: "websiteUrl",
        value: "https://members-only.example/",
        scope: "network_visible",
      },
    ];
    const { container } = render(
      <PublicCardView card={card("PUBLIC", leaked)} />,
    );
    const text = container.textContent;
    expect(text).not.toContain("2019");
    expect(text).not.toContain("Members-only one-liner.");
    expect(text).not.toContain("members-only.example");
    expect(text).not.toContain("Shown to Capital Q members");
    expect(container.querySelector('[data-scope="network_visible"]')).toBe(
      null,
    );
    expect(container.querySelector('[data-card-action="website"]')).toBe(null);
    expect(
      container.querySelector('a[href="https://members-only.example/"]'),
    ).toBe(null);
    // The public field still shows.
    expect(text).toContain("Seed");
  });

  it("shows a participant the members-only fields, marked as such", () => {
    render(
      <PublicCardView
        card={card("PARTICIPANT", [
          { key: "foundedDate", value: "2019-05-01", scope: "network_visible" },
        ])}
      />,
    );
    const row = screen.getByText("Founded").closest("[data-card-field]");
    expect(row?.getAttribute("data-scope")).toBe("network_visible");
    expect(row?.textContent).toContain("2019");
    expect(row?.textContent).toContain("Shown to Capital Q members");
  });
});

describe("who this is, in one screen", () => {
  it("names the organisation and says what kind it is from public fields", () => {
    const fields = scopeAssignments()[0] ?? [];
    render(<PublicCardView card={card("PUBLIC", fields)} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Kivu Freight" }),
    ).toBeTruthy();
    expect(screen.getByText("Company · Seed · Nairobi, Kenya")).toBeTruthy();
    expect(
      screen.getByText("Cross-border freight booking for East Africa."),
    ).toBeTruthy();
  });

  it("builds the descriptor only from the fields it is handed", () => {
    expect(cardDescriptor("COMPANY", [])).toBe(null);
    expect(
      cardDescriptor("INVESTOR_ORGANISATION", [
        { key: "investorType", value: "VC", scope: "public_external" },
        { key: "hqCountry", value: "KE", scope: "public_external" },
      ]),
    ).toBe("Venture capital firm · Kenya");
    expect(
      cardDescriptor("COMPANY", [
        { key: "headquartersCountry", value: "KE", scope: "public_external" },
      ]),
    ).toBe("Kenya");
  });
});

describe("what Capital Q vouches for", () => {
  it("says a synthetic-demo attestation is one, never 'verified by Capital Q'", () => {
    render(
      <PublicCardView
        card={{
          ...card("PUBLIC", []),
          verified: ["ORGANISATION_VERIFIED", "FOUNDER_IDENTITY_VERIFIED"],
          demoAttested: ["ORGANISATION_VERIFIED"],
        }}
      />,
    );
    expect(screen.queryByText("Organisation verified by Capital Q")).toBeNull();
    expect(
      screen.getByText(/Organisation: synthetic demo attestation/),
    ).toBeTruthy();
    expect(
      screen.getByText("Founder identity verified by Capital Q"),
    ).toBeTruthy();
  });
});

describe("the page's primary actions", () => {
  const fields = scopeAssignments()[0] ?? [];

  it("offers an anonymous scanner: save contact, connect on Capital Q, visit website", () => {
    const { container } = render(
      <PublicCardView card={card("PUBLIC", fields)} />,
    );
    const actions = screen.getByRole("region", { name: "Actions" });
    const links = within(actions).getAllByRole("link");
    // Save contact comes first: it is the one thing every scanner can use.
    expect(links[0]?.getAttribute("data-card-action")).toBe("save-contact");

    const save = within(actions).getByRole("link", { name: "Save contact" });
    expect(save.getAttribute("href")).toBe("/@kivu.vcf");
    expect(save.getAttribute("download")).toBe("kivu.vcf");

    const connect = within(actions).getByRole("link", {
      name: "Connect on Capital Q",
    });
    expect(connect.getAttribute("href")).toBe(
      `/auth/sign-in?next=${encodeURIComponent("/@kivu")}`,
    );

    const website = within(actions).getByRole("link", {
      name: /^kivu\.example\s*\(opens in a new tab\)$/,
    });
    expect(website.getAttribute("href")).toBe("https://www.kivu.example/");
    expect(website.getAttribute("target")).toBe("_blank");
    expect(website.getAttribute("rel")).toContain("noopener");
    expect(website.getAttribute("rel")).toContain("nofollow");

    // Buttons meet the 44px target: the large size is h-12.
    for (const link of links) expect(link.className).toContain("h-12");
    expect(container.querySelector("script")).toBe(null);
  });

  it("sends a signed-in participant into Capital Q instead of sign-in", () => {
    render(<PublicCardView card={card("PARTICIPANT", fields)} />);
    const open = screen.getByRole("link", { name: "Open in Capital Q" });
    expect(open.getAttribute("href")).toBe("/home");
    expect(screen.queryByRole("link", { name: "Connect on Capital Q" })).toBe(
      null,
    );
  });

  it("leaves the website action out when there is no public website", () => {
    render(
      <PublicCardView
        card={card(
          "PUBLIC",
          fields.filter((field) => field.key !== "websiteUrl"),
        )}
      />,
    );
    expect(
      screen.getAllByRole("link", { name: /Save contact|Connect/ }),
    ).toHaveLength(2);
    expect(document.querySelector('[data-card-action="website"]')).toBe(null);
  });
});
