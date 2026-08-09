import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, Trash2, Pause, Play } from 'lucide-react';
import { clsx } from 'clsx';
import { useLogsStore } from '../store/useLogsStore';
import type { LogLevel } from '../store/useLogsStore';

const LEVEL_COLORS: Record<LogLevel, { dot: string; text: string }> = {
  debug: { dot: 'bg-fg-subtle', text: 'text-fg-subtle' },
  info: { dot: 'bg-accent', text: 'text-accent' },
  warning: { dot: 'bg-warn', text: 'text-warn' },
  error: { dot: 'bg-danger', text: 'text-danger' },
  silent: { dot: 'bg-fg-subtle', text: 'text-fg-subtle' },
};

const LEVELS: LogLevel[] = ['debug', 'info', 'warning', 'error', 'silent'];

const MAX_RENDER = 200;

export default function Logs() {
  const { logs, level, paused, streaming, setLevel, togglePause, startStream, stop, clear } =
    useLogsStore();

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startStream();
    return () => stop();
  }, [startStream, stop]);

  useEffect(() => {
    if (paused) return;
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, paused]);

  const visible = logs.length > MAX_RENDER ? logs.slice(logs.length - MAX_RENDER) : logs;
  const colors = LEVEL_COLORS[level] ?? LEVEL_COLORS.info;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto flex flex-col h-full">
      {/* 顶部工具栏 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="card flex flex-col md:flex-row md:items-center gap-3 shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center shrink-0">
            <Terminal size={15} className="text-accent" />
          </span>
          <span className="text-sm font-medium">日志流</span>
          <span className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06]">{logs.length}</span>
          {streaming && !paused && (
            <span className="text-[10px] font-mono text-ok flex items-center gap-1 px-2 py-0.5 rounded-full bg-ok/10 border border-ok/20">
              <span className="relative flex w-1.5 h-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-70" />
                <span className="relative inline-flex rounded-full w-1.5 h-1.5 bg-ok" />
              </span>
              LIVE
            </span>
          )}
        </div>

        {/* 日志级别切换 */}
        <div className="flex gap-1.5 md:ml-2 flex-wrap">
          {LEVELS.map((lv) => {
            const isActive = level === lv;
            return (
              <button
                key={lv}
                onClick={() => setLevel(lv)}
                className={clsx(
                  'relative px-2.5 py-1 rounded-lg text-[11px] font-mono uppercase tracking-wide transition-all duration-200',
                  isActive ? 'text-accent' : 'text-fg-muted hover:text-fg',
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="log-level-bg"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.18), rgb(var(--c-accent-2) / 0.1))',
                      border: '1px solid rgb(var(--c-accent) / 0.32)',
                      boxShadow: '0 0 12px -4px rgb(var(--c-accent) / 0.35)',
                    }}
                    transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                  />
                )}
                {!isActive && (
                  <div className="absolute inset-0 rounded-lg bg-white/[0.03] border border-white/[0.06]" />
                )}
                <span className="relative z-10">{lv}</span>
              </button>
            );
          })}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 md:ml-auto">
          <button
            onClick={togglePause}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs transition-all duration-200',
              paused
                ? 'bg-warn/12 text-warn border border-warn/28 hover:bg-warn/20'
                : 'bg-white/[0.03] text-fg-muted border border-white/[0.06] hover:text-fg hover:bg-white/[0.05]',
            )}
            title={paused ? '继续' : '暂停'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            <span>{paused ? '继续' : '暂停'}</span>
          </button>
          <button
            onClick={clear}
            className="btn-ghost flex items-center gap-1.5"
            title="清空日志"
          >
            <Trash2 size={12} />
            <span className="text-xs">清空</span>
          </button>
        </div>
      </motion.div>

      {/* 日志列表（终端风格） */}
      <div
        ref={containerRef}
        className="card !p-3 flex-1 min-h-0 overflow-y-auto font-mono text-xs"
        style={{ background: 'rgb(var(--c-ink-950) / 0.55)' }}
      >
        {visible.length === 0 ? (
          <div className="text-fg-subtle text-center py-8 flex flex-col items-center gap-2">
            <span className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle/40 animate-pulse [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle/40 animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle/40 animate-pulse [animation-delay:300ms]" />
            </span>
            等待日志...
          </div>
        ) : (
          <div className="space-y-0.5">
            <AnimatePresence initial={false}>
              {visible.map((log, idx) => {
                const lc = LEVEL_COLORS[log.type as LogLevel] ?? LEVEL_COLORS.info;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2 px-1.5 py-1 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <span
                      className={clsx(
                        'shrink-0 mt-1 w-1.5 h-1.5 rounded-full',
                        lc.dot,
                      )}
                    />
                    <span
                      className={clsx(
                        'shrink-0 w-16 uppercase tracking-wider text-[10px]',
                        lc.text,
                      )}
                    >
                      {log.type}
                    </span>
                    <span className="text-fg break-all whitespace-pre-wrap">
                      {log.payload}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {paused && (
              <div className={clsx('px-1 py-1', colors.text)}>
                ── 已暂停 ──
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
