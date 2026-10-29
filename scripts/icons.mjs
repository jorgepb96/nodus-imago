import sharp from "sharp";
import fs from "node:fs/promises";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs><linearGradient id="g" x1="12" y1="10" x2="52" y2="56" gradientUnits="userSpaceOnUse"><stop stop-color="#ddd6fe"/><stop offset=".45" stop-color="#a78bfa"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect x="50" y="50" width="924" height="924" rx="215" fill="#f7f5fe"/><g transform="translate(132 132) scale(11.875)" stroke="url(#g)" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M32 9 52 21 52 43 32 55 12 43 12 21Z"/><path d="m32 9 13 26-26 0 13-26m20 12H25l13 23 14-23M12 21l13 23 13-23H12" stroke-width="2.7"/></g></svg>`;
await fs.mkdir("build", { recursive: true });
await fs.writeFile("build/icon.svg", svg);
await sharp(Buffer.from(svg)).png().toFile("build/icon.png");
