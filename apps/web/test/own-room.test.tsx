// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DataRoomOwnerView,
  DataRoomPreviewDto,
} from "@capital-q/contracts";

/**
 * Design ownroom-2: the founder's room beside an investor's view. The view
 * is the API's (the same projection an investor's own read uses), never
 * worked out in the browser: these tests check the page asks for the
 * chosen investor, shows exactly what came back, and asks again after a
 * change of access.
 */

type Action = (...args: unknown[]) => Promise<unknown>;
const actions = {
  preview: vi.fn<Action>(),
  setLevel: vi.fn<Action>(),
  setOutline: vi.fn<Action>(),
};
vi.mock("../src/features/company/material/material-actions", () => ({
  dataRoomPreviewAction: (...args: unknown[]) => actions.preview(...args),
  setLevelAction: (...args: unknown[]) => actions.setLevel(...args),
  setOutlineAction: (...args: unknown[]) => actions.setOutline(...args),
}));

const room = await import("../src/features/company/material/own-room");

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const COMPANY = id(1);
const NORTHBOUND = id(70);
const MERIDIAN = id(71);

const doc = (
  n: number,
  over: Partial<DataRoomOwnerView["documents"][number]>,
): DataRoomOwnerView["documents"][number] => ({
  documentId: id(100 + n),
  title: `Document ${n}`,
  folderCode: "fundraising",
  checklistItemCode: null,
  level: "PUBLIC",
  visibilityScope: "network_visible",
  kind: "PDF",
  pageCount: 13,
  updatedAt: "2026-10-01T09:00:00.000Z",
  validUntil: null,
  sharedWith: 0,
  openedBy: 0,
  version: 1,
  ...over,
});

const OWNER: DataRoomOwnerView = {
  viewer: "OWNER",
  companyId: COMPANY,
  stageCode: "seed",
  countryCode: "US",
  folders: [
    { code: "fundraising", label: "Fundraising summary" },
    { code: "corporate", label: "Company and incorporation" },
  ],
  documents: [
    doc(1, { title: "Tessellate seed deck (Oct 2026)" }),
    doc(2, {
      title: "Cap table",
      folderCode: "corporate",
      level: "PRIVATE",
      visibilityScope: "organisation_private",
      kind: "Sheet",
      pageCount: null,
    }),
  ],
  checklist: [],
  requests: [
    {
      requestId: id(200),
      relationshipId: MERIDIAN,
      documentId: id(102),
      documentTitle: "Cap table",
      requesterName: "Ada",
      requesterOrganisationName: "Meridian Seed",
      note: null,
      requestedAt: "2026-10-20T09:00:00.000Z",
      status: "OPEN",
      accessEndsAt: null,
    },
  ],
  outlineBeforeConnection: true,
};

const INVESTORS: DataRoomPreviewDto["investors"] = [
  {
    relationshipId: NORTHBOUND,
    investorOrganisationName: "Northbound Capital",
    connection: "CONNECTED",
  },
  {
    relationshipId: MERIDIAN,
    investorOrganisationName: "Meridian Seed",
    connection: "CONNECTED",
  },
];

function previewFor(relationshipId: string | null): DataRoomPreviewDto {
  return relationshipId === null
    ? {
        companyId: COMPANY,
        as: {
          relationshipId: null,
          investorOrganisationName: null,
          connection: "NOT_CONNECTED",
        },
        view: {
          viewer: "INVESTOR",
          companyId: COMPANY,
          access: "LOCKED",
          locked: {
            reason: "NOT_CONNECTED",
            outline: [
              { code: "fundraising", label: "Fundraising summary", documents: 1 },
            ],
          },
          folders: [],
          documents: [],
        },
        investors: INVESTORS,
      }
    : {
        companyId: COMPANY,
        as: {
          relationshipId,
          investorOrganisationName:
            relationshipId === NORTHBOUND ? "Northbound Capital" : "Meridian Seed",
          connection: "CONNECTED",
        },
        view: {
          viewer: "INVESTOR",
          companyId: COMPANY,
          access: "CONNECTED",
          folders: [{ code: "fundraising", label: "Fundraising summary" }],
          documents: [
            {
              documentId: id(101),
              title: "Tessellate seed deck (Oct 2026)",
              folderCode: "fundraising",
              shownAs: "PUBLIC",
              access: "OPEN",
              kind: "PDF",
              pageCount: 13,
              updatedAt: "2026-10-01T09:00:00.000Z",
              validUntil: null,
              openedAt: null,
              accessEndsAt: null,
            },
          ],
        },
        investors: INVESTORS,
      };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  actions.preview.mockReset();
  actions.setLevel.mockReset();
  actions.setOutline.mockReset();
  actions.preview.mockImplementation((input: unknown) =>
    Promise.resolve({
      ok: true,
      value: previewFor(
        (input as { relationshipId: string | null }).relationshipId,
      ),
    }),
  );
  actions.setLevel.mockResolvedValue({ ok: true, value: undefined });
  actions.setOutline.mockResolvedValue({ ok: true, value: undefined });
});
afterEach(cleanup);

