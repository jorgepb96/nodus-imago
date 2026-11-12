import fs from "node:fs/promises";

export const DISK_RESERVE = 64 * 2 ** 20;
/** Fail before extraction/copy; reserve leaves room for SQLite journals and OS. */
export async function ensureDiskSpace(
  directory: string,
  bytes: number,
  statfs = fs.statfs,
) {
  const stats = await statfs(directory);
  const available = Number(stats.bavail) * Number(stats.bsize);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    available < bytes + DISK_RESERVE
  )
    throw new Error(
      `Espacio insuficiente. Se necesitan ${Math.ceil((bytes + DISK_RESERVE) / 2 ** 20)} MiB libres en el destino.`,
    );
}
