// The interface languages. Spanish is the source every text is written in;
// English and French are translations (src/i18n.tsx, src/i18n.fr.ts).
export const LANGUAGES = ["es", "en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

/** A stored or reported language, falling back to Spanish. */
export const asLanguage = (value: unknown): Language =>
  LANGUAGES.includes(value as Language) ? (value as Language) : "es";

/** The name of each language, written in that language. */
export const LANGUAGE_NAMES: Record<Language, string> = { es: "Español", en: "English", fr: "Français" };

/** The locale used for numbers and dates in each language. */
export const LANGUAGE_LOCALES: Record<Language, string> = { es: "es-ES", en: "en-GB", fr: "fr-FR" };

/** Wikipedia's language edition for each interface language. */
export const wikipediaHost = (language: Language) => `https://${language}.wikipedia.org`;
