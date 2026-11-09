import { useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil } from "lucide-react";
import type {
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseDetail,
} from "../../shared/databases";
import { COLUMN_TYPES, columnTypeHasOptions } from "../../shared/databases";
import {
  COLUMN_STAT_FNS,
  isNumericSource,
  type FormulaSpec,
} from "../../shared/databaseFormula";
import {
  formulaExpressionResultKind,
  parseFormulaExpression,
  validateFormulaExpression,
} from "../../shared/databaseFormulaExpression";
import { Modal, Button } from "./ui";
import { useT } from "../i18n";
import type { Status } from "../../shared/imago";
import type { ModelChoice } from "../../shared/aiConfig";
import { ModelPicker } from "./ModelPicker";
export type Perform = (
  work: () => Promise<void>,
  message?: string,
) => Promise<void>;
const offered = [
  "title",
  "rich_text",
  "text",
  "number",
  "date",
  "time",
  "select",
  "multi_select",
  "status",
  "checkbox",
  "attachment",
  "url",
  "location",
  "relation",
  "formula",
  "ai",
  "unique_id",
  "created_time",
  "last_edited_time",
];
export function Properties({
  detail,
  onClose,
  onChanged,
  perform,
  status,
}: {
  detail: DatabaseDetail;
  onClose: () => void;
  onChanged: () => void;
  perform: Perform;
  status: Status;
}) {
  const t = useT();
  const [selected, setSelected] = useState<DatabaseColumn | null>(null),
    [name, setName] = useState(""),
    [type, setType] = useState<DatabaseColumnType>("text"),
    [creating, setCreating] = useState(false);
  const [options, setOptions] = useState<
      { id?: string; label: string; color: string | null }[]
    >([]),
    [relationDb, setRelationDb] = useState(""),
    [databases, setDatabases] = useState<{ id: string; name: string }[]>([]);
  const [operand, setOperand] = useState(""),
    [operation, setOperation] = useState("add"),
    [constant, setConstant] = useState(1),
    [formulaKind, setFormulaKind] = useState<
      "arithmetic" | "columnStat" | "expression"
    >("arithmetic"),
    [statFn, setStatFn] = useState("percentOfTotal"),
    [formulaSource, setFormulaSource] = useState(""),
    [formulaImported, setFormulaImported] = useState<string | null>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(null),
    [prompt, setPrompt] = useState(""),
    [source, setSource] = useState("");
  const aiConfig = () => ({
    aiModel: choice
      ? {
          provider: choice.provider === "local" ? "nodus" : choice.provider,
          model: choice.model,
        }
      : null,
    aiPrompt: prompt,
    aiSourceColumnId: source || undefined,
  });
  const formulaConfig = (): FormulaSpec | undefined => {
    if (type !== "formula" || formulaImported) return undefined;
    if (!operand) throw new Error("Selecciona una propiedad para la fórmula.");
    if (formulaKind === "columnStat")
      return {
        kind: "columnStat",
        fn: statFn as "percentOfTotal",
        columnId: operand,
      };
    if (formulaKind === "expression") {
      const source = formulaSource.trim();
      if (!source) throw new Error("Escribe una expresión.");
      const ast = parseFormulaExpression(source);
      const problem = validateFormulaExpression(ast, detail.columns);
      if (problem) throw new Error(problem);
      return {
        kind: "expression",
        source,
        ast,
        resultKind: formulaExpressionResultKind(ast, detail.columns),
      };
    }
    return {
      kind: "arithmetic",
      op: operation as "add",
      operands: [
        { kind: "column", columnId: operand },
        { kind: "number", value: constant },
      ],
    };
  };
  const edit = (c: DatabaseColumn) => {
    setSelected(c);
    setName(c.name);
    setType(c.type);
    setOptions(c.options);
    setCreating(false);
    setFormulaImported(null);
    setFormulaKind("arithmetic");
    setFormulaSource("");
    setOperand("");
    setStatFn("percentOfTotal");
    const spec = c.config.formula as FormulaSpec | undefined;
    if (spec?.kind === "columnStat") {
      setFormulaKind("columnStat");
      setStatFn(spec.fn);
      setOperand(spec.columnId);
    } else if (spec?.kind === "expression") {
      setFormulaKind("expression");
      setFormulaSource(spec.source);
    } else if (spec?.kind === "arithmetic") {
      const column = spec.operands.find((operand) => operand.kind === "column");
      const number = spec.operands.find((operand) => operand.kind === "number");
      if (
        !["add", "subtract", "multiply", "divide"].includes(spec.op) ||
        spec.operands.length !== 2 ||
        !column ||
        !number
      ) {
        setFormulaImported("arithmetic");
      } else {
        setOperand(column.columnId);
        setOperation(spec.op);
        setConstant(number.value);
      }
    } else if (spec) setFormulaImported(spec.kind);
    setPrompt(c.config.aiPrompt ?? "");
    setSource(c.config.aiSourceColumnId ?? "");
    setChoice(
      c.config.aiModel
        ? {
            provider: (c.config.aiModel.provider === "nodus"
              ? "local"
              : c.config.aiModel.provider) as ModelChoice["provider"],
            model: c.config.aiModel.model,
          }
        : null,
    );
  };
  const add = () => {
    setSelected(null);
    setName("");
    setType("text");
    setOptions([]);
    setCreating(true);
    setChoice(null);
    setPrompt("");
    setSource("");
    setFormulaImported(null);
    setFormulaKind("arithmetic");
    setFormulaSource("");
    setOperand("");
    setStatFn("percentOfTotal");
    void perform(async () =>
      setDatabases(await window.imago.call("listDatabases")),
    );
  };
  return (
    <Modal title={t("Propiedades")} onClose={onClose} wide>
      <div className="property-layout">
        <div className="property-list">
          {detail.columns.map((c) => (
            <button
              className={selected?.id === c.id ? "active" : ""}
              key={c.id}
              onClick={() => edit(c)}
            >
              <span>{c.name}</span>
              <small>
                {t(COLUMN_TYPES.find((t) => t.id === c.type)?.label ?? c.type)}
              </small>
              <Pencil size={13} />
            </button>
          ))}
          <Button onClick={add}>
            <Plus size={15} />
            {t("Añadir propiedad")}
          </Button>
        </div>
        <form
          className="property-form"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              if (selected) {
                const formula =
                  selected.type === "formula" ? formulaConfig() : undefined;
                await window.imago.call("updateColumn", {
                  id: selected.id,
                  name,
                  config: {
                    ...selected.config,
                    ...aiConfig(),
                    ...(formula ? { formula } : {}),
                  },
                });
                if (columnTypeHasOptions(type))
                  await window.imago.call("saveOptions", {
                    columnId: selected.id,
                    options,
                  });
              } else {
                const config =
                  type === "relation"
                    ? {
                        relationTargetDatabaseId: relationDb,
                        relationTargetKind: "db_row" as const,
                      }
                    : type === "formula"
                      ? { formula: formulaConfig() }
                      : aiConfig();
                const c = await window.imago.call("addColumn", {
                  databaseId: detail.database.id,
                  name,
                  type,
                  config,
                });
                if (columnTypeHasOptions(type))
                  await window.imago.call("saveOptions", {
                    columnId: c.id,
                    options,
                  });
              }
              onChanged();
              setCreating(false);
              setSelected(null);
            });
          }}
        >
          {!selected && !creating ? (
            <div className="muted property-hint">
              {t("Añadir propiedad")} · {t("Opciones")} · {t("Color")}
            </div>
          ) : (
            <>
              <label>
                {t("Nombre")}
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              <label>
                {t("Tipo")}
                <select
                  value={type}
                  disabled={!!selected}
                  onChange={(e) =>
                    setType(e.target.value as DatabaseColumnType)
                  }
                >
                  {COLUMN_TYPES.filter(
                    (c) =>
                      offered.includes(c.id) &&
                      (!detail.columns.some((c) => c.type === "title") ||
                        c.id !== "title" ||
                        selected?.type === "title"),
                  ).map((c) => (
                    <option key={c.id} value={c.id}>
                      {t(c.label)}
                    </option>
                  ))}
                </select>
              </label>
              {type === "relation" && !selected && (
                <label>
                  {t("Bases de datos")}
                  <select
                    required
                    value={relationDb}
                    onChange={(e) => setRelationDb(e.target.value)}
                  >
                    <option value="">—</option>
                    {databases.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {type === "formula" && (
                <div className="stack">
                  {formulaImported ? (
                    <p className="hint">
                      {t("Fórmula importada de Nodus")} · {formulaImported}.{" "}
                      {t(
                        "Se conserva su configuración original; este editor solo modifica operaciones, estadísticas y expresiones.",
                      )}
                    </p>
                  ) : (
                    <>
                      <label>
                        {t("Receta")}
                        <select
                          value={formulaKind}
                          onChange={(e) =>
                            setFormulaKind(
                              e.target.value as
                                | "arithmetic"
                                | "columnStat"
                                | "expression",
                            )
                          }
                        >
                          <option value="arithmetic">{t("Operación")}</option>
                          <option value="columnStat">
                            {t("Estadística de columna")}
                          </option>
                          <option value="expression">{t("Expresión")}</option>
                        </select>
                      </label>
                      {formulaKind !== "expression" && (
                        <label>
                          {t("Propiedades")}
                          <select
                            required
                            value={operand}
                            onChange={(e) => setOperand(e.target.value)}
                          >
                            <option value="">—</option>
                            {detail.columns
                              .filter(isNumericSource)
                              .map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      {formulaKind === "arithmetic" && (
                        <div className="row">
                          <select
                            aria-label={t("Fórmula")}
                            value={operation}
                            onChange={(e) => setOperation(e.target.value)}
                          >
                            <option value="add">+</option>
                            <option value="subtract">−</option>
                            <option value="multiply">×</option>
                            <option value="divide">÷</option>
                          </select>
                          <input
                            aria-label={t("Número")}
                            type="number"
                            value={constant}
                            onChange={(e) =>
                              setConstant(Number(e.target.value))
                            }
                          />
                        </div>
                      )}
                      {formulaKind === "columnStat" && (
                        <label>
                          {t("Función")}
                          <select
                            value={statFn}
                            onChange={(e) => setStatFn(e.target.value)}
                          >
                            {COLUMN_STAT_FNS.map((fn) => (
                              <option key={fn.id} value={fn.id}>
                                {t(fn.label)} · {t(fn.hint)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      {formulaKind === "expression" && (
                        <>
                          <label>
                            {t("Expresión")}
                            <textarea
                              rows={4}
                              required
                              value={formulaSource}
                              onChange={(e) =>
                                setFormulaSource(e.target.value)
                              }
                              placeholder={'property("id-columna") * 2'}
                            />
                          </label>
                          <label>
                            {t("Insertar propiedad")}
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                setFormulaSource((previous) =>
                                  `${previous}${previous ? " " : ""}property("${e.target.value}")`,
                                );
                              }}
                            >
                              <option value="">—</option>
                              {detail.columns.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <p className="hint">
                            {t(
                              'Usa property("id"), operadores + − * / % y funciones como if(), dateAdd(), concat() o sum(). Se valida antes de guardar.',
                            )}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
              {columnTypeHasOptions(type) && (
                <div className="stack">
                  <span className="field-label">{t("Opciones")}</span>
                  {options.map((o, i) => (
                    <div className="row option-edit" key={o.id ?? i}>
                      <input
                        type="color"
                        aria-label={t("Color")}
                        value={o.color ?? "#6366f1"}
                        onChange={(e) =>
                          setOptions(
                            options.map((v, j) =>
                              j === i ? { ...v, color: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <input
                        required
                        aria-label={t("Nombre")}
                        value={o.label}
                        onChange={(e) =>
                          setOptions(
                            options.map((v, j) =>
                              j === i ? { ...v, label: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        icon
                        title={t("Anterior")}
                        disabled={i === 0}
                        onClick={() => {
                          const x = [...options];
                          [x[i - 1], x[i]] = [x[i], x[i - 1]];
                          setOptions(x);
                        }}
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        type="button"
                        icon
                        title={t("Siguiente")}
                        disabled={i === options.length - 1}
                        onClick={() => {
                          const x = [...options];
                          [x[i + 1], x[i]] = [x[i], x[i + 1]];
                          setOptions(x);
                        }}
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        type="button"
                        icon
                        aria-label={t("Eliminar")}
                        onClick={() =>
                          setOptions(options.filter((_, j) => j !== i))
                        }
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    onClick={() =>
                      setOptions([...options, { label: "", color: "#6366f1" }])
                    }
                  >
                    <Plus size={14} />
                    {t("Añadir opción")}
                  </Button>
                </div>
              )}
              {[
                "text",
                "rich_text",
                "select",
                "status",
                "multi_select",
                "ai",
              ].includes(type) && (
                <div className="stack column-ai">
                  <h3>IA de la propiedad</h3>
                  <label>
                    {t("Modelo")}
                    <ModelPicker
                      inherit
                      value={choice}
                      settings={status.settings}
                      models={status.models}
                      onChange={setChoice}
                    />
                  </label>
                  <label>
                    Imágenes de origen
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">Imagen principal del registro</option>
                      {detail.columns
                        .filter((c) => ["attachment", "files"].includes(c.type))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Instrucciones de la columna
                    <textarea
                      rows={3}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="Indica qué observar o cómo clasificar estas imágenes…"
                    />
                  </label>
                  <p className="hint">
                    La clasificación respeta las opciones de esta propiedad. Las
                    anotaciones existentes se conservan. Los resultados se
                    presentan como propuestas.
                  </p>
                  {selected && (
                    <Button
                      type="button"
                      onClick={() =>
                        void perform(async () => {
                          await window.imago.call("updateColumn", {
                            id: selected.id,
                            name,
                            config: { ...selected.config, ...aiConfig() },
                          });
                          if (columnTypeHasOptions(type))
                            await window.imago.call("saveOptions", {
                              columnId: selected.id,
                              options,
                            });
                          await window.imago.call("analyze", {
                            databaseId: detail.database.id,
                            columnIds: [selected.id],
                            language: status.settings.language,
                            detailed: true,
                          });
                          onChanged();
                          onClose();
                        }, "Celdas vacías añadidas a la cola de tareas.")
                      }
                    >
                      Encolar celdas vacías ·{" "}
                      {detail.database.rowCount.toLocaleString()} registros
                    </Button>
                  )}
                  <p className="hint">
                    Solo se completarán celdas vacías con imagen. Las
                    anotaciones humanas y las opciones existentes se conservan.
                  </p>
                </div>
              )}
              <footer>
                <Button primary type="submit">
                  {t("Guardar")}
                </Button>
                {selected && selected.type !== "title" && (
                  <Button
                    type="button"
                    className="danger"
                    onClick={() => {
                      if (
                        !window.confirm(
                          t(
                            "¿Eliminar esta propiedad y todos sus valores? Esta operación no se puede deshacer.",
                          ),
                        )
                      )
                        return;
                      void perform(async () => {
                        await window.imago.call("deleteColumn", {
                          id: selected.id,
                        });
                        onChanged();
                        setSelected(null);
                      });
                    }}
                  >
                    <Trash2 size={14} />
                    {t("Eliminar")}
                  </Button>
                )}
              </footer>
            </>
          )}
        </form>
      </div>
    </Modal>
  );
}
