import { z } from "zod";
export const updatePreferencesSchema = z
  .object({
    automaticChecks: z.boolean().default(true),
    beta: z.boolean().default(false),
    autoDownload: z.boolean().default(true),
  })
  .strict();
export type UpdatePreferences = z.infer<typeof updatePreferencesSchema>;
export type UpdateStatus = {
  preferences: UpdatePreferences;
  status:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "backing-up"
    | "installing"
    | "not-available"
    | "error";
  currentVersion: string;
  version: string | null;
  progress: number | null;
  message: string;
  checkedAt: string | null;
};
