// Top-of-window update notice, matching Nodus Research's UpdateReadyNotice:
// the startup check shows its progress, a downloaded release offers
// "Install and restart" or "Later", and installation states stay visible.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import type { UpdateStatus } from "../../shared/updates";
import { Button } from "./ui";
import { useT } from "../i18n";

const SESSION_KEY = "imago.startupUpdateChecked";

function firstCheckThisSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== "1";
  } catch {
    return true;
  }
}

/** The sentence for a state, in the interface language (main sends Spanish). */
export function updateStatusMessage(
  update: UpdateStatus,
  t: (s: string) => string,
): string {
  const version = update.version ?? "";
  switch (update.status) {
    case "checking":
      return t("Buscando actualizaciones…");
    case "available":
      return `${t("Actualización encontrada")} · ${version}. ${t("La descarga empezará automáticamente.")}`;
    case "downloading":
      return `${t("Descargando actualización…")} ${Math.round(update.progress ?? 0)}%`;
    case "downloaded":
      if (update.errorCode === "pre-update-backup-required")
        return t(
          "Configura las copias de seguridad antes de instalar una beta. La actualización sigue descargada y tus datos no se han modificado.",
        );
      if (update.errorCode === "pre-update-backup-failed")
        return t(
          "La beta no se instaló porque no pudo crearse y verificarse la copia previa. Tus datos no se han modificado.",
        );
      if (update.errorCode === "update-install-failed")
        return t("No se pudo instalar la actualización. Puedes volver a intentarlo.");
      return `${t("Actualización lista")} · ${version}. ${t("Puedes instalarla y reiniciar cuando quieras.")}`;
    case "backing-up":
      return t("Creando y verificando una copia de seguridad antes de actualizar…");
    case "installing":
      return `${t("Instalando Nodus Imago")} ${version} ${t("y reiniciando…")}`;
    case "not-available":
      return `Nodus Imago ${update.currentVersion} ${t("ya está actualizado.")}`;
    case "disabled":
      return t("Las actualizaciones solo están disponibles en la aplicación empaquetada.");
    case "error":
      if (update.errorCode === "update-download-failed")
        return t("No se pudo descargar la actualización. Comprueba tu conexión y vuelve a intentarlo.");
      if (update.errorCode === "update-install-failed")
        return t("No se pudo instalar la actualización. Puedes volver a intentarlo.");
      return t("No se pudo comprobar si hay actualizaciones.");
    default:
      return update.message;
  }
}

const busy = (u: UpdateStatus | null) =>
  u?.status === "backing-up" || u?.status === "installing";

export function UpdateBanner({
  onRecovery,
  onError,
}: {
  onRecovery: () => void;
  onError: (message: string) => void;
}) {
  const t = useT(),
    [update, setUpdate] = useState<UpdateStatus | null>(null),
    [startup, setStartup] = useState(false),
    [deferred, setDeferred] = useState<string | null>(null),
    [requesting, setRequesting] = useState(false),
    started = useRef(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      window.imago
        .call("updateStatus")
        .then((state) => {
          if (!alive) return state;
          setUpdate(state);
          if (
            ["not-available", "disabled", "downloaded"].includes(state.status) ||
            busy(state)
          )
            setStartup(false);
          return state;
        })
        .catch(() => null);
    void load().then((state) => {
      // One visible check per session, as in Nodus; periodic ones stay quiet.
      if (
        !alive ||
        started.current ||
        !state ||
        state.status === "disabled" ||
        !state.preferences.automaticChecks ||
        !firstCheckThisSession()
      )
        return;
      started.current = true;
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        /* Storage may be unavailable. */
      }
      setStartup(true);
      void window.imago
        .call("updateCheck")
        .then(() => load())
        .catch(() => setStartup(false));
    });
    const unsubscribe = window.imago.onChange(() => void load());
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  // A startup error is shown briefly, then the window is left alone.
  useEffect(() => {
    if (!startup || update?.status !== "error") return;
    const timer = window.setTimeout(() => setStartup(false), 5000);
    return () => window.clearTimeout(timer);
  }, [startup, update?.status]);
  if (!update) return null;
  const ready = update.status === "downloaded",
    key = ready ? `${update.version}${update.errorCode ?? ""}` : null,
    needsRecovery =
      update.errorCode === "pre-update-backup-required" ||
      update.errorCode === "pre-update-backup-failed",
    working = requesting || busy(update),
    visible = working || startup || (key !== null && deferred !== key);
  if (!visible) return null;
  const downloading =
      update.status === "downloading" || update.status === "available",
    progress = Math.round(Math.max(0, Math.min(100, update.progress ?? 0))),
    failed = update.status === "error" || !!update.errorCode;
  const install = async () => {
    if (working) return;
    setRequesting(true);
    try {
      await window.imago.call("updateInstall");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setRequesting(false);
    }
  };
  return (
    <aside
      className={"update-banner" + (failed ? " failed" : "")}
      aria-label={t("Actualizaciones")}
      data-update-status={update.status}
    >
      {failed ? (
        <AlertTriangle size={16} />
      ) : update.status === "checking" || working ? (
        <RefreshCw size={16} className="spin" />
      ) : (
        <Download size={16} />
      )}
      <div className="update-banner-text">
        <p role="status">{updateStatusMessage(update, t)}</p>
        {downloading && (
          <div
            className="update-banner-progress"
            role="progressbar"
            aria-label={t("Progreso")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      {needsRecovery && (
        <Button onClick={onRecovery}>{t("Configurar copias")}</Button>
      )}
      {ready && (
        <Button primary disabled={working} onClick={() => void install()}>
          {t("Instalar y reiniciar")}
        </Button>
      )}
      {ready && !working && (
        <Button onClick={() => setDeferred(key)}>{t("Más tarde")}</Button>
      )}
    </aside>
  );
}
