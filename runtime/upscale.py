"""Nodus Imago local upscaling (Kandinsky ImageSR 2.0), JSON lines over stdin/stdout.

No listener, no server and no network: the weights are read from a verified
folder, and the pipeline is built from its two parts (transformer and VAE)
with the vendored, data-only code in ./kandinsky_image_sr. Memory profiles
follow the Pinokio launcher by ThomasEricB (MIT): the same model can run on a
large GPU, a small one (weights streamed block by block or quantised to int8)
or the processor; Apple Silicon shares one memory for both.

Requests: {"id", "operation": "probe"} or {"id", "operation": "upscale", ...}.
While upscaling, {"id", "progress": {"done", "total"}} lines are written; a
run stops between tiles when its cancel file appears.
"""
import os
os.environ.update(HF_HUB_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", DO_NOT_TRACK="1",
                  PYTORCH_ENABLE_MPS_FALLBACK="1", TOKENIZERS_PARALLELISM="false")
import sys
import json
import gc
import time
import socket
import logging
import warnings
import contextlib

def deny_network(*args, **kwargs):
    raise RuntimeError("Nodus Imago upscaling has no network access")

socket.create_connection = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
warnings.filterwarnings("ignore")
logging.getLogger("torch.utils._pytree").setLevel(logging.ERROR)
logging.getLogger("diffusers.quantizers.torchao.torchao_quantizer").setLevel(logging.ERROR)

GB = 1024 ** 3
# weights: bf16 or int8; offload: transformer blocks streamed from system RAM
# to the GPU one at a time; vae_tiling: the VAE decodes 512 px pieces.
PROFILES = {
    "full": {"quant": "none", "offload": False, "vae_tiling": False},
    "balanced": {"quant": "int8", "offload": False, "vae_tiling": False},
    "low": {"quant": "none", "offload": True, "vae_tiling": False},
    "minimum": {"quant": "none", "offload": True, "vae_tiling": True},
    "cpu": {"quant": "none", "offload": False, "vae_tiling": False},
}
state = {"pipe": None, "key": None, "info": None}


class Cancelled(Exception):
    pass


def emit(message):
    sys.__stdout__.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.__stdout__.flush()


def pick_device(torch, preference):
    if preference not in ("auto", "cuda", "mps", "cpu"):
        raise ValueError("Unsupported device")
    if preference != "auto":
        return torch.device(preference)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def probe():
    import platform
    import torch
    info = {"torch": torch.__version__, "python": platform.python_version(), "machine": platform.machine(),
            "threads": os.cpu_count() or 1, "cuda": None, "mps": None, "int8": False}
    try:
        import diffusers
        info["diffusers"] = diffusers.__version__
    except Exception:
        info["diffusers"] = None
    if torch.cuda.is_available():
        free, total = torch.cuda.mem_get_info(0)
        major, minor = torch.cuda.get_device_capability(0)
        info["cuda"] = {"name": torch.cuda.get_device_name(0), "freeBytes": free, "totalBytes": total,
                        "capability": f"{major}.{minor}", "rocm": bool(torch.version.hip),
                        "version": torch.version.hip or torch.version.cuda}
    if torch.backends.mps.is_available():
        info["mps"] = {"recommendedBytes": int(torch.mps.recommended_max_memory())}
    try:
        import torchao  # noqa: F401
        info["int8"] = True
    except Exception:
        pass
    return info


def bake_modulation(torch, pipe, device):
    """Each block's fp32 modulation MLP only ever sees the 19 baked time embeddings: its
    outputs are precomputed, which is bit-identical and frees about 2.4 GB (after Pinokio's
    Kandinsky ImageSR 2.0 Studio, MIT)."""
    class Lookup(torch.nn.Module):
        def __init__(self, inputs, outputs):
            super().__init__()
            self.register_buffer("inputs", inputs.detach().clone().float(), persistent=False)
            self.register_buffer("outputs", outputs, persistent=False)

        def forward(self, time_embed):
            match = (time_embed.float()[:, None, :] == self.inputs[None]).all(dim=-1)
            if not bool(match.any(dim=1).all()):
                raise RuntimeError("time embedding is not one of the baked rows")
            return self.outputs.index_select(0, match.float().argmax(dim=1))

    transformer = pipe.transformer
    table = transformer.time_embed_table
    with torch.no_grad():
        for block in transformer.visual_transformer_blocks:
            modulation = block.visual_modulation.to(device)
            outputs = torch.cat([modulation(row.to(device)) for row in table.split(1)])
            block.visual_modulation = Lookup(table, outputs.detach().cpu())
            del modulation, outputs
    gc.collect()


