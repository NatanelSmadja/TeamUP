// Decimal units match the displayed plan reference; conservative vs binary quotas.
export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes.toLocaleString('he-IL')} B`;
  const divisor = bytes >= 1_000_000_000 ? 1_000_000_000 : bytes >= 1_000_000 ? 1_000_000 : 1_000;
  const unit = divisor === 1_000_000_000 ? 'GB' : divisor === 1_000_000 ? 'MB' : 'KB';
  return `${(bytes / divisor).toLocaleString('he-IL', {maximumFractionDigits: 2})} ${unit}`;
}

export function usageLevel(bytes: number, limit: number): 'normal' | 'warning' | 'danger' {
  return bytes >= limit * .95 ? 'danger' : bytes >= limit * .8 ? 'warning' : 'normal';
}
