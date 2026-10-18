// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from "../src/components/menu.js";
import { SheetContent, SheetRoot } from "../src/components/sheet.js";

/**
 * F2: a menu opened inside a sheet (the Q sheet's deck Download) is
 * portalled to the body, so on the page layer it sat beneath the sheet,
 * which took its clicks. Inside a sheet it now opens on the modal-popover
 * layer token; outside one it stays on the page popover layer.
 */

afterEach(() => {
  cleanup();
});

function DownloadMenu() {
  return (
    <MenuRoot>
      <MenuTrigger>
        <button type="button">Download</button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem>PDF document</MenuItem>
      </MenuContent>
    </MenuRoot>
  );
}

async function openAndFindLayer(): Promise<string> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await Promise.resolve();
  });
  const item = await screen.findByText("PDF document");
  let node: HTMLElement | null = item;
  while (node !== null && !/z-\(--cq-z-/u.test(node.className)) {
    node = node.parentElement;
  }
  return node?.className ?? "";
}

describe("popup layer", () => {
  it("opens above the sheet when the menu is inside one", async () => {
    render(
      <SheetRoot open>
        <SheetContent title="Q">
          <DownloadMenu />
        </SheetContent>
      </SheetRoot>,
    );
    const layer = await openAndFindLayer();
    expect(layer).toContain("z-(--cq-z-modal-popover)");
  });

  it("stays on the page popover layer outside a sheet", async () => {
    render(<DownloadMenu />);
    const layer = await openAndFindLayer();
    expect(layer).toContain("z-(--cq-z-popover)");
    expect(layer).not.toContain("modal-popover");
  });
});