def quantizable(module, fqn):
    import torch
    return isinstance(module, torch.nn.Linear) and fqn.startswith("visual_transformer_blocks.") and "modulation" not in fqn


def enable_vae_tiling(vae):
    vae.enable_tiling()
    for name, value in (("tile_sample_min_size", 512), ("tile_sample_min_height", 512), ("tile_sample_min_width", 512),
                        ("tile_latent_min_size", 64), ("tile_latent_min_height", 64), ("tile_latent_min_width", 64)):
        if hasattr(vae, name):
            setattr(vae, name, value)


def empty_cache(torch):
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def load(request):
    import torch
    directory = request["directory"]
    if not os.path.isabs(directory) or not os.path.isfile(os.path.join(directory, "verified.json")):
        raise ValueError("Model has not passed integrity verification")
    device = pick_device(torch, request.get("device", "auto"))
    profile = request.get("profile", "full")
    if profile not in PROFILES:
        raise ValueError("Unknown memory profile")
    if device.type == "cpu":
        profile = "cpu"
    key = (directory, device.type, profile)
    if state["key"] == key:
        return state["pipe"], state["info"]
    state["pipe"] = state["key"] = state["info"] = None
    empty_cache(torch)
    torch.set_num_threads(max(1, min(int(request.get("threads", os.cpu_count() or 4)), 64)))
    recipe = dict(PROFILES[profile])
    if device.type not in ("cuda",):
        recipe["offload"] = False  # unified memory (MPS) or the processor: nothing to stream to
    if device.type == "mps":
        # Measured on an M2: decoding a 1024 px tile whole peaks at 7-12 GB of shared
        # memory; in 512 px pieces 2.4 GB, about 1.5 s slower and visually identical (41 dB).
        recipe["vae_tiling"] = True
    if device.type == "cuda" and not torch.version.hip and torch.cuda.get_device_capability(device)[0] < 8:
        dtype = torch.float16  # no bf16 tensor cores before Ampere; the VAE stays fp32 below
    else:
        dtype = torch.bfloat16
    started = time.perf_counter()
    from diffusers import AutoencoderKL
    from kandinsky_image_sr import KandinskyImageSRBakedTransformer3DModel, KandinskyImageSRPipeline
    with open(os.path.join(directory, "model_index.json"), encoding="utf-8") as handle:
        config = json.load(handle)
    transformer = KandinskyImageSRBakedTransformer3DModel.from_pretrained(
        os.path.join(directory, "transformer"), torch_dtype=dtype, local_files_only=True, use_safetensors=True)
    vae = AutoencoderKL.from_pretrained(os.path.join(directory, "vae"), torch_dtype=dtype, local_files_only=True,
                                        use_safetensors=True)
    keys = ("upscale_factors", "one_step_t_by_factor", "tile_size", "overlap", "text_sequence_length", "scale_factor")
    pipe = KandinskyImageSRPipeline(transformer=transformer, vae=vae, **{k: config[k] for k in keys if k in config})
    if dtype != torch.bfloat16 or device.type == "cpu":
        pipe.vae.to(torch.float32)  # fp16 overflows in the FLUX VAE; fp32 is also faster on the processor
    notes = []
    try:
        bake_modulation(torch, pipe, device)
    except Exception as error:  # keep the original modules
        notes.append(f"modulation not baked: {error}")
    if recipe["quant"] == "int8":
        from torchao.quantization import Int8WeightOnlyConfig, quantize_
        # Block by block: the bf16 weights never sit on the device all at once
        # (on a 16 GB Mac that alone would push the system into swap).
        for block in pipe.transformer.visual_transformer_blocks:
            block.to(device)
            quantize_(block, Int8WeightOnlyConfig(),
                      filter_fn=lambda module, fqn: quantizable(module, "visual_transformer_blocks.0." + fqn))
            empty_cache(torch)
    if recipe["offload"]:
        pipe.transformer.enable_group_offload(onload_device=device, offload_device=torch.device("cpu"),
                                              offload_type="block_level", num_blocks_per_group=1, use_stream=True)
        pipe.vae.to(device)
    else:
        pipe.to(device)
    if recipe["vae_tiling"]:
        enable_vae_tiling(pipe.vae)
    empty_cache(torch)
    info = {"device": device.type, "profile": profile, "dtype": str(dtype).removeprefix("torch."),
            "quant": recipe["quant"], "offload": recipe["offload"], "vaeTiling": recipe["vae_tiling"],
            "loadSeconds": round(time.perf_counter() - started, 2), "notes": notes}
    state.update(pipe=pipe, key=key, info=info)
    return pipe, info


