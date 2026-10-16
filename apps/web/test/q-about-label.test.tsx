// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  QPageFocus,
  QPageSubject,
  QSubjectProvider,
  useQAboutLabel,
  type QSubject,
} from "../src/features/q/q-subject";

/**
 * Live check 2026-10-16: on a GateQ application, Q's panel said "About
 * Savanna Seed Partners", the reader's own organisation.
 */
afterEach(cleanup);

const own: QSubject = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: "a0000000-0000-4000-8000-000000000001",
  label: "Savanna Seed Partners",
  scope: "investor_private",
};

function Label() {
  return <p>{useQAboutLabel() ?? "none"}</p>;
}

describe("what Q's panel says it is about", () => {
  it("is the person's own organisation with nothing open", () => {
    render(
      <QSubjectProvider own={own}>
        <Label />
      </QSubjectProvider>,
    );
    expect(screen.getByText("Savanna Seed Partners")).toBeTruthy();
  });

  it("follows the record open on the page, over any subject, and falls away with it", () => {
    const { rerender } = render(
      <QSubjectProvider own={own}>
        <QPageSubject
          subject={{
            kind: "COMPANY",
            companyId: "c0000000-0000-4000-8000-000000000001",
            label: "Kivu",
            scope: "investor_private",
          }}
        />
        <QPageFocus label="TensorGate's application" />
        <Label />
      </QSubjectProvider>,
    );
    expect(screen.getByText("TensorGate's application")).toBeTruthy();
    rerender(
      <QSubjectProvider own={own}>
        <Label />
      </QSubjectProvider>,
    );
    expect(screen.getByText("Savanna Seed Partners")).toBeTruthy();
  });
});
