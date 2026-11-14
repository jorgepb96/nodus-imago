import { useEffect, useState } from "react";
import type { DatabaseDetail } from "../../shared/databases";
import type {
  AutomationRule,
  AutomationAction,
  AutomationRun,
} from "../../shared/automations";
import { Modal, Button } from "./ui";
import { CriteriaSelect } from "./CriteriaSelect";
import { ViewControls } from "./ViewControls";
import { Cell } from "./Cell";
import type { Perform } from "./Properties";
import { useT } from "../i18n";
export function Automations({
  detail,
  perform,
  onClose,
}: {
  detail: DatabaseDetail;
  perform: Perform;
  onClose: () => void;
}) {
  const t = useT(),
    [rules, setRules] = useState<AutomationRule[]>([]),
    [rule, setRule] = useState<AutomationRule | null>(null),
    [history, setHistory] = useState<AutomationRun[]>([]),
    [error, setError] = useState("");
  const databaseId = detail.database.id;
  useEffect(() => {
    let active = true;
    void window.imago.call("automationList", { databaseId }).then(
      (r) => {
        if (active) setRules(r);
      },
      (e) => {
        if (active) setError(String(e));
      },
    );
    const load = () =>
      void window.imago.call("automationHistory", { databaseId }).then(
        (r) => {
          if (active) setHistory(r);
        },
        (e) => {
          if (active) setError(String(e));
        },
      );
    load();
    const timer = setInterval(load, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [databaseId]);
  const fresh = (): AutomationRule => ({
    id: crypto.randomUUID(),
    databaseId,
    name: "",
    enabled: false,
    trigger: "changed",
    watchColumnId: null,
    intervalMinutes: 60,
    filters: [],
    filterGroups: [],
    filterLogic: "and",
    actions: [
      {
        kind: "set",
        columnId:
          detail.columns.find((c) => c.type === "text")?.id ??
          detail.columns[0].id,
        value: null,
        overwrite: false,
      },
    ],
  });
  const writable = detail.columns.filter((c) =>
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
      "location",
      "ai",
    ].includes(c.type),
  );
  const options = detail.columns.map((c) => ({ value: c.id, label: c.name }));
  const actionChange = (index: number, action: AutomationAction) =>
    rule &&
    setRule({
      ...rule,
      actions: rule.actions.map((a, i) => (i === index ? action : a)),
    });
  return (
    <Modal title={t("Automatizaciones")} onClose={onClose} wide layout="panels">
      <div className="modal-body automation-intro">
        <p className="hint">
          {t(
            "Las reglas solo actúan si las activas. Las acciones no disparan otras reglas. La IA genera propuestas para revisión; conserva los límites locales y de API de Ajustes.",
          )}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="property-layout">
        <div className="property-list">
          {rules.map((r) => (
            <button
              key={r.id}
              className={r.id === rule?.id ? "active" : ""}
              onClick={() => setRule(r)}
            >
              {r.enabled ? "●" : "○"} {r.name}
            </button>
          ))}
          <Button onClick={() => setRule(fresh())}>{t("Añadir regla")}</Button>
        </div>
        <div className="property-form">
          {rule && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  const saved = await window.imago.call("automationSave", rule);
                  setRule(saved);
                  setRules(
                    await window.imago.call("automationList", { databaseId }),
                  );
                });
              }}
            >
              <label>
                {t("Nombre")}
                <input
                  required
                  value={rule.name}
                  onChange={(e) => setRule({ ...rule, name: e.target.value })}
                />
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) =>
                    setRule({ ...rule, enabled: e.target.checked })
                  }
                />
                {t("Regla activada")}
              </label>
              <CriteriaSelect
                label={t("Cuándo")}
                values={[rule.trigger]}
                options={[
                  { value: "created", label: t("Al crear un registro") },
                  { value: "changed", label: t("Al cambiar una propiedad") },
                  { value: "manual", label: t("Ejecución manual") },
                  { value: "schedule", label: t("Cada intervalo") },
                ]}
                onChange={(v) =>
                  setRule({
                    ...rule,
                    trigger: v[0] as AutomationRule["trigger"],
                  })
                }
              />
              {rule.trigger === "changed" && (
                <CriteriaSelect
                  label={t("Propiedad observada")}
                  values={[rule.watchColumnId ?? "*"]}
                  options={[
                    { value: "*", label: t("Cualquier propiedad") },
                    ...options,
                  ]}
                  onChange={(v) =>
                    setRule({
                      ...rule,
                      watchColumnId: v[0] === "*" ? null : v[0],
                    })
                  }
                />
              )}
              {rule.trigger === "schedule" && (
                <label>
                  {t("Intervalo en minutos")}
                  <input
                    type="number"
                    min={5}
                    max={525600}
                    value={rule.intervalMinutes}
                    onChange={(e) =>
                      setRule({
                        ...rule,
                        intervalMinutes: Number(e.target.value),
                      })
                    }
                  />
                </label>
              )}
              <p>{t("Solo si se cumplen los filtros")}</p>
              <ViewControls
                details={[detail]}
                filters={rule.filters}
                groups={rule.filterGroups ?? []}
                logic={rule.filterLogic ?? "and"}
                sorts={[]}
                onSorts={() => {}}
                onChange={(filters, filterGroups, filterLogic) =>
                  setRule({ ...rule, filters, filterGroups, filterLogic })
                }
              />
              {rule.actions.map((action, index) => {
                const column =
                  action.kind === "analyze"
                    ? null
                    : detail.columns.find((c) => c.id === action.columnId);
                return (
                  <section className="model-preparation" key={index}>
                    <CriteriaSelect
                      label={t("Acción")}
                      values={[action.kind]}
                      options={[
                        { value: "set", label: t("Asignar valor") },
                        { value: "copy", label: t("Copiar propiedad") },
                        {
                          value: "analyze",
                          label: t("Encolar análisis de IA"),
                        },
                      ]}
                      onChange={(v) =>
                        actionChange(
                          index,
                          v[0] === "analyze"
                            ? { kind: "analyze", columnIds: [] }
                            : v[0] === "copy"
                              ? {
                                  kind: "copy",
                                  columnId: writable[0].id,
                                  sourceColumnId: writable[0].id,
                                  overwrite: false,
                                }
                              : {
                                  kind: "set",
                                  columnId: writable[0].id,
                                  value: null,
                                  overwrite: false,
                                },
                        )
                      }
                    />
                    {action.kind === "analyze" ? (
                      <CriteriaSelect
                        multiple
                        label={t("Propiedades de IA")}
                        options={options}
                        values={action.columnIds}
                        onChange={(columnIds) =>
                          actionChange(index, { ...action, columnIds })
                        }
                      />
                    ) : (
                      <>
                        <CriteriaSelect
                          label={t("Propiedad de destino")}
                          options={writable.map((c) => ({
                            value: c.id,
                            label: c.name,
                          }))}
                          values={[action.columnId]}
                          onChange={(v) =>
                            actionChange(index, { ...action, columnId: v[0] })
                          }
                        />
                        {action.kind === "copy" ? (
                          <CriteriaSelect
                            label={t("Propiedad de origen")}
                            options={options}
                            values={[action.sourceColumnId]}
                            onChange={(v) =>
                              actionChange(index, {
                                ...action,
                                sourceColumnId: v[0],
                              })
                            }
                          />
                        ) : (
                          column && (
                            <Cell
                              column={column}
                              value={action.value}
                              onSave={async (value) => {
                                actionChange(index, { ...action, value });
                              }}
                            />
                          )
                        )}
                        <label className="row">
                          <input
                            type="checkbox"
                            checked={action.overwrite}
                            onChange={(e) =>
                              actionChange(index, {
                                ...action,
                                overwrite: e.target.checked,
                              })
                            }
                          />
                          {t("Permitir sobrescribir valores existentes")}
                        </label>
                      </>
                    )}
                    <Button
                      disabled={rule.actions.length === 1}
                      onClick={() =>
                        setRule({
                          ...rule,
                          actions: rule.actions.filter((_, i) => i !== index),
                        })
                      }
                    >
                      {t("Eliminar acción")}
                    </Button>
                  </section>
                );
              })}
              <Button
                disabled={rule.actions.length >= 10}
                onClick={() =>
                  setRule({
                    ...rule,
                    actions: [
                      ...rule.actions,
                      {
                        kind: "set",
                        columnId: writable[0].id,
                        value: null,
                        overwrite: false,
                      },
                    ],
                  })
                }
              >
                {t("Añadir acción")}
              </Button>
              <footer className="row">
                <Button primary type="submit">
                  {t("Guardar")}
                </Button>
                <Button
                  disabled={!rules.some((r) => r.id === rule.id && r.enabled)}
                  onClick={() =>
                    void perform(async () => {
                      await window.imago.call("automationRun", { id: rule.id });
                    })
                  }
                >
                  {t("Ejecutar sobre los registros actuales")}
                </Button>
                <Button
                  onClick={() =>
                    void perform(async () => {
                      await window.imago.call("automationDelete", {
                        id: rule.id,
                      });
                      setRule(null);
                      setRules(
                        await window.imago.call("automationList", {
                          databaseId,
                        }),
                      );
                    })
                  }
                >
                  {t("Eliminar regla")}
                </Button>
              </footer>
            </form>
          )}
        </div>
      </div>
      <details className="modal-body automation-history">
        <summary>{t("Historial de automatizaciones")}</summary>
        <table>
          <thead>
            <tr>
              <th>{t("Fecha")}</th>
              <th>{t("Nombre")}</th>
              <th>{t("Estado")}</th>
              <th>{t("Registro")}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.createdAt).toLocaleString()}</td>
                <td>{rules.find((r) => r.id === run.ruleId)?.name}</td>
                <td>
                  {t(
                    ({ completed: "Completada", skipped: "Omitida", failed: "Fallida" } as Record<string, string>)[run.state] ?? run.state,
                  )}{" "}
                  {t(run.message)}
                </td>
                <td>{run.rowId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Modal>
  );
}
