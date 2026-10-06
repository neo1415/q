// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProfileFinding } from "@capital-q/contracts";

/**
 * The editable, enriched profile (BIZ-002).
 *
 * What this suite holds the page to: every field is editable with the
 * keyboard alone; a save sends the version the page holds, through the
 * server action that calls the one write path; nothing reads as saved
 * until the server says so; a version conflict is said plainly and never
 * overwrites; unknown reads "Not added"; a name can't be emptied; Q's
 * findings are kept apart from declared values, said in words on the
 * three axes with their pages, never as a percentage; and "Ask Q" /
 * "Edit with Q" open the one Q with a draft the person sends themselves.
 *
 * The server actions are mocked at their module boundary ("use server"
 * files need a session and the API).
 */

type SaveResult =
  | { ok: true; value: string | null; version: number }
  | {
      ok: false;
      reason: "CONFLICT" | "INVALID" | "DENIED" | "UNAVAILABLE";
      message: string;
    };

const savePersonFieldAction =
  vi.fn<
    (
      field: string,
      value: string | null,
      version: number,
    ) => Promise<SaveResult>
  >();
const saveCompanyFieldAction =
  vi.fn<
    (
      id: string,
      field: string,
      value: string | null,
      version: number,
    ) => Promise<SaveResult>
  >();
const askAbout = vi.fn<(seed: string) => void>();
const refresh = vi.fn();

