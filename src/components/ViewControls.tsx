import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  Filter,
  GripVertical,
  Plus,
  Search,
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
function criteriaColumns(details: DatabaseDetail[]): FilterColumn[] {
  return [
    ...details.flatMap((detail) =>
      detail.columns.map((column) => ({
        ...column,
        databaseName: details.length > 1 ? detail.database.name : "",
      })),
    ),
    ...metadataColumns,
  ];
}
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
/** Drag-and-drop reordering that starts only from a row's grip, so text
 * fields and pickers inside the row keep their own pointer behaviour. The grip
 * also moves its row with the arrow keys. */
function useReorder(onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<number | null>(null),
    [armed, setArmed] = useState<number | null>(null),
    [over, setOver] = useState<{
      index: number;
      side: "before" | "after";
    } | null>(null);
  const finish = () => {
    setDrag(null);
    setArmed(null);
    setOver(null);
  };
  const row = (index: number) => ({
    draggable: armed === index || drag === index,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
      setDrag(index);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (drag === null) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect(),
        side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (over?.index !== index || over.side !== side) setOver({ index, side });
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (drag === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (over) {
        let to = over.index + (over.side === "after" ? 1 : 0);
        if (to > drag) to--;
        if (to !== drag) onMove(drag, to);
      }
      finish();
    },
    onDragEnd: finish,
    "data-dragging": drag === index ? "" : undefined,
    "data-drop":
      drag !== null && drag !== index && over?.index === index
        ? over.side
        : undefined,
  });
  const handle = (index: number, count: number) => ({
    onPointerDown: () => setArmed(index),
    onPointerUp: () => setArmed(null),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      const to =
        event.key === "ArrowUp"
          ? index - 1
          : event.key === "ArrowDown"
            ? index + 1
            : -1;
      if (to < 0 || to >= count) return;
      event.preventDefault();
      onMove(index, to);
    },
  });
  return { row, handle };
}
const moveItem = <T,>(items: T[], from: number, to: number) => {
  const next = [...items],
    [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};
type ChoiceItem = CriteriaOption & { count?: number };
/** Inline multi-select for option-like filters: always-visible checklist with
 * its own search box, record counts and the current selection as chips. */
function ChoiceChecklist({
  items,
  selected,
  values,
  onChange,
  query,
  onQueryChange,
  loading = false,
  more = false,
  onMore,
  custom = false,
}: {
  items: ChoiceItem[];
  /** Known labels for selected values that the visible list may not contain. */
  selected: ChoiceItem[];
  values: string[];
  onChange: (values: string[]) => void;
  query: string;
  onQueryChange: (query: string) => void;
  loading?: boolean;
  more?: boolean;
  onMore?: () => void;
  custom?: boolean;
}) {
  const t = useT();
  const known = new Map(
    [...selected, ...items].map((item) => [item.value, item]),
  );
  const toggle = (value: string) =>
    onChange(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value].slice(0, 1000),
    );
  const trimmed = query.trim();
  const canAdd =
    custom && !!trimmed && !items.some((item) => item.value === trimmed);
  return (
    <div className="choice-checklist">
      <div className="choice-search">
        <Search size={13} />
        <input
          aria-label={t("Buscar opciones")}
          placeholder={t("Buscar opciones…")}
          value={query}
          maxLength={300}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (canAdd) {
              toggle(trimmed);
              onQueryChange("");
            } else if (items[0] && !items[0].disabled) toggle(items[0].value);
          }}
        />
        {query && (
          <button
            type="button"
            aria-label={t("Limpiar búsqueda")}
            onClick={() => onQueryChange("")}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {values.length > 0 && (
        <div className="choice-chips" aria-label={t("Valores seleccionados")}>
          {values.map((value) => {
            const item = known.get(value);
            return (
              <span className="choice-chip" key={value}>
                {item?.color && (
                  <i
                    className="criteria-option-color"
                    style={{ background: item.color }}
                  />
                )}
                <span title={item?.label ?? value}>{item?.label ?? value}</span>
                <button
                  type="button"
                  aria-label={`${t("Quitar")}: ${item?.label ?? value}`}
                  onClick={() => toggle(value)}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="choice-list" role="group" aria-label={t("Valores del filtro")}>
        {items.map((item) => (
          <label
            key={item.value}
            className={`choice-item ${values.includes(item.value) ? "checked" : ""}`}
          >
            <input
              type="checkbox"
              checked={values.includes(item.value)}
              disabled={item.disabled}
              onChange={() => toggle(item.value)}
            />
            {item.color && (
              <i
                className="criteria-option-color"
                style={{ background: item.color }}
              />
            )}
            <span className="choice-label" title={item.label}>
              {item.label}
              {item.description && <small>{item.description}</small>}
            </span>
            {item.count !== undefined && (
              <small className="choice-count">
                {item.count.toLocaleString()}
              </small>
            )}
          </label>
        ))}
        {canAdd && (
          <button
            type="button"
            className="choice-add"
            onClick={() => {
              toggle(trimmed);
              onQueryChange("");
            }}
          >
            <Plus size={12} />
            {t("Usar este valor")}: {trimmed}
          </button>
        )}
        {loading && (
          <p className="hint" role="status">
            {t("Cargando opciones…")}
          </p>
        )}
        {!items.length && !loading && !canAdd && (
          <p className="hint">{t("Sin coincidencias")}</p>
        )}
        {more && (
          <button
            type="button"
            className="choice-add"
            disabled={loading}
            onClick={onMore}
          >
            {t("Cargar más opciones")}
          </button>
        )}
      </div>
      <div className="choice-footer">
        <span>
          {values.length
            ? `${values.length.toLocaleString()} ${t(values.length === 1 ? "seleccionado" : "seleccionados")}`
            : t("Ninguno seleccionado")}
        </span>
        <button
          type="button"
          disabled={!items.length}
          onClick={() =>
            onChange(
              [
                ...new Set([
                  ...values,
                  ...items
                    .filter((item) => !item.disabled)
                    .map((item) => item.value),
                ]),
              ].slice(0, 1000),
            )
          }
        >
          {t(query ? "Seleccionar resultados" : "Seleccionar todo")}
        </button>
        <button
          type="button"
          disabled={!values.length}
          onClick={() => onChange([])}
        >
          {t("Limpiar selección")}
        </button>
      </div>
    </div>
  );
}
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
  const [choices, setChoices] = useState<ChoiceItem[]>([]),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(false),
    [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<ChoiceItem[]>([]);
  const ids = columns.map((column) => column.id).join("|");
  const choiceMode = ["any", "all", "none"].includes(filter.op);
  const selectedSignature = JSON.stringify(
    Array.isArray(filter.value)
      ? filter.value
      : filter.value
        ? [filter.value]
        : [],
  );
  const asItem = (item: { value: string; label: string; count: number }) => ({
    value: item.value,
    label: item.label,
    count: item.count,
  });
  useEffect(() => {
    setOffset(0);
  }, [query, ids]);
  // Option properties list every option locally; one lookup adds how many
  // records currently use each one.
  useEffect(() => {
    if (!choiceMode || kind !== "options") return;
    let cancelled = false;
    const optionIds = [
      ...new Set(columns.flatMap((source) => source.options.map((o) => o.id))),
    ].slice(0, 1000);
    if (!optionIds.length) return;
    void window.imago
      .call("propertyChoices", { columnIds: ids.split("|"), selected: optionIds })
      .then((result) => {
        if (cancelled) return;
        const next = new Map<string, number>();
        for (const item of result.selections)
          next.set(item.value, (next.get(item.value) ?? 0) + item.count);
        setCounts(next);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
    // The option catalogue is part of the column identity for this lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choiceMode, kind, ids]);
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
                      [...previous, ...result.choices.map(asItem)].map(
                        (item) => [item.value, item],
                      ),
                    ).values(),
                  ]
                : result.choices.map(asItem),
            );
            setSelectedOptions(result.selections.map(asItem));
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
    const values = Array.isArray(filter.value)
      ? filter.value
      : filter.value
        ? [filter.value]
        : [];
    const fold = (text: string) =>
      text
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
    const items: ChoiceItem[] =
      kind === "options"
        ? columns
            .flatMap((source) =>
              source.options.map((option) => ({
                value: option.id,
                label: option.label,
                color: option.color,
                count: counts ? (counts.get(option.id) ?? 0) : undefined,
                description:
                  columns.length > 1
                    ? `${source.databaseName} · ${source.name}`
                    : undefined,
              })),
            )
            .filter((option) => fold(option.label).includes(fold(query)))
        : choices;
    return (
      <div className="criteria-operand">
        <ChoiceChecklist
          items={items}
          selected={selectedOptions}
          values={values}
          onChange={onChange}
          query={query}
          onQueryChange={setQuery}
          loading={kind !== "options" && loading}
          more={kind !== "options" && more}
          onMore={() => setOffset((n) => n + 50)}
          custom={!["options", "relation", "person"].includes(kind)}
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
    kind === "number" || kind === "files" || kind === "period"
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
  const reorder = useReorder((from, to) =>
    onChange(moveItem(filters, from, to), groups, logic),
  );
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
          column && filterKind(column) === "period"
            ? t(
                op === "between"
                  ? "Coincide con el periodo"
                  : op === "equals"
                    ? "Incluye el año"
                    : op === "lt"
                      ? "Termina antes del año"
                      : op === "gt"
                        ? "Empieza después del año"
                        : op === "empty"
                          ? "No tiene periodo"
                          : op === "not_empty"
                            ? "Tiene periodo"
                            : FILTER_LABELS[op],
              )
            : column && filterKind(column) === "date"
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
            {...reorder.row(index)}
          >
            <div className="criteria-rule-heading">
              <button
                type="button"
                className="criteria-grip"
                aria-label={t("Mover condición (arrastra o usa las flechas)")}
                title={t("Arrastra para reordenar")}
                disabled={filters.length < 2}
                {...reorder.handle(index, filters.length)}
              >
                <GripVertical size={14} />
              </button>
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
                title={t("Eliminar condición")}
                className="criteria-delete"
                onClick={() =>
                  onChange(
                    filters.filter((_, i) => i !== index),
                    groups,
                    logic,
                  )
                }
              >
                <Trash2 size={13} />
              </Button>
            </div>
            {column ? (
              <div
                className={`criteria-rule-value ${["any", "all", "none"].includes(filter.op) ? "choices" : ""}`}
              >
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
/** Labels for each direction, worded for what the property holds. */
function sortDirectionLabels(
  sort: ViewSort,
  column: FilterColumn | undefined,
  t: (text: string) => string,
): [string, string] {
  const kind = column ? filterKind(column) : "text";
  if (["$created", "$modified"].includes(sort.columnId) || kind === "date" || kind === "period")
    return [t("Más antiguos primero"), t("Más recientes primero")];
  if (kind === "checkbox") return [t("Sin marcar primero"), t("Marcados primero")];
  if (kind === "time") return [t("Más temprano primero"), t("Más tarde primero")];
  if (kind === "options")
    return sort.by === "label"
      ? [t("A → Z"), t("Z → A")]
      : sort.by === "count"
        ? [t("Menos valores primero"), t("Más valores primero")]
        : [t("Orden de las opciones"), t("Orden inverso")];
  if (
    kind === "number" ||
    kind === "files" ||
    kind === "relation" ||
    sort.columnId === "$images" ||
    sort.columnId === "$position"
  )
    return [t("Menor a mayor"), t("Mayor a menor")];
  return [t("A → Z"), t("Z → A")];
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
  const t = useT();
  const reorder = useReorder((from, to) => onChange(moveItem(sorts, from, to)));
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
  const update = (index: number, patch: Partial<ViewSort>) =>
    onChange(
      sorts.map((sort, i) => {
        if (i !== index) return sort;
        const next = { ...sort, ...patch };
        // Optional refinements are stored only when they differ from the default.
        if (next.empty !== "first") delete next.empty;
        if (!next.by) delete next.by;
        return next;
      }),
    );
  return (
    <div className="criteria-sort-editor">
      <p className="hint">
        {t(
          "Se aplica primero el criterio superior; los siguientes deshacen los empates. Arrastra desde el asa para cambiar la prioridad.",
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
      {!sorts.length && (
        <p className="criteria-empty">
          {t("Sin ordenamientos: los registros siguen su orden original.")}
        </p>
      )}
      <div className="criteria-sort-list">
        {sorts.map((sort, index) => {
          const column = columns.find((column) => column.id === sort.columnId),
            kind = column ? filterKind(column) : "text",
            [asc, desc] = sortDirectionLabels(sort, column, t);
          const name =
            options.find((option) => option.value === sort.columnId)?.label ??
            sort.columnId;
          return (
            <div
              className="criteria-sort-row"
              key={sort.columnId}
              {...reorder.row(index)}
            >
              <div className="criteria-sort-main">
                <button
                  type="button"
                  className="criteria-grip"
                  aria-label={`${t("Mover ordenamiento (arrastra o usa las flechas)")}: ${name}`}
                  title={t("Arrastra para cambiar la prioridad")}
                  disabled={sorts.length < 2}
                  {...reorder.handle(index, sorts.length)}
                >
                  <GripVertical size={14} />
                </button>
                <span
                  className="criteria-sort-priority"
                  aria-label={`${t("Prioridad")} ${index + 1}`}
                >
                  {index === 0 ? t("Ordenar por") : t("y después por")}
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
                    update(index, { columnId: values[0], by: undefined })
                  }
                />
                <Button
                  icon
                  className="criteria-delete"
                  aria-label={`${t("Eliminar ordenamiento")}: ${name}`}
                  title={t("Eliminar ordenamiento")}
                  onClick={() => onChange(sorts.filter((_, i) => i !== index))}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
              <div className="criteria-sort-extra">
                <div
                  className="criteria-segmented"
                  role="group"
                  aria-label={t("Dirección del ordenamiento")}
                >
                  {(
                    [
                      ["asc", asc, ArrowUp],
                      ["desc", desc, ArrowDown],
                    ] as const
                  ).map(([direction, label, Icon]) => (
                    <button
                      type="button"
                      key={direction}
                      aria-pressed={sort.direction === direction}
                      onClick={() => update(index, { direction })}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  ))}
                </div>
                {kind === "options" && (
                  <div className="criteria-sort-mode">
                    <span>{t("Según")}</span>
                    <CriteriaSelect
                      label={t("Criterio de las opciones")}
                      options={[
                        { value: "position", label: t("Orden de las opciones") },
                        { value: "label", label: t("Nombre de la opción") },
                        ...(column?.type === "multi_select"
                          ? [{ value: "count", label: t("Número de valores") }]
                          : []),
                      ]}
                      values={[sort.by ?? "position"]}
                      onChange={(values) =>
                        update(index, {
                          by:
                            values[0] === "label" || values[0] === "count"
                              ? values[0]
                              : undefined,
                        })
                      }
                    />
                  </div>
                )}
                <div
                  className="criteria-segmented compact"
                  role="group"
                  aria-label={t("Registros sin valor")}
                >
                  <span>{t("Vacíos")}</span>
                  {(
                    [
                      ["last", t("Al final")],
                      ["first", t("Al principio")],
                    ] as const
                  ).map(([empty, label]) => (
                    <button
                      type="button"
                      key={empty}
                      aria-pressed={(sort.empty ?? "last") === empty}
                      onClick={() => update(index, { empty })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="criteria-add-row">
        {sorts.length < 8 && (
          <CriteriaSelect
            label={t("Añadir ordenamiento")}
            placeholder={t(sorts.length ? "+ Añadir criterio de desempate" : "+ Añadir ordenamiento")}
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
            <Trash2 size={13} />
            {t("Quitar ordenamientos")}
          </Button>
        )}
      </div>
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
  openRequest = 0,
  sortRequest = 0,
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
  /** Bumped by the column menu's "Filter" to open the panel on the filters. */
  openRequest?: number;
  /** Bumped by the criteria bar to open the panel on the sorts. */
  sortRequest?: number;
}) {
  const t = useT(),
    anchor = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [tab, setTab] = useState<"filters" | "sorts">("filters");
  useEffect(() => {
    if (!openRequest) return;
    setTab("filters");
    setOpen(true);
  }, [openRequest]);
  useEffect(() => {
    if (!sortRequest) return;
    setTab("sorts");
    setOpen(true);
  }, [sortRequest]);
  const columns = criteriaColumns(details);
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
        data-tour="db-filter"
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

/** One-line summary of the active criteria under the toolbar: each filter and
 * sort is a chip that opens the panel or removes itself. */
export function CriteriaBar({
  details,
  filters,
  groups,
  logic,
  sorts,
  onChange,
  onSorts,
  onOpenFilters,
  onOpenSorts,
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
  onOpenFilters: () => void;
  onOpenSorts: () => void;
}) {
  const t = useT();
  const columns = criteriaColumns(details);
  const ready = filters
    .map((filter, index) => ({ filter, index }))
    .filter(({ filter }) => isFilterReady(filter));
  const groupCount = groups.reduce(
    (n, group) => n + activeFilterCount(group.filters, group.groups ?? []),
    0,
  );
  if (!ready.length && !groupCount && !sorts.length) return null;
  const nameOf = (id: string) => {
    const meta = SORT_META.find(([key]) => key === id);
    if (meta) return t(meta[1]);
    return columns.find((column) => column.id === id)?.name ?? id;
  };
  const describe = (filter: PropertyFilter) => {
    const column = columns.find((item) => item.id === filter.columnId);
    const kind = column ? filterKind(column) : "text";
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    let shown = "";
    if (filterNeedsValue(filter.op)) {
      if (filter.op === "relative_date")
        shown = t(
          RELATIVE_DATES.find(([key]) => key === filter.value)?.[1] ??
            String(filter.value),
        );
      else if (filter.op === "between") shown = `${values[0]} – ${values[1]}`;
      else if (kind === "options")
        shown = values
          .map(
            (value) =>
              columns
                .flatMap((item) => item.options)
                .find((option) => option.id === value)?.label ?? value,
          )
          .join(", ");
      else if (kind === "person" || kind === "relation")
        shown =
          values.length === 1
            ? `1 ${t("valor")}`
            : `${values.length} ${t("valores")}`;
      else shown = values.join(", ");
    }
    return `${t(FILTER_LABELS[filter.op]).toLowerCase()}${shown ? ` ${shown}` : ""}`;
  };
  return (
    <div className="criteria-bar" aria-label={t("Criterios activos")}>
      {ready.map(({ filter, index }, position) => {
        const name = filter.groupId
          ? (columns.find((column) => column.id === filter.columnId)?.name ?? "")
          : nameOf(filter.columnId);
        const text = `${name} ${describe(filter)}`;
        return (
          <span className="criteria-chip" key={filter.id ?? index}>
            {position > 0 && (
              <em className="criteria-chip-logic">
                {t(logic === "or" ? "o" : "y")}
              </em>
            )}
            <button type="button" title={text} onClick={onOpenFilters}>
              <Filter size={11} />
              <b>{name}</b>
              <span>{describe(filter)}</span>
            </button>
            <button
              type="button"
              className="criteria-chip-remove"
              aria-label={`${t("Quitar filtro")}: ${text}`}
              onClick={() =>
                onChange(
                  filters.filter((_, i) => i !== index),
                  groups,
                  logic,
                )
              }
            >
              <X size={11} />
            </button>
          </span>
        );
      })}
      {!!groupCount && (
        <span className="criteria-chip">
          <button type="button" onClick={onOpenFilters}>
            <Filter size={11} />
            <b>{t("Grupos de condiciones")}</b>
            <span>{groupCount}</span>
          </button>
          <button
            type="button"
            className="criteria-chip-remove"
            aria-label={t("Quitar grupos de condiciones")}
            onClick={() => onChange(filters, [], logic)}
          >
            <X size={11} />
          </button>
        </span>
      )}
      {(ready.length > 0 || groupCount > 0) && sorts.length > 0 && (
        <i className="criteria-bar-divider" aria-hidden="true" />
      )}
      {sorts.map((sort, index) => {
        const column = columns.find((item) => item.id === sort.columnId);
        const label = sortDirectionLabels(sort, column, t)[
          sort.direction === "desc" ? 1 : 0
        ];
        const name = nameOf(sort.columnId);
        return (
          <span className="criteria-chip sort" key={sort.columnId}>
            <button
              type="button"
              title={`${index + 1}. ${name}: ${label}`}
              onClick={onOpenSorts}
            >
              {sort.direction === "desc" ? (
                <ArrowDown size={11} />
              ) : (
                <ArrowUp size={11} />
              )}
              <b>{name}</b>
              <span>{label}</span>
            </button>
            <button
              type="button"
              className="criteria-chip-remove"
              aria-label={`${t("Quitar ordenamiento")}: ${name}`}
              onClick={() => onSorts(sorts.filter((_, i) => i !== index))}
            >
              <X size={11} />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        className="criteria-bar-clear"
        onClick={() => {
          onChange([], [], logic);
          onSorts([]);
        }}
      >
        {t("Borrar todo")}
      </button>
    </div>
  );
}
