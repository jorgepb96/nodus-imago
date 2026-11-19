// "+" popover at the right end of the table header: pick a property type and
// the column is created at once. Types that need setup (relation, rollup,
// formula, AI) open the Properties dialog with that type preselected.
import { useState, type RefObject } from "react";
import { Aperture, Camera, Loader2 } from "lucide-react";
import { buildTemplate, PROPERTY_TEMPLATES, type PropertyTemplate } from "../../shared/photoTemplates";
import {
  columnTypeDef,
  type DatabaseColumnType,
  type DatabaseDetail,
} from "../../shared/databases";
import { useT } from "../i18n";
import { CriteriaPopover } from "./CriteriaSelect";
import { OFFERED_COLUMN_TYPES, type Perform } from "./Properties";

/** Types that cannot be created without extra settings. */
export const NEEDS_SETUP = new Set<DatabaseColumnType>([
  "relation",
  "rollup",
  "formula",
  "ai",
]);

export function AddPropertyMenu({
  detail,
  anchor,
  perform,
  language,
  onClose,
  onCreated,
  onSetup,
}: {
  detail: DatabaseDetail;
  anchor: RefObject<HTMLElement>;
  /** Interface language: templates are created in it. */
  language: string;
  perform: Perform;
  onClose: () => void;
  onCreated: (columnId: string) => void;
  onSetup: (type: DatabaseColumnType) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const hasTitle = detail.columns.some((c) => c.type === "title");
  const types = OFFERED_COLUMN_TYPES.filter((id) => !(hasTitle && id === "title"));

  const pick = (type: DatabaseColumnType) => {
    if (busy) return;
    if (NEEDS_SETUP.has(type)) {
      onSetup(type);
      onClose();
      return;
    }
    setBusy(type);
    void perform(async () => {
      try {
        const taken = new Set(detail.columns.map((c) => c.name));
        const base = t(columnTypeDef(type).label);
        let name = base,
          n = 2;
        while (taken.has(name)) name = `${base} ${n++}`;
        const created = await window.imago.call("addColumn", {
          databaseId: detail.database.id,
          name,
          type,
        });
        onClose();
        onCreated(created.id);
      } finally {
        setBusy(null);
      }
    });
  };

  // A ready-made property: options, colours, definitions and Wikipedia links.
  const createFromTemplate = (template: PropertyTemplate) => {
    if (busy) return;
    setBusy(template.id);
    void perform(async () => {
      try {
        const built = buildTemplate(template, language);
        const taken = new Set(detail.columns.map((c) => c.name));
        let name = built.name,
          n = 2;
        while (taken.has(name)) name = `${built.name} ${n++}`;
        const created = await window.imago.call("addColumn", {
          databaseId: detail.database.id,
          name,
          type: "multi_select",
          config: built.config,
        });
        await window.imago.call("saveOptions", {
          columnId: created.id,
          options: built.options,
        });
        onClose();
        onCreated(created.id);
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <CriteriaPopover
      anchor={anchor}
      onClose={onClose}
      width={240}
      label={t("Añadir propiedad")}
      className="column-menu add-property-menu"
    >
      <div role="menu">
        <div className="column-menu-back">
          <strong>{t("Añadir propiedad")}</strong>
        </div>
        <div className="column-menu-group">
          <span className="option-menu-label add-property-heading">
            {t("Fotografía histórica")}
          </span>
          {PROPERTY_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              role="menuitem"
              className="column-menu-item"
              disabled={!!busy}
              onClick={() => createFromTemplate(template)}
            >
              {template.id === "camera-type" ? <Camera size={15} /> : <Aperture size={15} />}
              <span>{template.name[language === "es" ? "es" : "en"]}</span>
              {busy === template.id && <Loader2 size={13} className="spin column-menu-end" />}
            </button>
          ))}
        </div>
        <div className="column-menu-group add-property-types">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              className="column-menu-item"
              disabled={!!busy}
              onClick={() => pick(type)}
            >
              <span>{t(columnTypeDef(type).label)}</span>
              {busy === type && (
                <Loader2 size={13} className="spin column-menu-end" />
              )}
            </button>
          ))}
        </div>
      </div>
    </CriteriaPopover>
  );
}
