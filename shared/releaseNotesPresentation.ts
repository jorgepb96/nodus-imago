// How release notes are shown and published, as in Nodus Research
// (shared/releaseNotesPresentation.ts): three sections in a fixed order, and
// the GitHub description written from the English text in the window's order.
import type { Language } from "./language";
import type { ReleaseCategory, ReleaseHighlight, ReleaseNote, ReleaseNoteScope } from "./releaseNotes";

export const RELEASE_CATEGORIES: readonly ReleaseCategory[] = ["new", "enhancement", "fix"];
export const RELEASE_SECTION_LABELS: Record<Language, Record<ReleaseCategory, string>> = {
  es: { new: "Funciones nuevas", enhancement: "Mejoras", fix: "Correcciones" },
  en: { new: "New features", enhancement: "Enhancements", fix: "Fixes" },
  fr: { new: "Nouvelles fonctionnalités", enhancement: "Améliorations", fix: "Corrections" },
};
export const RELEASE_EMPTY_SECTION: Record<Language, string> = {
  es: "Sin novedades en esta sección.",
  en: "No changes in this section.",
  fr: "Aucune nouveauté dans cette section.",
};

/** Within a section: largest group of a scope first, ties by first appearance, original order inside. */
export function groupHighlightsByScope<T extends { scope: ReleaseNoteScope }>(highlights: readonly T[]): T[] {
  const groups = new Map<ReleaseNoteScope, T[]>();
  for (const highlight of highlights) {
    const bucket = groups.get(highlight.scope);
    if (bucket) bucket.push(highlight);
    else groups.set(highlight.scope, [highlight]);
  }
  return [...groups.values()]
    .map((items, index) => ({ items, index }))
    .sort((a, b) => b.items.length - a.items.length || a.index - b.index)
    .flatMap((group) => group.items);
}

export function releaseNoteSections(note: ReleaseNote): { category: ReleaseCategory; highlights: ReleaseHighlight[] }[] {
  for (const highlight of note.highlights)
    if (!RELEASE_CATEGORIES.includes(highlight.category)) throw new Error(`Release ${note.version} has an uncategorized highlight: ${highlight.en}`);
  return RELEASE_CATEGORIES.map((category) => ({
    category,
    highlights: groupHighlightsByScope(note.highlights.filter((h) => h.category === category)),
  }));
}

/** The published description uses exactly the window's English text and displayed order. */
export function releaseNoteMarkdown(note: ReleaseNote): string {
  if (!note.highlights.length) throw new Error(`Release ${note.version} is missing highlights`);
  return (
    `# Nodus Imago ${note.version}\n\n` +
    releaseNoteSections(note)
      .map(
        (section) =>
          `## ${RELEASE_SECTION_LABELS.en[section.category]}\n\n` +
          (section.highlights.length
            ? section.highlights
                .map((h) => {
                  if (!h.en.trim()) throw new Error(`Release ${note.version} has an empty English highlight`);
                  return `- ${h.en}`;
                })
                .join("\n\n")
            : RELEASE_EMPTY_SECTION.en),
      )
      .join("\n\n") +
    "\n"
  );
}
