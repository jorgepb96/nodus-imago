import { useState, useEffect } from "react";
import {
  decodeMultiSelect,
  encodeMultiSelect,
  decodeCheckbox,
} from "../../shared/databases";
import {
  decodeDatabaseDate,
  decodeDatabaseLocation,
  encodeDatabaseLocation,
} from "../../shared/databaseProperties";
import type { DatabaseColumn } from "../../shared/databases";
import { useT } from "../i18n";
export function Cell({
  column,
  value,
  onSave,
  compact = false,
}: {
  column: DatabaseColumn;
  value: string | null;
  onSave: (v: string | null) => Promise<void>;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(
      column.type === "location"
        ? (decodeDatabaseLocation(value)?.name ?? value ?? "")
        : (value ?? ""),
    ),
    [busy, setBusy] = useState(false);
  const t = useT();
  useEffect(
    () =>
      setDraft(
        column.type === "location"
          ? (decodeDatabaseLocation(value)?.name ?? value ?? "")
          : (value ?? ""),
      ),
    [value, column.type],
  );
  const save = async (v: string | null) => {
    setBusy(true);
    try {
      await onSave(v);
    } finally {
      setBusy(false);
    }
  };
  if (["attachment", "files"].includes(column.type))
    return <span className="muted">{t("Imágenes")}</span>;
  if (["select", "multi_select", "status"].includes(column.type)) {
    const selected =
      column.type === "multi_select"
        ? decodeMultiSelect(value)
        : value
          ? [value]
          : [];
    return (
      <details className="option-picker">
        <summary aria-label={column.name}>
          <span className="chips">
            {selected.length ? (
              column.options
                .filter((o) => selected.includes(o.id))
                .map((o) => (
                  <span
                    className="chip"
                    key={o.id}
                    style={
                      { "--chip": o.color ?? "#6366f1" } as React.CSSProperties
                    }
                  >
                    {o.label}
                  </span>
                ))
            ) : (
              <span className="muted">—</span>
            )}
          </span>
        </summary>
        <div className="option-menu">
          {column.options.map((o) => (
            <label key={o.id}>
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                disabled={busy}
                onChange={() =>
                  void save(
                    column.type === "multi_select"
                      ? encodeMultiSelect(
                          selected.includes(o.id)
                            ? selected.filter((id) => id !== o.id)
                            : [...selected, o.id],
                        )
                      : selected.includes(o.id)
                        ? null
                        : o.id,
                  )
                }
              />
              <i style={{ background: o.color ?? "#6366f1" }} />
              {o.label}
            </label>
          ))}
          {!column.options.length && (
            <p>
              {t("Añadir opción")}: {t("Propiedades")}
            </p>
          )}
        </div>
      </details>
    );
  }
  if (column.type === "checkbox")
    return (
      <input
        type="checkbox"
        aria-label={column.name}
        checked={decodeCheckbox(value)}
        disabled={busy}
        onChange={(e) => void save(e.target.checked ? "1" : "0")}
      />
    );
  if (
    [
      "formula",
      "rollup",
      "unique_id",
      "created_time",
      "last_edited_time",
      "created_by",
      "last_edited_by",
      "comparison",
      "button",
      "ai_image",
    ].includes(column.type)
  )
    return <span className="computed">{value ?? "—"}</span>;
  if (column.type === "date")
    return (
      <input
        className="cell-input"
        aria-label={column.name}
        type="date"
        value={decodeDatabaseDate(value)?.start.slice(0, 10) ?? ""}
        disabled={busy}
        onChange={(e) => void save(e.target.value || null)}
      />
    );
  const location = column.type === "location";
  const displayed = draft;
  const props = {
    className: "cell-input",
    "aria-label": column.name,
    value: displayed,
    disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (
        draft !==
        (location
          ? (decodeDatabaseLocation(value)?.name ?? value ?? "")
          : (value ?? ""))
      )
        void save(
          location
            ? encodeDatabaseLocation({
                ...decodeDatabaseLocation(value),
                name: draft,
              })
            : draft || null,
        );
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement))
        (e.target as HTMLInputElement).blur();
    },
  };
  return !compact && ["text", "rich_text", "ai"].includes(column.type) ? (
    <textarea {...props} rows={3} />
  ) : (
    <input
      {...props}
      type={
        column.type === "number"
          ? "number"
          : column.type === "time"
            ? "time"
            : "text"
      }
    />
  );
}
