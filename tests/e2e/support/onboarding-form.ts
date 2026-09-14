import type { Page } from "@playwright/test";

/**
 * The onboarding screens open on Q's conversation (CQ-PRE-REC-001 §16); the
 * structured form is one tap away and is what these specs exercise. After
 * every navigation to an onboarding route — first visit, reload, a second
 * tab, returning from Home — take that tap. A completed session shows its
 * completion panel with no such button, and the form itself has none, so
 * a missing button is not an error.
 */
export async function useTheForm(page: Page): Promise<void> {
  const button = page
    .getByRole("button", { name: "Use the form", exact: true })
    .first();
  try {
    await button.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    return;
  }
  await button.click();
}
