import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Filter,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { DatabaseColumn, DatabaseDetail } from "../../shared/databases";
import type {
  EquivalenceGroup,
  PropertyFilter,
  PropertyFilterGroup,
  ViewSort,
} from "../../shared/imago";
import {
  activeFilterCount,
  FILTER_LABELS,
  filterKind,
  filterNeedsValue,
  filterOperators,
  isFilterReady,
  RELATIVE_DATES,
  SORT_META,
} from "../../shared/viewCriteria";
import { useT } from "../i18n";
import {
  CriteriaPopover,
  CriteriaSelect,
  type CriteriaOption,
} from "./CriteriaSelect";
import { Button } from "./ui";

type FilterColumn = DatabaseColumn & { databaseName: string };
const newId = () => crypto.randomUUID();
const metadataColumns: FilterColumn[] = [
  { id: "$created", name: "Fecha de incorporación", type: "created_time" },
  { id: "$modified", name: "Última modificación", type: "last_edited_time" },
  { id: "$images", name: "Número de imágenes", type: "number" },
].map(
  (column) =>
    ({
      ...column,
      databaseId: "",
      databaseName: "",
      position: 0,
      config: {},
      options: [],
    }) as FilterColumn,
);
function Operand({
  filter,
  columns,
  onChange,
}: {
  filter: PropertyFilter;
  columns: FilterColumn[];
  onChange: (value: string | string[]) => void;
}) {
  const t = useT(),
    column = columns[0],
    kind = filterKind(column),
    [query, setQuery] = useState("");
  const [choices, setChoices] = useState<CriteriaOption[]>([]),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<CriteriaOption[]>([]);
  const ids = columns.map((column) => column.id).join("|");
  const choiceMode = ["any", "all", "none"].includes(filter.op);
  const selectedSignature = JSON.stringify(
    Array.isArray(filter.value)
      ? filter.value
      : filter.value
        ? [filter.value]
        : [],
  );
  useEffect(() => {
    setOffset(0);
  }, [query, ids]);
  useEffect(() => {
    if (!choiceMode || kind === "options" || column.id.startsWith("$")) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    if (!offset) setChoices([]);
    const timer = setTimeout(() => {
      void window.imago
        .call("propertyChoices", {
          columnIds: ids.split("|"),
          query,
          offset,
          selected: JSON.parse(selectedSignature),
        })
        .then((result) => {
          if (!cancelled) {
            setChoices((previous) =>
              offset
                ? [
                    ...new Map(
                      [
                        ...previous,
                        ...result.choices.map((item) => ({
                          value: item.value,
                          label: item.label,
                          description: `${item.count} ${t("registros")}`,
                        })),
                      ].map((item) => [item.value, item]),
                    ).values(),
                  ]
                : result.choices.map((item) => ({
                    value: item.value,
                    label: item.label,
                    description: `${item.count} ${t("registros")}`,
                  })),
            );
            setSelectedOptions(result.selections);
            setMore(result.more);
          }
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Catalogue labels use the current app language on the next lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceMode, kind, ids, query, offset, selectedSignature]);
  if (!filterNeedsValue(filter.op)) return null;
  if (filter.op === "relative_date")
    return (
      <CriteriaSelect
        label={t("Intervalo de fechas")}
        options={RELATIVE_DATES.map(([value, label]) => ({
          value,
          label: t(label),
        }))}
        values={typeof filter.value === "string" ? [filter.value] : []}
        onChange={(values) => onChange(values[0] ?? "")}
      />
    );
  if (choiceMode) {
    const options =
      kind === "options"
        ? columns.flatMap((source) =>
            source.options.map((option) => ({
              value: option.id,
              label: option.label,
              color: option.color,
              description:
                columns.length > 1
                  ? `${source.databaseName} · ${source.name}`
                  : undefined,
            })),
          )
        : choices;
    return (
      <div className="criteria-operand">
        <CriteriaSelect
          label={t("Valores del filtro")}
          options={options}
          values={
            Array.isArray(filter.value)
              ? filter.value
              : filter.value
                ? [filter.value]
                : []
          }
          onChange={onChange}
          multiple
          selectedOptions={selectedOptions}
          custom={!["options", "relation", "person"].includes(kind)}
          {...(kind !== "options"
            ? {
                query,
                onQueryChange: setQuery,
                loading,
                more,
                onMore: () => setOffset((n) => n + 50),
              }
            : {})}
        />
        {error && (
          <small role="alert">
            {t("No se pudieron cargar las sugerencias.")}
          </small>
        )}
      </div>
    );
  }
  const type =
    kind === "number" || kind === "files"
      ? "number"
      : kind === "date"
        ? "date"
        : kind === "time"
          ? "time"
          : "text";
  if (filter.op === "between") {
    const values = Array.isArray(filter.value)
      ? filter.value
      : [filter.value, ""];
    return (
      <div className="criteria-range">
        <input
          type={type}
          aria-label={t("Desde")}
          value={values[0] ?? ""}
          onChange={(event) => onChange([event.target.value, values[1] ?? ""])}
        />
        <span>{t("y")}</span>
        <input
          type={type}
          aria-label={t("Hasta")}
          value={values[1] ?? ""}
          onChange={(event) => onChange([values[0] ?? "", event.target.value])}
        />
      </div>
    );
  }
  return (
    <input
      className="criteria-value-input"
      type={type}
      step={type === "number" ? "any" : undefined}
      aria-label={t("Valor del filtro")}
      placeholder={t("Escribe un valor…")}
      value={
        Array.isArray(filter.value) ? (filter.value[0] ?? "") : filter.value
      }
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
function FilterEditor({
  filters,
  groups,
  logic,
  onChange,
  columns,
  equivalences,
  depth = 0,
  total,
  onRemove,
}: {
  filters: PropertyFilter[];
  groups: PropertyFilterGroup[];
  logic: "and" | "or";
  onChange: (
    filters: PropertyFilter[],
    groups: PropertyFilterGroup[],
    logic: "and" | "or",
  ) => void;
  columns: FilterColumn[];
  equivalences: EquivalenceGroup[];
  depth?: number;
  total: number;
  onRemove?: () => void;
}) {
  const t = useT();
  const options: CriteriaOption[] = [
    ...columns.map((column) => ({
      value: column.id,
      label: column.id.startsWith("$") ? t(column.name) : column.name,
      description: column.databaseName || t("Datos del registro"),
    })),
    ...equivalences.map((group) => ({
      value: "eq:" + group.id,
      label: group.name,
      description: `${t("Campos equivalentes")} · ${group.columnIds.length}`,
    })),
  ];
  const resolve = (filter: PropertyFilter) =>
    columns.filter((column) =>
      (filter.columnIds ?? [filter.columnId]).includes(column.id),
    );
  const update = (index: number, patch: Partial<PropertyFilter>) =>
    onChange(
      filters.map((filter, i) =>
        i === index ? { ...filter, ...patch } : filter,
      ),
      groups,
      logic,
    );
  const initial = (key: string): PropertyFilter | null => {
    const equivalence = key.startsWith("eq:")
      ? equivalences.find((group) => group.id === key.slice(3))
      : undefined;
    const selected = columns.filter((column) =>
      equivalence
        ? equivalence.columnIds.includes(column.id)
        : column.id === key,
    );
    if (!selected.length) return null;
    const ops = filterOperators(selected[0]).filter((op) =>
      selected.every((column) => filterOperators(column).includes(op)),
    );
    if (!ops.length) return null;
    const op = ops[0];
    return {
      id: newId(),
      columnId: selected[0].id,
      ...(equivalence
        ? {
            groupId: equivalence.id,
            columnIds: selected.map((column) => column.id),
          }
        : selected[0].databaseId
          ? { databaseId: selected[0].databaseId }
          : {}),
      op,
      value: ["any", "all", "none"].includes(op) ? [] : "",
    };
  };
  return (
    <div className={`criteria-filter-group ${depth ? "nested" : ""}`}>
      <div className="criteria-group-heading">
        <span>
          {t(depth ? "Grupo de condiciones" : "Mostrar registros que cumplan")}
        </span>
        <CriteriaSelect
          label={t("Combinar condiciones")}
          options={[
            { value: "and", label: t("Todas las condiciones (Y)") },
            { value: "or", label: t("Cualquiera de las condiciones (O)") },
          ]}
          values={[logic]}
          onChange={(values) =>
            onChange(filters, groups, values[0] === "or" ? "or" : "and")
          }
        />
        {onRemove && (
          <Button
            icon
            aria-label={t("Eliminar grupo")}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      {filters.map((filter, index) => {
        const selected = resolve(filter),
          column = selected[0];
        const operators = column
          ? filterOperators(column).filter((op) =>
              selected.every((item) => filterOperators(item).includes(op)),
            )
          : [];
        const opLabel = (op: keyof typeof FILTER_LABELS) =>
          column && filterKind(column) === "date"
            ? op === "lt"
              ? t("Es anterior a")
              : op === "gt"
                ? t("Es posterior a")
                : op === "gte"
                  ? t("En esta fecha o después")
                  : op === "lte"
                    ? t("En esta fecha o antes")
                    : t(FILTER_LABELS[op])
            : t(FILTER_LABELS[op]);
        return (
          <div
            className={`criteria-filter-row ${filter.disabled ? "disabled" : ""}`}
            key={filter.id ?? `${filter.columnId}-${index}`}
          >
            <div className="criteria-rule-heading">
              <input
                type="checkbox"
                checked={!filter.disabled}
                aria-label={t("Activar condición")}
                onChange={(event) =>
                  update(index, { disabled: !event.target.checked })
                }
              />
              <CriteriaSelect
                label={t("Propiedad del filtro")}
                options={options}
                values={[
                  filter.groupId ? "eq:" + filter.groupId : filter.columnId,
                ]}
                onChange={(values) => {
                  const next = initial(values[0]);
                  if (next) update(index, { ...next, id: filter.id });
                }}
              />
              <Button
                icon
                aria-label={t("Duplicar condición")}
                disabled={total >= 100}
                onClick={() =>
                  onChange(
                    [...filters, { ...filter, id: newId() }],
                    groups,
                    logic,
                  )
                }
              >
                <Copy size={13} />
              </Button>
              <Button
                icon
                aria-label={t("Eliminar condición")}
                onClick={() =>
                  onChange(
                    filters.filter((_, i) => i !== index),
                    groups,
                    logic,
                  )
                }
              >
                <X size={14} />
              </Button>
            </div>
            {column ? (
              <div className="criteria-rule-value">
                <CriteriaSelect
                  label={t("Condición del filtro")}
                  options={operators.map((value) => ({
                    value,
                    label: opLabel(value),
                  }))}
                  values={[filter.op]}
                  onChange={(values) => {
                    const op = values[0] as PropertyFilter["op"];
                    update(index, {
                      op,
                      value: ["any", "all", "none"].includes(op)
                        ? Array.isArray(filter.value)
                          ? filter.value
                          : filter.value
                            ? [filter.value]
                            : []
                        : op === "between"
                          ? ["", ""]
                          : "",
                    });
                  }}
                />
                <Operand
                  key={`${filter.columnId}:${filter.op}`}
                  filter={filter}
                  columns={selected}
                  onChange={(value) => update(index, { value })}
                />
              </div>
            ) : (
              <p className="hint">
                {t(
                  "La propiedad ya no existe. Elige otra o elimina esta condición.",
                )}
              </p>
            )}
            {!filter.disabled && !isFilterReady(filter) && (
              <small className="criteria-pending">
                {t("Completa el valor para activar esta condición.")}
              </small>
            )}
          </div>
        );
      })}
      {groups.map((group, index) => (
        <div className="criteria-subgroup" key={group.id}>
          <FilterEditor
            filters={group.filters}
            groups={group.groups ?? []}
            logic={group.logic}
            depth={depth + 1}
            columns={columns}
            equivalences={equivalences}
            total={total}
            onRemove={() =>
              onChange(
                filters,
                groups.filter((_, i) => i !== index),
                logic,
              )
            }
            onChange={(nextFilters, nextGroups, nextLogic) =>
              onChange(
                filters,
                groups.map((item, i) =>
                  i === index
                    ? {
                        ...item,
                        filters: nextFilters,
                        groups: nextGroups,
                        logic: nextLogic,
                      }
                    : item,
                ),
                logic,
              )
            }
          />
        </div>
      ))}
      <div className="criteria-add-row">
        <CriteriaSelect
          label={t("Añadir filtro")}
          placeholder={t("+ Añadir filtro")}
          options={options}
          values={[]}
          disabled={total >= 100}
          onChange={(values) => {
            const filter = initial(values[0]);
            if (filter) onChange([...filters, filter], groups, logic);
          }}
        />
        {depth < 3 && groups.length < 20 && (
          <Button
            disabled={total >= 100}
            onClick={() =>
              onChange(
                filters,
                [
                  ...groups,
                  {
                    id: newId(),
                    logic: logic === "and" ? "or" : "and",
                    filters: [],
                    groups: [],
                  },
                ],
                logic,
              )
            }
          >
            <Plus size={13} />
            {t("Añadir grupo")}
          </Button>
        )}
      </div>
    </div>
  );
}
function SortEditor({
  sorts,
  onChange,
  columns,
}: {
  sorts: ViewSort[];
  onChange: (sorts: ViewSort[]) => void;
  columns: FilterColumn[];
}) {
  const t = useT(),
    [drag, setDrag] = useState<number | null>(null);
  const options = [
    ...SORT_META.map(([value, label]) => ({
      value,
      label: t(label),
      description: t("Datos del registro"),
    })),
    ...columns
      .filter((column) => !column.id.startsWith("$"))
      .map((column) => ({
        value: column.id,
        label: column.name,
        description: column.databaseName,
      })),
  ];
  const move = (from: number, to: number) => {
    if (to < 0 || to >= sorts.length) return;
    const next = [...sorts],
      [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <div className="criteria-sort-editor">
      <p className="hint">
        {t(
          "Se aplica primero el criterio superior. Los valores vacíos quedan al final.",
        )}
      </p>
      <CriteriaSelect
        label={t("Ordenamientos rápidos")}
        placeholder={t("Elegir un ordenamiento rápido…")}
        options={[
          { value: "original", label: t("Orden original") },
          { value: "alpha", label: t("Alfabético: A → Z") },
          { value: "alpha_desc", label: t("Alfabético: Z → A") },
          { value: "recent", label: t("Añadidos recientemente") },
          { value: "old", label: t("Añadidos más antiguos") },
          { value: "modified", label: t("Modificados recientemente") },
          {
            value: "modified_old",
            label: t("Sin modificar desde hace más tiempo"),
          },
          { value: "images", label: t("Más imágenes primero") },
          { value: "images_asc", label: t("Menos imágenes primero") },
        ]}
        values={[]}
        onChange={(values) => {
          const presets: Record<string, ViewSort[]> = {
            original: [],
            alpha: [{ columnId: "$title", direction: "asc" }],
            alpha_desc: [{ columnId: "$title", direction: "desc" }],
            recent: [{ columnId: "$created", direction: "desc" }],
            old: [{ columnId: "$created", direction: "asc" }],
            modified: [{ columnId: "$modified", direction: "desc" }],
            modified_old: [{ columnId: "$modified", direction: "asc" }],
            images: [{ columnId: "$images", direction: "desc" }],
            images_asc: [{ columnId: "$images", direction: "asc" }],
          };
          onChange(presets[values[0]] ?? []);
        }}
      />
      {sorts.map((sort, index) => {
        const column = columns.find((column) => column.id === sort.columnId),
          kind = column ? filterKind(column) : "text";
        const dated =
          ["$created", "$modified"].includes(sort.columnId) || kind === "date";
        const asc = dated
          ? t("Más antiguos primero")
          : kind === "checkbox"
            ? t("Sin marcar primero")
            : kind === "time"
              ? t("Más temprano primero")
              : kind === "number" ||
                  kind === "files" ||
                  kind === "relation" ||
                  sort.columnId === "$images"
                ? t("Menor a mayor")
                : kind === "options"
                  ? t("Orden de las opciones")
                  : t("Ascendente: A → Z");
        const desc = dated
          ? t("Más recientes primero")
          : kind === "checkbox"
            ? t("Marcados primero")
            : kind === "time"
              ? t("Más tarde primero")
              : kind === "number" ||
                  kind === "files" ||
                  kind === "relation" ||
                  sort.columnId === "$images"
                ? t("Mayor a menor")
                : kind === "options"
                  ? t("Orden inverso de las opciones")
                  : t("Descendente: Z → A");
        return (
          <div
            className="criteria-sort-row"
            key={sort.columnId}
            draggable
            onDragStart={() => setDrag(index)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (drag !== null) move(drag, index);
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
          >
            <span
              className="criteria-sort-priority"
              title={t("Arrastra para cambiar la prioridad")}
            >
              {index + 1}
            </span>
            <CriteriaSelect
              label={t("Propiedad de ordenamiento")}
              options={options.filter(
                (option) =>
                  option.value === sort.columnId ||
                  !sorts.some((sort) => sort.columnId === option.value),
              )}
              values={[sort.columnId]}
              onChange={(values) =>
                onChange(
                  sorts.map((sort, i) =>
                    i === index ? { ...sort, columnId: values[0] } : sort,
                  ),
                )
              }
            />
            <CriteriaSelect
              label={t("Dirección del ordenamiento")}
              options={[
                { value: "asc", label: asc },
                { value: "desc", label: desc },
              ]}
              values={[sort.direction]}
              onChange={(values) =>
                onChange(
                  sorts.map((sort, i) =>
                    i === index
                      ? {
                          ...sort,
                          direction: values[0] === "desc" ? "desc" : "asc",
                        }
                      : sort,
                  ),
                )
              }
            />
            <div className="criteria-sort-actions">
              <Button
                icon
                aria-label={t("Subir prioridad")}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp size={13} />
              </Button>
              <Button
                icon
                aria-label={t("Bajar prioridad")}
                disabled={index === sorts.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown size={13} />
              </Button>
              <Button
                icon
                aria-label={t("Eliminar ordenamiento")}
                onClick={() => onChange(sorts.filter((_, i) => i !== index))}
              >
                <X size={13} />
              </Button>
            </div>
          </div>
        );
      })}
      {sorts.length < 8 && (
        <CriteriaSelect
          label={t("Añadir ordenamiento")}
          placeholder={t("+ Añadir ordenamiento")}
          options={options.filter(
            (option) => !sorts.some((sort) => sort.columnId === option.value),
          )}
          values={[]}
          onChange={(values) =>
            onChange([...sorts, { columnId: values[0], direction: "asc" }])
          }
        />
      )}
      {!!sorts.length && (
        <Button onClick={() => onChange([])}>
          {t("Quitar ordenamientos")}
        </Button>
      )}
    </div>
  );
}
export function ViewControls({
  details,
  filters,
  groups,
  logic,
  sorts,
  onChange,
  onSorts,
  equivalences = [],
  deferred = false,
}: {
  details: DatabaseDetail[];
  filters: PropertyFilter[];
  groups: PropertyFilterGroup[];
  logic: "and" | "or";
  sorts: ViewSort[];
  onChange: (
    filters: PropertyFilter[],
    groups: PropertyFilterGroup[],
    logic: "and" | "or",
  ) => void;
  onSorts: (sorts: ViewSort[]) => void;
  equivalences?: EquivalenceGroup[];
  deferred?: boolean;
}) {
  const t = useT(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [tab, setTab] = useState<"filters" | "sorts">("filters");
  const columns: FilterColumn[] = [
    ...details.flatMap((detail) =>
      detail.columns.map((column) => ({
        ...column,
        databaseName: details.length > 1 ? detail.database.name : "",
      })),
    ),
    ...metadataColumns,
  ];
  const count = activeFilterCount(filters, groups);
  const nodeCount = (
    filters: PropertyFilter[],
    groups: PropertyFilterGroup[],
  ): number =>
    filters.length +
    groups.reduce(
      (n, group) => n + 1 + nodeCount(group.filters, group.groups ?? []),
      0,
    );
  return (
    <div className="view-controls">
      <button
        ref={anchor}
        className={`button ${count || sorts.length ? "selected" : ""}`}
        aria-label={t("Filtrar y ordenar")}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={14} />
        {t("Filtrar y ordenar")}
        {!!(count + sorts.length) && (
          <span className="small-count">{count + sorts.length}</span>
        )}
      </button>
      {open && (
        <CriteriaPopover
          anchor={anchor}
          label={t("Filtros y ordenamientos")}
          onClose={() => setOpen(false)}
          className="view-controls-panel"
          width={650}
          closeOnFocusOutside={false}
        >
          <header>
            <strong>{t("Filtros y ordenamientos")}</strong>
            <Button
              icon
              aria-label={t("Cerrar")}
              onClick={() => setOpen(false)}
            >
              <X size={16} />
            </Button>
          </header>
          <div className="criteria-panel-tabs">
            <button
              className={tab === "filters" ? "active" : ""}
              onClick={() => setTab("filters")}
            >
              <Filter size={14} />
              {t("Filtros")} ({count})
            </button>
            <button
              className={tab === "sorts" ? "active" : ""}
              onClick={() => setTab("sorts")}
            >
              <ArrowUpDown size={14} />
              {t("Ordenamientos")} ({sorts.length})
            </button>
          </div>
          <div className="criteria-panel-body">
            {tab === "filters" ? (
              <FilterEditor
                columns={columns}
                equivalences={equivalences}
                filters={filters}
                groups={groups}
                logic={logic}
                onChange={onChange}
                total={nodeCount(filters, groups)}
              />
            ) : (
              <SortEditor columns={columns} sorts={sorts} onChange={onSorts} />
            )}
          </div>
          <footer>
            <span>
              {t(
                deferred
                  ? "Los filtros de Búsqueda se aplican al pulsar Buscar."
                  : "Se conserva al cambiar entre Tabla, Galería y Mapa.",
              )}
            </span>
            <Button
              onClick={() => {
                onChange([], [], "and");
                onSorts([]);
              }}
            >
              {t("Restablecer")}
            </Button>
            <Button primary onClick={() => setOpen(false)}>
              {t("Listo")}
            </Button>
          </footer>
        </CriteriaPopover>
      )}
    </div>
  );
}
