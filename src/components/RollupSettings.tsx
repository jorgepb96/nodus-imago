import { useEffect, useState } from "react";
import {
  ROLLUP_FUNCTIONS,
  type DatabaseColumnConfig,
  type DatabaseDetail,
} from "../../shared/databases";
import { CriteriaSelect } from "./CriteriaSelect";
import { useT } from "../i18n";
export function RollupSettings({
  detail,
  value,
  onChange,
}: {
  detail: DatabaseDetail;
  value: DatabaseColumnConfig;
  onChange: (v: DatabaseColumnConfig) => void;
}) {
  const t = useT(),
    [target, setTarget] = useState<DatabaseDetail | null>(null),
    [error, setError] = useState("");
  const relations = detail.columns.filter(
      (c) => c.type === "relation" && c.config.relationTargetDatabaseId,
    ),
    relation = relations.find((c) => c.id === value.rollupRelationColumnId),
    databaseId = relation?.config.relationTargetDatabaseId;
  useEffect(() => {
    let active = true;
    setTarget(null);
    if (databaseId)
      void window.imago.call("detail", { id: databaseId }).then(
        (d) => {
          if (active) {
            setTarget(d);
            setError("");
          }
        },
        (e) => {
          if (active) setError(String(e));
        },
      );
    return () => {
      active = false;
    };
  }, [databaseId]);
  return (
    <div className="stack">
      <CriteriaSelect
        label={t("Relación del rollup")}
        options={relations.map((c) => ({ value: c.id, label: c.name }))}
        values={
          value.rollupRelationColumnId ? [value.rollupRelationColumnId] : []
        }
        onChange={(v) =>
          onChange({
            ...value,
            rollupRelationColumnId: v[0],
            rollupTargetColumnId: undefined,
          })
        }
      />
      <CriteriaSelect
        label={t("Propiedad relacionada")}
        disabled={!target}
        options={
          target?.columns.map((c) => ({ value: c.id, label: c.name })) ?? []
        }
        values={value.rollupTargetColumnId ? [value.rollupTargetColumnId] : []}
        onChange={(v) => onChange({ ...value, rollupTargetColumnId: v[0] })}
      />
      <CriteriaSelect
        label={t("Agregación")}
        options={ROLLUP_FUNCTIONS.map((f) => ({
          value: f.id,
          label: t(f.label),
        }))}
        values={[value.rollupFunction ?? "count"]}
        onChange={(v) =>
          onChange({
            ...value,
            rollupFunction: v[0] as DatabaseColumnConfig["rollupFunction"],
          })
        }
      />
      <p className="hint">
        {t(
          "Se actualiza al cambiar los registros relacionados. Los filtros de la vista no alteran el resultado.",
        )}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
