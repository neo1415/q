// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

/**
 * W4-A (enterprise audit finding 6): the Arabic catalogue is no longer in
 * every page's JavaScript. It loads on demand, and the language provider
 * waits for it: the server HTML is Arabic and hydration matches it, with
 * no English first and no hydration error. The test setup registers the
 * catalogue as the server does, so each case starts from a fresh module
 * graph where the browser has not loaded it yet.
 */

async function fresh() {
  vi.resetModules();
  const messages = await import("../src/features/i18n/messages");
  const language = await import("../src/features/i18n/language");
  return { messages, language };
}

describe("the hand catalogue loads on demand", () => {
  it("is not loaded until asked for; English needs none", async () => {
    const { messages } = await fresh();
    expect(messages.hasHandCatalogue("ar")).toBe(true);
    expect(messages.handCatalogueReady("ar")).toBe(false);
    expect(messages.handCatalogueReady("en")).toBe(true);
    expect(messages.translate("ar", "Settings")).toBe("Settings");
    await messages.loadHandCatalogue("ar");
    expect(messages.handCatalogueReady("ar")).toBe(true);
    expect(messages.translate("ar", "Settings")).not.toBe("Settings");
  });

  it("server HTML in Arabic hydrates in Arabic, with no mismatch", async () => {
    // The server side: its own module graph, the catalogue loaded.
    const server = await fresh();
    await server.messages.loadHandCatalogue("ar");
    const { renderToString } = await import("react-dom/server");
    const ServerProvider = server.language.LanguageProvider;
    const ServerWords = server.language.Words;
    const html = renderToString(
      <ServerProvider language="ar">
        <span data-probe>
          <ServerWords>Settings</ServerWords>
        </span>
      </ServerProvider>,
    );
    const arabic = server.messages.translate("ar", "Settings");
    expect(html).toContain(arabic);
    expect(html).toContain('dir="rtl"');

    // The browser side: a fresh graph, the catalogue not loaded yet.
    const browser = await fresh();
    expect(browser.messages.handCatalogueReady("ar")).toBe(false);
    const { hydrateRoot } = await import("react-dom/client");
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    const Provider = browser.language.LanguageProvider;
    const Words = browser.language.Words;
    await act(async () => {
      hydrateRoot(
        container,
        <Provider language="ar">
          <span data-probe>
            <Words>Settings</Words>
          </span>
        </Provider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
      await browser.messages.loadHandCatalogue("ar");
    });
    expect(errors).toEqual([]);
    expect(container.querySelector("[data-probe]")?.textContent).toBe(arabic);
    expect(document.documentElement.dir).toBe("rtl");
    container.remove();
  });
});