vi.mock("../src/features/profile/profile-actions", () => ({
  savePersonFieldAction: (
    field: string,
    value: string | null,
    version: number,
  ) => savePersonFieldAction(field, value, version),
  saveCompanyFieldAction: (
    id: string,
    field: string,
    value: string | null,
    version: number,
  ) => saveCompanyFieldAction(id, field, value, version),
  saveInvestorFieldAction: vi.fn(),
}));
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({
    open: false,
    setOpen: vi.fn(),
    askAbout,
    askNow: askAbout,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { EditableProfile } =
  await import("../src/features/profile/editable-profile");
const { ProfileFindings, SignalsAndVerification } =
  await import("../src/features/profile/profile-enrichment");
const { COMPANY_FIELDS, PERSON_FIELDS, normaliseDraft } =
  await import("../src/features/profile/profile-fields");

configure({ asyncUtilTimeout: 10_000 });

const COMPANY = "f0000000-0000-4000-8000-000000000001";
const DECLARED = "Your statement · self-reported";

beforeEach(() => {
  savePersonFieldAction.mockReset();
  saveCompanyFieldAction.mockReset();
  askAbout.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

function row(field: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-profile-field="${field}"]`,
  );
  if (element === null) throw new Error(`no row ${field}`);
  return element;
}

function renderPerson(values = { displayName: "Ada", headline: null }) {
  return render(
    <EditableProfile
      kind="PERSON"
      fields={PERSON_FIELDS}
      values={values}
      version={3}
      provenance={DECLARED}
    />,
  );
}

describe("editing a profile field", () => {
  it("shows unknown as Not added, with an Add control, and a stated value with its provenance", () => {
    renderPerson();
    expect(within(row("headline")).getByText("Not added")).toBeTruthy();
    expect(row("headline").dataset["state"]).toBe("unknown");
    expect(
      within(row("headline")).getByRole("button", { name: "Add headline" }),
    ).toBeTruthy();
    expect(within(row("displayName")).getByText("Ada")).toBeTruthy();
    // The value stands alone (R23); its provenance is said once, one tap
    // away under "Sources", not beneath every value (ADR 0018).
    expect(within(row("displayName")).queryByText(DECLARED)).toBeNull();
    const sources = screen.getByText("Sources").closest("details");
    expect(sources?.open).toBe(false);
    expect(
      within(sources as HTMLElement).getByText(new RegExp(DECLARED)),
    ).toBeTruthy();
  });

  it("saves with the keyboard alone, sending the page's version, and shows the value only once the server confirms it", async () => {
    let resolve: (result: SaveResult) => void = () => undefined;
    savePersonFieldAction.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderPerson();
    fireEvent.click(
      within(row("headline")).getByRole("button", { name: "Add headline" }),
    );
    const input = within(row("headline")).getByRole("textbox", {
      name: "Headline",
    });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  Founder, Kivu Freight " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(savePersonFieldAction).toHaveBeenCalledWith(
      "headline",
      "Founder, Kivu Freight",
      3,
    );
    // Not saved yet: the editor is still there, busy.
    expect(within(row("headline")).getByText("Saving…")).toBeTruthy();
    resolve({ ok: true, value: "Founder, Kivu Freight", version: 4 });
    await waitFor(() =>
      expect(
        within(row("headline")).getByText("Founder, Kivu Freight"),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("status").textContent).toBe("Headline saved.");

    // The next save carries the version the server returned.
    savePersonFieldAction.mockResolvedValue({
      ok: true,
      value: "Ada L.",
      version: 5,
    });
    fireEvent.click(
      within(row("displayName")).getByRole("button", { name: "Edit name" }),
    );
    const name = within(row("displayName")).getByRole("textbox", {
      name: "Name",
    });
    fireEvent.change(name, { target: { value: "Ada L." } });
    fireEvent.submit(name.closest("form") as HTMLFormElement);
    expect(savePersonFieldAction).toHaveBeenLastCalledWith(
      "displayName",
      "Ada L.",
      4,
    );
  });

  it("refreshes after a save, and a sibling section on the same record adopts the newer version", async () => {
    // About and Company are two sections of one company record, each
    // holding the version the page was rendered with.
    const sections = (version: number, oneLiner: string | null) => (
      <>
        <div data-section="about">
          <EditableProfile
            kind="PERSON"
            fields={PERSON_FIELDS.filter((f) => f.field === "headline")}
            values={{ headline: oneLiner }}
            version={version}
            provenance={DECLARED}
          />
        </div>
        <div data-section="company">
          <EditableProfile
            kind="PERSON"
            fields={PERSON_FIELDS.filter((f) => f.field === "displayName")}
            values={{ displayName: "Ada" }}
            version={version}
            provenance={DECLARED}
          />
        </div>
      </>
    );
    const view = render(sections(3, null));
    savePersonFieldAction.mockResolvedValue({
      ok: true,
      value: "Founder",
      version: 4,
    });
    fireEvent.click(
      within(row("headline")).getByRole("button", { name: "Add headline" }),
    );
    const input = within(row("headline")).getByRole("textbox", {
      name: "Headline",
    });
    fireEvent.change(input, { target: { value: "Founder" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    // The refreshed server render carries version 4 to both sections.
    view.rerender(sections(4, "Founder"));
    savePersonFieldAction.mockResolvedValue({
      ok: true,
      value: "Ada L.",
      version: 5,
    });
    fireEvent.click(
      within(row("displayName")).getByRole("button", { name: "Edit name" }),
    );
    const name = within(row("displayName")).getByRole("textbox", {
      name: "Name",
    });
    fireEvent.change(name, { target: { value: "Ada L." } });
    fireEvent.submit(name.closest("form") as HTMLFormElement);
    expect(savePersonFieldAction).toHaveBeenLastCalledWith(
      "displayName",
      "Ada L.",
      4,
    );
    // An older render never rolls a section back.
    view.rerender(sections(3, null));
    expect(within(row("headline")).getByText("Founder")).toBeTruthy();
  });

  it("cancels with Escape and sends nothing", () => {
    renderPerson();
    fireEvent.click(
      within(row("displayName")).getByRole("button", { name: "Edit name" }),
    );
    const input = within(row("displayName")).getByRole("textbox", {
      name: "Name",
    });
    fireEvent.change(input, { target: { value: "Someone else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(savePersonFieldAction).not.toHaveBeenCalled();
    expect(within(row("displayName")).getByText("Ada")).toBeTruthy();
  });

  it("refuses to empty a name before anything is sent", () => {
    renderPerson();
    fireEvent.click(
      within(row("displayName")).getByRole("button", { name: "Edit name" }),
    );
    const input = within(row("displayName")).getByRole("textbox", {
      name: "Name",
    });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(savePersonFieldAction).not.toHaveBeenCalled();
    expect(within(row("displayName")).getByRole("alert").textContent).toBe(
      "Name can't be empty.",
    );
  });

  it("says a version conflict plainly, keeps the stored value, and offers a reload", async () => {
    saveCompanyFieldAction.mockResolvedValue({
      ok: false,
      reason: "CONFLICT",
      message:
        "This profile changed since the page was opened, perhaps through Q. Reload to see the latest, then make your change again.",
    });
    render(
      <EditableProfile
        kind="COMPANY"
        subjectId={COMPANY}
        fields={COMPANY_FIELDS}
        values={{ canonicalName: "Kivu Freight", websiteUrl: null }}
        version={7}
        provenance={DECLARED}
      />,
    );
    fireEvent.click(
      within(row("websiteUrl")).getByRole("button", { name: "Add website" }),
    );
    const input = within(row("websiteUrl")).getByRole("textbox", {
      name: "Website",
    });
    // Not type="url": the browser's own check would refuse a bare domain
    // before the page could read it (found in the browser, BIZ-002).
    expect(input.getAttribute("type")).toBe("text");
    expect(input.getAttribute("inputmode")).toBe("url");
    fireEvent.change(input, { target: { value: "kivu-freight.example" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    // A website without a scheme is read as https, as Q's write path reads it.
    expect(saveCompanyFieldAction).toHaveBeenCalledWith(
      COMPANY,
      "websiteUrl",
      "https://kivu-freight.example",
      7,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("changed since the page was opened");
    expect(within(row("websiteUrl")).getByText("Not added")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Reload" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a refusal beside the field and keeps the draft", async () => {
    savePersonFieldAction.mockResolvedValue({
      ok: false,
      reason: "DENIED",
      message:
        "Your role doesn't include editing this profile. An administrator of your organisation can.",
    });
    renderPerson();
    fireEvent.click(
      within(row("headline")).getByRole("button", { name: "Add headline" }),
    );
    const input = within(row("headline")).getByRole("textbox", {
      name: "Headline",
    });
    fireEvent.change(input, { target: { value: "Angel investor" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    const alert = await within(row("headline")).findByRole("alert");
    expect(alert.textContent).toContain("administrator");
    expect((input as HTMLInputElement).value).toBe("Angel investor");
  });
});

describe("normaliseDraft", () => {
  const [name, headline] = PERSON_FIELDS;
  it("clears a clearable field and refuses to clear a required one", () => {
    if (name === undefined || headline === undefined) throw new Error("fields");
    expect(normaliseDraft(headline, "  ")).toEqual({ ok: true, value: null });
    expect(normaliseDraft(name, "")).toMatchObject({ ok: false });
    expect(normaliseDraft(headline, "x".repeat(161))).toMatchObject({
      ok: false,
    });
  });
});

const FINDINGS: ProfileFinding[] = [
  {
    id: "e0000000-0000-4000-8000-000000000001",
    key: "presence.what_they_do",
    statement: "Runs cross-border freight booking for East Africa.",
    truthClass: "Q_INFERENCE",
    evidenceStatus: "SELF_REPORTED",
    lifecycleStatus: "CURRENT",
    recordedAt: "2026-09-20T10:00:00.000Z",
    sources: [
      {
        title: "About Kivu Freight",
        url: "https://kivu-freight.example/about",
        retrievedAt: "2026-09-20T09:59:00.000Z",
      },
    ],
  },
  {
    id: "e0000000-0000-4000-8000-000000000002",
    key: "presence.location",
    statement: "Based in Kigali.",
    truthClass: "Q_INFERENCE",
    evidenceStatus: "SELF_REPORTED",
    lifecycleStatus: "STALE",
    recordedAt: "2025-01-20T10:00:00.000Z",
    sources: [],
  },
];

describe("what Q found", () => {
  it("says each finding on the three axes in words, with its page and date, never a percentage", () => {
    render(
      <ProfileFindings
        subjectLabel="Kivu Freight"
        state={{ status: "READ", findings: FINDINGS }}
      />,
    );
    const [doing, place] =
      document.querySelectorAll<HTMLElement>("[data-finding]");
    if (doing === undefined || place === undefined) throw new Error("items");
    expect(within(doing).getByText("Q's reading · self-reported")).toBeTruthy();
    const link = within(doing).getByRole("link", {
      name: "About Kivu Freight",
    });
    expect(link.getAttribute("href")).toBe(
      "https://kivu-freight.example/about",
    );
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(within(doing).getByText(/read 20 Sept? 2026/)).toBeTruthy();
    // Lifecycle is said only when it is not current.
    expect(
      within(place).getByText(
        "Q's reading · self-reported · May be out of date",
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/%|confidence/i);
    expect(
      screen.getByText(/Not on your profile until you confirm it/),
    ).toBeTruthy();
  });

  it("opens the one Q with a draft about the finding, sending nothing", () => {
    render(
      <ProfileFindings
        subjectLabel="Kivu Freight"
        state={{ status: "READ", findings: FINDINGS }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ask Q about: what it does" }),
    );
    expect(askAbout).toHaveBeenCalledWith(
      'You found on kivu-freight.example about Kivu Freight: "Runs cross-border freight booking for East Africa.". Is that right, and should any of it go on my profile?',
    );
  });

  it("says when nothing was found, and when the read failed, differently", () => {
    const { rerender } = render(
      <ProfileFindings
        subjectLabel="me"
        state={{ status: "READ", findings: [] }}
      />,
    );
    expect(screen.getByText(/Nothing found yet/)).toBeTruthy();
    rerender(
      <ProfileFindings subjectLabel="me" state={{ status: "UNAVAILABLE" }} />,
    );
    expect(screen.getByText(/Couldn't be read just now/)).toBeTruthy();
    // While streaming: said as a read in progress, never as "nothing".
    rerender(
      <ProfileFindings subjectLabel="me" state={{ status: "LOADING" }} />,
    );
    expect(screen.getByText(/Reading what Q found/)).toBeTruthy();
    expect(screen.queryByText(/Nothing found yet/)).toBeNull();
  });
});

describe("Signals & verification", () => {
  const subjects = [
    {
      label: "Kivu Freight",
      heading: "Your company",
      hasWebsite: true,
      findings: { status: "READ" as const, findings: [] },
    },
    {
      label: "me",
      heading: "You",
      hasWebsite: false,
      findings: { status: "READ" as const, findings: [] },
    },
  ];

  it("is one card: nothing found and nothing verified said once, every control wired", () => {
    render(
      <SignalsAndVerification
        subjects={subjects}
        verification={{ status: "NONE" }}
        verificationHref="/verification"
      />,
    );
    expect(screen.getAllByText("What Q found")).toHaveLength(1);
    expect(screen.getAllByText("Nothing found yet")).toHaveLength(1);
    expect(screen.getByText("Nothing verified yet")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "How verification works" }),
    ).toHaveProperty("pathname", "/verification");
    fireEvent.click(screen.getByRole("button", { name: "Ask Q to look" }));
    expect(askAbout.mock.calls).toEqual([
      [
        "Look for public information about Kivu Freight and tell me what you find.",
      ],
    ]);
  });

  it("while reading, shows a loading state and never 'nothing'", () => {
    render(
      <SignalsAndVerification
        subjects={subjects.map((subject) => ({
          ...subject,
          findings: { status: "LOADING" as const },
        }))}
        verification={null}
        verificationHref={null}
      />,
    );
    expect(screen.queryByText("Nothing found yet")).toBeNull();
    // No verification page on this side: the button asks Q instead.
    expect(
      screen.getByRole("button", { name: "How verification works" }),
    ).toBeTruthy();
  });
});
