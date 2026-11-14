import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { UpdateStatus, UpdatePreferences } from "../../shared/updates";
import type { Perform } from "./Properties";
import { Button } from "./ui";
import { useT } from "../i18n";
import { updateStatusMessage } from "./UpdateBanner";
export function UpdateSettings({ perform }: { perform: Perform }) {
  const t = useT(),
    [state, setState] = useState<UpdateStatus | null>(null);
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const load = useCallback(
    async () => setState(await window.imago.call("updateStatus")),
    [],
  );
  useEffect(() => {
    void load();
    return window.imago.onChange(() => void load());
  }, [load]);
  const action = (work: () => Promise<unknown>) =>
    void perform(async () => {
      await work();
      await load();
    });
  const configure = (patch: Partial<UpdatePreferences>) =>
    action(() =>
      window.imago.call("updateConfigure", { ...state!.preferences, ...patch }),
    );
  if (!state) return null;
  const busy = ["checking", "downloading", "backing-up", "installing"].includes(
    state.status,
  );
  return (
    <section className="settings-section stack">
      <h2>{t("Actualizaciones y novedades")}</h2>
      <p>
        {t("Versión instalada")}: {state.currentVersion}
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          disabled={busy}
          checked={state.preferences.automaticChecks}
          onChange={(e) => configure({ automaticChecks: e.target.checked })}
        />
        {t("Buscar actualizaciones automáticamente")}
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          disabled={busy}
          checked={state.preferences.autoDownload}
          onChange={(e) => configure({ autoDownload: e.target.checked })}
        />
        {t("Descargar automáticamente las versiones compatibles")}
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          disabled={
            state.status === "installing" || state.status === "backing-up"
          }
          checked={state.preferences.beta}
          onChange={(e) => configure({ beta: e.target.checked })}
        />
        {t("Recibir versiones beta")}
      </label>
      <p className="hint">
        {t(
          "Las versiones estables son el canal predeterminado. No se instalan versiones anteriores ni se instala una actualización por el simple hecho de cerrar Imago.",
        )}
      </p>
      <div role="status">{updateStatusMessage(state, t)}</div>
      {state.backupWarning && (
        <p className="hint">
          {t("La copia previa no pudo completarse:")} {state.backupWarning}
        </p>
      )}
      {state.progress !== null && <progress value={state.progress} max={100} />}
      <div className="row wrap">
        <Button
          disabled={busy || state.status === "disabled"}
          onClick={() => action(() => window.imago.call("updateCheck"))}
        >
          <RefreshCw size={16} />
          {t("Comprobar actualizaciones")}
        </Button>
        {state.status === "available" && (
          <Button
            onClick={() => action(() => window.imago.call("updateDownload"))}
          >
            <Download size={16} />
            {t("Descargar actualización")}
          </Button>
        )}
        {state.status === "downloaded" && (
          <>
            <label>
              {t(
                "Contraseña de la copia previa (opcional si ya está guardada)",
              )}
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {t("Confirmar contraseña")}
              <input
                type="password"
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <Button
              primary
              disabled={
                !!(password || confirmation) &&
                (password.trim().length < 8 || password !== confirmation)
              }
              onClick={() =>
                action(() =>
                  window.imago.call(
                    "updateInstall",
                    password ? { password } : undefined,
                  ),
                )
              }
            >
              {t("Instalar y reiniciar")}
            </Button>
          </>
        )}
      </div>
      <p className="hint">
        {t(
          "Antes de instalar se pausan los trabajos. Si las copias de seguridad están configuradas (Almacenamiento y copias), se crea antes una copia cifrada y verificada; para una beta es obligatoria.",
        )}
      </p>
    </section>
  );
}
