// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { lightSection, unlightAll } from "@/features/q-pitch/section-light";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("lightSection (v6: every section Q talks about is lit)", () => {
  it("lights the anchored section, one at a time, and opens it when asked", async () => {
    document.body.innerHTML = `
      <details data-qp-anchor="inv.07.profile.overview.moats"><summary>Moats</summary><p>…</p></details>
      <section data-qp-anchor="inv.07.profile.overview.raise">Raise</section>`;
    const signal = new AbortController().signal;
    expect(
      await lightSection(
        "inv.07.profile.overview.moats",
        { open: true },
        signal,
      ),
    ).toBe(true);
    const moats = document.querySelector("details");
    expect(moats?.open).toBe(true);
    expect(moats?.hasAttribute("data-qp-lit")).toBe(true);
    await lightSection("inv.07.profile.overview.raise", {}, signal);
    expect(moats?.hasAttribute("data-qp-lit")).toBe(false);
    expect(document.querySelectorAll("[data-qp-lit]")).toHaveLength(1);
    unlightAll();
    expect(document.querySelectorAll("[data-qp-lit]")).toHaveLength(0);
  });

  it("waits for a section the page renders late, and reports one that never comes", async () => {
    const signal = new AbortController().signal;
    setTimeout(() => {
      document.body.innerHTML = `<section data-qp-anchor="inv.10.gateq.dossier">Dossier</section>`;
    }, 150);
    expect(await lightSection("inv.10.gateq.dossier", {}, signal, 1_000)).toBe(
      true,
    );
    expect(await lightSection("inv.10.gateq.missing", {}, signal, 200)).toBe(
      false,
    );
  });

  it("finds a shared element by any of its anchors, one per track", async () => {
    document.body.innerHTML = `<section data-qp-anchor="inv.07.crm.hub fdr.05.crm.hub">CRM</section>`;
    const signal = new AbortController().signal;
    expect(await lightSection("fdr.05.crm.hub", {}, signal, 100)).toBe(true);
    expect(await lightSection("inv.07.crm.hub", {}, signal, 100)).toBe(true);
    expect(await lightSection("inv.07.crm", {}, signal, 100)).toBe(false);
  });
});
