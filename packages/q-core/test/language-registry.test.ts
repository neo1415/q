import { describe, expect, it } from "vitest";

import {
  ISO_639_1,
  isOfferedLanguage,
  languageChannels,
  languageDirection,
  languageInfo,
  listSeparator,
  offeredLanguages,
  resolveLanguage,
  voiceLineAvailable,
} from "../src/language/public.js";

/**
 * Any language (owner 2026-10-16): names, direction and lists come from
 * Intl data, never a per-language branch; channels from the providers'
 * documented lists, never a pretence.
 */
describe("the language registry", () => {
  it("names each language in itself and finds its direction, for many languages", () => {
    const cases: readonly [string, string, "ltr" | "rtl"][] = [
      ["fr", "français", "ltr"],
      ["sw", "Kiswahili", "ltr"],
      ["ur", "اردو", "rtl"],
      ["he", "עברית", "rtl"],
      ["ja", "日本語", "ltr"],
      ["yo", "Èdè Yorùbá", "ltr"],
      ["ar", "العربية", "rtl"],
      ["fa", "فارسی", "rtl"],
      ["dv", "Divehi", "rtl"],
    ];
    for (const [tag, native, direction] of cases) {
      expect(languageInfo(tag)?.nativeName, tag).toBe(native);
      expect(languageDirection(tag), tag).toBe(direction);
    }
    expect(languageInfo("pt-br")?.tag).toBe("pt-BR");
  });

  it("offers most ISO 639-1 languages and refuses what it cannot name or script", () => {
    expect(offeredLanguages().length).toBeGreaterThan(150);
    expect(offeredLanguages().length).toBeLessThanOrEqual(ISO_639_1.length);
    expect(isOfferedLanguage("tlh")).toBe(false);
    expect(isOfferedLanguage("xx")).toBe(false);
    expect(isOfferedLanguage("not a tag")).toBe(false);
    expect(languageDirection("xx")).toBe("ltr");
  });

  it("resolves a language asked for by tag or by name in any language", () => {
    for (const asked of [
      "fr",
      "French",
      "français",
      "Kifaransa",
      "francés",
      "الفرنسية",
      "فرنسي",
    ]) {
      const resolved = resolveLanguage(asked);
      expect(resolved.ok && resolved.info.tag, asked).toBe("fr");
    }
    expect(resolveLanguage("Kiswahili")).toMatchObject({
      ok: true,
      info: { tag: "sw" },
    });
    expect(resolveLanguage("日本語")).toMatchObject({
      ok: true,
      info: { tag: "ja" },
    });
    expect(resolveLanguage("tlh")).toEqual({
      ok: false,
      reason: "NOT_OFFERED",
    });
    expect(resolveLanguage("Klingon")).toMatchObject({ ok: false });
    expect(resolveLanguage("")).toMatchObject({ ok: false });
  });

  it("joins lists with the script's comma", () => {
    expect(listSeparator("ar")).toBe("، ");
    expect(listSeparator("ur")).toBe("، ");
    expect(listSeparator("ja")).toBe("、");
    expect(listSeparator("fr")).toBe(", ");
  });
});

describe("voice and video capability", () => {
  it("listens with the Deepgram model each language is documented for", () => {
    expect(languageChannels("en").listen).toEqual({ model: "flux-general-en" });
    expect(languageChannels("fr").listen).toEqual({
      model: "flux-general-multi",
    });
    expect(languageChannels("ar-AE").listen).toEqual({
      model: "nova-3",
      language: "ar-AE",
    });
    expect(languageChannels("ar-YE").listen).toEqual({
      model: "nova-3",
      language: "ar",
    });
    expect(languageChannels("ko").listen).toEqual({
      model: "nova-3",
      language: "ko",
    });
  });

  it("falls back honestly where a provider lists no support", () => {
    // Swahili: no Deepgram model, no Tavus; ElevenLabs v3 and Whisper list it.
    const sw = languageChannels("sw");
    expect(sw.listen).toBeNull();
    expect(sw.video).toBeNull();
    expect(sw.speak).toEqual({ languageCode: "sw" });
    expect(sw.transcriptionHint).toBe("sw");
    expect(voiceLineAvailable("sw")).toBe(false);
    // Urdu: Nova-3 hears it, Tavus does not run it.
    expect(languageChannels("ur").video).toBeNull();
    expect(voiceLineAvailable("ur")).toBe(true);
    // GPT-Live documents no list: by instruction, never "supported".
    expect(languageChannels("fr").live).toBe("BY_INSTRUCTION");
  });

  it("runs video rooms in the person's language first, English understood", () => {
    expect(languageChannels("es").video).toEqual({ languages: ["es", "en"] });
    expect(languageChannels("en").video).toEqual({ languages: ["en"] });
    expect(languageChannels("nb").video).toEqual({ languages: ["no", "en"] });
  });
});
