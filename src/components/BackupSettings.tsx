import { useEffect, useState, useCallback } from "react";
import {
  Download,
  Upload,
  FolderOpen,
  ShieldCheck,
  Archive,
  CheckCircle,
  Lock,
} from "lucide-react";
import type { BackupStatus, BackupPreferences } from "../../shared/backups";
import type { Perform } from "./Properties";
import { Button, Modal } from "./ui";
import { useT } from "../i18n";
export function BackupSettings({
  perform,
  onChanged,
  notify,
}: {
  perform: Perform;
  onChanged: () => void;
  notify?: (message: string) => void;
}) {
  const t = useT(),
    [state, setState] = useState<BackupStatus | null>(null),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [pick, setPick] = useState<{ token: string; encrypted: boolean } | null>(
      null,
    ),
    [restorePassword, setRestorePassword] = useState(""),
    [preview, setPreview] = useState<{
      databases: number;
      rows: number;
      files: number;
      createdAt: string;
      legacy: boolean;
    } | null>(null),
    [replace, setReplace] = useState(false),
    [keys, setKeys] = useState(true),
    [message, setMessage] = useState(""),
    [visible, setVisible] = useState(10);
  const [verifyId, setVerifyId] = useState<string | null>(null),
    [verifyPassword, setVerifyPassword] = useState("");
  const load = useCallback(
    async () => setState(await window.imago.call("backupStatus")),
    [],
  );
  useEffect(() => {
    void load();
    const stop = window.imago.onChange(() => void load());
    return stop;
  }, [load]);
  const act = (work: () => Promise<unknown>) =>
    void perform(async () => {
      await work();
      await load();
      onChanged();
    });
  const save = (patch: Partial<BackupPreferences>) =>
    act(() =>
      window.imago.call("backupConfigure", { ...state!.preferences, ...patch }),
    );
  if (!state) return <p>{t("Cargando copias de seguridad…")}</p>;
  const busy = state.busy;
  return (
    <section
      className="stack backup-settings"
      aria-label={t("Copias de seguridad")}
    >
      <h3>{t("Copias de seguridad")}</h3>
      <p>
        {t(
          "Guarda los originales, las bases de datos, los ajustes, las vistas y el historial. Los modelos se descargan por separado.",
        )}
      </p>
      <div className="notice">
        <ShieldCheck />
        <div>
          <strong>{t("Copias verificadas y recuperables")}</strong>
          <p>
            {t(
              "Cada copia se comprueba antes de darse por válida. Las copias cifradas incluyen las claves de API; las copias sin contraseña no las incluyen.",
            )}
          </p>
        </div>
      </div>
      <label>
        {t("Carpeta de copias")}
        <div className="row">
          <input
            readOnly
            value={state.folder}
            placeholder={t("Selecciona una carpeta externa al perfil de Imago")}
          />
          <Button
            disabled={busy}
            onClick={() => act(() => window.imago.call("backupChooseFolder"))}
          >
            <FolderOpen size={16} />
            {t("Elegir carpeta")}
          </Button>
        </div>
      </label>
      <div className="settings-card stack">
        <h4>
          <Lock size={16} /> {t("Contraseña maestra")}
        </h4>
        <p>
          {state.passwordStored
            ? t(
                "Contraseña guardada en el almacén seguro. Las versiones anteriores se conservan para abrir tus copias antiguas.",
              )
            : t(
                "Configura una contraseña para cifrar las copias y activar la programación.",
              )}
        </p>
        <p className="hint">
          {t(
            "Guarda esta contraseña fuera de Imago: la necesitarás para recuperar las copias en otro dispositivo.",
          )}
        </p>
        <label>
          {t("Nueva contraseña")}
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          {t("Confirmar contraseña")}
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <Button
          disabled={
            busy ||
            !state.secureStorageAvailable ||
            password.trim().length < 8 ||
            password !== confirmation
          }
          onClick={() =>
            act(async () => {
              await window.imago.call("backupSetPassword", { password });
              setPassword("");
              setConfirmation("");
              setMessage(t("Contraseña de copias guardada."));
            })
          }
        >
          {t("Guardar contraseña")}
        </Button>
        {!state.secureStorageAvailable && (
          <p role="alert">
            {t(
              "El almacén seguro no está disponible. Introduce y confirma una contraseña para cada copia cifrada manual; la programación requiere el almacén seguro.",
            )}
          </p>
        )}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={state.preferences.enabled}
          disabled={busy}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        {t("Copias automáticas cifradas")}
      </label>
      <p className="hint">
        {t(
          "Se ejecutan con Imago abierto y recuperan la programación pendiente al volver a abrirlo. Puedes elegir una carpeta sincronizada o un disco externo.",
        )}
      </p>
      <div className="row wrap">
        <Button
          disabled={busy}
          onClick={() => save({ schedule: "schedule" })}
          primary={state.preferences.schedule === "schedule"}
        >
          {t("Días y hora")}
        </Button>
        <Button
          disabled={busy}
          onClick={() => save({ schedule: "interval" })}
          primary={state.preferences.schedule === "interval"}
        >
          {t("Cada intervalo")}
        </Button>
      </div>
      {state.preferences.schedule === "interval" ? (
        <label>
          {t("Intervalo en horas")}
          <input
            type="number"
            min={1}
            max={8760}
            value={state.preferences.intervalHours}
            disabled={busy}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= 8760)
                save({ intervalHours: n });
            }}
          />
        </label>
      ) : (
        <div className="stack">
          <div className="row wrap">
            {[
              t("Domingo"),
              t("Lunes"),
              t("Martes"),
              t("Miércoles"),
              t("Jueves"),
              t("Viernes"),
              t("Sábado"),
            ].map((day, index) => (
              <label className="check-label" key={day}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={state.preferences.days.includes(index)}
                  onChange={(e) =>
                    save({
                      days: e.target.checked
                        ? [...state.preferences.days, index]
                        : state.preferences.days.filter((d) => d !== index),
                    })
                  }
                />
                {day}
              </label>
            ))}
          </div>
          <small>{t("Sin días marcados: todos los días.")}</small>
          <label>
            {t("Hora local")}
            <input
              type="time"
              disabled={busy}
              value={`${String(state.preferences.hour).padStart(2, "0")}:${String(state.preferences.minute).padStart(2, "0")}`}
              onChange={(e) => {
                if (e.target.value) {
                  const [hour, minute] = e.target.value.split(":").map(Number);
                  save({ hour, minute });
                }
              }}
            />
          </label>
        </div>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          disabled={busy}
          checked={state.preferences.retentionEnabled}
          onChange={(e) => save({ retentionEnabled: e.target.checked })}
        />
        {t("Archivar copias automáticas antiguas")}
      </label>
      {state.preferences.retentionEnabled && (
        <label>
          {t("Conservar activas las últimas")}
          <input
            type="number"
            min={3}
            max={1000}
            disabled={busy}
            value={state.preferences.keepLast}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 3 && n <= 1000)
                save({ keepLast: n });
            }}
          />
        </label>
      )}
      <p className="hint">
        {t(
          "Se conservan al menos tres copias verificadas antes de archivar. Archivar mueve el archivo a Archivadas-Imago; no lo borra.",
        )}
      </p>
      <div className="row wrap">
        <Button
          disabled={
            busy ||
            (!!(password || confirmation) &&
              (password.trim().length < 8 || password !== confirmation))
          }
          onClick={() =>
            act(async () => {
              const entry = await window.imago.call(
                "backupRun",
                password.trim().length >= 8 && password === confirmation
                  ? { password }
                  : undefined,
              );
              if (entry) {
                setMessage(t("Copia completa creada y verificada."));
                notify?.(t("Copia completa creada y verificada."));
              }
            })
          }
        >
          <Download size={16} />
          {t("Crear copia completa")}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            act(async () => {
              setRestorePassword("");
              setPreview(null);
              setReplace(false);
              setPick(await window.imago.call("backupPickRestore"));
            })
          }
        >
          <Upload size={16} />
          {t("Restaurar copia")}
        </Button>
      </div>
      {busy && (
        <p role="status">{state.phase || t("Operación de copias en curso…")}</p>
      )}
      {state.lastError && (
        <p role="alert" className="danger">
          {state.lastError}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {state.lastSuccess && (
        <p className="hint">
          {t("Última copia verificada")}:{" "}
          {new Date(state.lastSuccess).toLocaleString()}
        </p>
      )}
      <h4>{t("Historial de copias")}</h4>
      {!state.entries.length && (
        <p>{t("Todavía no hay copias registradas.")}</p>
      )}
      {state.entries.slice(0, visible).map((entry) => (
        <article className="settings-card stack" key={entry.id}>
          <strong>
            {new Date(entry.createdAt).toLocaleString()} ·{" "}
            {(entry.bytes / 2 ** 20).toFixed(1)} MiB ·{" "}
            {entry.encrypted ? t("Cifrada") : t("Sin cifrar")}
          </strong>
          <small className="mono">{entry.file}</small>
          <small>
            {!entry.available
              ? t("Archivo no disponible")
              : entry.archived
                ? t("Archivada")
                : t("Verificada al crearla")}
          </small>
          <div className="row wrap">
            <Button
              disabled={busy || !entry.available}
              onClick={() =>
                entry.encrypted
                  ? (setVerifyPassword(""), setVerifyId(entry.id))
                  : act(async () => {
                      await window.imago.call("backupVerify", { id: entry.id });
                      setMessage(t("Integridad de la copia comprobada."));
                    })
              }
            >
              <CheckCircle size={15} />
              {t("Comprobar integridad")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                act(() => window.imago.call("backupReveal", { id: entry.id }))
              }
            >
              <FolderOpen size={15} />
              {t("Mostrar archivo")}
            </Button>
            <Button
              disabled={busy || !entry.available}
              onClick={() =>
                act(() =>
                  window.imago.call("backupArchive", {
                    id: entry.id,
                    archived: !entry.archived,
                  }),
                )
              }
            >
              <Archive size={15} />
              {entry.archived ? t("Recuperar del archivo") : t("Archivar")}
            </Button>
          </div>
        </article>
      ))}
      {state.entries.length > visible && (
        <Button onClick={() => setVisible((n) => n + 10)}>
          {t("Mostrar más copias")}
        </Button>
      )}
      {verifyId && (
        <Modal
          title={t("Comprobar integridad")}
          onClose={() => {
            if (!busy) {
              setVerifyId(null);
              setVerifyPassword("");
            }
          }}
        >
          <div className="stack">
            <label>
              {t("Contraseña original de la copia")}
              <input
                type="password"
                placeholder={t("Dejar vacío para usar el almacén seguro")}
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
              />
            </label>
            <Button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await window.imago.call("backupVerify", {
                    id: verifyId,
                    password: verifyPassword || undefined,
                  });
                  setVerifyId(null);
                  setVerifyPassword("");
                  setMessage(t("Integridad de la copia comprobada."));
                })
              }
            >
              {t("Comprobar integridad")}
            </Button>
          </div>
        </Modal>
      )}
      {pick && (
        <Modal
          title={t("Restaurar copia")}
          onClose={() => {
            if (!busy) setPick(null);
          }}
        >
          <div className="stack">
            {(pick.encrypted || replace) && (
              <label>
                {t("Contraseña original de la copia")}
                <input
                  type="password"
                  autoComplete="off"
                  value={restorePassword}
                  onChange={(e) => {
                    setRestorePassword(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
            )}
            <Button
              disabled={busy || (pick.encrypted && !restorePassword)}
              onClick={() =>
                act(async () =>
                  setPreview(
                    await window.imago.call("backupInspect", {
                      token: pick.token,
                      password: restorePassword || undefined,
                    }),
                  ),
                )
              }
            >
              {t("Comprobar antes de restaurar")}
            </Button>
            {preview && (
              <>
                <p>
                  {preview.databases} {t("bases de datos")} · {preview.rows}{" "}
                  {t("registros")} · {preview.files} {t("originales")}
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={replace}
                    disabled={busy}
                    onChange={(e) => setReplace(e.target.checked)}
                  />
                  {t(
                    "Sustituir la colección actual conservando antes una copia cifrada y verificada",
                  )}
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={keys}
                    disabled={busy || !state.secureStorageAvailable}
                    onChange={(e) => setKeys(e.target.checked)}
                  />
                  {t(
                    "Recuperar las claves de API sin reemplazar las que ya existen",
                  )}
                </label>
                <p className="hint">
                  {t(
                    "Las APIs, automatizaciones y copias automáticas quedan desactivadas al restaurar. Los trabajos se conservan en pausa.",
                  )}
                </p>
                <Button
                  primary
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const result = await window.imago.call("backupRestore", {
                        token: pick.token,
                        password: restorePassword || undefined,
                        replace,
                        restoreCredentials:
                          keys && state.secureStorageAvailable,
                      });
                      if (result) {
                        setPick(null);
                        setRestorePassword("");
                        if (result.warnings.length)
                          setMessage(result.warnings.join(" "));
                        else
                          void window.imago
                            .call("reloadInterface")
                            .catch(() => {});
                      }
                    })
                  }
                >
                  {t("Restaurar datos comprobados")}
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
