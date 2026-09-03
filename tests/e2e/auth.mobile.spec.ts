import { expect, test, type Page } from "@playwright/test";

import {
  expectNoHorizontalOverflow,
  signInThroughUi,
  signOutThroughUi,
  signUpThroughUi,
  TEST_PASSWORD,
  uniqueEmail,
  waitForAuthLink,
} from "./support/local-auth.js";

/**
 * Authentication journeys at 390 × 844 against the local Supabase stack.
 * Every test starts signed out; accounts are synthetic and unique per run.
 */
test.use({ storageState: { cookies: [], origins: [] } });

/** The danger notice, excluding Next's own route announcer (also role=alert). */
function formError(page: Page) {
  return page.locator('[role="alert"][data-tone="danger"]');
}

test.describe("authentication (mobile)", () => {
  test("a signed-out visitor to a protected route is sent to sign-in with a return path", async ({
    page,
  }) => {
    // Home is the default destination, so it needs no return parameter.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(
      page.getByRole("heading", { name: "Sign in", level: 1 }),
    ).toBeVisible();
    // No application chrome on the auth surface.
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("complementary")).toHaveCount(0);

    await page.goto("/profile");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fprofile$/);
    await page.goto("/onboarding/founder?fixture=review");
    await expect(page).toHaveURL(
      /\/auth\/sign-in\?next=%2Fonboarding%2Ffounder%3Ffixture%3Dreview$/,
    );
    // Auth paths are never a return destination (no sign-in loop).
    await page.goto("/auth/update-password");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });

  test("the sign-in screen is minimal, reachable and touch-sized", async ({
    page,
  }) => {
    await page.goto("/auth/sign-in");
    await expectNoHorizontalOverflow(page);

    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password");
    const submit = page.getByRole("button", { name: "Continue" });
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(password).toHaveAttribute("autocomplete", "current-password");

    for (const control of [email, password, submit]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // Show/hide is a named, pressed-state control and paste is not blocked.
    const toggle = page.getByRole("button", { name: "Show password" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(
      page.getByRole("button", { name: "Hide password" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(password).not.toHaveAttribute("onpaste", /.+/);

    // Keyboard order: email → password.
    await email.focus();
    await page.keyboard.press("Tab");
    await expect(password).toBeFocused();

    // Secondary paths are present and small.
    await expect(
      page.getByRole("link", { name: "Forgot password?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Create account" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Email me a sign-in link instead" }),
    ).toBeVisible();
  });

  test("create account → authenticated → profile shows the account → sign out clears the session", async ({
    page,
  }) => {
    const email = uniqueEmail("signup");
    await page.goto("/auth/sign-up");
    await expectNoHorizontalOverflow(page);
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    // Nothing but email and password is asked.
    await expect(page.getByRole("textbox")).toHaveCount(2);
    await expect(page.getByRole("combobox")).toHaveCount(0);

    await signUpThroughUi(page, email);
    await expect(
      page.getByRole("heading", { name: "Home", level: 1 }),
    ).toBeVisible();

    await page.goto("/profile");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("Active organisation membership")).toHaveCount(
      0,
    );

    await signOutThroughUi(page);
    await expect(page.getByText("You're signed out.")).toBeVisible();

    // The session is gone: protected routes redirect again and no session
    // cookie remains in the browser.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    const cookies = await page.context().cookies();
    expect(
      cookies.filter((cookie) => cookie.name.includes("auth-token")),
    ).toHaveLength(0);
  });

  test("signed-in visitors are moved off sign-in and the return path is honoured", async ({
    page,
  }) => {
    const email = uniqueEmail("return");
    await signUpThroughUi(page, email);
    await page.goto("/auth/sign-in?next=%2Fprofile");
    await expect(page).toHaveURL(/\/profile$/);

    await signOutThroughUi(page);
    await page.goto("/auth/sign-in?next=%2Fprofile");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/profile$/);
  });

  test("sign-in failures are generic: unknown email and wrong password read identically", async ({
    page,
  }) => {
    const email = uniqueEmail("wrong");
    await signUpThroughUi(page, email);
    await signOutThroughUi(page);

    await signInThroughUi(page, email, `${TEST_PASSWORD}-wrong`);
    await expect(formError(page)).toContainText(
      "Email or password wasn't recognised.",
    );
    // Controls are restored after failure: no stuck pending state.
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

    await signInThroughUi(page, uniqueEmail("nobody"), TEST_PASSWORD);
    await expect(formError(page)).toContainText(
      "Email or password wasn't recognised.",
    );
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
  });

  test("open redirects are refused in every form", async ({ page }) => {
    // The page sanitises the return path server-side before the form exists.
    const attempts = [
      "https://evil.example",
      "https://evil.example/home",
      "//evil.example",
      "javascript:alert(1)",
      "https%3A%2F%2Fevil.example",
      "%2F%2Fevil.example",
      "/\\evil.example",
      "/%2F%2Fevil.example",
    ];
    for (const attempt of attempts) {
      await page.goto(`/auth/sign-in?next=${encodeURIComponent(attempt)}`);
      await expect(page.locator('input[name="next"]')).toHaveValue("/home");
    }
    await page.goto("/auth/sign-in?next=%2Fprofile");
    await expect(page.locator('input[name="next"]')).toHaveValue("/profile");

    // The action sanitises again: a tampered hidden field cannot send the
    // browser off-origin after a real sign-in.
    const email = uniqueEmail("redirect");
    await signUpThroughUi(page, email);
    await signOutThroughUi(page);
    await page.goto("/auth/sign-in");
    await page.evaluate(() => {
      const field =
        document.querySelector<HTMLInputElement>('input[name="next"]');
      if (field !== null) {
        field.value = "https://evil.example/phish";
      }
    });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/home$/);

    // And a signed-in visitor with a hostile next is kept on-origin too.
    await page.goto("/auth/sign-in?next=%2F%2Fevil.example");
    await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/home$/);
  });

  test("password recovery: generic response, emailed link, new password works, old one does not", async ({
    page,
    request,
  }) => {
    test.slow();
    const email = uniqueEmail("recovery");
    await signUpThroughUi(page, email);
    await signOutThroughUi(page);

    // Unknown and known addresses get the same page.
    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email").fill(uniqueEmail("unknown"));
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page).toHaveURL(/\/auth\/check-email\?purpose=recovery$/);
    const unknownCopy = await page.getByRole("main").innerText();

    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page).toHaveURL(/\/auth\/check-email\?purpose=recovery$/);
    expect(await page.getByRole("main").innerText()).toBe(unknownCopy);

    const link = await waitForAuthLink(request, email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/auth\/update-password$/);

    const newPassword = `${TEST_PASSWORD}-rotated`;
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page).toHaveURL(/\/home$/);

    await signOutThroughUi(page);

    await signInThroughUi(page, email, TEST_PASSWORD);
    await expect(formError(page)).toContainText(
      "Email or password wasn't recognised.",
    );
    await signInThroughUi(page, email, newPassword);
    await expect(page).toHaveURL(/\/home$/);
  });

  test("an emailed sign-in link signs the person in through the callback", async ({
    page,
    request,
  }) => {
    const email = uniqueEmail("link");
    await page.goto("/auth/sign-in");
    await page
      .getByRole("button", { name: "Email me a sign-in link instead" })
      .click();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page).toHaveURL(/\/auth\/check-email\?purpose=link$/);

    const link = await waitForAuthLink(request, email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/home$/);
    await page.goto("/profile");
    await expect(page.getByText(email)).toBeVisible();
  });

  test("a stale or forged callback lands on sign-in with a generic notice", async ({
    page,
  }) => {
    await page.goto("/auth/callback?code=not-a-real-code");
    await expect(page).toHaveURL(/\/auth\/sign-in\?notice=link-invalid$/);
    await expect(
      page.getByText("That link has expired or was already used."),
    ).toBeVisible();
    await page.goto("/auth/callback?next=https%3A%2F%2Fevil.example");
    await expect(page).toHaveURL(/\/auth\/sign-in\?notice=link-invalid$/);
  });

  test("auth and session responses are never cacheable", async ({
    request,
  }) => {
    for (const path of [
      "/auth/sign-in",
      "/auth/sign-up",
      "/auth/callback?code=x",
      "/auth/forgot-password",
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
    const home = await request.get("/home", { maxRedirects: 0 });
    expect(home.status()).toBe(307);
    expect(home.headers()["cache-control"]).toContain("no-store");
  });
});
