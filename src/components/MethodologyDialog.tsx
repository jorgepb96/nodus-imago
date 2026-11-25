// «Informe metodológico»: a PDF that documents what a study rests on (the
// data and its fingerprint, the vocabularies, the models and their exact
// instructions, the human review, agreement, parameters, views and
// statistics), in the interface language, with an optional JSON annex.
import { useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import { renderMethodologyHtml } from "../../shared/methodologyHtml";
import logoSvg from "../../build/icon-mark.svg?raw";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";

export function MethodologyDialog({
  detail,
  details,
  onClose,
  onDone,
}: {
  /** The database the report starts from. */
  detail: DatabaseDetail;
  details: DatabaseDetail[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  // The databases this one is related to come along by default.
  const related = useMemo(() => {
    const ids = new Set([detail.database.id]);
    for (const c of detail.columns) if (c.type === "relation" && c.config.relationTargetDatabaseId) ids.add(c.config.relationTargetDatabaseId as string);
    for (const d of details) if (d.columns.some((c) => c.type === "relation" && c.config.relationTargetDatabaseId === detail.database.id)) ids.add(d.database.id);
    return ids;
  }, [detail, details]);
  const [chosen, setChosen] = useState<Set<string>>(related),
    [title, setTitle] = useState(t("Informe metodológico de «{db}»").replace("{db}", detail.database.name)),
    [annex, setAnnex] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const ordered = details.filter((d) => chosen.has(d.database.id)).map((d) => d.database.id);
      const data = await window.imago.call("methodologyData", { databaseIds: ordered });
      const html = renderMethodologyHtml(data, t, { title, logoSvg });
      const saved = await window.imago.call("methodologyPdf", {
        html,
        fileName: title,
        annex: annex ? JSON.stringify(data, null, 2) : null,
      });
      if (saved) onDone(saved.annex ? t("Informe y anexo técnico guardados.") : t("Informe guardado."));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal icon={FileText} title={t("Informe metodológico")} onClose={onClose}>
      <form
        className="modal-body methodology-form"
        data-testid="methodology-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <p className="hint">
          {t("Un PDF con todo lo que hace falta para reproducir o evaluar tu análisis: los datos y su huella, las categorías, los modelos de IA con su revisión y sus instrucciones exactas, lo que revisaste y corregiste, la concordancia, los parámetros, las vistas y las estadísticas guardadas.")}
        </p>
        <label>
          {t("Título")}
          <input required value={title} onChange={(e) => setTitle(e.target.value)} data-testid="methodology-title" />
        </label>
        <fieldset className="methodology-databases">
          <legend>{t("Bases de datos del informe")}</legend>
          {details.map((d) => (
            <label key={d.database.id} className="check-label">
              <input type="checkbox" checked={chosen.has(d.database.id)} onChange={() => toggle(d.database.id)} />
              {d.database.name}
              {related.has(d.database.id) && d.database.id !== detail.database.id && <small className="muted"> · {t("relacionada")}</small>}
            </label>
          ))}
        </fieldset>
        <label className="check-label">
          <input type="checkbox" checked={annex} onChange={(e) => setAnnex(e.target.checked)} data-testid="methodology-annex" />
          {t("Guardar también el anexo técnico (JSON) junto al PDF")}
        </label>
        {error && <p className="error">{t(error)}</p>}
        <footer className="modal-actions">
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary type="submit" data-testid="methodology-generate" disabled={busy || !chosen.size || !title.trim()}>
            {busy && <Loader2 size={14} className="spin" />}
            {t(busy ? "Preparando el informe…" : "Guardar PDF")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
