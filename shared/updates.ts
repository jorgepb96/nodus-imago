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
  /** Structured reason, so the interface can explain and offer the right action. */
  errorCode?:
    | "update-check-failed"
    | "update-download-failed"
    | "update-install-failed"
    | "pre-update-backup-required"
    | "pre-update-backup-failed";
  /** The stable update went ahead although its safety copy could not be made. */
  backupWarning?: string;
};
