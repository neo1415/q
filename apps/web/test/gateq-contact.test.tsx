// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn() }));
vi.mock("../src/features/gateq/interview-actions", () => ({
  contactApplicationAction: calls.save,
  confirmContactAction: calls.confirm,
}));
const { ContactStep } = await import("../src/features/gateq/contact-step");
const onConfirmed = vi.fn();
const contact = {
  name: "Example founder",
  email: "founder@example.test",
  role: "Founder",
  companyName: "Example",
};
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);
function mount() {
  render(
    <ContactStep
      initial={contact}
      account={false}
      ensureToken={() => Promise.resolve("gqs_application_token_long")}
      onConfirmed={onConfirmed}
    />,
  );
}
describe("guest contact confirmation", () => {
  it("does not advance when delivery fails and keeps the application recoverable", async () => {
    calls.save.mockResolvedValue({
      ok: true,
      value: { codeSent: false, contact: { emailConfirmed: false } },
    });
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm contact" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't send/);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Six-digit email code")).toBeNull();
  });
  it("wrong or expired codes cannot advance; only confirmed response unlocks the form", async () => {
    calls.save.mockResolvedValue({
      ok: true,
      value: { codeSent: true, contact: { emailConfirmed: false } },
    });
    calls.confirm
      .mockResolvedValueOnce({
        ok: true,
        value: { status: "WRONG_CODE", contact: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { status: "EXPIRED", contact: null },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { status: "CONFIRMED", contact: { emailConfirmed: true } },
      });
    mount();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm contact" }));
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText("Six-digit email code"), {
      target: { value: "123456" },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Verify email and continue" }),
      );
      await Promise.resolve();
    });
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/doesn't match/);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Verify email and continue" }),
      );
      await Promise.resolve();
    });
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/no longer usable/);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Verify email and continue" }),
      );
      await Promise.resolve();
    });
    expect(onConfirmed).toHaveBeenCalledExactlyOnceWith(contact);
  });
});
