// The local upscaling model in Settings › Local models: the hardware found
// on this computer, the memory profile recommended for it (and the others,
// to choose by hand), and the optional installation, with its progress, a
// pause, and removal after confirmation.
import { useCallback, useEffect, useState } from "react";
import { Cpu, Download, HardDrive, ImageUpscale, MemoryStick, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import type { Job, Settings } from "../../shared/imago";
import {
  PROFILE_HELP,
  PROFILE_LABELS,
  UPSCALE_MODEL_NAME,
  UPSCALE_REPOSITORY,
  expectedSecondsPerTile,
  formatDuration,
  type UpscaleProfile,
  type UpscaleProfileChoice,
  type UpscaleStatus,
} from "../../shared/upscale";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";
import type { Perform } from "./Properties";

const PROFILES: UpscaleProfile[] = ["full", "balanced", "low", "minimum", "cpu"];
const gb = (bytes: number) => (bytes / 1e9).toFixed(1).replace(".", ",");

export function UpscaleModelCard({
  jobs,
  settings,
  perform,
  onChanged,
}: {
  jobs: Job[];
  settings: Settings;
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT();
  const [status, setStatus] = useState<UpscaleStatus | null>(null);
  const [confirm, setConfirm] = useState<"install" | "delete" | null>(null);
  const [detecting, setDetecting] = useState(false);
  const load = useCallback((refresh = false) => window.imago.call("upscaleStatus", { refresh }).then(setStatus).catch(() => {}), []);
  useEffect(() => void load(), [load]);
  const job = status?.preparing ? jobs.find((j) => j.id === status.preparing) : undefined;
  useEffect(() => {
    if (status?.preparing && (!job || ["completed", "failed", "cancelled"].includes(job.state))) void load();
  }, [status?.preparing, job?.state, job, load]);
  if (!status) return null;
  const { hardware: hw, recommendation: rec } = status;
  const installed = status.ready;
  const partly = !installed && (status.installed.model || status.installed.runtime || status.usedBytes > 0);
  const choose = (profile: UpscaleProfileChoice) =>
    void perform(async () => {
      await window.imago.call("updateSettings", { upscale: { ...settings.upscale, profile } });
      await load();
      onChanged();
    });
  // Streaming blocks needs a dedicated GPU (CUDA); 8 bits needs torchao on a GPU.
  const possible = (p: UpscaleProfile) =>
    p === "cpu" || (hw.gpu.kind === "nvidia" ? true : hw.gpu.kind === "apple" ? p === "full" || p === "balanced" : false);
  const gpuLine =
    hw.gpu.kind === "apple"
      ? `${hw.gpu.name} · ${t("GPU integrada, memoria compartida")} (${gb((hw.gpu.vramGB ?? 0) * 1e9)} GB ${t("utilizables")})`
      : hw.gpu.kind === "nvidia"
        ? `${hw.gpu.name} · ${gb((hw.gpu.vramGB ?? 0) * 1e9)} GB VRAM${hw.gpu.freeGB !== null ? ` (${gb(hw.gpu.freeGB * 1e9)} GB ${t("libres")})` : ""}`
        : hw.gpu.kind === "none"
          ? t("Sin GPU compatible")
          : `${hw.gpu.name} · ${t("sin aceleración compatible")}`;
  return (
    <article className="model-card upscale-model-card" data-testid="upscale-model-card">
      <div className="row">
        <div className="model-icon">
          <ImageUpscale size={21} />
        </div>
        <div>
          <h3>{`${UPSCALE_MODEL_NAME} · ${t("Escalado IA")}`}</h3>
          <span className="muted">
            {t("Amplía imágenes ×2 y ×4 en este equipo")} · {t(status.license)}
          </span>
        </div>
        <span className="spacer" />
        <span className={"badge " + (installed ? "safe" : "")}>
          {t(installed ? "Instalado y verificado" : job ? "Instalando…" : partly ? "Instalación incompleta" : "No instalado")}
        </span>
      </div>

      <div className="upscale-hardware" data-testid="upscale-hardware">
        <h4>
          {t("Este equipo")}
          <button
            type="button"
            className="link-button"
            disabled={detecting}
            onClick={() => {
              setDetecting(true);
              void (installed ? window.imago.call("upscaleProbe").then(setStatus) : load(true)).finally(() => setDetecting(false));
            }}
          >
            <RefreshCw size={12} /> {t(detecting ? "Detectando…" : "Detectar de nuevo")}
          </button>
        </h4>
        <ul>
          <li>
            <Cpu size={14} />
            <span>{`${hw.cpu} · ${hw.threads} ${t("hilos")} · ${hw.platform === "darwin" ? "macOS" : hw.platform === "win32" ? "Windows" : "Linux"} ${hw.arch}`}</span>
          </li>
          <li>
            <MemoryStick size={14} />
            <span>
              {`${gb(hw.ramGB * 1e9)} GB RAM`}
              {hw.availableGB !== null ? ` · ${gb(hw.availableGB * 1e9)} GB ${t("disponibles ahora")}` : ""}
            </span>
          </li>
          <li>
            <ImageUpscale size={14} />
            <span>{gpuLine}</span>
          </li>
        </ul>
        <p className={`upscale-recommendation ${rec.supported ? "" : "is-unsupported"}`}>
          {rec.supported ? (
            <>
              {t("Perfil recomendado")}: <strong>{t(PROFILE_LABELS[rec.profile])}</strong> · {t(rec.reason)}
            </>
          ) : (
            t(rec.reason)
          )}
        </p>
        {rec.warnings.map((w) => (
          <p key={w} className="upscale-warning">
            {t(w)}
          </p>
        ))}
      </div>

      <fieldset className="upscale-profiles" disabled={!rec.supported && hw.platform === "darwin" && hw.arch !== "arm64"}>
        <legend>{t("Perfil de memoria")}</legend>
        <label className={status.choice === "auto" ? "is-selected" : ""}>
          <input type="radio" name="upscale-profile" checked={status.choice === "auto"} onChange={() => choose("auto")} />
          <span>
            <strong>
              {t("Automático")} <em>{`${t("ahora")}: ${t(PROFILE_LABELS[rec.profile])}`}</em>
            </strong>
            <small>{t("Elige el perfil según la memoria de este equipo cada vez que se detecta.")}</small>
          </span>
        </label>
        {PROFILES.filter(possible).map((p) => {
          const measured = status.measured[p];
          return (
            <label key={p} className={status.choice === p ? "is-selected" : ""}>
              <input type="radio" name="upscale-profile" checked={status.choice === p} onChange={() => choose(p)} />
              <span>
                <strong>
                  {t(PROFILE_LABELS[p])}
                  {p === rec.profile && <em className="upscale-recommended">{t("recomendado")}</em>}
                </strong>
                <small>
                  {t(PROFILE_HELP[p])}{" "}
                  {measured
                    ? t("Medido aquí: {s} por tesela de 1024 px.").replace("{s}", formatDuration(measured))
                    : t("Estimado: {s} por tesela de 1024 px.").replace("{s}", formatDuration(expectedSecondsPerTile(hw, p)))}
                </small>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="model-details">
        <span>
          <HardDrive size={12} /> {t("Espacio necesario")}: ~{gb(status.diskBytes)} GB ({t("pesos del modelo y entorno Python")})
        </span>
        {status.usedBytes > 0 && (
          <span>
            {t("Ocupa ahora")}: {gb(status.usedBytes)} GB
          </span>
        )}
        <span>{UPSCALE_REPOSITORY}</span>
        <span className="mono">{status.revision.slice(0, 12)}</span>
      </div>

      {job && (
        <div className="upscale-install-progress" data-testid="upscale-install-progress">
          <span className="upscale-bar">
            <i style={{ width: `${Math.round((job.done / Math.max(1, job.total)) * 100)}%` }} />
          </span>
          <small>
            {`${job.done}/${job.total} · `}
            {job.state === "paused" ? t("En pausa") : job.state === "failed" ? t("Error") : (job.message ?? t("En cola"))}
          </small>
        </div>
      )}

      <div className="row wrap">
        {!installed && !job && (
          <Button primary disabled={!rec.supported && status.choice === "auto"} onClick={() => setConfirm("install")} data-testid="upscale-install-button">
            <Download size={14} />
            {t(partly ? "Completar la instalación" : "Instalar")}
          </Button>
        )}
        {job && ["queued", "running"].includes(job.state) && (
          <Button onClick={() => void perform(async () => window.imago.call("controlJob", { id: job.id, action: "pause" }))}>
            <Pause size={14} />
            {t("Pausar")}
          </Button>
        )}
        {job && ["paused", "failed"].includes(job.state) && (
          <Button primary onClick={() => void perform(async () => window.imago.call("controlJob", { id: job.id, action: "resume" }))}>
            <Play size={14} />
            {t("Reanudar")}
          </Button>
        )}
        {(installed || partly) && (
          <Button onClick={() => setConfirm("delete")} data-testid="upscale-delete-button">
            <Trash2 size={14} />
            {t("Eliminar")}
          </Button>
        )}
      </div>

      {confirm === "install" && (
        <Modal icon={Download} title={t("Instalar el escalado local")} onClose={() => setConfirm(null)}>
          <div className="modal-body">
            <p>
              {t("Se descargarán los pesos de {m} ({gb} GB, revisión fija y verificada con SHA-256) y un entorno Python con PyTorch preparado para este equipo.")
                .replace("{m}", UPSCALE_MODEL_NAME)
                .replace("{gb}", gb(status.diskBytes))}
            </p>
            <p className="hint">
              {t("Origen: Hugging Face (pesos), PyPI y PyTorch (paquetes) y GitHub (uv y Python). Licencias: MIT para el modelo, Apache-2.0 para su VAE (de FLUX.1-schnell). La descarga puede pausarse y reanudarse desde la cola.")}
            </p>
          </div>
          <footer>
            <Button onClick={() => setConfirm(null)}>{t("Cancelar")}</Button>
            <Button
              primary
              data-testid="upscale-install-confirm"
              onClick={() =>
                void perform(async () => {
                  setConfirm(null);
                  await window.imago.call("upscaleInstall");
                  await load();
                  onChanged();
                })
              }
            >
              <Download size={14} />
              {t("Instalar")}
            </Button>
          </footer>
        </Modal>
      )}
      {confirm === "delete" && (
        <Modal icon={Trash2} title={t("Eliminar el escalado local")} onClose={() => setConfirm(null)}>
          <div className="modal-body">
            <p>
              {t("Se eliminarán los pesos del modelo y su entorno Python ({gb} GB). Las versiones ampliadas que ya has creado se conservan. Podrás instalarlo de nuevo.").replace(
                "{gb}",
                gb(status.usedBytes),
              )}
            </p>
          </div>
          <footer>
            <Button onClick={() => setConfirm(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              data-testid="upscale-delete-confirm"
              onClick={() =>
                void perform(async () => {
                  setConfirm(null);
                  await window.imago.call("upscaleUninstall");
                  await load();
                  onChanged();
                })
              }
            >
              <Trash2 size={14} />
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
    </article>
  );
}
