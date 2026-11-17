// Figure plates and citations: a caption template for the database (saved),
// a preview of the captions of the selected records, and the PDF export with
// one numbered figure per page and the list of figures.
import { useEffect, useMemo, useState } from "react";
import { Copy, FileDown, FileImage } from "lucide-react";
import type { DatabaseDetail } from "../../shared/databases";
import type { RecordRow } from "../../shared/imago";
import { CITATION_STYLES, citationTemplate, renderCitation, type CitationStyle } from "../../shared/citation";
import { useT } from "../i18n";
import { Button, Modal } from "./ui";

export function CitationTemplateEditor({
  detail,
  template,
  sample = [],
  onChange,
}: {
  detail: DatabaseDetail;
  template: string;
  /** Records whose values tell which properties hold file names, not sources. */
  sample?: RecordRow[];
  onChange: (template: string) => void;
}) {
  const t = useT();
  const properties = detail.columns.filter((c) => !["button", "files", "attachment", "ai_image", "relation"].includes(c.type));
  return (
    <div className="citation-editor">
      <label>
        {t("Plantilla del pie y de la cita")}
        <textarea rows={2} value={template} onChange={(e) => onChange(e.target.value)} data-testid="citation-template" />
      </label>
      <div className="citation-styles">
        {(Object.keys(CITATION_STYLES) as CitationStyle[]).map((style) => (
          <button key={style} type="button" onClick={() => onChange(citationTemplate(detail.columns, style, sample))}>
            {CITATION_STYLES[style]}
          </button>
        ))}
      </div>
      <div className="citation-properties" aria-label={t("Insertar propiedad")}>
        {properties.map((c) => (
          <button key={c.id} type="button" onClick={() => onChange(`${template}${template && !template.endsWith(" ") ? " " : ""}{${c.name}}`)}>
            {`{${c.name}}`}
          </button>
        ))}
      </div>
      <p className="hint">{t("Escribe los nombres de las propiedades entre llaves. Si una propiedad está vacía, desaparece con su puntuación.")}</p>
    </div>
  );
}

export function PlatesDialog({
  detail,
  rowIds,
  template: saved,
  onTemplate,
  onClose,
  onDone,
}: {
  detail: DatabaseDetail;
  rowIds: string[];
  template: string | undefined;
  onTemplate: (template: string) => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const [template, setTemplate] = useState(saved ?? citationTemplate(detail.columns));
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState(t("Fig."));
  const [start, setStart] = useState(1);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState(saved !== undefined);
  useEffect(() => {
    void Promise.all(rowIds.slice(0, 200).map((id) => window.imago.call("getRow", { id }))).then((loaded) => {
      setRows(loaded);
      // The suggested template, once the records show which properties hold file names.
      if (!edited) setTemplate(citationTemplate(detail.columns, "chicago", loaded));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowIds]);
  const captions = useMemo(() => rows.map((row) => renderCitation(template, detail.columns, row) || row.title), [rows, template, detail.columns]);
  const withImages = rows.filter((r) => r.images.some((i) => i.width > 0)).length;
  return (
    <Modal icon={FileImage} title={t("Láminas y citas")} onClose={onClose} wide>
      <div className="modal-body plates-dialog" data-testid="plates-dialog">
        <p className="hint">
          {t("Crea un PDF con una figura por página, numerada y con su pie, y al final la lista de figuras. El pie se forma con la plantilla, que también usa «Copiar cita» en la ficha.")}
        </p>
        <div className="plates-fields">
          <label>
            {t("Título del documento (opcional)")}
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            {t("Rótulo")}
            <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {t("Primer número")}
            <input type="number" min={1} value={start} onChange={(e) => setStart(Math.max(1, Number(e.target.value) || 1))} />
          </label>
        </div>
        <CitationTemplateEditor
          detail={detail}
          template={template}
          sample={rows}
          onChange={(next) => {
            setTemplate(next);
            setEdited(true);
          }}
        />
        <h3>{t("Vista previa de los pies")}</h3>
        <ol className="plates-preview" data-testid="plates-preview">
          {captions.slice(0, 8).map((caption, i) => (
            <li key={rows[i].id}>
              <b>
                {label} {start + i}.
              </b>{" "}
              {caption}
            </li>
          ))}
        </ol>
        {rows.length > withImages && (
          <p className="hint">{t("{n} registros no tienen imagen y no se incluirán.").replace("{n}", String(rows.length - withImages))}</p>
        )}
        {error && <p className="error">{t(error)}</p>}
      </div>
      <footer>
        <Button
          onClick={() =>
            void navigator.clipboard
              .writeText(captions.map((c, i) => `${label} ${start + i}. ${c}`).join("\n"))
              .then(() => onDone(t("Pies copiados al portapapeles.")))
          }
        >
          <Copy size={14} />
          {t("Copiar los pies")}
        </Button>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button
          primary
          disabled={busy || !withImages}
          data-testid="plates-export"
          onClick={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                await onTemplate(template);
                const result = await window.imago.call("platesExport", {
                  rowIds: rows.filter((r) => r.images.some((i) => i.width > 0)).map((r) => r.id),
                  template,
                  title,
                  label,
                  listTitle: t("Lista de figuras"),
                  start,
                });
                if (result) onDone(t("PDF con {n} figuras guardado.").replace("{n}", String(result.figures)));
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            })()
          }
        >
          <FileDown size={14} />
          {t(busy ? "Creando el PDF…" : "Exportar PDF")}
        </Button>
      </footer>
    </Modal>
  );
}
