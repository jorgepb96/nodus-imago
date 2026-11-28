// AI providers and models, as Nodus configures them: one row per provider
// with its key (saved encrypted, never shown again), its catalogue loaded on
// demand and searchable, and a star on each model. Starred models are the
// favourites every model selector offers; they are kept in each provider's
// profile (`apiProfiles[provider].models`), so the selectors read them as
// before. Imago keeps its own keys, apart from Nodus's.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { KeyRound, ShieldCheck, Star, X } from "lucide-react";
import { PROVIDERS, remoteProvider, type ApiProvider, type ProviderModel } from "../../shared/aiConfig";
import { EMBEDDING_API_PROVIDERS } from "../../shared/embeddingApi";
import { IMAGE_API, SUGGESTED_IMAGE_MODELS } from "../../shared/restoration";
import { KNOWN_EDIT_MODELS, UPSCALE_SERVICES, UPSCALE_SERVICE_IDS, type UpscaleService } from "../../shared/upscaleApi";
import type { Settings, Status } from "../../shared/imago";
import { ServiceKey } from "./UpscaleApi";
import { Button } from "./ui";
import type { Perform } from "./Properties";
import { useT } from "../i18n";

type Keys = { encryptionAvailable: boolean; providers: Record<string, boolean> };
type ModelRef = { provider: ApiProvider; model: string };
const LOCAL: ApiProvider[] = ["ollama", "lmstudio"];
/** Providers whose endpoint is the user's: a local server or a compatible gateway. */
const OWN_ENDPOINT: ApiProvider[] = ["ollama", "lmstudio", "custom"];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const refKey = (m: ModelRef) => `${m.provider}::${m.model}`;
type ProviderId = ApiProvider | UpscaleService;
const PROVIDER_ORDER: ProviderId[] = [
  ...(Object.keys(PROVIDERS) as ApiProvider[]).filter((provider) => !OWN_ENDPOINT.includes(provider)),
  ...UPSCALE_SERVICE_IDS,
  ...OWN_ENDPOINT,
];
const isUpscaleService = (provider: ProviderId): provider is UpscaleService =>
  Object.hasOwn(UPSCALE_SERVICES, provider);


const CAPABILITY_LABELS = {
  chat: "Chat",
  automations: "Automatizaciones",
  vision: "Análisis de imágenes",
  search: "Búsqueda semántica",
  restore: "Restauración IA",
  colorize: "Colorización IA",
  upscale: "Escalado IA",
} as const;
type Capability = keyof typeof CAPABILITY_LABELS;
const VISION_PROVIDERS: ApiProvider[] = ["anthropic", "openai", "openrouter", "gemini", "groq", "ollama", "lmstudio", "custom"];
const REMOTE_BLOCKED = "Las APIs remotas están desactivadas. Activa «Permitir APIs remotas» para introducir claves y consultar modelos.";

function modelCapabilities(provider: ApiProvider, models: ProviderModel[] | null): Capability[] {
  const capabilities: Capability[] = ["chat", "automations"];
  if (VISION_PROVIDERS.includes(provider) || models?.some((model) => model.vision)) capabilities.push("vision");
  if (EMBEDDING_API_PROVIDERS.some((supported) => supported === provider)) capabilities.push("search");
  if (SUGGESTED_IMAGE_MODELS[provider] || (IMAGE_API[provider] && models?.some((model) => model.imageOutput)))
    capabilities.push("restore", "colorize");
  return capabilities;
}

