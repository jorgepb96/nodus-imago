// Reused from Nodus shared/imageAnalysis.ts, AGPL-3.0-only.
export interface VisionImagePart {
  base64: string;
  mediaType: string;
}

/** OpenAI-compatible user content: a text part + one image_url part per image. */
export function openAiVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
  ];
}

/** Anthropic native user content: a text block + one image block per image. */
export function anthropicVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
  ];
}
