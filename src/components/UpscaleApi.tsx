// Upscaling with an online service, for researchers who may never have used
// one: what it is, three steps to get started (account, credit, key), the
// keys of the three services, and a short list of recommended models with
// the rest one search away (favourites first, a price limit when wanted).
import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Cloud, ExternalLink, KeyRound, Search, Star, Trash2 } from "lucide-react";
import {
  PRICE_LIMITS,
  STYLE_HELP,
  STYLE_LABELS,
  UPSCALE_SERVICES,
  UPSCALE_SERVICE_IDS,
  estimateCost,
  formatCost,
  modelKey,
  type ApiUpscaleModel,
  type UpscaleService,
} from "../../shared/upscaleApi";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";

const open = (url: string) => void window.imago.call("openExternalLink", { url });

/** One service's key: paste, save (checked at once), or remove. */
export function ServiceKey({
  service,
  saved,
  onChanged,
  compact = false,
}: {
  service: UpscaleService;
  saved: boolean;
  onChanged: (status: Record<UpscaleService, boolean>) => void;
  compact?: boolean;
}) {
  const t = useT();
  const info = UPSCALE_SERVICES[service];
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const status = await window.imago.call("setUpscaleKey", { service, key: value.trim() });
      onChanged(status);
      try {
        const check = await window.imago.call("checkUpscaleKey", { service });
        setNote({ ok: true, text: check.balance ? t("Clave correcta. Saldo: {b}").replace("{b}", check.balance) : t("Clave correcta.") });
      } catch (e) {
        setNote({ ok: false, text: t(e instanceof Error ? e.message : String(e)) });
      }
      setValue("");
    } catch (e) {
      setNote({ ok: false, text: t(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`upscale-service-key ${compact ? "is-compact" : ""}`} data-testid={`upscale-key-${service}`}>
      <div className="upscale-service-key-head">
        <strong>{info.label}</strong>
        {saved ? (
          <span className="badge safe">
            <CircleCheck size={12} /> {t("Clave guardada")}
          </span>
        ) : (
          <span className="badge">{t("Sin clave")}</span>
        )}
      </div>
      {!compact && <p className="hint">{t(info.about)}</p>}
      <div className="upscale-service-key-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={t(saved ? "Pegar una clave nueva para sustituirla" : "Pega aquí la clave")}
          aria-label={t("Clave de {s}").replace("{s}", info.label)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button primary disabled={!value.trim() || busy} onClick={() => void save()}>
          <KeyRound size={13} />
          {t(busy ? "Comprobando…" : "Guardar")}
        </Button>
        {saved && (
          <Button icon aria-label={t("Eliminar la clave")} data-tooltip={t("Eliminar la clave")} onClick={() => setRemoving(true)}>
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      <button type="button" className="link-button" onClick={() => open(info.keysUrl)}>
        <ExternalLink size={12} /> {t("Conseguir una clave en {s}").replace("{s}", info.label)}
      </button>
      {note && <p className={note.ok ? "upscale-key-ok" : "restoration-error"}>{note.text}</p>}
      {removing && (
        <Modal icon={Trash2} title={t("Eliminar la clave")} onClose={() => setRemoving(false)}>
          <div className="modal-body">
            <p>{t("Se borrará la clave de {s} de este ordenador. Tu cuenta y tu saldo en el servicio no cambian.").replace("{s}", info.label)}</p>
          </div>
          <footer>
            <Button onClick={() => setRemoving(false)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void window.imago.call("clearUpscaleKey", { service }).then((status) => {
                  setRemoving(false);
                  onChanged(status);
                })
              }
            >
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

/**
 * For someone who has never used an online service: what it is, then three
 * steps for the service chosen (account, credit, key). A window of its own,
 * so the side panel stays short.
 */
export function ServiceSetupModal({
  keys,
  onKeys,
  onClose,
}: {
  keys: Record<UpscaleService, boolean>;
  onKeys: (k: Record<UpscaleService, boolean>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [service, setService] = useState<UpscaleService>(() => UPSCALE_SERVICE_IDS.find((s) => keys[s]) ?? "fal");
  const info = UPSCALE_SERVICES[service];
  return (
    <Modal icon={Cloud} title={t("Usar un servicio de internet")} onClose={onClose} wide>
      <div className="modal-body upscale-setup" data-testid="upscale-guide">
        <p className="upscale-setup-intro">
          {t(
            "Un servicio de internet amplía la imagen en sus propios ordenadores, mucho más potentes que el tuyo, y te la devuelve en unos segundos. Se paga solo lo que se usa, normalmente céntimos por imagen. Para usarlo hace falta una cuenta y una «clave»: una contraseña larga que identifica tu cuenta. Imago la guarda cifrada en este ordenador y nunca la comparte.",
          )}
        </p>
        <div className="upscale-setup-services" role="tablist" aria-label={t("Servicio")}>
          {UPSCALE_SERVICE_IDS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={service === s} className={service === s ? "is-selected" : ""} onClick={() => setService(s)}>
              <strong>{UPSCALE_SERVICES[s].label}</strong>
              {keys[s] ? (
                <small className="is-ok">
                  <CircleCheck size={12} /> {t("Clave guardada")}
                </small>
              ) : (
                <small>{t(s === "fal" ? "Recomendado para empezar" : "Sin clave")}</small>
              )}
            </button>
          ))}
        </div>
        <p className="hint">{t(info.about)}</p>
        <ol className="upscale-steps">
          <li>
            <span className="upscale-step-number">1</span>
            <div>
              <strong>{t("Crea una cuenta")}</strong>
              <span>{t("Regístrate en la web del servicio con tu correo. Solo hay que hacerlo una vez.")}</span>
              <Button onClick={() => open(info.site)}>
                <ExternalLink size={13} />
                {t("Abrir {s}").replace("{s}", info.label)}
              </Button>
            </div>
          </li>
          <li>
            <span className="upscale-step-number">2</span>
            <div>
              <strong>{t("Añade saldo")}</strong>
              <span>{t("Con 5 $ puedes ampliar cientos de fotos con los modelos recomendados. Solo se cobra lo que usas.")}</span>
              <Button onClick={() => open(info.billingUrl)}>
                <ExternalLink size={13} />
                {t("Abrir la página de pago")}
              </Button>
            </div>
          </li>
          <li>
            <span className="upscale-step-number">3</span>
            <div>
              <strong>{t("Crea una clave y pégala aquí")}</strong>
              <span>{t("En la página de claves del servicio, crea una nueva, cópiala y pégala abajo. Imago comprueba al momento que funciona.")}</span>
              <ServiceKey key={service} service={service} saved={keys[service]} onChanged={onKeys} compact />
            </div>
          </li>
        </ol>
      </div>
      <footer>
        <Button primary onClick={onClose}>
          {t(Object.values(keys).some(Boolean) ? "Listo" : "Cerrar")}
        </Button>
      </footer>
    </Modal>
  );
}

/** The recommended models first; every other upscaler one search away, favourites on top. */
export function ApiModelPicker({
  models,
  keys,
  chosen,
  favorites,
  maxPrice,
  outputMP,
  onChoose,
  onFavorite,
  onMaxPrice,
}: {
  models: ApiUpscaleModel[];
  keys: Record<UpscaleService, boolean>;
  chosen: string;
  favorites: string[];
  maxPrice: number | null;
  /** Megapixels of the result, to say what one image costs. */
  outputMP: number;
  onChoose: (m: ApiUpscaleModel) => void;
  onFavorite: (key: string) => void;
  onMaxPrice: (value: number | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const usable = models.filter((m) => keys[m.service]);
  const cost = (m: ApiUpscaleModel) => estimateCost(m.price, outputMP);
  const withinPrice = (m: ApiUpscaleModel) => maxPrice === null || (cost(m) ?? Infinity) <= maxPrice;
  const recommended = usable.filter((m) => m.recommended);
  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    return usable
      .filter((m) => withinPrice(m) && (!q || `${m.name} ${m.id} ${m.description ?? ""} ${UPSCALE_SERVICES[m.service].label}`.toLowerCase().includes(q)))
      .sort(
        (a, b) =>
          Number(favorites.includes(modelKey(b))) - Number(favorites.includes(modelKey(a))) ||
          Number(!!b.recommended) - Number(!!a.recommended) ||
          (cost(a) ?? 99) - (cost(b) ?? 99) ||
          a.name.localeCompare(b.name),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, query, maxPrice, favorites, outputMP]);
  const hiddenByPrice = maxPrice === null ? 0 : usable.filter((m) => !withinPrice(m)).length;
  const row = (m: ApiUpscaleModel, card = false) => {
    const key = modelKey(m),
      favorite = favorites.includes(key),
      c = cost(m);
    return (
      <li key={key} className={`${chosen === key ? "is-selected" : ""} ${card ? "is-card" : ""}`}>
        <button type="button" role="radio" aria-checked={chosen === key} onClick={() => onChoose(m)} data-testid="upscale-api-model">
          <span className="upscale-model-title">
            <strong>{m.name}</strong>
            <span className={`upscale-style ${m.style}`} data-tooltip={t(STYLE_HELP[m.style])}>
              {t(STYLE_LABELS[m.style])}
            </span>
          </span>
          <small>
            {UPSCALE_SERVICES[m.service].label} · {c === null ? t("precio desconocido") : `~${formatCost(c)} ${t("por imagen")}`}
          </small>
          {card && m.recommended && <small className="upscale-model-why">{t(m.recommended)}</small>}
        </button>
        <button
          type="button"
          className={`restoration-star ${favorite ? "is-on" : ""}`}
          aria-pressed={favorite}
          aria-label={t(favorite ? "Quitar de favoritos" : "Marcar como favorito")}
          data-tooltip={t(favorite ? "Quitar de favoritos" : "Marcar como favorito")}
          onClick={() => onFavorite(key)}
        >
          <Star size={14} fill={favorite ? "currentColor" : "none"} />
        </button>
      </li>
    );
  };
  return (
    <div className="upscale-api-models">
      {recommended.length > 0 && (
        <ul className="restoration-models upscale-recommended-list" role="radiogroup" aria-label={t("Modelos recomendados")}>
          {recommended.map((m) => row(m, true))}
        </ul>
      )}
      <details className="upscale-all-models" open={all} onToggle={(e) => setAll(e.currentTarget.open)}>
        <summary>{t("Ver todos los modelos ({n})").replace("{n}", String(usable.length))}</summary>
        <div className="restoration-model-tools">
          <span className="upscale-search">
            <Search size={13} />
            <input type="search" placeholder={t("Buscar modelo…")} aria-label={t("Buscar modelo…")} value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <select
            aria-label={t("Precio máximo por imagen")}
            value={maxPrice === null ? "" : String(maxPrice)}
            onChange={(e) => onMaxPrice(e.target.value ? Number(e.target.value) : null)}
            data-testid="upscale-max-price"
          >
            <option value="">{t("Cualquier precio")}</option>
            {PRICE_LIMITS.map((p) => (
              <option key={p} value={p}>
                {t("Hasta {p} por imagen").replace("{p}", formatCost(p))}
              </option>
            ))}
          </select>
        </div>
        <ul className="restoration-models" role="radiogroup" aria-label={t("Modelos")}>
          {!listed.length && <li className="restoration-models-empty">{t("No hay modelos que coincidan.")}</li>}
          {listed.map((m) => row(m))}
        </ul>
        {hiddenByPrice > 0 && (
          <p className="hint">{t("{n} modelos ocultos por el precio máximo (también los de precio desconocido).").replace("{n}", String(hiddenByPrice))}</p>
        )}
      </details>
    </div>
  );
}

/** Settings › Providers: the keys of the online upscaling services. */
export function UpscaleServicesSettings() {
  const t = useT();
  const [keys, setKeys] = useState<Record<UpscaleService, boolean> | null>(null);
  useEffect(() => {
    void window.imago.call("upscaleServicesStatus").then(setKeys).catch(() => {});
  }, []);
  if (!keys) return null;
  return (
    <section className="settings-section upscale-services-settings" data-testid="upscale-services-settings">
      <h2>{t("Servicios para ampliar imágenes")}</h2>
      <p className="muted">{t("Solo se usan en Escalado IA, cuando eliges «Con un servicio de internet». Cada imagen se paga en el propio servicio.")}</p>
      {UPSCALE_SERVICE_IDS.map((s) => (
        <ServiceKey key={s} service={s} saved={keys[s]} onChanged={setKeys} />
      ))}
    </section>
  );
}
