import { useEffect, useState } from "react";
import { Cpu, ShieldCheck, Download, RefreshCw } from "lucide-react";
import type { ModelPreparation as Plan } from "../../shared/modelPreparation";
import type { Status } from "../../shared/imago";
import { ONNX_ID, HARRIER_ID, LEGACY_EMBEDDING_ID } from "../../shared/embeddingBackends";
import { Button, Spinner, Modal } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";
import type { Perform } from "./Properties";
import { useT } from "../i18n";

export function ModelPreparation({ status, perform, onChanged }: { status: Status; perform: Perform; onChanged: () => void }) {
  const t = useT(), [plan, setPlan] = useState<Plan | null>(null), [consent, setConsent] = useState(false), [error, setError] = useState("");
  const [license, setLicense] = useState<{ label: string; text: string; source: string } | null>(null);
  const signature = JSON.stringify([status.settings.embeddingModel, status.settings.dimensions, status.models.map(m => [m.id, m.verified, m.bytes]), status.jobs.map(j => [j.id, j.state, j.done])]);
  useEffect(() => {
    let disposed = false;
    void window.imago.call("modelPreparation").then(value => { if (!disposed) { setPlan(value); setError(""); } }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [signature]);
  const jobs = status.jobs.filter(j => j.kind === "prepare" && ["queued", "running", "paused", "failed"].includes(j.state));
  return <section className="settings-section model-preparation" aria-label={t("Preparar búsqueda local")}>
    <div className="settings-section-header"><Cpu size={22}/><div><h3>{t("Búsqueda local sin Python")}</h3><p>{t("Elige el modelo y prepara sus dependencias. La búsqueda literal funciona sin descargar nada.")}</p></div></div>
    <CriteriaSelect label={t("Modelo de embeddings")} values={[status.settings.embeddingModel]} options={[
      { value: ONNX_ID, label: "EmbeddingGemma 2 · ONNX Q8", disabled: status.platform === "darwin x64", description: t("Texto e imagen · CPU integrado") },
      { value: HARRIER_ID, label: "Harrier OSS v1 0.6B Q8_0", description: t("1024 dimensiones · imágenes mediante descripciones locales de LFM3") },
      { value: LEGACY_EMBEDDING_ID, label: t("Compatibilidad PyTorch (experimental)"), description: t("Requiere Python instalado por separado") },
    ]} onChange={values => { setConsent(false); void perform(async () => { await window.imago.call("updateSettings", { embeddingModel: values[0] }); onChanged(); }); }}/>
    {error && <p role="alert">{error}</p>}
    {!plan ? <Spinner/> : <>
      <p>{t("Runtime")}: {plan.runtime === "onnx-cpu" ? "ONNX Runtime 1.30.0 · CPU" : plan.runtime === "llama-cpu" ? "llama.cpp · CPU" : t("Python externo · experimental")} · {plan.activeDimensions} {t("dimensiones")}</p>
      {plan.embeddingModel === HARRIER_ID && <p className="notice">{t("Harrier procesa texto. Para buscar imágenes, LFM3 genera descripciones locales que se indexan con un contrato independiente. Necesita más memoria y tiempo; no es equivalente al embedding visual de EmbeddingGemma.")}</p>}
      {plan.runtime === "python-experimental" && <p className="notice">{t("Este modo conserva los índices antiguos y necesita el entorno Python opcional. No forma parte de la preparación sin Python.")}</p>}
      {!!plan.priorVectors && <p className="notice">{plan.priorVectors} {t("vectores pertenecen a otro contrato. Se conservan, pero no se mezclan con el índice activo. Vuelve a indexar para usar este modelo.")}</p>}
      <ul className="preparation-dependencies">{plan.requirements.map(model => <li key={model.id}><div><strong>{model.label}</strong><small>{model.license} · {model.estimatedGB.toFixed(3)} GB · {model.repository} · {model.revision.slice(0, 12)}</small></div><span>{model.verified ? <ShieldCheck size={19}/> : <Download size={19}/>}</span><Button onClick={() => void perform(async () => { setLicense(await window.imago.call("modelLicense", { id: model.id })); })}>{t("Licencia y procedencia")}</Button></li>)}</ul>
      <p>{t("Descarga pendiente")}: {(plan.remainingBytes / 1e6).toFixed(1)} MB · {t("Espacio libre")}: {(plan.freeBytes / 1e9).toFixed(1)} GB</p>
      <p className="muted">{t("Destino")}: <span className="mono">{plan.destination}</span></p>
      {plan.ready ? <div><p className="notice preparation-ready" role="status"><ShieldCheck size={18}/> {t("Listo para indexar")}</p><Button primary disabled={!status.images || status.jobs.some(j => j.kind === "index" && ["queued", "running"].includes(j.state))} onClick={() => void perform(async () => { await window.imago.call("indexImages", {}); onChanged(); })}>{t("Indexar imágenes")}</Button></div> : <>
        <label className="check-label"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/>{t("He revisado las licencias y autorizo estas descargas al destino indicado.")}</label>
        <Button primary disabled={!consent || !plan.supported || plan.runtime === "python-experimental" || plan.freeBytes < plan.remainingBytes + 64 * 2 ** 20 || jobs.some(j => ["queued", "running"].includes(j.state))} onClick={() => void perform(async () => { await window.imago.call("prepareModels", { consent: true }); onChanged(); })}><Download size={15}/>{t("Preparar búsqueda semántica")}</Button>
        {plan.freeBytes < plan.remainingBytes + 64 * 2 ** 20 && <p role="alert">{t("No hay espacio suficiente para preparar el modelo.")}</p>}
      </>}
      {jobs.map(job => <article className="job" key={job.id}><strong>{job.label}</strong><progress value={job.done} max={job.total || 1}/><p>{job.message} · {job.done}/{job.total}</p><div className="row">{(["running", "queued"].includes(job.state) ? ["pause", "cancel"] : ["resume", "cancel"]).map(action => <Button key={action} onClick={() => void perform(async () => { await window.imago.call("controlJob", { id: job.id, action: action as "pause" | "resume" | "cancel" }); onChanged(); })}>{t(action === "pause" ? "Pausar" : action === "resume" ? "Reanudar" : "Cancelar")}</Button>)}</div></article>)}
    </>}
    {license && <Modal title={license.label} wide onClose={() => setLicense(null)}><div className="modal-body"><p className="muted">{license.source}</p><pre className="license-text">{license.text}</pre></div></Modal>}
  </section>;
}
