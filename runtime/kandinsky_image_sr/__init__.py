# Vendored from https://github.com/kandinskylab/kandinsky-image-sr (commit 6c24057), MIT License,
# Copyright (c) 2026 kandinskylab. See LICENSE in this folder.
# Imago builds the pipeline from its parts (see runtime/upscale.py), so the Hub
# loading registration of the original package is not needed here.
from kandinsky_image_sr.baked_transformer import KandinskyImageSRBakedTransformer3DModel
from kandinsky_image_sr.pipeline import KandinskyImageSROutput, KandinskyImageSRPipeline

__all__ = ["KandinskyImageSRBakedTransformer3DModel", "KandinskyImageSROutput", "KandinskyImageSRPipeline"]
__version__ = "1.0.0"
