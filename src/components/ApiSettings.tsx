import { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  ShieldCheck,
  Download,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { PROVIDERS, type ApiProvider } from "../../shared/aiConfig";
import type { Settings, Status } from "../../shared/imago";
import { Button } from "./ui";
import { ModelPicker } from "./ModelPicker";
import type { Perform } from "./Properties";
import { useT } from "../i18n";
export function ApiSettings({
  status,
  perform,
  onChanged,
}: {
  status: Status;
  perform: Perform;
  onChanged: () => void;
}) {
  const t = useT(),
    [provider, setProvider] = useState<ApiProvider>("openrouter"),
    [key, setKey] = useState(""),
    [base, setBase] = useState(""),
    [modelText, setModelText] = useState(""),
    [keys, setKeys] = useState<{
      encryptionAvailable: boolean;
      providers: Record<string, boolean>;
    } | null>(null),
    [catalog, setCatalog] = useState<string[]>([]);
  const s = status.settings;
  const refreshKeys = useCallback(
    () =>
      void perform(async () =>
        setKeys(await window.imago.call("credentialsStatus")),
      ),
    [perform],
  );
  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);
  const profileSignature = JSON.stringify(s.apiProfiles[provider] ?? null);
  useEffect(() => {
    setBase(s.apiProfiles[provider]?.baseUrl ?? PROVIDERS[provider].baseUrl);
    setModelText(s.apiProfiles[provider]?.models.join("\n") ?? "");
    setKey("");
    setCatalog([]);
    // profileSignature is the serialised provider profile used for comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, profileSignature]);
  const update = (patch: Partial<Settings>) =>
    void perform(async () => {
      await window.imago.call("updateSettings", patch);
      onChanged();
    });
  const save = async () => {
    const models = [
      ...new Set(
        modelText
          .split(/\n/)
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ];
    await window.imago.call("updateSettings", {
      apiProfiles: { ...s.apiProfiles, [provider]: { baseUrl: base, models } },
    });
    onChanged();
  };
  return (
    <div className="settings-section">
      <div className="settings-card-heading">
        <span>
          <KeyRound size={21} />
        </span>
        <div>
          <h2>{t("Proveedores de IA y modelos")}</h2>
<p>{t("Las claves y los modelos configurados se comparten entre las bases de datos de Imago.")}</p>
        </div>
      </div>
      <div className="provider-favorites">
        <span>{t("Modelos configurados")}</span>
        <div>
          {Object.entries(s.apiProfiles).flatMap(([provider, profile]) =>
            (profile?.models ?? []).map((model) => (
              <span className="provider-model-chip" key={provider + model}>
                ★ {PROVIDERS[provider as ApiProvider].label} · {model}
              </span>
            )),
          )}
          {!Object.values(s.apiProfiles).some((p) => p?.models.length) && (
<small className="muted">{t("Añade tus modelos a los proveedores de abajo.")}</small>
          )}
        </div>
      </div>
      <label className="setting-row">
        <span>
          <strong>{t("Permitir APIs remotas")}</strong>
<p className="hint">{t("Solo se envían datos cuando encolas una tarea con un modelo de API o eliges embeddings por API para indexar y buscar.")}</p>
        </span>
        <input
          aria-label={t("Permitir APIs remotas")}
          type="checkbox"
          checked={s.remoteEnabled}
          onChange={(e) => update({ remoteEnabled: e.target.checked })}
        />
      </label>
      <div className="notice">
        <ShieldCheck size={18} />
        <div>
          <strong>
            {keys?.encryptionAvailable
              ? t("Claves cifradas con el almacén del sistema")
              : t("Almacén seguro no disponible")}
          </strong>
          <p>
            {t("Las claves nunca se muestran de nuevo ni se guardan en las bases de datos, copias o registros. Imago mantiene sus propias credenciales, independientes de Nodus.")}
          </p>
        </div>
      </div>
      <div className="provider-list">
        {Object.entries(PROVIDERS).map(([id, p]) => (
          <details
            key={id}
            open={provider === id}
            className={keys?.providers[id] ? "configured" : ""}
            onToggle={(e) => {
              if (e.currentTarget.open && provider !== id)
                setProvider(id as ApiProvider);
            }}
          >
            <summary>
              <ChevronRight size={13} />
              <strong>{p.label}</strong>
              <span
                className={
                  "provider-key-state " + (keys?.providers[id] ? "saved" : "")
                }
              >
                {keys?.providers[id]
                  ? t("● clave guardada")
                  : id === "ollama" || id === "lmstudio"
                    ? t("(local)")
                    : t("○ sin clave")}
              </span>
              {(id === "ollama" || id === "lmstudio") && (
                <code>{p.baseUrl}</code>
              )}
            </summary>
            {provider === id && (
              <div className="provider-details">
                <label>
                  {t("Endpoint")}
                  <input
                    value={base}
                    onChange={(e) => setBase(e.target.value)}
                    placeholder={PROVIDERS[provider].baseUrl}
                  />
                </label>
                <label>
                  {t("Clave de API")}
                  <div className="row">
                    <KeyRound size={16} />
                    <input
                      style={{ flex: 1 }}
                      autoComplete="off"
                      type="password"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={
                        keys?.providers[provider]
                          ? t("Clave guardada · escribe para sustituirla")
                          : t("Clave del proveedor")
                      }
                    />
                    <Button
                      disabled={!key || !keys?.encryptionAvailable}
                      onClick={() =>
                        void perform(async () => {
                          await window.imago.call("setApiKey", {
                            provider,
                            key,
                          });
                          setKey("");
                          refreshKeys();
                        })
                      }
                    >
                      {t("Guardar clave")}
                    </Button>
                    {keys?.providers[provider] && (
                      <Button
                        icon
                        aria-label={t("Eliminar clave")}
                        onClick={() =>
                          void perform(async () => {
                            await window.imago.call("clearApiKey", {
                              provider,
                            });
                            refreshKeys();
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    )}
                  </div>
                </label>
                <label>
                  {t("Modelos de visión · uno por línea")}
                  <textarea
                    rows={4}
                    value={modelText}
                    onChange={(e) => setModelText(e.target.value)}
                    placeholder={t("Identificador exacto del modelo")}
                  />
                </label>
                <div className="row">
                  <Button primary onClick={() => void perform(save)}>
                    {t("Guardar proveedor")}
                  </Button>
                  <Button
                    onClick={() =>
                      void perform(async () => {
                        await save();
                        setCatalog(
                          await window.imago.call("listProviderModels", {
                            provider,
                          }),
                        );
                      })
                    }
                  >
                    <Download size={14} />
                    {t("Consultar modelos")}
                  </Button>
                </div>
                {!!catalog.length && (
                  <label>
                    {t("Catálogo")}
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value)
                          setModelText(
                            [
                              ...new Set([
                                ...modelText.split("\n").filter(Boolean),
                                e.target.value,
                              ]),
                            ].join("\n"),
                          );
                      }}
                    >
                      <option value="">{t("Añadir un modelo de visión…")}</option>
                      {catalog.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="hint">{t("El catálogo puede incluir modelos sin visión. Comprueba que el elegido admite imágenes.")}</span>
                  </label>
                )}
              </div>
            )}
          </details>
        ))}
      </div>
      <label className="setting-row">
        <strong>{t("Intervalo mínimo entre solicitudes")}</strong>
        <div className="row">
          <input
            aria-label={t("Intervalo API")}
            type="number"
            min={0}
            max={60000}
            step={250}
            value={s.apiDelayMs}
            onChange={(e) => update({ apiDelayMs: Number(e.target.value) })}
          />
          ms
        </div>
      </label>
      <p className="hint">{t("Los trabajos comparten el intervalo de cada proveedor. Las respuestas de límite temporal se reintentan con espera; los errores de acceso detienen la tarea para poder corregirlos y reanudarla.")}</p>
    </div>
  );
}
