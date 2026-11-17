// Before images are indexed for the first time, the researcher chooses the
// quality of the semantic index: more visual detail per image recognises more,
// and takes longer. Each level shows how long this collection would take.
import { useState } from "react";
import { Check, Gauge, Images, Info, Rabbit, Telescope } from "lucide-react";
import type { AutoIndexState } from "../../electron/autoIndex";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";

type Quality = 280 | 140 | 70;
const LEVELS: { value: Quality; icon: typeof Gauge; title: string; text: string }[] = [
  {
    value: 280,
    icon: Telescope,
    title: "Alta",
    text: "Reconoce mejor los detalles pequeños: rótulos, rostros, objetos lejanos. Es la más lenta.",
  },
  {
    value: 140,
    icon: Gauge,
    title: "Media",
    text: "Buen equilibrio entre detalle y velocidad: unas dos veces más rápida que la alta.",
  },
  {
    value: 70,
    icon: Rabbit,
    title: "Rápida",
    text: "Unas cinco veces más rápida que la alta. Puede pasar por alto detalles pequeños.",
  },
];

/** «≈ 3 h 20 min», «≈ 12 min», «menos de 1 min». */
export function formatDuration(seconds: number, t: (s: string) => string) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return t("menos de 1 min");
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return "≈ " + (hours ? `${hours} h${rest ? ` ${rest} min` : ""}` : `${minutes} min`);
}

export function IndexQualityDialog({
  quality,
  onStart,
  onClose,
}: {
  quality: NonNullable<AutoIndexState["quality"]>;
  onStart: (visionBudget: Quality) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [choice, setChoice] = useState<Quality>(quality.current);
  const [busy, setBusy] = useState(false);
  return (
    <Modal icon={Gauge} title={t("Primera indexación de las imágenes")} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void onStart(choice).finally(() => setBusy(false));
        }}
      >
        <div className="modal-body index-quality">
          <p className="index-quality-lead">
            {t(
              "Para la búsqueda semántica, Imago analiza cada imagen una vez. Elige con cuánto detalle: más calidad reconoce más cosas, pero tarda más.",
            )}
          </p>
          <div className="index-quality-summary" data-testid="index-quality-counts">
            <Images size={16} />
            <span>
              <strong>{quality.assets.toLocaleString()}</strong> {t("imágenes")} ·{" "}
              <strong>{quality.rows.toLocaleString()}</strong> {t("fichas")}
            </span>
          </div>
          <div className="index-quality-options" role="radiogroup" aria-label={t("Calidad de la indexación")}>
            {LEVELS.map(({ value, icon: Icon, title, text }) => (
              <label key={value} className={`index-quality-option ${choice === value ? "is-selected" : ""}`}>
                <input
                  className="index-quality-radio"
                  type="radio"
                  name="index-quality"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                />
                <span className="index-quality-icon" aria-hidden>
                  {choice === value ? <Check size={18} /> : <Icon size={18} />}
                </span>
                <span className="index-quality-text">
                  <strong>{t(title)}</strong>
                  <small>{t(text)}</small>
                </span>
                <span className="index-quality-time">
                  <small>{t("Tiempo estimado")}</small>
                  <b data-testid={`index-quality-time-${value}`}>{formatDuration(quality.seconds[value], t)}</b>
                </span>
              </label>
            ))}
          </div>
          <p className="index-quality-note">
            <Info size={15} />
            <span>
              {t(
                "Puedes pausar la indexación cuando quieras. La calidad se cambia después en Configuración › Modelos, pero entonces hay que volver a indexar las imágenes.",
              )}
            </span>
          </p>
        </div>
        <footer>
          <Button type="button" onClick={onClose}>
            {t("Ahora no")}
          </Button>
          <Button primary type="submit" disabled={busy} data-testid="index-quality-start">
            {t("Empezar a indexar")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

/** Opens the quality choice from anywhere a first indexing can start. */
export const askIndexQuality = () => window.dispatchEvent(new Event("imago:index-quality"));
