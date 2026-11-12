import { useState, useEffect, useRef } from "react";
import {
  decodeMultiSelect,
  encodeMultiSelect,
  decodeCheckbox,
} from "../../shared/databases";
import { decodeDatabaseDate } from "../../shared/databaseProperties";
import type { DatabaseColumn } from "../../shared/databases";
import { useT } from "../i18n";
import { MarkdownView } from "./MarkdownView";
import { LocationCell } from "./LocationCell";
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
  const [draft, setDraft] = useState(value ?? ""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false);
  const t = useT(),
    textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value ?? ""), [value, column.type]);
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
  if (column.type === "location")
    return (
      <LocationCell
        name={column.name}
        value={value}
        onSave={onSave}
        compact={compact}
      />
    );
  const displayed = draft;
  const props = {
    className: "cell-input",
    "aria-label": column.name,
    value: displayed,
    disabled: busy,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onBlur: () => {
      if (draft !== (value ?? "")) void save(draft || null);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement))
        (e.target as HTMLInputElement).blur();
    },
  };
  if (!compact && ["text", "rich_text", "ai"].includes(column.type)) {
    const wrap = (before: string, after = before) => {
      const element = textareaRef.current;
      const start = element?.selectionStart ?? draft.length,
        end = element?.selectionEnd ?? draft.length,
        selected = draft.slice(start, end) || t("texto");
      setDraft(
        draft.slice(0, start) + before + selected + after + draft.slice(end),
      );
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(
          start + before.length,
          start + before.length + selected.length,
        );
      });
    };
    const prefixLine = (prefix: string) => {
      const element = textareaRef.current,
        start = element?.selectionStart ?? draft.length,
        lineStart = draft.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      setDraft(draft.slice(0, lineStart) + prefix + draft.slice(lineStart));
      requestAnimationFrame(() => {
        element?.focus();
        element?.setSelectionRange(
          start + prefix.length,
          start + prefix.length,
        );
      });
    };
    return (
      <div className="markdown-cell">
        {column.type === "rich_text" && (
          <div
            className="markdown-toolbar"
            role="toolbar"
            aria-label={t("Formato")}
          >
            <button
              type="button"
              aria-label={t("Negrita")}
              title={t("Negrita")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("**");
              }}
            >
              <b>B</b>
            </button>
            <button
              type="button"
              aria-label={t("Cursiva")}
              title={t("Cursiva")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("*");
              }}
            >
              <i>I</i>
            </button>
            <button
              type="button"
              aria-label={t("Título")}
              title={t("Título")}
              onMouseDown={(event) => {
                event.preventDefault();
                prefixLine("## ");
              }}
            >
              H
            </button>
            <button
              type="button"
              aria-label={t("Lista")}
              title={t("Lista")}
              onMouseDown={(event) => {
                event.preventDefault();
                prefixLine("- ");
              }}
            >
              •
            </button>
            <button
              type="button"
              aria-label={t("Enlace")}
              title={t("Enlace")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("[", "](https://)");
              }}
            >
              ↗
            </button>
            <button
              type="button"
              aria-label={t("Código")}
              title={t("Código")}
              onMouseDown={(event) => {
                event.preventDefault();
                wrap("`");
              }}
            >
              &lt;/&gt;
            </button>
            <button
              type="button"
              aria-label={preview ? t("Editar") : t("Vista previa")}
              title={preview ? t("Editar") : t("Vista previa")}
              onClick={() => setPreview(!preview)}
            >
              {preview ? t("Editar") : t("Vista previa")}
            </button>
          </div>
        )}
        {preview ? (
          <MarkdownView text={draft} />
        ) : (
          <textarea {...props} ref={textareaRef} rows={3} />
        )}
      </div>
    );
  }
  return (
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
