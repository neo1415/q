# Q home tidy, like ChatGPT — receipts (2026-11-06)

Branch `fix/q-home-tidy` (from `origin/fix/resume-asking-cv9ru3` @ `4c04b5f`). Owner-approved clean-ups: one phone top bar, "Hide from Q" as a message action, and Clear moved into the More menu.

The screenshots come from the dev harness `/dev/q-nav?connected=1&shell=1`. `shell=1` is new on this branch. It wraps the real `QConversationPanel` in the signed-in shell's phone header and shell context, with the fictional scope "Personal investing". Nothing reaches Q, the database or a provider. The harness strip is hidden.

The "before" shots used the base commit's `src/features/q` and `globals.css` inside the same harness. Each state has four sizes: 1440×900 and 390×844, each in light and dark.

| State                        | Before                           | After                           |
| ---------------------------- | -------------------------------- | ------------------------------- |
| Empty home                   | `before-empty-<w>-<scheme>.png`  | `after-empty-<w>-<scheme>.png`  |
| After the first send, Chat   | `before-sent-<w>-<scheme>.png`   | `after-sent-<w>-<scheme>.png`   |
| More (⋯) menu open           | `before-more-<w>-<scheme>.png`   | `after-more-<w>-<scheme>.png`   |
| Phone menu drawer open (390) | `before-drawer-390-<scheme>.png` | `after-drawer-390-<scheme>.png` |

## What changed

1. **One top bar on the phone Q home.**
   - Below 1024 px the shell's own header is hidden on the Q home only, through CSS `.cq-shell:has(.cq-q-home) .cq-shell-header`. That header held the menu, "Capital Q", "Private", the bell and You.
   - The Q top line now starts with the shell's menu button (`PhoneShellLead`), keeps the sliding Q | Chat switch in the centre, and keeps Board, Conversations and ⋯ at the right.
   - The menu's drawer gets a first row with the scope indicator ("Private"), the notifications bell and You. Each is one tap once the drawer is open.
   - Every other page keeps its header. The desktop is unchanged.
   - The shell passes its context through `ShellPhoneLeadProvider`. Outside the shell, for example in the bare harness, no menu is drawn.
2. **Hide from Q.**
   - The always-visible link under each of the person's lines is gone.
   - Each stored line has a small "Message actions" (⋯) button that opens a menu with "Hide from Q".
   - On a desktop the button stays transparent until the row is hovered, something in it has keyboard focus, or its menu is open. On touch screens (`hover: none`) it stays quietly visible.
   - It is a real button, so Tab reaches it and Enter opens it.
   - `hideQMessageAction` and the Q API's ownership check are unchanged.
   - Not in the screenshots: the harness has no stored conversation, so its lines have no message id and offer no actions, which is unchanged behaviour. The placement is covered by the component tests.
3. **Clear.**
   - The floating "Clear" / "Show again" at the foot of the thread was the cards control (`CardsControls`). It has been removed from the thread.
   - The header ⋯ menu now offers "Clear the cards" (when two or more cards show) and "Show the cards again" (only after cards were closed in this conversation). These are the same `applyCardsIntent` calls and the same conditions as before.
   - There was no confirmation before, and none was added. Clearing only hides cards on this screen. There is no separate "clear conversation" feature, so "the existing equivalent" is this one.
   - In the harness the More menu shows no card items, because the harness has no cards.

New strings, with Arabic, are in `catalog/sweep.ts`: "Message actions", "Hide from Q", "Couldn't hide that. Try again", "Clear the cards" and "Show the cards again". `generate-ui-text-source` regenerated them: 6522 strings, 0 Arabic gaps.

## Tests

- **New:** `apps/web/test/q-home-tidy.test.tsx`, 7 tests.
  - Failing-first against the base `src/features/q` and `globals.css`: 6 failed and 1 passed. The test that passed is the guard "no menu outside the shell".
  - After the change: 7 of 7 passed.
- **Updated honestly to the new placement:**
  - `hide-from-q.test.tsx` now opens Message actions and then chooses Hide from Q.
  - `card-visibility-surfaces.test.tsx` and `n3-one-q.test.tsx` use the More menu instead of `CardsControls`.
  - `e2e/clear-cards.spec.ts` opens More before using the click twins. It was not run here, because it needs a signed-in account.

Gate results are in the message to the integration owner and below.

## Gates (2026-11-06, exact results)

- `pnpm exec turbo run build --filter=./packages/*`: exit 0. There were 54 tasks, 42 of them cached.
- Root tsc `node --max-old-space-size=7168 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: exit 0.
- Web tsc (`apps/web`, `tsc --noEmit -p tsconfig.json`): exit 0.
- eslint on the 15 touched TS/TSX files (`NODE_OPTIONS=--max-old-space-size=6144`): exit 0, with no findings.
- Full web vitest (`vitest run apps/web`): 464 files and 4041 tests passed.
  - That includes `back-everywhere` (87), `destination-routes` (52) and `manifest-page-coverage` (3).
  - It also includes the `control/app-routes` consumers.
- `packages/q-core` vitest, after the regenerated UI-text source: 145 files passed and 1 skipped; 832 tests passed and 1 skipped.
- `packages/ui` was not touched.
- `npx prettier --check apps packages docs`: all files clean.
- Not run: Playwright e2e (`clear-cards.spec.ts` needs a signed-in account). Nothing was deployed and no live calls were made.
