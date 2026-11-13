import { z } from "zod";
export const backupPreferencesSchema = z
  .object({
    enabled: z.boolean().default(false),
    schedule: z.enum(["interval", "schedule"]).default("schedule"),
    intervalHours: z.number().int().min(1).max(8760).default(24),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    hour: z.number().int().min(0).max(23).default(20),
    minute: z.number().int().min(0).max(59).default(0),
    retentionEnabled: z.boolean().default(false),
    keepLast: z.number().int().min(3).max(1000).default(10),
  })
  .strict();
export type BackupPreferences = z.infer<typeof backupPreferencesSchema>;
export type BackupEntry = {
  id: string;
  file: string;
  createdAt: string;
  bytes: number;
  sha256: string;
  encrypted: boolean;
  keyId: string;
  archived: boolean;
  verifiedAt: string;
  reason: "manual" | "automatic" | "before-restore" | "before-update";
};
export type BackupStatus = {
  preferences: BackupPreferences;
  folder: string;
  passwordStored: boolean;
  secureStorageAvailable: boolean;
  busy: boolean;
  phase: string;
  lastSuccess: string | null;
  lastError: string | null;
  entries: (BackupEntry & { available: boolean })[];
};
export function backupDue(
  preferences: BackupPreferences,
  lastAt: string | null,
  now = new Date(),
) {
  const last = lastAt ? Date.parse(lastAt) : NaN;
  if (preferences.schedule === "interval")
    return (
      !Number.isFinite(last) ||
      last > now.getTime() ||
      now.getTime() - last >= preferences.intervalHours * 3600000
    );
  for (let back = 0; back <= 7; back++) {
    const slot = new Date(now);
    slot.setDate(slot.getDate() - back);
    slot.setHours(preferences.hour, preferences.minute, 0, 0);
    if (
      slot <= now &&
      (!preferences.days.length || preferences.days.includes(slot.getDay()))
    )
      return (
        !Number.isFinite(last) || last > now.getTime() || last < slot.getTime()
      );
  }
  return false;
}
