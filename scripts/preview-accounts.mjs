import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The preview's own sign-in accounts (QX-003, preview auth fix).
 *
 * `preview:update` resets the preview database, because a new commit may
 * bring migrations with it and a half-migrated tester stack is worse than
 * a wiped one. The reset takes `auth.users` with it, and
 * `supabase/seed.sql` creates none — so every update left the tester at a
 * sign-in page with no account to sign in to, which made the stable
 * tester stack unusable for the one thing it exists for.
 *
 * The fix reuses `dev:bootstrap` rather than writing a second seeder.
 * That script already creates the three synthetic people through the
 * public paths a real person takes — sign-up, then the onboarding runtime
 * — so the founder it makes owns a canonical company written by the
 * canonical service, and the tester can actually ask Q about something.
 * A seeder that inserted rows directly would produce an account that
 * signs in and has nothing to talk about.
 *
 * Three things make pointing it at the preview safe:
 *
 * **It is the preview's own stack or nothing.** Every value comes from
 * `supabase status` for the preview project and from the preview's own
 * ports; none is read from development's `.env.local`.
 *
 * **It refuses anything that is not loopback.** That guard is in
 * `dev-bootstrap` itself, so a hosted URL cannot be seeded even by
 * mistake.
 *
 * **It is quiet.** `dev:bootstrap` prints the synthetic password on
 * completion; here its output is captured and not echoed, so
 * `preview:start`, `preview:update` and `preview:status` never carry a
 * password. `pnpm preview:accounts` prints it, because asking for it is
 * the moment to show it.
 */

const scripts = resolve(fileURLToPath(new URL(".", import.meta.url)));

/**
 * The synthetic identities `dev:bootstrap` creates, mirrored here for the
 * `preview:accounts` listing. The password is that script's constant: it
 * is not a secret, because these accounts exist only on this machine and
 * only against a loopback database.
 */
export const PREVIEW_ACCOUNTS = [
  { key: "founder", email: "dev-founder@capitalq.local", label: "Founder" },
  { key: "investor", email: "dev-investor@capitalq.local", label: "Investor" },
  { key: "member", email: "dev-member@capitalq.local", label: "No org yet" },
];
export const PREVIEW_ACCOUNT_PASSWORD = "CapitalQ-dev-2026!";

/**
 * Put the tester's accounts back after a reset.
 *
 * Idempotent: `dev:bootstrap` reports what already exists and changes
 * nothing when everything is there, so this is safe to run on every
 * `preview:start` as well as every `preview:update`.
 */
export function ensurePreviewAccounts({ stack, apiUrl, dataDir }) {
  if (
    typeof stack?.API_URL !== "string" ||
    typeof stack.PUBLISHABLE_KEY !== "string" ||
    typeof stack.SECRET_KEY !== "string"
  ) {
    return { ok: false, reason: "no preview stack settings" };
  }
  const result = spawnSync(
    process.execPath,
    [join(scripts, "dev-bootstrap.mjs")],
    {
      cwd: resolve(scripts, ".."),
      // A clean environment rather than an inherited one: development's
      // own SUPABASE_URL must not be able to leak in and point this at
      // the wrong database.
      env: {
        ...process.env,
        SUPABASE_URL: stack.API_URL,
        SUPABASE_PUBLISHABLE_KEY: stack.PUBLISHABLE_KEY,
        SUPABASE_SECRET_KEY: stack.SECRET_KEY,
        CQ_API_URL: apiUrl,
      },
      // Captured, never echoed: the last line of that script is a
      // password.
      encoding: "utf8",
      shell: false,
    },
  );
  if (result.status !== 0) {
    const tail = String(result.stderr ?? result.stdout ?? "")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .at(-1);
    return {
      ok: false,
      reason: tail === undefined ? "bootstrap failed" : tail.slice(0, 120),
      log: join(dataDir, "preview.log"),
    };
  }
  return { ok: true };
}
