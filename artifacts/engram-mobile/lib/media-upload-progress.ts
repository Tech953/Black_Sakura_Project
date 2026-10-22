export function getMediaUploadPercent(loaded: number, total: number): number | null {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(99, Math.max(0, Math.floor((loaded / total) * 100)));
}
