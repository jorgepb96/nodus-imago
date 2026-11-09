import { Plus, X } from "lucide-react";
import { Button } from "./ui";
import type { DatabaseDetail } from "../../shared/databases";
import type { EquivalenceGroup, PropertyFilter } from "../../shared/imago";
import { useT } from "../i18n";
export function Filters({
  details,
  filters,
  onChange,
  logic,
  setLogic,
  equivalences = [],
}: {
  details: DatabaseDetail[];
  filters: PropertyFilter[];
  onChange: (v: PropertyFilter[]) => void;
  logic: "and" | "or";
  setLogic: (v: "and" | "or") => void;
  equivalences?: EquivalenceGroup[];
}) {
  const t = useT(),
    columns = details
      .flatMap((d) =>
        d.columns.map((c) => ({ ...c, databaseName: d.database.name })),
      )
      .filter((c) => !["attachment", "files"].includes(c.type));
  const update = (i: number, p: Partial<PropertyFilter>) =>
    onChange(filters.map((f, j) => (i === j ? { ...f, ...p } : f)));
  return (
    <div className="filter-panel">
      <div className="row">
        <select
          aria-label={t("Filtros")}
          value={logic}
          onChange={(e) => setLogic(e.target.value as "and" | "or")}
        >
          <option value="and">{t("Todas las condiciones")}</option>
          <option value="or">{t("Cualquier condición")}</option>
        </select>
        <Button
          disabled={!columns.length}
          onClick={() => {
            const c = columns[0];
            onChange([
              ...filters,
              {
                databaseId: c.databaseId,
                columnId: c.id,
                op: "contains",
                value: "",
              },
            ]);
          }}
        >
          <Plus size={14} />
          {t("Añadir filtro")}
        </Button>
      </div>
      {filters.map((f, i) => {
        const c = columns.find((c) => c.id === f.columnId);
        return (
          <div className="row filter-rule" key={i}>
            <select
              aria-label={t("Propiedades")}
              value={f.groupId ? "eq:" + f.groupId : f.columnId}
              onChange={(e) => {
                if (e.target.value.startsWith("eq:")) {
                  const group = equivalences.find(
                    (item) => item.id === e.target.value.slice(3),
                  );
                  if (!group) return;
                  update(i, {
                    groupId: group.id,
                    columnId: group.columnIds[0],
                    columnIds: group.columnIds,
                    databaseId: undefined,
                    op: "contains",
                    value: "",
                  });
                  return;
                }
                const col = columns.find((c) => c.id === e.target.value)!;
                update(i, {
                  groupId: undefined,
                  columnIds: undefined,
                  columnId: col.id,
                  databaseId: col.databaseId,
                  op: col.type === "multi_select" ? "any" : "contains",
                  value: "",
                });
              }}
            >
              {columns.map((c) => (
                <option key={c.id} value={c.id}>
                  {details.length > 1 ? c.databaseName + " · " : ""}
                  {c.name}
                </option>
              ))}
              {!!equivalences.length && (
                <optgroup label={t("Campos equivalentes")}>
                  {equivalences.map((group) => (
                    <option key={group.id} value={"eq:" + group.id}>
                      {group.name} ·{" "}
                      {group.columnIds.length} {t("propiedades")}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <select
              aria-label={t("Tipo")}
              value={f.op}
              onChange={(e) =>
                update(i, {
                  op: e.target.value as PropertyFilter["op"],
                  value:
                    e.target.value === "all" || e.target.value === "any"
                      ? []
                      : "",
                })
              }
            >
              <option value="contains">{t("Contiene")}</option>
              <option value="equals">{t("Es igual a")}</option>
              {!f.groupId && (
                <>
                  <option value="gte">{t("Desde")}</option>
                  <option value="lte">{t("Hasta")}</option>
                </>
              )}
              {!f.groupId && c?.type === "multi_select" && (
                <>
                  <option value="any">{t("Cualquiera de")}</option>
                  <option value="all">{t("Todas las opciones")}</option>
                </>
              )}
              <option value="empty">{t("Está vacío")}</option>
            </select>
            {f.op !== "empty" &&
              (c?.options.length && !f.groupId ? (
                <select
                  aria-label={t("Opciones")}
                  multiple={f.op === "any" || f.op === "all"}
                  value={
                    f.op === "any" || f.op === "all"
                      ? Array.isArray(f.value)
                        ? f.value
                        : []
                      : String(f.value)
                  }
                  onChange={(e) =>
                    update(i, {
                      value:
                        f.op === "any" || f.op === "all"
                          ? Array.from(e.target.selectedOptions).map(
                              (o) => o.value,
                            )
                          : e.target.value,
                    })
                  }
                >
                  {f.op !== "any" && f.op !== "all" && (
                    <option value="">—</option>
                  )}
                  {c.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={t("Filtros")}
                  type={
                    c?.type === "number"
                      ? "number"
                      : c?.type === "date"
                        ? "date"
                        : "text"
                  }
                  value={String(f.value)}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              ))}
            <Button
              icon
              aria-label={t("Eliminar")}
              onClick={() => onChange(filters.filter((_, j) => j !== i))}
            >
              <X size={15} />
            </Button>
          </div>
        );
      })}
      {!filters.length && <p className="muted">{t("Sin filtros")}</p>}
    </div>
  );
}
