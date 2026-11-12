// Nodus EmbeddingGemma worker contract extended with the official vision encoder.
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import { prepareEmbeddingGemma2Input, reduceEmbeddingGemma2 } from "../../shared/embeddingGemma2";

let configuration: { directory: string; threads: number } | undefined;
// The inference process is file-only. Downloads belong to the model manager.
const offline = () => { throw new Error("La inferencia local no puede acceder a la red."); };
net.Socket.prototype.connect = offline as typeof net.Socket.prototype.connect;
tls.connect = offline as typeof tls.connect;
globalThis.fetch = (async () => offline()) as typeof fetch;
let runtime: Promise<{ processor: any; model: any; RawImage: any }> | undefined;
async function load() {
  return runtime ??= (async () => {
    if (!configuration) throw new Error("Falta configuración del proceso ONNX.");
    const { env, AutoConfig, AutoModel, AutoProcessor, RawImage } = await import("@nodus/embeddinggemma-transformers");
    env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false; env.cacheDir = configuration.directory;
    const options = { local_files_only: true };
    const config: any = await AutoConfig.from_pretrained(configuration.directory, options);
    config.audio_config = null;
    const processor: any = await AutoProcessor.from_pretrained(configuration.directory, options);
    const model: any = await AutoModel.from_pretrained(configuration.directory, { ...options, config, device: "cpu", dtype: "q8", session_options: { intraOpNumThreads: configuration.threads, interOpNumThreads: 1 } });
    return { processor, model, RawImage };
  })();
}
let chain = Promise.resolve();
process.on("message", (request: any) => {
  if (request.operation === "init") {
    if (!configuration && typeof request.directory === "string" && path.isAbsolute(request.directory) && Number.isInteger(request.threads) && request.threads >= 1 && request.threads <= 4) configuration = { directory: request.directory, threads: request.threads };
    return;
  }
  chain = chain.then(async () => {
    try {
      const { processor, model, RawImage } = await load();
      const results: number[][] = [];
      for (const item of request.inputs as { text?: string; image?: string; role?: string }[]) {
        const text = item.image ? null : prepareEmbeddingGemma2Input(item.text ?? "", item.role === "query" ? "query" : "document");
        const image = item.image ? await RawImage.read(item.image) : null;
        const inputs = await processor(text, image ? [image] : null, null, null, { padding: true, truncation: false });
        if (inputs.input_ids.dims.at(-1) > 8192) throw new Error("La entrada supera los 8192 tokens; reduce su longitud.");
        const { sentence_embedding } = await model(inputs);
        results.push(...reduceEmbeddingGemma2(sentence_embedding.tolist(), 1, request.dimensions));
      }
      process.send!({ id: request.id, ok: true, result: results });
    } catch (error) { process.send!({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
});
