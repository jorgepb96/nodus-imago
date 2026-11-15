/**
 * The project's public accounts, shared with Nodus Research
 * (shared/socialLinks.ts there): the What's New window shows them.
 * `label` is a brand name and is not translated.
 */
export interface SocialLink {
  id: "reddit" | "youtube" | "x";
  label: string;
  url: string;
  /** The glyph is the brand's name, so the label is not printed beside it. */
  glyphIsWordmark?: true;
}

export const NODUS_SOCIAL_LINKS: readonly SocialLink[] = [
  { id: "reddit", label: "Reddit", url: "https://www.reddit.com/r/NodusApp/" },
  { id: "youtube", label: "YouTube", url: "https://www.youtube.com/@nodusresearch" },
  { id: "x", label: "X", url: "https://x.com/nodusresearch", glyphIsWordmark: true },
];
