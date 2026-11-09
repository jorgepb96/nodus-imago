import { useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  FileQuestion,
  FileImage,
  FolderInput,
} from "lucide-react";
import { Modal, Button } from "./ui";
import type { CsvImportPlanData } from "../../shared/databaseCsv";
import type {
  DatabaseColumnType,
  DatabaseDetail,
} from "../../shared/databases";
import { COLUMN_TYPES } from "../../shared/databases";
import type { ImagePlan } from "../../shared/imago";
import type { Perform } from "./Properties";
import { useT } from "../i18n";
export function CsvImport({
  plan,
  onClose,
  onDone,
  perform,
}: {
  plan: CsvImportPlanData;
  onClose: () => void;
  onDone: (id: string) => void;
  perform: Perform;
}) {
  const t = useT(),
    [name, setName] = useState(plan.fileName.replace(/\.[^.]+$/, "")),
    [headers, setHeaders] = useState(plan.headers),
    [types, setTypes] = useState(plan.suggestedTypes);
  const titleCount = types.filter((type) => type === "title").length;
  return (
    <Modal wide title={t("Previsualización de importación")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            const d = await window.imago.call("csvImport", {
              token: plan.token,
              name,
              headers,
              types,
            });
            onDone(d.database.id);
          });
        }}
      >
        <div className="modal-body">
          <label>
            {t("Nombre")}
            <input
              value={name}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="muted">
            {plan.fileName} · {plan.rowCount.toLocaleString()} {t("registros")}
          </p>
          <div className="table-scroll preview-table">
            <table>
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i}>
                      <input
                        aria-label={t("Nombre")}
                        required
                        value={h}
                        onChange={(e) =>
                          setHeaders(
                            headers.map((v, j) =>
                              j === i ? e.target.value : v,
                            ),
                          )
                        }
                      />
                      <select
                        aria-label={t("Tipo")}
                        value={types[i]}
                        onChange={(e) =>
                          setTypes(
                            types.map((v, j) =>
                              j === i
                                ? (e.target.value as DatabaseColumnType)
                                : v,
                            ),
                          )
                        }
                      >
                        {COLUMN_TYPES.filter((c) =>
                          [
                            "title",
                            "text",
                            "rich_text",
                            "number",
                            "date",
                            "time",
                            "select",
                            "status",
                            "multi_select",
                            "checkbox",
                            "url",
                          ].includes(c.id),
                        ).map((c) => (
                          <option value={c.id} key={c.id}>
                            {t(c.label)}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.sampleRows.map((r, i) => (
                  <tr key={i}>
                    {headers.map((_, j) => (
                      <td key={j}>{r[j] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Selecciona una única columna de título. Los valores incompatibles
            detendrán la importación para que puedas corregir el tipo.
          </p>
        </div>
        <footer>
          <Button type="button" onClick={onClose}>
            {t("Cancelar")}
          </Button>
          <Button primary type="submit" disabled={titleCount !== 1}>
            {t("Importar")} {plan.rowCount.toLocaleString()} {t("registros")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
export function ImageImport({
  initialPlan,
  detail,
  onClose,
  onDone,
  perform,
}: {
  initialPlan: ImagePlan;
  detail: DatabaseDetail;
  onClose: () => void;
  onDone: () => void;
  perform: Perform;
}) {
  const t = useT(),
    [plan, setPlan] = useState(initialPlan),
    [reference, setReference] = useState(
      detail.columns.find((c) => c.type === "title")?.id ?? "",
    ),
    [pattern, setPattern] = useState(""),
    [partial, setPartial] = useState(false),
    [storage, setStorage] = useState<"copy" | "link">("copy"),
    [targetColumn, setTargetColumn] = useState(
      initialPlan.columnId ??
        detail.columns.find(
          (column) => column.type === "attachment" || column.type === "files",
        )?.id ??
        "",
    ),
    [create, setCreate] = useState(true),
    [assignments, setAssignments] = useState<Record<string, string | null>>({}),
    [rowChoices, setRowChoices] = useState<{ id: string; title: string }[]>([]),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const counts = {
    safe: plan.matches.filter((m) => m.status === "safe").length,
    ambiguous: plan.matches.filter((m) => m.status === "ambiguous").length,
    unmatched: plan.matches.filter((m) => m.status === "unmatched").length,
  };
  const rematch = () =>
    void perform(async () => {
      setPlan(
        await window.imago.call("rematchImages", {
          token: plan.token,
          referenceColumnId: reference,
          pattern,
          partial,
        }),
      );
      setAssignments({});
      setPage(0);
    });
  return (
    <Modal wide title={t("Importar imágenes")} onClose={onClose}>
      <div className="modal-body stack">
        <div className="row">
          <FileImage size={20} />
          <strong>
            {plan.files.toLocaleString()} {t("imágenes")}
          </strong>
          <span className="muted">JPEG · PNG · WebP · TIFF · BMP</span>
        </div>
        <div className="import-stats">
          <div>
            <CheckCircle2 />
            <b>{counts.safe}</b>
            <span>{t("Correspondencias seguras")}</span>
          </div>
          <div>
            <CircleHelp />
            <b>{counts.ambiguous}</b>
            <span>{t("Correspondencias dudosas")}</span>
          </div>
          <div>
            <FileQuestion />
            <b>{counts.unmatched}</b>
            <span>{t("Sin correspondencia")}</span>
          </div>
        </div>
        <div className="row align-end">
          <label>
            {t("Columna de referencia")}
            <select
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            >
              <option value="__record_id__">{t("ID del registro")}</option>
              {detail.columns
                .filter(
                  (c) => !["attachment", "files", "formula"].includes(c.type),
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t("Patrón de catálogo")}
            <input
              value={pattern}
              placeholder="@@###"
              onChange={(e) => setPattern(e.target.value)}
            />
          </label>
          <Button onClick={rematch}>{t("Aplicar")}</Button>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={partial}
            onChange={(e) => setPartial(e.target.checked)}
          />
          {t("Coincidencia parcial")} · revisión manual
        </label>
        <div className="row">
          <input
            placeholder={t("Buscar") + " " + t("Registro").toLowerCase()}
            aria-label={t("Buscar")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            onClick={() =>
              void perform(async () =>
                setRowChoices(
                  (
                    await window.imago.call("search", {
                      databaseIds: [detail.database.id],
                      query,
                      limit: 200,
                    })
                  ).rows.map((r) => ({ id: r.id, title: r.title })),
                ),
              )
            }
          >
            {t("Buscar")}
          </Button>
        </div>
        <div className="table-scroll matching-table">
          <table>
            <thead>
              <tr>
                <th>{t("Archivo")}</th>
                <th>{t("Estado")}</th>
                <th>{t("Registro")}</th>
              </tr>
            </thead>
            <tbody>
              {plan.matches.slice(page * 100, (page + 1) * 100).map((m) => (
                <tr key={m.pathToken}>
                  <td>{m.fileName}</td>
                  <td>
                    <span className={"badge " + m.status}>
                      {t(
                        m.status === "safe"
                          ? "Correspondencias seguras"
                          : m.status === "ambiguous"
                            ? "Correspondencias dudosas"
                            : "Sin correspondencia",
                      )}
                    </span>
                  </td>
                  <td>
                    <select
                      aria-label={m.fileName + " " + t("Registro")}
                      value={
                        Object.hasOwn(assignments, m.pathToken)
                          ? (assignments[m.pathToken] ?? "")
                          : (m.rowId ?? "")
                      }
                      onChange={(e) =>
                        setAssignments({
                          ...assignments,
                          [m.pathToken]: e.target.value || null,
                        })
                      }
                    >
                      <option value="">
                        {m.status === "ambiguous"
                          ? t("Omitir archivo")
                          : t("Sin correspondencia")}
                      </option>
                      {[
                        ...new Set([
                          ...m.candidates,
                          ...rowChoices.map((r) => r.id),
                        ]),
                      ].map((id) => (
                        <option key={id} value={id}>
                          {rowChoices.find((r) => r.id === id)?.title ?? id}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <Button disabled={!page} onClick={() => setPage(page - 1)}>
            {t("Anterior")}
          </Button>
          <span className="muted">
            {page + 1} / {Math.max(1, Math.ceil(plan.files / 100))}
          </span>
          <Button
            disabled={(page + 1) * 100 >= plan.files}
            onClick={() => setPage(page + 1)}
          >
            {t("Siguiente")}
          </Button>
        </div>
        <label>
          {t("Columna de destino")}
          <select
            value={targetColumn}
            onChange={(e) => setTargetColumn(e.target.value)}
          >
            <option value="">{t("Crear columna Imágenes")}</option>
            {detail.columns
              .filter((column) =>
                ["attachment", "files"].includes(column.type),
              )
              .map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
          </select>
        </label>
        <div className="row">
          <label className="check-label">
            <input
              type="radio"
              checked={storage === "copy"}
              onChange={() => setStorage("copy")}
            />
            {t("Copiar originales")}
          </label>
          <label className="check-label">
            <input
              type="radio"
              checked={storage === "link"}
              onChange={() => setStorage("link")}
            />
            {t("Vincular ubicaciones")}
          </label>
        </div>
        <label className="check-label">
          <input
            type="checkbox"
            checked={create}
            onChange={(e) => setCreate(e.target.checked)}
          />
          {t("Crear registros sin correspondencia")}
        </label>
        <p className="hint">
          Los casos dudosos se omiten hasta que elijas un registro. Los
          originales se conservan intactos y los duplicados se detectan por su
          contenido.
        </p>
      </div>
      <footer>
        <Button onClick={onClose}>{t("Cancelar")}</Button>
        <Button
          primary
          onClick={() =>
            void perform(async () => {
              await window.imago.call("importImages", {
                token: plan.token,
                storage,
                createUnmatched: create,
                columnId: targetColumn || undefined,
                assignments: plan.matches
                  .filter(
                    (m) =>
                      m.status !== "ambiguous" || !!assignments[m.pathToken],
                  )
                  .map((m) => ({
                    pathToken: m.pathToken,
                    rowId: Object.hasOwn(assignments, m.pathToken)
                      ? assignments[m.pathToken]
                      : m.rowId,
                  })),
              });
              onDone();
            })
          }
        >
          <FolderInput size={15} />
          {t("Confirmar importación")}
        </Button>
      </footer>
    </Modal>
  );
}