def peak_bytes(torch, device):
    if device == "cuda":
        return int(torch.cuda.max_memory_allocated())
    if device == "mps":
        return int(torch.mps.driver_allocated_memory())
    return None


def upscale(request):
    import torch
    from PIL import Image
    from kandinsky_image_sr.image_processor import to_srgb
    scale = int(request["scale"])
    creativity = int(request.get("creativity", 0))
    if scale not in (2, 4) or not 0 <= creativity <= 8:
        raise ValueError("Invalid upscale parameters")
    for key in ("input", "output"):
        if not os.path.isabs(request[key]):
            raise ValueError("Paths must be absolute")
    pipe, info = load(request)
    cancel = request.get("cancel")
    if info["device"] == "cuda":
        torch.cuda.reset_peak_memory_stats()
    with Image.open(request["input"]) as opened:
        image = to_srgb(opened)
    from kandinsky_image_sr.tiling import tile_positions
    lq_tile = int(pipe.config.tile_size) // scale
    stride = max(1, int(lq_tile * (1.0 - float(pipe.config.overlap))))
    total = len(tile_positions(max(image.height, lq_tile), lq_tile, stride)) * len(
        tile_positions(max(image.width, lq_tile), lq_tile, stride))
    done = [0]
    original = type(pipe)._infer_tiles

    def counted(pixels, *args, **kwargs):
        if cancel and os.path.exists(cancel):
            raise Cancelled("cancelled")
        out = original(pipe, pixels, *args, **kwargs)
        done[0] += int(pixels.shape[0])
        emit({"id": request["id"], "progress": {"done": done[0], "total": total}})
        return out

    pipe._infer_tiles = counted
    emit({"id": request["id"], "progress": {"done": 0, "total": total}})
    started = time.perf_counter()
    try:
        result = pipe(image, upscale_factor=scale, creativity=creativity,
                      tile_batch_size=max(1, int(request.get("tileBatch", 1)))).images[0]
    except torch.OutOfMemoryError as error:
        empty_cache(torch)
        raise RuntimeError("out of memory") from error
    finally:
        del pipe._infer_tiles
    seconds = time.perf_counter() - started
    peak = peak_bytes(torch, info["device"])
    result.save(request["output"], format="PNG", compress_level=4)
    del result, image
    empty_cache(torch)
    return {**info, "width": image_size(request["output"])[0], "height": image_size(request["output"])[1],
            "seconds": round(seconds, 2), "tiles": total, "peakBytes": peak, "creativity": creativity, "scale": scale}


def image_size(path):
    from PIL import Image
    with Image.open(path) as opened:
        return opened.size


def run(request):
    operation = request.get("operation")
    if operation == "probe":
        return probe()
    if operation == "upscale":
        return upscale(request)
    if operation == "unload":
        state["pipe"] = state["key"] = state["info"] = None
        import torch
        empty_cache(torch)
        return True
    raise ValueError("Unknown operation")


for line in sys.stdin:
    request_id = None
    try:
        request = json.loads(line)
        request_id = request["id"]
        with contextlib.redirect_stdout(sys.stderr):
            result = run(request)
        emit({"id": request_id, "ok": True, "result": result})
    except Cancelled:
        emit({"id": request_id, "ok": False, "error": "cancelled", "cancelled": True})
    except Exception as error:
        emit({"id": request_id, "ok": False, "error": f"{type(error).__name__}: {error}"})