function serviceCapabilities(service: UpscaleService): Capability[] {
  const capabilities: Capability[] = [];
  for (const task of ["restore", "colorize"] as const)
    if (KNOWN_EDIT_MODELS.some((model) => model.service === service && model.task === task)) capabilities.push(task);
  capabilities.push("upscale");
  return capabilities;
}

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
    s = status.settings,
    [open, setOpen] = useState<ProviderId | null>(null),
    [keys, setKeys] = useState<Keys | null>(null),
    [serviceKeys, setServiceKeys] = useState<Record<UpscaleService, boolean> | null>(null);
  const refreshKeys = useCallback(
    () => void perform(async () => setKeys(await window.imago.call("credentialsStatus"))),
    [perform],
  );
  useEffect(() => {
    refreshKeys();
  }, [refreshKeys]);
  useEffect(() => {
    void window.imago.call("upscaleServicesStatus").then(setServiceKeys).catch(() => {});
  }, []);
  const toggleProvider = (provider: ProviderId) => setOpen((current) => current === provider ? null : provider);
  const update = (patch: Partial<Settings>) =>
    void perform(async () => {
      await window.imago.call("updateSettings", patch);
      onChanged();
    });
  const favorites: ModelRef[] = Object.entries(s.apiProfiles).flatMap(([provider, profile]) =>
    (profile?.models ?? []).map((model) => ({ provider: provider as ApiProvider, model })),
  );
  const isFav = (m: ModelRef) => !!s.apiProfiles[m.provider]?.models.includes(m.model);
  const saveProfile = async (provider: ApiProvider, patch: { baseUrl?: string; models?: string[] }) => {
    const profile = s.apiProfiles[provider];
    await window.imago.call("updateSettings", {
      apiProfiles: {
        ...s.apiProfiles,
        [provider]: {
          baseUrl: patch.baseUrl ?? profile?.baseUrl ?? PROVIDERS[provider].baseUrl,
          models: patch.models ?? profile?.models ?? [],
        },
      },
    });
    onChanged();
  };
  const toggleFav = (m: ModelRef) =>
    perform(async () => {
      const models = s.apiProfiles[m.provider]?.models ?? [];
      await saveProfile(m.provider, {
        models: models.includes(m.model) ? models.filter((x) => x !== m.model) : [...models, m.model],
      });
    });
  return (
    <div className="settings-section">
      <div className="settings-card-heading">
        <span>
          <KeyRound size={21} />
        </span>
        <div>
          <h2>{t("Proveedores de IA y modelos")}</h2>
          <p>{t("Las claves de API y los modelos configurados se comparten entre todas las bases de datos de Imago.")}</p>
        </div>
      </div>
      <FavoriteModels favorites={favorites} toggleFav={toggleFav} />
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
          <strong>{keys?.encryptionAvailable ? t("Claves cifradas con el almacén del sistema") : t("Almacén seguro no disponible")}</strong>
          <p>
            {t("Las claves nunca se muestran de nuevo ni se guardan en las bases de datos, copias o registros. Imago mantiene sus propias credenciales, independientes de Nodus.")}
          </p>
        </div>
      </div>
      <p className="hint">{t("Las funciones disponibles dependen del modelo elegido.")}</p>
      <div className="provider-list">
        {PROVIDER_ORDER.map((provider) => isUpscaleService(provider) ? (
          <ProviderAccordion
            key={provider}
            provider={provider}
            label={UPSCALE_SERVICES[provider].label}
            hasKey={!!serviceKeys?.[provider]}
            capabilities={serviceCapabilities(provider)}
            expanded={open === provider}
            onToggle={() => toggleProvider(provider)}
          >
            {!s.remoteEnabled && (
              <p className="provider-blocked" data-testid={`provider-blocked-${provider}`}>{t(REMOTE_BLOCKED)}</p>
            )}
            <ServiceKey
              service={provider}
              saved={!!serviceKeys?.[provider]}
              onChanged={setServiceKeys}
              disabled={!s.remoteEnabled || !keys?.encryptionAvailable}
              inSettings
            />
          </ProviderAccordion>
        ) : (
          <ProviderRow
            key={provider}
            provider={provider}
            settings={s}
            keys={keys}
            expanded={open === provider}
            onToggle={() => toggleProvider(provider)}
            onKeysChanged={refreshKeys}
            saveProfile={saveProfile}
            isFav={isFav}
            toggleFav={toggleFav}
          />
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

/**
 * The favourites, as chips that can be removed, and a check of each against
 * its provider's catalogue: one that no longer appears is marked, since its
 * availability is no longer confirmed (it may still work as an alias).
 */
function FavoriteModels({ favorites, toggleFav }: { favorites: ModelRef[]; toggleFav: (m: ModelRef) => Promise<void> }) {
  const t = useT();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ signature: string; stale: string[]; unreadable: ApiProvider[] } | null>(null);
  const signature = favorites.map(refKey).sort().join("\n");
  const result = checked?.signature === signature ? checked : null;
  const check = async () => {
    setChecking(true);
    const providers = [...new Set(favorites.map((m) => m.provider))];
    const catalogues = await Promise.all(
      providers.map(async (provider) => {
        try {
          return [provider, new Set((await window.imago.call("listProviderModels", { provider })).map((m) => m.id))] as const;
        } catch {
          return [provider, null] as const;
        }
      }),
    );
    const read = new Map(catalogues);
    setChecked({
      signature,
      unreadable: catalogues.filter(([, ids]) => !ids).map(([provider]) => provider),
      stale: favorites.filter((m) => read.get(m.provider) && !read.get(m.provider)!.has(m.model)).map(refKey),
    });
    setChecking(false);
  };
  return (
    <div className="provider-favorites">
      <div className="provider-favorites-head">
        <span>{t("Modelos favoritos para los selectores independientes")}</span>
        {favorites.length > 0 && (
          <Button onClick={() => void check()} disabled={checking} data-testid="check-favorite-availability">
            {checking ? t("Comprobando…") : t("Comprobar catálogo")}
          </Button>
        )}
      </div>
      {favorites.length ? (
        <div className="provider-favorite-chips">
          {favorites.map((m) => {
            const stale = !!result?.stale.includes(refKey(m));
            return (
              <span
                key={refKey(m)}
                className={`provider-favorite-chip${stale ? " is-stale" : ""}`}
                data-tooltip={stale ? t("{provider} no incluye este modelo en su catálogo; su disponibilidad no está confirmada.").replace("{provider}", t(PROVIDERS[m.provider].label)) : undefined}
              >
                <Star size={12} fill="currentColor" />
                <span>
                  {t(PROVIDERS[m.provider].label)} · {m.model}
                </span>
                <button type="button" aria-label={t("Quitar de favoritos")} data-tooltip={t("Quitar de favoritos")} onClick={() => void toggleFav(m)}>
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="hint">{t("Carga los modelos de un proveedor y márcalos con la estrella: aparecerán en los selectores de modelo.")}</p>
      )}
      {result && (
        <div className="provider-favorites-check" data-testid="stale-favorites">
          {result.unreadable.length > 0 && (
            <p className="hint">{t("No se pudo comprobar: {providers}").replace("{providers}", result.unreadable.map((p) => t(PROVIDERS[p].label)).join(", "))}</p>
          )}
          {result.stale.length ? (
            <div className="provider-favorites-stale">
              <strong>{t("Favoritos que no aparecen en el catálogo")}</strong>
              <p>{t("Estos favoritos no aparecen en el catálogo de su proveedor, pero podrían seguir funcionando como alias. Su disponibilidad no está confirmada. Quítalos con la × si ya no los usas.")}</p>
            </div>
          ) : (
            <p className={result.unreadable.length ? "hint" : "provider-favorites-ok"}>
              {t(result.unreadable.length ? "La comprobación está incompleta; la disponibilidad de los modelos no comprobados sigue sin confirmar." : "Todos los favoritos aparecen en los catálogos comprobados.")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProviderAccordion({
  provider,
  label,
  hasKey,
  localEndpoint,
  capabilities,
  expanded,
  onToggle,
  children,
}: {
  provider: ProviderId;
  label: string;
  hasKey: boolean;
  localEndpoint?: string;
  capabilities: Capability[];
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <div className={`provider-row${expanded ? " is-open" : ""}`} data-testid={`provider-${provider}`}>
      <button type="button" className="provider-row-head" aria-expanded={expanded} onClick={onToggle}>
        <span className="provider-row-identity">
          <span className="provider-row-caret" aria-hidden>{expanded ? "▾" : "▸"}</span>
          <strong>{label}</strong>
          <span className={`provider-key-state${hasKey ? " saved" : ""}`}>
            {hasKey ? `● ${t("clave guardada")}` : localEndpoint !== undefined ? t("(local)") : `○ ${t("sin clave")}`}
          </span>
          {provider === "openrouter" && <span className="provider-row-note">{t("(modelos públicos)")}</span>}
        </span>
        <span className="provider-capabilities">
          {capabilities.map((capability) => (
            <span key={capability} className="provider-capability" data-capability={capability}>{t(CAPABILITY_LABELS[capability])}</span>
          ))}
        </span>
        {localEndpoint && <code>{localEndpoint}</code>}
      </button>
      {expanded && <div className="provider-row-body">{children}</div>}
    </div>
  );
}

function ProviderRow({
  provider,
  settings,
  keys,
  expanded,
  onToggle,
  onKeysChanged,
  saveProfile,
  isFav,
  toggleFav,
}: {
  provider: ApiProvider;
  settings: Settings;
  keys: Keys | null;
  expanded: boolean;
  onToggle: () => void;
  onKeysChanged: () => void;
  saveProfile: (provider: ApiProvider, patch: { baseUrl?: string; models?: string[] }) => Promise<void>;
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const t = useT(),
    p = PROVIDERS[provider],
    hasKey = !!keys?.providers[provider],
    local = LOCAL.includes(provider),
    savedBase = settings.apiProfiles[provider]?.baseUrl ?? p.baseUrl,
    // A cloud provider shows its endpoint only when one other than the official was saved.
    showEndpoint = OWN_ENDPOINT.includes(provider) || (!!p.baseUrl && savedBase !== p.baseUrl),
    // With remote APIs off, a provider reached over the network takes no key and lists nothing.
    blocked = !settings.remoteEnabled && remoteProvider(provider, settings.apiProfiles);
  const [keyInput, setKeyInput] = useState(""),
    [base, setBase] = useState(savedBase),
    [manual, setManual] = useState(""),
    [models, setModels] = useState<ProviderModel[] | null>(null),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState<null | "save" | "delete" | "load" | "endpoint">(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => setBase(savedBase), [savedBase]);
  const run = async (action: NonNullable<typeof busy>, work: () => Promise<void>) => {
    setBusy(action);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(t(errorText(e)));
    } finally {
      setBusy(null);
    }
  };
  const saveKey = () =>
    !blocked &&
    keyInput.trim() &&
    void run("save", async () => {
      await window.imago.call("setApiKey", { provider, key: keyInput });
      setKeyInput("");
      onKeysChanged();
    });
  const q = search.trim().toLowerCase();
  const filtered = (models ?? []).filter((m) => !q || m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q));
  const shown = filtered.slice(0, 300);
  return (
    <ProviderAccordion
      provider={provider}
      label={t(p.label)}
      hasKey={hasKey}
      localEndpoint={local ? savedBase : undefined}
      capabilities={modelCapabilities(provider, models)}
      expanded={expanded}
      onToggle={onToggle}
    >
      {showEndpoint && (
        <div className="provider-input-row">
          <input
            aria-label={t("Endpoint")}
            value={base}
            placeholder={p.baseUrl || "https://…/v1"}
            disabled={!!busy}
            onChange={(e) => setBase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && base.trim() !== savedBase) void run("endpoint", () => saveProfile(provider, { baseUrl: base.trim() }));
            }}
          />
          <Button disabled={!!busy || base.trim() === savedBase} onClick={() => void run("endpoint", () => saveProfile(provider, { baseUrl: base.trim() }))}>
            {t("Guardar endpoint")}
          </Button>
        </div>
      )}
      {blocked && (
        <p className="provider-blocked" data-testid={`provider-blocked-${provider}`}>
          {t(REMOTE_BLOCKED)}
        </p>
      )}
      <div className="provider-input-row">
        <input
          type="password"
          autoComplete="off"
          aria-label={t("Clave de API")}
          placeholder={hasKey ? t("•••••••• (guardada)") : OWN_ENDPOINT.includes(provider) ? t("clave de API (opcional)") : t("clave del proveedor")}
          value={keyInput}
          disabled={!!busy || blocked || !keys?.encryptionAvailable}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveKey();
          }}
        />
        <Button primary disabled={!!busy || blocked || !keyInput.trim() || !keys?.encryptionAvailable} onClick={saveKey}>
          {t("Guardar")}
        </Button>
        {hasKey && (
          <Button
            className="provider-delete"
            disabled={!!busy}
            onClick={() =>
              void run("delete", async () => {
                await window.imago.call("clearApiKey", { provider });
                onKeysChanged();
              })
            }
          >
            {t("Borrar")}
          </Button>
        )}
      </div>
      <div className="provider-input-row">
        <Button
          disabled={!!busy || blocked}
          onClick={() => void run("load", async () => setModels(await window.imago.call("listProviderModels", { provider })))}
        >
          {busy === "load" ? t("Cargando…") : t("Cargar modelos")}
        </Button>
        {models && <input aria-label={t("Buscar modelo…")} placeholder={t("Buscar modelo…")} value={search} onChange={(e) => setSearch(e.target.value)} />}
        {models && <span className="provider-model-count">{filtered.length}</span>}
      </div>
      {OWN_ENDPOINT.includes(provider) && (
        <form
          className="provider-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            const id = manual.trim();
            if (!id || isFav({ provider, model: id })) return;
            void toggleFav({ provider, model: id }).then(() => setManual(""));
          }}
        >
          <input aria-label={t("Identificador exacto del modelo")} placeholder={t("Identificador exacto del modelo")} value={manual} onChange={(e) => setManual(e.target.value)} />
          <Button type="submit" disabled={!manual.trim()}>
            {t("Añadir a favoritos")}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="provider-error">
          {error}
        </p>
      )}
      {models && (
        <div className="provider-model-list" data-testid={`provider-model-list-${provider}`}>
          <ModelList provider={provider} models={shown} isFav={isFav} toggleFav={toggleFav} />
          {!filtered.length && <p className="provider-model-more">{t("No hay modelos que coincidan.")}</p>}
          {filtered.length > shown.length && (
            <p className="provider-model-more">{t("Mostrando {n}; refina la búsqueda para ver más.").replace("{n}", String(shown.length))}</p>
          )}
        </div>
      )}
    </ProviderAccordion>
  );
}

/** A provider's models, with a star each; OpenRouter's grouped by upstream provider. */
function ModelList({
  provider,
  models,
  isFav,
  toggleFav,
}: {
  provider: ApiProvider;
  models: ProviderModel[];
  isFav: (m: ModelRef) => boolean;
  toggleFav: (m: ModelRef) => Promise<void>;
}) {
  const t = useT();
  const rows: ReactElement[] = [];
  let group: string | null = null;
  for (const m of models) {
    if (provider === "openrouter" && m.group && m.group !== group) {
      group = m.group;
      rows.push(
        <div key={`g-${group}`} className="provider-model-group">
          {group}
        </div>,
      );
    }
    const ref = { provider, model: m.id },
      fav = isFav(ref),
      meta = [
        m.name && m.name !== m.id ? m.name : "",
        m.contextLength ? `${Math.round(m.contextLength / 1000)}${t("K ctx máx.")}` : "",
      ].filter(Boolean);
    rows.push(
      <div key={m.id} className="provider-model-row">
        <button
          type="button"
          className={`provider-star${fav ? " is-on" : ""}`}
          aria-pressed={fav}
          aria-label={t(fav ? "Quitar de favoritos" : "Marcar como favorito")}
          data-tooltip={t(fav ? "Quitar de favoritos" : "Marcar como favorito")}
          onClick={() => void toggleFav(ref)}
        >
          <Star size={13} fill={fav ? "currentColor" : "none"} />
        </button>
        <span className="provider-model-text">
          <span title={m.name ?? m.id}>{m.id}</span>
          {meta.length > 0 && <small>{meta.join(" · ")}</small>}
        </span>
        {m.vision && (
          <span className="provider-badge" data-tooltip={t("Acepta imágenes: apto como modelo de visión.")}>
            {t("visión")}
          </span>
        )}
        {m.imageOutput && (
          <span className="provider-badge image" data-tooltip={t("Devuelve imágenes: aparece en Restauración IA.")}>
            {t("imagen")}
          </span>
        )}
      </div>,
    );
  }
  return <div>{rows}</div>;
}
