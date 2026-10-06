// Playwright building blocks for the founder surfaces, driven the way a
// person uses them (labels and roles, never test ids or private APIs).

export const region = (page, name) =>
  page.getByRole("region", { name, exact: true }).first();

/** Open a profile region's editor ("Edit <name>"), if it is not open yet. */
export async function openRegion(page, name) {
  const r = region(page, name);
  const done = r.getByRole("button", { name: `Done editing ${name}` });
  if (await done.isVisible().catch(() => false)) return r;
  await r.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  await page.waitForTimeout(800);
  return r;
}

export async function closeRegion(page, name) {
  const r = region(page, name);
  const done = r.getByRole("button", { name: `Done editing ${name}` });
  if (await done.isVisible().catch(() => false)) await done.click();
  await page.waitForTimeout(500);
}

/**
 * Edit one inline field inside an open region: click "Add <label>" or
 * "Edit <label>", fill, Save, and wait for the editor to close. Returns
 * "unchanged" when the shown value already equals the wanted one.
 */
export async function setField(page, regionName, label, value) {
  const r = await openRegion(page, regionName);
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  const opener = r
    .getByRole("button", { name: new RegExp(`^(Add|Edit) (${escape(label)}|${escape(lower)})$`, "i") })
    .first();
  if (!(await opener.isVisible().catch(() => false)))
    return `no opener for ${label}`;
  await opener.click();
  await page.waitForTimeout(600);
  const box = r.getByRole("textbox", { name: new RegExp(`^${escape(label)}$`, "i") }).first();
  const combo = r.getByRole("combobox", { name: new RegExp(`^${escape(label)}$`, "i") }).first();
  if (await box.isVisible().catch(() => false)) {
    await box.fill(String(value));
  } else if (await combo.isVisible().catch(() => false)) {
    await combo.selectOption({ label: String(value) }).catch(async () =>
      combo.selectOption(String(value)),
    );
  } else {
    const dateBox = r.locator("input").first();
    await dateBox.fill(String(value));
  }
  await r.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.waitForTimeout(2500);
  const err = await r.getByRole("alert").allInnerTexts().catch(() => []);
  return err.filter((t) => t.trim()).join(" ") || "saved";
}

/** In the open "Edit sector" dialog, add each category by typing and picking. */
export async function addSectorCategories(page, names) {
  const d = page.getByRole("dialog");
  const out = [];
  for (const name of names) {
    const already = d.getByRole("button", { name: new RegExp(`^Remove ${escape(name)}$`, "i") });
    if (await already.isVisible().catch(() => false)) {
      out.push(`${name}: present`);
      continue;
    }
    const box = d.getByRole("textbox", { name: "Add" });
    await box.fill(name);
    await page.waitForTimeout(1800);
    const pick = d.getByRole("button", { name, exact: true }).first();
    if (await pick.isVisible().catch(() => false)) {
      await pick.click();
      await page.waitForTimeout(500);
      out.push(`${name}: added`);
    } else out.push(`${name}: NOT FOUND`);
  }
  return out;
}

export function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
