import { useEffect, useMemo, useState } from "react";
import { PROVIDERS, type ModelChoice, type VisionCatalogModel } from "../../shared/aiConfig";
import { useT } from "../i18n";
import { CriteriaSelect } from "./CriteriaSelect";

const modelKey = ({ provider, model }: ModelChoice) => `${provider}|${model}`;

export function useVisionModels(active: boolean, model: string) {
  const [catalogue, setCatalogue] = useState<{ models: VisionCatalogModel[]; error?: string } | null>(null);
  const models = catalogue?.models;
  const options = useMemo(() => (models ?? []).map(({ choice, name }) => ({
    value: modelKey(choice),
    label: name,
    description: choice.provider === "local" ? "Local" : `${PROVIDERS[choice.provider].label} · ${choice.model}`,
  })), [models]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void window.imago.call("visualTagModels").then(
      (available) => { if (current) setCatalogue({ models: available }); },
      (err) => { if (current) setCatalogue({ models: [], error: err instanceof Error ? err.message : String(err) }); },
    );
    return () => { current = false; };
  }, [active]);

  return { options, selected: models?.find(({ choice }) => modelKey(choice) === model) ?? models?.[0],
    loading: catalogue === null, error: catalogue?.error };
}

export function VisionModelPicker({ catalogue, onChange, disabled }: {
  catalogue: ReturnType<typeof useVisionModels>;
  onChange: (model: string) => void;
  disabled: boolean;
}) {
  const t = useT();
  return (
    <CriteriaSelect
      label={t("Modelo de visión")}
      options={catalogue.options}
      values={catalogue.selected ? [modelKey(catalogue.selected.choice)] : []}
      onChange={([value]) => onChange(value ?? "")}
      placeholder={t(catalogue.loading ? "Cargando modelos…" : "Seleccionar modelo…")}
      disabled={catalogue.loading || disabled || !catalogue.options.length}
    />
  );
}
