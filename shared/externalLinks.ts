/** The renderer never navigates to external documents or passes arbitrary schemes. */
export function externalHttpsUrl(value: string): string | null {
  try {
    if (value.length > 4000 || /[\x00-\x20\x7f]/.test(value.trim()))
      return null;
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname
      ? url.href
      : null;
  } catch {
    return null;
  }
}
