// Search box inside a database: narrows the table, gallery, timeline and
// statistics as you type, by words (literal), by meaning (semantic, over
// images and/or the records' text) or both, without leaving the database.
import { useEffect, useRef, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import { useT } from "../i18n";
import { CriteriaSelect } from "./CriteriaSelect";

export type DatabaseSearchState = {
  query: string;
  mode: "literal" | "semantic" | "hybrid";
  sources: "both" | "images" | "text";
  limit: number;
};
export const EMPTY_DATABASE_SEARCH: DatabaseSearchState = {
  query: "",
  mode: "literal",
  sources: "both",
  limit: 100,
};

export function DatabaseSearch({
  value,
  onChange,
  modelReady,
}: {
  value: DatabaseSearchState;
  onChange: (next: DatabaseSearchState) => void;
  modelReady: boolean;
}) {
  const t = useT(),
    [draft, setDraft] = useState(value.query),
    input = useRef<HTMLInputElement>(null),
    latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  useEffect(() => setDraft(value.query), [value.query]);
  // Literal search filters as you type; a semantic one waits a little longer
  // because each query is embedded by the model.
  useEffect(() => {
    if (draft === latest.current.query) return;
    const timer = setTimeout(
      () => onChange({ ...latest.current, query: draft }),
      latest.current.mode === "literal" ? 250 : 500,
    );
    return () => clearTimeout(timer);
  }, [draft, onChange]);
  const mode = modelReady ? value.mode : "literal";
  return (
    <div className="database-search" role="search" data-tour="db-search">
      <label className="database-search-input">
        <Search size={15} />
        <input
          ref={input}
          value={draft}
          aria-label={t("Buscar en esta base de datos")}
          placeholder={t(
            mode === "literal"
              ? "Buscar en esta base de datos…"
              : "Describe lo que buscas: palabras, escenas, objetos…",
          )}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onChange({ ...value, query: draft });
            if (e.key === "Escape" && draft) {
              e.stopPropagation();
              setDraft("");
              onChange({ ...value, query: "" });
            }
          }}
        />
        {draft && (
          <button
            type="button"
            className="database-search-clear"
            aria-label={t("Borrar búsqueda")}
            onClick={() => {
              setDraft("");
              onChange({ ...value, query: "" });
              input.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </label>
      <div className="segmented" role="group" aria-label={t("Tipo de búsqueda")}>
        {(["literal", "semantic", "hybrid"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "active" : ""}
            aria-pressed={mode === m}
            disabled={m !== "literal" && !modelReady}
            title={
              m !== "literal" && !modelReady
                ? t("Prepara un modelo de embeddings para buscar por significado.")
                : t(
                    m === "literal"
                      ? "Palabras exactas en títulos y propiedades"
                      : m === "semantic"
                        ? "Por significado, en imágenes y fichas"
                        : "Palabras exactas más resultados por significado",
                  )
            }
            onClick={() => onChange({ ...value, mode: m })}
          >
            {m !== "literal" && <Sparkles size={12} />}
            {t(m === "literal" ? "Literal" : m === "semantic" ? "Semántica" : "Híbrida")}
          </button>
        ))}
      </div>
      {mode !== "literal" && (
        <>
          <div className="database-search-option">
            <CriteriaSelect
              label={t("Comparar la consulta con")}
              options={[
                { value: "both", label: t("Imagen + ficha") },
                { value: "images", label: t("Solo imagen") },
                { value: "text", label: t("Solo ficha") },
              ]}
              values={[value.sources]}
              onChange={(v) => onChange({ ...value, sources: v[0] as DatabaseSearchState["sources"] })}
            />
          </div>
          <div className="database-search-option">
            <CriteriaSelect
              label={t("Resultados por significado")}
              options={[25, 50, 100, 250, 500].map((n) => ({
                value: String(n),
                label: `${n} ${t("más parecidos")}`,
              }))}
              values={[String(value.limit)]}
              onChange={(v) => onChange({ ...value, limit: Number(v[0]) })}
            />
          </div>
        </>
      )}
    </div>
  );
}
