import { describe, expect, it, vi } from "vitest";

vi.mock("../src/features/company/material/material-actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

import { filingOf } from "../src/features/company/material/data-room";

/**
 * F10: filing a document in the data room. A checklist item names its own
 * folder; a folder alone clears the item; anything else is no filing.
 */
const CHECKLIST = [
  {
    code: "cac_certificate",
    folderCode: "corporate",
    label: "Certificate of incorporation (CAC)",
    defaultLevel: "ON_REQUEST" as const,
    present: false,
  },
];

describe("data room filing", () => {
  it("files as a checklist item in its folder, or in a folder alone", () => {
    expect(filingOf("item:cac_certificate", CHECKLIST)).toEqual({
      folderCode: "corporate",
      checklistItemCode: "cac_certificate",
    });
    expect(filingOf("folder:financials", CHECKLIST)).toEqual({
      folderCode: "financials",
      checklistItemCode: null,
    });
  });

  it("an unknown item or an empty choice files nothing", () => {
    expect(filingOf("item:nope", CHECKLIST)).toBeNull();
    expect(filingOf("folder:", CHECKLIST)).toBeNull();
    expect(filingOf("anything", CHECKLIST)).toBeNull();
  });
});
