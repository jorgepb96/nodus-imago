"""Nodus Imago local inference, JSON-lines over stdin/stdout. No listener or server.
Data-only models, built-in architectures, offline file loading, no remote code.
"""
import os
os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", DO_NOT_TRACK="1", TOKENIZERS_PARALLELISM="false")
import sys
import json
import gc
import socket
import contextlib

def deny_network(*args, **kwargs):
    raise RuntimeError("Nodus Imago inference has no network access")

socket.create_connection = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
loaded = None
loaded_key = None
processor = None

def load(request):
    global loaded, loaded_key, processor
    key = (request["directory"], request["task"], request["device"])
    if key == loaded_key:
        return loaded
    loaded = None
    processor = None
    loaded_key = None
    gc.collect()
    import torch
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if hasattr(torch, "mps") and torch.backends.mps.is_available():
        torch.mps.empty_cache()
    torch.set_num_threads(max(1, min(int(request.get("threads", 2)), 8)))
    directory = request["directory"]
    if not os.path.isabs(directory) or not os.path.isfile(os.path.join(directory, "verified.json")):
        raise ValueError("Model has not passed integrity verification")
    if request["device"] not in ("cpu", "cuda", "mps"):
        raise ValueError("Unsupported device")
    # FP32 is deliberate: EmbeddingGemma 2 does not support FP16.
    if request["task"] == "embedding":
        from sentence_transformers import SentenceTransformer
        with open(os.path.join(directory, "modules.json"), encoding="utf-8") as handle:
            modules = json.load(handle)
        # Sentence Transformers 6.2 moved these classes (base.modules /
        # sentence_transformer.modules); older revisions used
        # sentence_transformers.models.*. Accept only the three data-only
        # modules Imago needs, by package prefix and class name. This keeps the
        # local runtime from loading arbitrary custom modules or remote code.
        allowed = {"Transformer", "Pooling", "Normalize"}
        def supported(module_type):
            if not isinstance(module_type, str):
                return False
            parts = module_type.split(".")
            return parts[0] == "sentence_transformers" and len(parts) > 1 and parts[-1] in allowed
        if any(not supported(module.get("type")) for module in modules):
            raise ValueError("Unsupported sentence-transformer module")
        loaded = SentenceTransformer(directory, device=request["device"], local_files_only=True,
                                     trust_remote_code=False, config_kwargs={"audio_config": None},
                                     model_kwargs={"torch_dtype": torch.float32})
    else:
        from transformers import AutoProcessor, SmolVLMForConditionalGeneration
        processor = AutoProcessor.from_pretrained(directory, local_files_only=True, trust_remote_code=False)
        loaded = SmolVLMForConditionalGeneration.from_pretrained(directory, local_files_only=True,
                    trust_remote_code=False, torch_dtype=torch.float32, use_safetensors=True).to(request["device"])
        loaded.eval()
    loaded_key = key
    return loaded

def run(request):
    if request.get("operation") == "probe":
        import torch, torchvision, transformers, sentence_transformers, PIL
        return {"torch": torch.__version__, "torchvision": torchvision.__version__, "transformers": transformers.__version__, "sentence_transformers": sentence_transformers.__version__, "pillow": PIL.__version__}
    model = load(request)
    if request["task"] == "embedding":
        from PIL import Image
        inputs = []
        for item in request["inputs"]:
            if item.get("image"):
                # PIL decoding prevents a model processor interpreting input as a URL.
                inputs.append({"image": Image.open(item["image"]).convert("RGB")})
            else:
                text = item.get("text", "")
                if len(text) > 24000:
                    raise ValueError("Text query exceeds the local input budget")
                prefix = "task: search result | query: " if item.get("role") == "query" else "title: none | text: "
                inputs.append(prefix + text)
        dimensions = request["dimensions"]
        if dimensions not in (256, 512, 768):
            raise ValueError("Invalid embedding dimension")
        return model.encode(inputs, batch_size=1, truncate_dim=dimensions, normalize_embeddings=True,
                            show_progress_bar=False, processing_kwargs={"image": {"max_soft_tokens": 280}}).tolist()
    import torch
    from PIL import Image
    messages = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": request["prompt"]}]}]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(text=prompt, images=[Image.open(request["image"]).convert("RGB")], return_tensors="pt").to(request["device"])
    with torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=384, do_sample=False)
    return processor.batch_decode(output[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)[0].strip()

for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request["id"]
        with contextlib.redirect_stdout(sys.stderr):
            result = run(request)
        print(json.dumps({"id": request_id, "ok": True, "result": result}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"id": request_id, "ok": False, "error": str(error)}, ensure_ascii=False), flush=True)
