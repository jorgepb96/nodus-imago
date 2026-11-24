"""Run one detector over a sample of Imago previews and save its boxes as JSON.

Usage (inside the evaluation venv, see README.md):
  python -I run.py <model> <sample.txt> <thumbnails-dir> <out.json> [--coarse] [--limit N]

<model>: gdino | owl | florence | mirage
<sample.txt>: one line per image, "group|content_hash" (the group is only a label
for the report). Images are read from <thumbnails-dir>/<content_hash>-preview.webp,
the preview Imago keeps in its collection folder.
Boxes are saved on a 0–1000 scale relative to the image.
"""
import json, statistics, sys, time

FINE = {
    "Personas": ["person", "child", "priest", "nun", "soldier"],
    "Animales": ["donkey", "horse", "ox", "sheep", "goat", "dog", "bird"],
    "Transportes": ["cart", "car", "truck", "bus", "train", "bicycle", "boat"],
    "Religión": ["cross", "religious statue", "church", "bell tower"],
    "Agricultura": ["wheat sheaf", "haystack", "plough", "basket"],
    "Arquitectura": ["castle", "tower", "bridge", "house", "arch", "fountain", "windmill"],
    "Industria": ["electricity pylon", "factory chimney", "barrel"],
    "Vestimenta": ["hat"],
    "Textos": ["sign"],
}
# General terms: Grounding DINO labels these reliably (see docs/VISUAL-DETECTION.md).
COARSE = {
    "Personas": ["person"], "Animales": ["animal"], "Transportes": ["vehicle", "cart", "boat"],
    "Religión": ["religious statue", "cross"], "Arquitectura": ["church", "tower", "bridge", "house"],
    "Industria": ["electricity pylon", "barrel"],
}


def norm(box, w, h):
    x0, y0, x1, y1 = [float(v) for v in box]
    return [round(x0 * 1000 / w), round(y0 * 1000 / h), round(x1 * 1000 / w), round(y1 * 1000 / h)]


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0


def nms(dets, threshold=0.5):
    """Keeps the best box of each label where boxes of that label overlap."""
    kept = []
    for d in sorted(dets, key=lambda d: -d["score"]):
        if all(d["name"] != k["name"] or iou(d["bbox"], k["bbox"]) < threshold for k in kept):
            kept.append(d)
    return kept


class GroundingDino:
    def __init__(self, terms):
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
        self.terms = terms
        self.processor = AutoProcessor.from_pretrained("IDEA-Research/grounding-dino-base")
        self.model = AutoModelForZeroShotObjectDetection.from_pretrained("IDEA-Research/grounding-dino-base").eval()

    def __call__(self, image):
        # All terms in one prompt: one forward pass per image (well under the 256-token limit).
        inputs = self.processor(images=image, text=". ".join(self.terms) + ".", return_tensors="pt")
        outputs = self.model(**inputs)
        result = self.processor.post_process_grounded_object_detection(
            outputs, inputs.input_ids, threshold=0.3, text_threshold=0.25, target_sizes=[image.size[::-1]])[0]
        dets = []
        for box, score, label in zip(result["boxes"], result["scores"], result["text_labels"]):
            label = label.strip()
            name = label if label in self.terms else next((t for t in self.terms if t in label), None)
            if name:
                dets.append({"name": name, "bbox": norm(box, *image.size), "score": round(float(score), 3)})
        return nms(dets)


class Owlv2:
    def __init__(self, terms):
        from transformers import Owlv2ForObjectDetection, Owlv2Processor
        self.terms = terms
        self.processor = Owlv2Processor.from_pretrained("google/owlv2-base-patch16-ensemble")
        self.model = Owlv2ForObjectDetection.from_pretrained("google/owlv2-base-patch16-ensemble").eval()

    def __call__(self, image):
        import torch
        inputs = self.processor(text=[[f"a photo of a {t}" for t in self.terms]], images=image, return_tensors="pt")
        outputs = self.model(**inputs)
        side = max(image.size)  # OWLv2 pads the image to a square
        result = self.processor.post_process_grounded_object_detection(
            outputs=outputs, threshold=0.2, target_sizes=torch.tensor([[side, side]]))[0]
        return nms([{"name": self.terms[int(l)], "bbox": norm(b, *image.size), "score": round(float(s), 3)}
                    for b, s, l in zip(result["boxes"], result["scores"], result["labels"])])


class Florence:
    """Free detection (<OD>): the model names what it sees; no scores."""
    def __init__(self, _terms):
        from transformers import AutoProcessor, Florence2ForConditionalGeneration
        self.processor = AutoProcessor.from_pretrained("florence-community/Florence-2-large")
        self.model = Florence2ForConditionalGeneration.from_pretrained("florence-community/Florence-2-large").eval()

    def __call__(self, image):
        inputs = self.processor(text="<OD>", images=image, return_tensors="pt")
        ids = self.model.generate(**inputs, max_new_tokens=512, num_beams=1, do_sample=False)
        text = self.processor.batch_decode(ids, skip_special_tokens=False)[0]
        result = self.processor.post_process_generation(text, task="<OD>", image_size=image.size)["<OD>"]
        return [{"name": l, "bbox": norm(b, *image.size), "score": None} for b, l in zip(result["bboxes"], result["labels"])]


class Mirage:
    """Free detection: names come from its own language model (0–1000 boxes already)."""
    def __init__(self, _terms):
        from cactus import Mirage as Model
        self.model = Model()

    def __call__(self, image):
        result = self.model.describe(image, sections=["objects"], fields=["bbox", "score"])
        return [{"name": o["name"], "bbox": o["bbox"], "score": o.get("score")} for o in result.get("objects", [])]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 4:
        sys.exit(__doc__)
    model, sample, thumbs, out = args[:4]
    vocab = COARSE if "--coarse" in sys.argv else FINE
    terms = [t for ts in vocab.values() for t in ts]
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    import torch
    from PIL import Image
    torch.set_grad_enabled(False)
    started = time.perf_counter()
    detector = {"gdino": GroundingDino, "owl": Owlv2, "florence": Florence, "mirage": Mirage}[model](terms)
    load = time.perf_counter() - started
    rows = [line.strip().split("|") for line in open(sample, encoding="utf-8") if line.strip()][:limit]
    results, times = [], []
    for group, content_hash in rows:
        image = Image.open(f"{thumbs}/{content_hash}-preview.webp").convert("RGB")
        t = time.perf_counter()
        boxes = detector(image)
        times.append(time.perf_counter() - t)
        results.append({"group": group, "hash": content_hash, "boxes": boxes})
    json.dump({"model": model, "vocabulary": vocab if model in ("gdino", "owl") else None, "results": results},
              open(out, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"{model}: load {load:.1f} s · {len(times)} images · mean {statistics.mean(times):.2f} s · "
          f"median {statistics.median(times):.2f} s · max {max(times):.2f} s · {torch.get_num_threads()} threads")


if __name__ == "__main__":
    main()
