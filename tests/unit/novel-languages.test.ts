import { describe, expect, it } from "vitest";
import en from "../../locales/en/ui.json";
import es from "../../locales/es/ui.json";
import { NOVEL_LANGUAGES, isNovelLanguage, languageOptions, novelLanguageOf } from "$lib/i18n/languages";

// The languages a novel can be written in (src/lib/i18n/languages.ts), held
// to the names the interface has for them. Rust keeps the same list
// (`LANGUAGES` in src-tauri/src/commands/project.rs) and holds it to the same
// names in a test of its own.

describe("the languages a novel can be written in", () => {
  it("are exactly the ones both locales can name", () => {
    for (const [locale, ui] of [["en", en], ["es", es]] as const) {
      expect(Object.keys(ui.languages).sort(), locale).toEqual([...NOVEL_LANGUAGES].sort());
    }
  });

  it("are offered by name, in their own words", () => {
    expect(languageOptions("en")).toEqual([
      { value: "en", label: "English" },
      { value: "es", label: "Español" },
    ]);
    expect(isNovelLanguage("es")).toBe(true);
    expect(isNovelLanguage("fr")).toBe(false);
  });

  it("show a code a project holds outside the list, rather than a language it does not have", () => {
    const options = languageOptions("fr");
    expect(options.map((o) => o.value)).toEqual(["en", "es", "fr"]);
    expect(options[2].label).toBe("fr (not offered)");
    // Nothing extra for a blank, which is no language at all.
    expect(languageOptions("")).toHaveLength(NOVEL_LANGUAGES.length);
  });

  it("name a region or a capital of a language on the list by that language", () => {
    // Every export reads `es-MX` as Spanish, so the picker does not call it
    // a language Versorium does not offer.
    expect(languageOptions("es-MX")[2]).toEqual({ value: "es-MX", label: "Español (es-MX)" });
    expect(languageOptions("ES")[2]).toEqual({ value: "ES", label: "Español (ES)" });
    expect(languageOptions("en_GB")[2].label).toBe("English (en_GB)");
    // Not shaped like a tag, it names nothing, whatever it starts with.
    expect(languageOptions("español")[2].label).toBe("español (not offered)");
  });

  it("read a tag the way Rust's language_code does", () => {
    // The cases of `language_code_accepts_supported_tags_only` in
    // src-tauri/src/commands/project.rs.
    for (const [raw, code] of [["es", "es"], ["en", "en"], [" ES-mx ", "es"], ["en_US", "en"], ["es-419", "es"]]) {
      expect(novelLanguageOf(raw), raw).toBe(code);
    }
    for (const raw of ["fr", "", "   ", "español", "spanish", "esp", "-es", "en-", "e"]) {
      expect(novelLanguageOf(raw), raw).toBeNull();
    }
  });
});
