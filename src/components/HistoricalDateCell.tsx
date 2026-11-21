// A historical date: the text as the cataloguer wrote it and, beside it, the
// period Imago reads from it ("1925–1935 · Aproximada"). Clicking the period
// lets the user fix the years and the certainty by hand.
import { useEffect, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";
import {
  CERTAINTY_HELP,
  CERTAINTY_LABELS,
  decodeHistoricalDate,
  encodeHistoricalDate,
  parseHistoricalDate,
  periodLabel,
  type Certainty,
} from "../../shared/historicalDate";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";

export function HistoricalDateCell({
  name,
  value,
  onSave,
  compact,
}: {
  name: string;
  value: string | null;
  onSave: (value: string | null) => Promise<void>;
  compact: boolean;
}) {
  const t = useT();
  const stored = decodeHistoricalDate(value);
  const [draft, setDraft] = useState(stored?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => setDraft(decodeHistoricalDate(value)?.text ?? ""), [value]);
  // While typing, the period shown is the one the new text would give.
  const preview = draft !== (stored?.text ?? "") ? parseHistoricalDate(draft) : stored;
  const label = periodLabel(preview, document.documentElement.lang === "en" ? "en" : "es");
  // In the table, a text that only says the period («1950-1959») would repeat
  // it, cut short: the range alone is shown, and the text comes back to edit.
  const plain = (text: string) => text.replace(/[\s\u2010-\u2015-]+/g, "").toLowerCase();
  const same = compact && !!label && plain(draft) === plain(label);
  const save = async (raw: string | null) => {
    setBusy(true);
    try {
      await onSave(raw);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className={`historical-date-cell ${compact ? "compact" : ""}`}>
      <input
        className={`cell-input ${same ? "is-same" : ""}`}
        aria-label={name}
        value={draft}
        disabled={busy}
        placeholder={compact ? "" : t("Por ejemplo: c. 1930, [1930], ant. 1936, años 50")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== (stored?.text ?? "")) void save(draft.trim() || null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {draft.trim() && (
        <button
          ref={anchor}
          type="button"
          className={`historical-date-period certainty-${preview?.certainty ?? "none"} ${label ? "" : "is-unread"}`}
          data-tooltip={
            label
              ? `${t("Periodo")}: ${label} · ${t(CERTAINTY_LABELS[preview!.certainty])}${stored?.manual ? ` · ${t("ajustado a mano")}` : ""}`
              : t("No se reconoce ningún año en este texto. Pulsa para indicar el periodo.")
          }
          aria-label={t("Ajustar el periodo")}
          disabled={busy || !stored}
          onClick={() => setOpen(true)}
        >
          <CalendarRange size={12} />
          {label || "?"}
        </button>
      )}
      {open && stored && (
        <CriteriaPopover anchor={anchor} onClose={() => setOpen(false)} width={320} label={t("Ajustar el periodo")}>
          <PeriodEditor
            value={stored}
            onCancel={() => setOpen(false)}
            onSave={(next) => {
              setOpen(false);
              void save(next);
            }}
          />
        </CriteriaPopover>
      )}
    </span>
  );
}

function PeriodEditor({
  value,
  onSave,
  onCancel,
}: {
  value: NonNullable<ReturnType<typeof decodeHistoricalDate>>;
  onSave: (raw: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [start, setStart] = useState(value.start?.toString() ?? "");
  const [end, setEnd] = useState(value.end?.toString() ?? "");
  const [certainty, setCertainty] = useState<Certainty>(value.certainty);
  const year = (text: string) => (text.trim() ? Number(text) : null);
  const valid =
    [start, end].every((v) => !v.trim() || /^-?\d{1,4}$/.test(v.trim())) &&
    (year(start) == null || year(end) == null || year(start)! <= year(end)!) &&
    (year(start) != null || year(end) != null);
  return (
    <form
      className="period-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onSave(encodeHistoricalDate({ text: value.text, start: year(start), end: year(end), certainty, manual: true }));
      }}
    >
      <p className="hint">
        {t("El texto se conserva tal como está escrito. Aquí indicas el periodo que usan los filtros, la cronología y las estadísticas.")}
      </p>
      <div className="period-editor-years">
        <label>
          {t("Desde el año")}
          <input inputMode="numeric" value={start} placeholder={t("abierto")} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          {t("Hasta el año")}
          <input inputMode="numeric" value={end} placeholder={t("abierto")} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <fieldset className="period-editor-certainty">
        <legend>{t("Certeza")}</legend>
        {(Object.keys(CERTAINTY_LABELS) as Certainty[]).map((key) => (
          <label key={key} data-tooltip={t(CERTAINTY_HELP[key])}>
            <input type="radio" name="certainty" checked={certainty === key} onChange={() => setCertainty(key)} />
            {t(CERTAINTY_LABELS[key])}
          </label>
        ))}
      </fieldset>
      {!valid && <p className="period-editor-error">{t("Indica al menos un año. El inicial debe ser anterior o igual al final.")}</p>}
      <footer>
        {value.manual && (
          <button type="button" className="button" onClick={() => onSave(value.text)}>
            {t("Volver a la lectura automática")}
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="button" onClick={onCancel}>
          {t("Cancelar")}
        </button>
        <button type="submit" className="button primary" disabled={!valid}>
          {t("Guardar")}
        </button>
      </footer>
    </form>
  );
}
