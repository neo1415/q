// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { QueueKeys, DecisionBar, QUEUE_ITEM } =
  await import("../src/features/admin/queue-keys");

afterEach(cleanup);
// jsdom has no layout; the handler scrolls the current item into view.
Element.prototype.scrollIntoView = vi.fn();

function Queue({ onPress }: { readonly onPress: (what: string) => void }) {
  return (
    <QueueKeys hint="J / K move · V verify · D decline">
      <ul>
        {["Kazikit", "Maji Loop"].map((name) => (
          <li key={name} {...QUEUE_ITEM}>
            {name}
            <DecisionBar>
              <button
                type="button"
                data-shortcut="v"
                onClick={() => onPress(`verify ${name}`)}
              >
                Verify
              </button>
              <button
                type="button"
                data-shortcut="d"
                onClick={() => onPress(`decline ${name}`)}
              >
                Decline
              </button>
            </DecisionBar>
          </li>
        ))}
      </ul>
      <input aria-label="Basis" />
    </QueueKeys>
  );
}

const key = (k: string) =>
  act(() => {
    fireEvent.keyDown(window, { key: k });
  });

describe("admin queue keys (design-48)", () => {
  it("J / K move the current item; a letter presses that item's button", () => {
    const onPress = vi.fn();
    render(<Queue onPress={onPress} />);
    key("v");
    expect(onPress).toHaveBeenLastCalledWith("verify Kazikit");
    key("j");
    expect(document.activeElement?.textContent).toContain("Maji Loop");
    key("d");
    expect(onPress).toHaveBeenLastCalledWith("decline Maji Loop");
    key("k");
    key("v");
    expect(onPress).toHaveBeenLastCalledWith("verify Kazikit");
  });

  it("ignores keys while typing, with a modifier, or with a dialog open", () => {
    const onPress = vi.fn();
    render(<Queue onPress={onPress} />);
    const input = screen.getByLabelText("Basis");
    fireEvent.keyDown(input, { key: "v" });
    key("v");
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(onPress).toHaveBeenCalledTimes(1);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    key("v");
    expect(onPress).toHaveBeenCalledTimes(1);
    dialog.remove();
  });

  it("marks the current item and shows what the keys do", () => {
    render(<Queue onPress={vi.fn()} />);
    expect(screen.getByText("J / K move · V verify · D decline")).toBeTruthy();
    expect(
      document.querySelector("[data-queue-item][aria-current=true]")
        ?.textContent,
    ).toContain("Kazikit");
  });
});
