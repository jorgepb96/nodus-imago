// Version labels in the interface language: «Sin trama + Editada · IA» is
// made of parts, each translated on its own.
import { versionLabel, type VersionOp } from "../shared/workshop";

type T = (text: string) => string;
export function tLabel(t: T, label: string) {
  const ai = label.endsWith(" · IA");
  const body = label
    .replace(/ · IA$/, "")
    .split(" + ")
    .map((part) => (/^\d+$/.test(part) ? part : t(part)))
    .join(" + ");
  return ai ? `${body} · ${t("IA")}` : body;
}
/** The words written on an exported copy, translated. */
export function tExport(t: T, ops: VersionOp[]) {
  const ai = ops.some((o) => o.tool === "ai");
  const base = tLabel(t, versionLabel(ops).replace(/ · IA$/, ""));
  return `${base} ${t(ai ? "mediante IA" : "digitalmente")}`;
}
