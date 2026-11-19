import { Fragment, useEffect, useState } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, SlidersHorizontal, Sparkles, Info } from "lucide-react";
import type {
  DatabaseColumn,
  DatabaseColumnType,
  DatabaseDetail,
  DatabaseColumnConfig,
} from "../../shared/databases";
import {
  COLUMN_TYPES,
  columnTypeHasOptions,
  type AiPresetId,
} from "../../shared/databases";
import {
  AI_PRESETS,
  aiPresetOf,
  aiPresetTask,
  type AiUserPreset,
} from "../../shared/databaseAi";
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
import { RollupSettings } from "./RollupSettings";
export type Perform = (
  work: () => Promise<void>,
  message?: string,
) => Promise<void>;
const TAG_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];
export const OFFERED_COLUMN_TYPES: DatabaseColumnType[] = [
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
  "rollup",
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
  initialColumnId = null,
  initialCreateType = null,
}: {
  /** Open with this property selected (from the column menu). */
  initialColumnId?: string | null;
  /** Open creating a property of this type (from the header "+" menu). */
  initialCreateType?: DatabaseColumnType | null;
  detail: DatabaseDetail;
  onClose: () => void;
  onChanged: () => void;
  perform: Perform;
  status: Status;
}) {
  const t = useT();
  const [rollup, setRollup] = useState<DatabaseColumnConfig>({
    rollupFunction: "count",
  });
  const [selected, setSelected] = useState<DatabaseColumn | null>(null),
    [name, setName] = useState(""),
    [type, setType] = useState<DatabaseColumnType>("text"),
    [creating, setCreating] = useState(false),
    [confirmDelete, setConfirmDelete] = useState<DatabaseColumn | null>(null);
  const [options, setOptions] = useState<
      {
        id?: string;
        label: string;
        color: string | null;
        definition?: string;
        /** Information page (Wikipedia) opened from the option's info icon. */
        link?: string;
      }[]
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
    [source, setSource] = useState(""),
    // A built-in task id, "custom" or "user:<id>" for a task the user saved.
    [preset, setPreset] = useState<string>("describe"),
    [output, setOutput] = useState<"text" | "tags">("text"),
    [tagList, setTagList] = useState(""),
    [freeTags, setFreeTags] = useState(true),
    [fillNow, setFillNow] = useState(true),
    [aiOn, setAiOn] = useState(false),
    // Most tags the AI may use; 0 = no limit.
    [maxTags, setMaxTags] = useState(5),
    // Advanced classification: general criteria and a definition per option.
    [criteriaOn, setCriteriaOn] = useState(false),
    [criteria, setCriteria] = useState(""),
    [definitionsOn, setDefinitionsOn] = useState(false),
    [linkRow, setLinkRow] = useState<number | null>(null),
    [userPresets, setUserPresets] = useState<AiUserPreset[]>(
      () => status.settings.aiUserPresets ?? [],
    ),
    [presetName, setPresetName] = useState(""),
    [savingPreset, setSavingPreset] = useState(false),
    [deletePreset, setDeletePreset] = useState<AiUserPreset | null>(null);
  const userPreset = preset.startsWith("user:")
      ? userPresets.find((p) => "user:" + p.id === preset) ?? null
      : null,
    presetId: AiPresetId = preset.startsWith("user:")
      ? "custom"
      : (preset as AiPresetId),
    ownPrompt = presetId === "custom";
  const plainOptions = () => options.map(({ id, label, color }) => ({ id, label, color }));
  const savePresets = (next: AiUserPreset[], message: string) =>
    perform(async () => {
      await window.imago.call("updateSettings", { aiUserPresets: next });
      setUserPresets(next);
    }, message);
  const choosePreset = (key: string) => {
    const saved = key.startsWith("user:")
      ? userPresets.find((p) => "user:" + p.id === key)
      : null;
    setPreset(key);
    setSavingPreset(false);
    if (saved) {
      setPrompt(saved.prompt);
      setOutput(saved.output);
      setPresetName(saved.name);
    } else if (key === "custom") setOutput("text");
    else if (ownPrompt) setPrompt("");
  };
  const aiConfig = () => ({
    aiModel: choice
      ? {
          provider: choice.provider === "local" ? "nodus" : choice.provider,
          model: choice.model,
        }
      : null,
    aiPrompt: prompt,
    aiSourceColumnId: source || undefined,
    ...(columnTypeHasOptions(type)
      ? {
          optionLinks: Object.fromEntries(
            options
              .filter((o) => o.label.trim() && /^https:\/\//.test(o.link?.trim() ?? ""))
              .map((o) => [o.label.trim().toLocaleLowerCase(), o.link!.trim()]),
          ),
          aiEnabled: aiOn,
          aiFreeTags: type === "multi_select" && aiOn && freeTags,
          aiMaxTags: maxTags,
          aiCriteriaOn: aiOn && criteriaOn,
          aiCriteria: criteria,
          aiDefinitionsOn: aiOn && definitionsOn,
          aiDefinitions: Object.fromEntries(
            options
              .filter((o) => o.label.trim() && o.definition?.trim())
              .map((o) => [o.label.trim().toLocaleLowerCase(), o.definition!.trim()]),
          ),
        }
      : {}),
    ...(type === "ai"
      ? {
          aiPreset: aiTask(),
          aiMaxTags: maxTags,
          aiOutput: ownPrompt ? output : undefined,
          aiUserPresetId: userPreset?.id,
          aiTags:
            presetId === "tags" && !freeTags
              ? [
                  ...new Set(
                    tagList
                      .split(/[\n,]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ]
              : [],
        }
      : {}),
  });
  const aiTask = () => {
    if (presetId === "tags" && !freeTags && !tagList.trim())
      throw new Error("Escribe las etiquetas permitidas o elige etiquetas automáticas.");
    if (ownPrompt && !prompt.trim())
      throw new Error("Escribe las instrucciones de la columna.");
    return presetId;
  };
  const formulaConfig = (): FormulaSpec | undefined => {
    if (type !== "formula" || formulaImported) return undefined;
    if (formulaKind !== "expression" && !operand)
      throw new Error("Selecciona una propiedad para la fórmula.");
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
    setRollup(c.config);
    setSelected(c);
    setName(c.name);
    setType(c.type);
    setOptions(
      c.options.map(({ id, label, color }) => ({
        id,
        label,
        color,
        definition: c.config.aiDefinitions?.[label.toLocaleLowerCase()] ?? "",
        link: c.config.optionLinks?.[label.toLocaleLowerCase()] ?? "",
      })),
    );
    setCriteriaOn(!!c.config.aiCriteriaOn);
    setCriteria(c.config.aiCriteria ?? "");
    setDefinitionsOn(!!c.config.aiDefinitionsOn);
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
    setPreset(
      c.config.aiUserPresetId &&
        (status.settings.aiUserPresets ?? []).some(
          (p) => p.id === c.config.aiUserPresetId,
        )
        ? "user:" + c.config.aiUserPresetId
        : aiPresetOf(c.config),
    );
    setOutput(c.config.aiOutput ?? "text");
    setAiOn(!!c.config.aiEnabled);
    setMaxTags(c.config.aiMaxTags ?? 5);
    if (columnTypeHasOptions(c.type)) setFreeTags(!!c.config.aiFreeTags);
    setPresetName(
      (status.settings.aiUserPresets ?? []).find(
        (p) => p.id === c.config.aiUserPresetId,
      )?.name ?? "",
    );
    setTagList((c.config.aiTags ?? []).join("\n"));
    setFreeTags(!c.config.aiTags?.length);
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
    setRollup({ rollupFunction: "count" });
    setSelected(null);
    setName("");
    setType("text");
    setOptions([]);
    setCreating(true);
    setChoice(null);
    setPrompt("");
    setSource("");
    setPreset("describe");
    setAiOn(false);
    setCriteriaOn(false);
    setCriteria("");
    setDefinitionsOn(false);
    setMaxTags(5);
    setOutput("text");
    setPresetName("");
    setSavingPreset(false);
    setTagList("");
    setFreeTags(true);
    setFillNow(true);
    setFormulaImported(null);
    setFormulaKind("arithmetic");
    setFormulaSource("");
    setOperand("");
    setStatFn("percentOfTotal");
    void perform(async () =>
      setDatabases(await window.imago.call("listDatabases")),
    );
  };
  // Opened from a column header: start on that property.
  useEffect(() => {
    const column = detail.columns.find((c) => c.id === initialColumnId);
    if (column) edit(column);
    else if (initialCreateType) {
      add();
      setType(initialCreateType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Modal icon={SlidersHorizontal} title={t("Propiedades")} onClose={onClose} wide layout="panels">
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
                {c.type === "ai"
                  ? `${t("IA")} · ${t("Texto")}`
                  : t(COLUMN_TYPES.find((t) => t.id === c.type)?.label ?? c.type)}
                {c.config.aiEnabled && columnTypeHasOptions(c.type) && (
                  <Sparkles
                    size={11}
                    className="property-ai-mark"
                    aria-label={t("Rellenada con IA")}
                  />
                )}
              </small>
              <Pencil size={13} />
            </button>
          ))}
          <Button data-tour="add-property" onClick={add}>
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
                    ...(type === "rollup" ? rollup : {}),
                    ...aiConfig(),
                    ...(formula ? { formula } : {}),
                  },
                });
                if (columnTypeHasOptions(type))
                  await window.imago.call("saveOptions", {
                    columnId: selected.id,
                    options: plainOptions(),
                  });
              } else {
                const config =
                  type === "rollup"
                    ? rollup
                    : type === "relation"
                      ? {
                          relationTargetDatabaseId: relationDb,
                          relationTargetKind: "db_row" as const,
                        }
                      : type === "formula"
                        ? { formula: formulaConfig() }
                        : aiConfig();
                // AI tags are a real multi-select: chips that filter, with
                // the AI choosing among its options or adding new ones.
                const aiTags = type === "ai" && presetId === "tags";
                const tagOptions = tagList
                  .split(/[\n,]/)
                  .map((tag) => tag.trim())
                  .filter((tag, i, all) => tag && all.indexOf(tag) === i);
                const c = await window.imago.call("addColumn", {
                  databaseId: detail.database.id,
                  name,
                  type: aiTags ? "multi_select" : type,
                  config: aiTags
                    ? {
                        ...config,
                        aiPreset: undefined,
                        aiTags: undefined,
                        aiOutput: undefined,
                        aiEnabled: true,
                        aiFreeTags: freeTags,
                      }
                    : config,
                });
                if (aiTags && !freeTags)
                  await window.imago.call("saveOptions", {
                    columnId: c.id,
                    options: tagOptions.map((label, i) => ({
                      label,
                      color: TAG_COLORS[i % TAG_COLORS.length],
                    })),
                  });
                else if (columnTypeHasOptions(type))
                  await window.imago.call("saveOptions", {
                    columnId: c.id,
                    options: plainOptions(),
                  });
                if (
                  (type === "ai" || (columnTypeHasOptions(type) && aiOn)) &&
                  fillNow &&
                  detail.database.rowCount > 0
                )
                  await window.imago
                    .call("analyze", {
                      databaseId: detail.database.id,
                      columnIds: [c.id],
                      language: status.settings.language,
                      detailed: true,
                    })
                    .catch(() => undefined);
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
                  aria-label={t("Tipo")}
                  value={type}
                  disabled={!!selected}
                  onChange={(e) =>
                    setType(e.target.value as DatabaseColumnType)
                  }
                >
                  {COLUMN_TYPES.filter(
                    (c) =>
                      OFFERED_COLUMN_TYPES.includes(c.id) &&
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
              {type === "rollup" && (
                <RollupSettings
                  detail={detail}
                  value={rollup}
                  onChange={setRollup}
                />
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
                          aria-label={t("Receta")}
                          value={formulaKind}
                          onChange={(e) =>
                            setFormulaKind(
                              e.target.value as
                                "arithmetic" | "columnStat" | "expression",
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
                            {detail.columns.filter(isNumericSource).map((c) => (
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
                              onChange={(e) => setFormulaSource(e.target.value)}
                              placeholder={'property("id-columna") * 2'}
                            />
                          </label>
                          <label>
                            {t("Insertar propiedad")}
                            <select
                              value=""
                              onChange={(e) => {
                                if (!e.target.value) return;
                                setFormulaSource(
                                  (previous) =>
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
                    <Fragment key={o.id ?? i}>
                    <div className="row option-edit">
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
                        className={o.link ? "option-has-link" : ""}
                        title={t("Enlace de información")}
                        aria-expanded={linkRow === i}
                        onClick={() => setLinkRow(linkRow === i ? null : i)}
                      >
                        <Info size={14} />
                      </Button>
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
                    {linkRow === i && (
                      <input
                        className="option-link-input"
                        type="url"
                        autoFocus
                        aria-label={`${t("Enlace de información")} · ${o.label}`}
                        placeholder={t("https://es.wikipedia.org/wiki/…")}
                        value={o.link ?? ""}
                        onChange={(e) =>
                          setOptions(
                            options.map((v, j) =>
                              j === i ? { ...v, link: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    )}
                    </Fragment>
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
                  <h3>{t("IA de la propiedad")}</h3>
                  {columnTypeHasOptions(type) && (
                    <>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={aiOn}
                          onChange={(e) => setAiOn(e.target.checked)}
                        />
                        {t("Rellenar con IA directamente en la celda")}
                      </label>
                      {aiOn && type === "multi_select" && (
                        <div className="stack ai-tags">
                          <label className="check-label">
                            <input
                              type="radio"
                              name="ai-options"
                              checked={freeTags}
                              onChange={() => setFreeTags(true)}
                            />
                            {t("Etiquetas automáticas: la IA puede añadir opciones nuevas")}
                          </label>
                          <label className="check-label">
                            <input
                              type="radio"
                              name="ai-options"
                              checked={!freeTags}
                              onChange={() => setFreeTags(false)}
                            />
                            {t("Solo las opciones de la lista")}
                          </label>
                          <label>
                            {t("Máximo de etiquetas")}
                            <select
                              value={maxTags}
                              onChange={(e) => setMaxTags(Number(e.target.value))}
                            >
                              {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                              <option value={0}>{t("Sin límite")}</option>
                            </select>
                          </label>
                        </div>
                      )}
                      {aiOn && (
                        <details className="ai-advanced" open={criteriaOn || definitionsOn}>
                          <summary>{t("Opciones avanzadas")}</summary>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={criteriaOn}
                              onChange={(e) => setCriteriaOn(e.target.checked)}
                            />
                            {t("Criterios generales de clasificación")}
                          </label>
                          {criteriaOn && (
                            <textarea
                              rows={4}
                              value={criteria}
                              aria-label={t("Criterios generales de clasificación")}
                              onChange={(e) => setCriteria(e.target.value)}
                              placeholder={t(
                                "Por ejemplo: clasifica por el motivo principal de la fotografía, no por el lugar donde se tomó.",
                              )}
                            />
                          )}
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={definitionsOn}
                              onChange={(e) => setDefinitionsOn(e.target.checked)}
                            />
                            {t("Criterios por opción (definiciones)")}
                          </label>
                          {definitionsOn && (
                            <div className="ai-definitions">
                              {options.filter((o) => o.label.trim()).length === 0 && (
                                <p className="hint">
                                  {t("Añade opciones a la lista para definir cada una.")}
                                </p>
                              )}
                              {options.map((o, i) =>
                                o.label.trim() ? (
                                  <label key={o.id ?? "new-" + i}>
                                    <span
                                      className="chip"
                                      style={{ "--chip": o.color ?? "#6366f1" } as React.CSSProperties}
                                    >
                                      {o.label}
                                    </span>
                                    <textarea
                                      rows={2}
                                      value={o.definition ?? ""}
                                      aria-label={`${t("Definición de")} ${o.label}`}
                                      placeholder={t("Qué entra en esta opción y qué no…")}
                                      onChange={(e) =>
                                        setOptions(
                                          options.map((x, j) =>
                                            j === i ? { ...x, definition: e.target.value } : x,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                ) : null,
                              )}
                            </div>
                          )}
                        </details>
                      )}
                      {aiOn && !selected && (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={fillNow}
                            onChange={(e) => setFillNow(e.target.checked)}
                          />
                          {t("Rellenar ahora las celdas de los registros con imagen")}
                        </label>
                      )}
                    </>
                  )}
                  {type === "ai" && (
                    <>
                      <label>
                        {t("Qué debe hacer la IA")}
                        <select
                          value={preset}
                          onChange={(e) => choosePreset(e.target.value)}
                        >
                          <optgroup label={t("Predefinidos")}>
                            {AI_PRESETS.filter(
                              (p) =>
                                p.id !== "custom" &&
                                // An existing AI text property cannot become a
                                // multi-select; tags are created as one.
                                !(p.id === "tags" && selected?.type === "ai" && aiPresetOf(selected.config) !== "tags"),
                            ).map((p) => (
                              <option key={p.id} value={p.id}>
                                {t(p.label)}
                              </option>
                            ))}
                          </optgroup>
                          {userPresets.length > 0 && (
                            <optgroup label={t("Mis predefinidos")}>
                              {userPresets.map((p) => (
                                <option key={p.id} value={"user:" + p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <option value="custom">{t("Personalizado")}</option>
                        </select>
                      </label>
                      {!ownPrompt && (
                        <>
                          <p className="hint">
                            {t(AI_PRESETS.find((p) => p.id === presetId)?.hint ?? "")}
                          </p>
                          <label>
                            {t("Prompt")}
                            <textarea
                              className="ai-prompt-preview"
                              readOnly
                              rows={6}
                              value={aiPresetTask(
                                presetId,
                                status.settings.language,
                                presetId === "tags" && !freeTags
                                  ? tagList.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
                                  : [],
                                maxTags > 0 ? maxTags : null,
                              )}
                            />
                          </label>
                        </>
                      )}
                      {presetId === "tags" && !selected && (
                        <p className="hint ai-tags-note">
                          {t(
                            "Se creará como selección múltiple: cada etiqueta será un chip que puedes filtrar y agrupar.",
                          )}
                        </p>
                      )}
                      {presetId === "tags" && (
                        <div className="stack ai-tags">
                          <label className="check-label">
                            <input
                              type="radio"
                              name="ai-tags"
                              checked={freeTags}
                              onChange={() => setFreeTags(true)}
                            />
                            {t("Etiquetas automáticas (la IA las elige libremente)")}
                          </label>
                          <label className="check-label">
                            <input
                              type="radio"
                              name="ai-tags"
                              checked={!freeTags}
                              onChange={() => setFreeTags(false)}
                            />
                            {t("Solo estas etiquetas")}
                          </label>
                          {!freeTags && (
                            <textarea
                              rows={4}
                              value={tagList}
                              aria-label={t("Etiquetas permitidas")}
                              onChange={(e) => setTagList(e.target.value)}
                              placeholder={t("Una etiqueta por línea: retrato, paisaje, interior…")}
                            />
                          )}
                          <label>
                            {t("Máximo de etiquetas")}
                            <select
                              value={maxTags}
                              onChange={(e) => setMaxTags(Number(e.target.value))}
                            >
                              {[1, 2, 3, 5, 8, 10, 15, 20].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                              <option value={0}>{t("Sin límite")}</option>
                            </select>
                          </label>
                        </div>
                      )}
                      <label>
                        {ownPrompt
                          ? t("Instrucciones")
                          : t("Indicaciones adicionales (opcional)")}
                        <textarea
                          rows={ownPrompt ? 6 : 2}
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder={
                            ownPrompt
                              ? t("Describe qué debe escribir la IA en cada celda…")
                              : t("Por ejemplo: menciona siempre el tipo de soporte fotográfico.")
                          }
                        />
                      </label>
                      {ownPrompt && (
                        <label>
                          {t("Resultado")}
                          <select
                            value={output}
                            onChange={(e) => setOutput(e.target.value as "text" | "tags")}
                          >
                            <option value="text">{t("Texto")}</option>
                            <option value="tags">{t("Lista de etiquetas")}</option>
                          </select>
                        </label>
                      )}
                      {ownPrompt && (
                        <div className="ai-preset-actions">
                          {(userPreset || savingPreset) && (
                            <input
                              aria-label={t("Nombre del predefinido")}
                              placeholder={t("Nombre del predefinido")}
                              value={presetName}
                              onChange={(e) => setPresetName(e.target.value)}
                            />
                          )}
                          {userPreset ? (
                            <>
                              <Button
                                type="button"
                                disabled={!presetName.trim() || !prompt.trim()}
                                onClick={() =>
                                  void savePresets(
                                    userPresets.map((p) =>
                                      p.id === userPreset.id
                                        ? { ...p, name: presetName.trim(), prompt: prompt.trim(), output }
                                        : p,
                                    ),
                                    "Predefinido guardado.",
                                  )
                                }
                              >
                                {t("Guardar predefinido")}
                              </Button>
                              <Button
                                type="button"
                                className="danger"
                                onClick={() => setDeletePreset(userPreset)}
                              >
                                <Trash2 size={14} />
                                {t("Eliminar predefinido")}
                              </Button>
                            </>
                          ) : savingPreset ? (
                            <Button
                              type="button"
                              disabled={!presetName.trim() || !prompt.trim()}
                              onClick={() => {
                                const created: AiUserPreset = {
                                  id: crypto.randomUUID(),
                                  name: presetName.trim(),
                                  prompt: prompt.trim(),
                                  output,
                                };
                                void savePresets(
                                  [...userPresets, created],
                                  "Predefinido guardado.",
                                ).then(() => {
                                  setPreset("user:" + created.id);
                                  setSavingPreset(false);
                                });
                              }}
                            >
                              {t("Guardar")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              disabled={!prompt.trim()}
                              onClick={() => {
                                setPresetName("");
                                setSavingPreset(true);
                              }}
                            >
                              <Plus size={14} />
                              {t("Guardar como predefinido")}
                            </Button>
                          )}
                        </div>
                      )}
                      {!selected && (
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={fillNow}
                            onChange={(e) => setFillNow(e.target.checked)}
                          />
                          {t("Rellenar ahora las celdas de los registros con imagen")}
                        </label>
                      )}
                    </>
                  )}
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
                    {t("Imágenes de origen")}
                    <select
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">
                        {t("Imagen principal del registro")}
                      </option>
                      {detail.columns
                        .filter((c) => ["attachment", "files"].includes(c.type))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  {type !== "ai" && (
                    <label>
                      {t("Instrucciones de la columna")}
                      <textarea
                        rows={3}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={t(
                          "Indica qué observar o cómo clasificar estas imágenes…",
                        )}
                      />
                    </label>
                  )}
                  <p className="hint">
                    {type === "ai" || (columnTypeHasOptions(type) && aiOn)
                      ? t(
                          "El resultado se escribe directamente en la celda, en el idioma de la interfaz. Usa el botón de IA de la cabecera o de cada celda para generarlo de nuevo; Deshacer lo revierte.",
                        )
                      : t(
                          "La clasificación respeta las opciones de esta propiedad. Las anotaciones existentes se conservan. Los resultados se presentan como propuestas.",
                        )}
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
                              options: plainOptions(),
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
                      {t("Encolar celdas vacías")} ·{" "}
                      {detail.database.rowCount.toLocaleString()}{" "}
                      {t("registros")}
                    </Button>
                  )}
                  <p className="hint">
                    {t(
                      "Solo se completarán celdas vacías con imagen. Las anotaciones humanas y las opciones existentes se conservan.",
                    )}
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
                    onClick={() => setConfirmDelete(selected)}
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
      {deletePreset && (
        <Modal
          icon={Trash2}
          title={t("Eliminar predefinido")}
          onClose={() => setDeletePreset(null)}
        >
          <div className="modal-body">
            <h3>{deletePreset.name}</h3>
            <p>
              {t(
                "¿Eliminar este predefinido? Las propiedades que ya lo usan conservan sus instrucciones.",
              )}
            </p>
          </div>
          <footer>
            <Button onClick={() => setDeletePreset(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() => {
                const gone = deletePreset;
                setDeletePreset(null);
                void savePresets(
                  userPresets.filter((p) => p.id !== gone.id),
                  "Predefinido eliminado.",
                ).then(() => {
                  if (preset === "user:" + gone.id) setPreset("custom");
                });
              }}
            >
              <Trash2 size={14} />
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
      {confirmDelete && (
        <Modal icon={Trash2}
          title={t("Eliminar propiedad")}
          onClose={() => setConfirmDelete(null)}
        >
          <div className="modal-body">
            <h3>{confirmDelete.name}</h3>
            <p>
              {t(
                "¿Eliminar esta propiedad y todos sus valores? Esta operación no se puede deshacer.",
              )}
            </p>
          </div>
          <footer>
            <Button onClick={() => setConfirmDelete(null)}>{t("Cancelar")}</Button>
            <Button
              className="danger"
              onClick={() =>
                void perform(async () => {
                  await window.imago.call("deleteColumn", {
                    id: confirmDelete.id,
                  });
                  setConfirmDelete(null);
                  onChanged();
                  setSelected(null);
                })
              }
            >
              <Trash2 size={14} />
              {t("Eliminar")}
            </Button>
          </footer>
        </Modal>
      )}
    </Modal>
  );
}
