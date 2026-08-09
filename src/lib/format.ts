// 格式化工具

/** 字节数 → 人类可读（B / KB / MB / GB） */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes < 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

/** 字节/秒 → 速率（自动带 /s 后缀） */
export function formatRate(bytesPerSec: number, decimals = 1): string {
  return `${formatBytes(bytesPerSec, decimals)}/s`;
}

/** 毫秒延迟 → "123ms" 或 "timeout" */
export function formatDelay(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'timeout';
  if (ms < 0) return 'error';
  return `${Math.round(ms)}ms`;
}

/** ISO 时间 → "HH:MM:SS" */
export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/** 持续时长（从 started 至今）→ "1m 23s" */
export function formatDuration(startedISO: string): string {
  try {
    const start = new Date(startedISO).getTime();
    const now = Date.now();
    let sec = Math.floor((now - start) / 1000);
    if (sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  } catch {
    return '-';
  }
}

/** 大数字加千分位 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** 时间戳 → "HH:MM:SS" */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
