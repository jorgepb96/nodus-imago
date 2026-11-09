import type { ModelInfo, Settings } from "../../shared/imago";
import { PROVIDERS, type ModelChoice } from "../../shared/aiConfig";
import { useT } from "../i18n";
export function modelChoices(
  settings: Settings,
  models: ModelInfo[],
): ModelChoice[] {
  return [
    ...models
      .filter((m) => m.task === "vision")
      .map((m) => ({ provider: "local" as const, model: m.id })),
    ...Object.entries(settings.apiProfiles).flatMap(([provider, profile]) =>
      (profile?.models ?? []).map((model) => ({
        provider: provider as keyof typeof PROVIDERS,
        model,
      })),
    ),
  ];
}
export function ModelPicker({
  value,
  onChange,
  settings,
  models,
  inherit = false,
}: {
  value: ModelChoice | null;
  onChange: (v: ModelChoice | null) => void;
  settings: Settings;
  models: ModelInfo[];
  inherit?: boolean;
}) {
  const t = useT(),
    encode = (v: ModelChoice) => v.provider + "|" + v.model,
    choices = modelChoices(settings, models);
  return (
    <select
      aria-label="Modelo"
      value={value ? encode(value) : ""}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) {
          onChange(null);
          return;
        }
        const [provider, ...parts] = v.split("|");
        onChange({
          provider: provider as ModelChoice["provider"],
          model: parts.join("|"),
        });
      }}
    >
      {inherit && <option value="">{t("Predeterminado de Ajustes")}</option>}
      {value && !choices.some((c) => encode(c) === encode(value)) && (
        <option value={encode(value)}>
          {value.provider} · {value.model}
        </option>
      )}
      <optgroup label={t("Modelos locales")}>
        {models
          .filter((m) => m.task === "vision")
          .map((m) => (
            <option key={m.id} value={"local|" + m.id}>
              {m.label}
              {m.verified ? "" : " · no instalado"}
            </option>
          ))}
      </optgroup>
      {Object.entries(settings.apiProfiles).map(([provider, profile]) => (
        <optgroup
          key={provider}
          label={PROVIDERS[provider as keyof typeof PROVIDERS].label}
        >
          {profile?.models.map((model) => (
            <option value={provider + "|" + model} key={model}>
              {model}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
