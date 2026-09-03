import { test as setup } from "@playwright/test";

import {
  signUpThroughUi,
  STORAGE_STATE,
  uniqueEmail,
} from "./support/local-auth.js";

/**
 * Creates one synthetic account through the real sign-up screen and saves
 * its session cookies. The application journeys (shell, onboarding, PWA)
 * run with this state; the auth journeys start signed out on purpose.
 */
setup("create a synthetic signed-in session", async ({ page }) => {
  await signUpThroughUi(page, uniqueEmail("session"));
  await page.context().storageState({ path: STORAGE_STATE });
});
