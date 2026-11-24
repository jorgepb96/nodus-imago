"""Draw a run's boxes on its images, six per contact sheet, for visual review.

Usage: python -I draw.py <out.json from run.py> <thumbnails-dir> <sheets-dir>
The sheets contain collection images: keep them outside the repository.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

COLORS = ["#ff3b30", "#34c759", "#0a84ff", "#ff9f0a", "#bf5af2", "#64d2ff", "#ffd60a", "#ff375f"]


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    run, thumbs, outdir = sys.argv[1:4]
    os.makedirs(outdir, exist_ok=True)
    data = json.load(open(run, encoding="utf-8"))
    try:
        font = ImageFont.truetype("Arial Bold.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    tiles = []
    for i, entry in enumerate(data["results"]):
        image = Image.open(f"{thumbs}/{entry['hash']}-preview.webp").convert("RGB")
        scale = 560 / max(image.size)
        image = image.resize((round(image.width * scale), round(image.height * scale)))
        draw = ImageDraw.Draw(image)
        names = sorted({b["name"] for b in entry["boxes"]})
        for b in entry["boxes"]:
            x0, y0, x1, y1 = b["bbox"]
            color = COLORS[names.index(b["name"]) % len(COLORS)]
            box = [x0 * image.width / 1000, y0 * image.height / 1000, x1 * image.width / 1000, y1 * image.height / 1000]
            draw.rectangle(box, outline=color, width=3)
            label = b["name"] if b.get("score") is None else f"{b['name']} {b['score']:.2f}"
            text_box = draw.textbbox((box[0] + 2, box[1] + 1), label, font=font)
            draw.rectangle(text_box, fill=color)
            draw.text((box[0] + 2, box[1] + 1), label, fill="black", font=font)
        tile = Image.new("RGB", (580, 600), "white")
        tile.paste(image, ((580 - image.width) // 2, 30))
        ImageDraw.Draw(tile).text((8, 6), f"#{i + 1} · {entry['group']}", fill="black", font=font)
        tiles.append(tile)
    for k in range(0, len(tiles), 6):
        sheet = Image.new("RGB", (580 * 3, 600 * 2), "white")
        for j, tile in enumerate(tiles[k:k + 6]):
            sheet.paste(tile, ((j % 3) * 580, (j // 3) * 600))
        sheet.save(os.path.join(outdir, f"{data['model']}-{k // 6 + 1:02d}.jpg"), quality=85)


if __name__ == "__main__":
    main()
