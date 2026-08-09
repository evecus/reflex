// 延迟值 → 颜色映射（用于节点延迟色块）
// 规则：<100ms 绿色 / 100-300ms 青色 / 300-800ms 橘色 / >800ms 红色 / null 灰色

export interface DelayColor {
  bg: string;
  text: string;
  border: string;
}

export function delayColor(delay: number | null | undefined): DelayColor {
  if (delay === null || delay === undefined) {
    return {
      bg: 'bg-fg-subtle/20',
      text: 'text-fg-subtle',
      border: 'border-fg-subtle/30',
    };
  }
  if (delay < 0) {
    return { bg: 'bg-danger/15', text: 'text-danger', border: 'border-danger/30' };
  }
  if (delay < 100) {
    return { bg: 'bg-ok/15', text: 'text-ok', border: 'border-ok/30' };
  }
  if (delay < 300) {
    return { bg: 'bg-accent/15', text: 'text-accent', border: 'border-accent/30' };
  }
  if (delay < 800) {
    return { bg: 'bg-warn/15', text: 'text-warn', border: 'border-warn/30' };
  }
  return { bg: 'bg-danger/15', text: 'text-danger', border: 'border-danger/30' };
}

/** 延迟数字的简短展示 */
export function delayLabel(delay: number | null | undefined): string {
  if (delay === null || delay === undefined) return '-';
  if (delay < 0) return 'ERR';
  return `${Math.round(delay)}`;
}