describe("the founder's room, seen as an investor would", () => {
  it("says each document's access in words, and opens on anyone not yet connected", async () => {
    render(<room.OwnRoom companyId={COMPANY} view={OWNER} />);
    await settle();
    expect(screen.getByText("Investors you accept")).toBeTruthy();
    expect(screen.getByText("Only your team")).toBeTruthy();
    expect(screen.getByText("PDF, 13 pages")).toBeTruthy();
    expect(actions.preview).toHaveBeenCalledWith({
      companyId: COMPANY,
      relationshipId: null,
    });
    const lens = document.querySelector('[data-lens="NOT_YET"]');
    expect(lens?.textContent).toContain(
      "As not yet connected sees it: Any investor who can find you",
    );
    expect(lens?.textContent).toContain("1 hidden");
    // Only-your-team never appears in an investor's view, not as a title.
    expect(lens?.textContent).not.toContain("Cap table");
  });

  it("asks the API for the chosen investor and shows what came back", async () => {
    render(<room.OwnRoom companyId={COMPANY} view={OWNER} />);
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "A connected investor" }),
    );
    await settle();
    expect(actions.preview).toHaveBeenLastCalledWith({
      companyId: COMPANY,
      relationshipId: NORTHBOUND,
    });
    const lens = document.querySelector('[data-lens="CONNECTED"]');
    expect(lens?.textContent).toContain("Northbound Capital, interest accepted");
    expect(
      within(lens as HTMLElement).getByText("Can open"),
    ).toBeTruthy();
    // Two connected investors: the founder picks whose view.
    fireEvent.change(screen.getByLabelText("Which investor"), {
      target: { value: MERIDIAN },
    });
    await settle();
    expect(actions.preview).toHaveBeenLastCalledWith({
      companyId: COMPANY,
      relationshipId: MERIDIAN,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Requested a document" }),
    );
    await settle();
    expect(
      document.querySelector('[data-lens="REQUESTED"]')?.textContent,
    ).toContain("Meridian Seed");
  });

  it("saves a change of access, then reads the investor's view again", async () => {
    render(<room.OwnRoom companyId={COMPANY} view={OWNER} />);
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: /Who can see Cap table/ }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Investors you accept/ }));
    const calls = actions.preview.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await settle();
    expect(actions.setLevel).toHaveBeenCalledWith({
      companyId: COMPANY,
      documentId: id(102),
      level: "PUBLIC",
      version: 1,
    });
    expect(actions.preview.mock.calls.length).toBe(calls + 1);
    expect(screen.getAllByText("Investors you accept")).toHaveLength(2);
  });

  it("turns the folder outline off for investors not yet connected", async () => {
    render(<room.OwnRoom companyId={COMPANY} view={OWNER} />);
    await settle();
    const toggle = screen.getByRole("switch", { name: "Folder names" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await settle();
    expect(actions.setOutline).toHaveBeenCalledWith({
      companyId: COMPANY,
      outlineBeforeConnection: false,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("is honest when no investor is connected yet", async () => {
    actions.preview.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        value: { ...previewFor(null), investors: [] },
      }),
    );
    render(
      <room.OwnRoom companyId={COMPANY} view={{ ...OWNER, requests: [] }} />,
    );
    await settle();
    fireEvent.click(
      screen.getByRole("button", { name: "A connected investor" }),
    );
    await settle();
    expect(screen.getByText(/No investor is connected yet/)).toBeTruthy();
    expect(room.accessWords({ level: "SHARED_ONLY", sharedWith: 2 })).toBe(
      "Shared with 2 investors",
    );
  });
});
