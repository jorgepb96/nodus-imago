import lightIcon from "../../build/icon.png";
import darkIcon from "../../build/icon-dark.png";

let lastMode: boolean | null = null;

/**
 * The macOS Dock follows the resolved app theme.
 * The renderer rasterises the approved light/dark artwork at 512 px and gives
 * the main process a PNG data URL, so no native SVG rasteriser is needed.
 */
export async function applyAppIcon(dark: boolean) {
  if (!window.imago?.setAppIcon) return;
  // Nodus updates the macOS Dock icon; Windows/Linux keep the packaged icon.
  if (!navigator.platform.toLowerCase().includes("mac")) return;
  if (lastMode === dark) return;
  const image = new Image();
  image.src = dark ? darkIcon : lightIcon;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(image, 0, 0, 512, 512);
  await window.imago.setAppIcon(canvas.toDataURL("image/png"));
  lastMode = dark;
}
