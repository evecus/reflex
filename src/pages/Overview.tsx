import { useEffect } from 'react';
import { motion } from 'framer-motion';
import CountUp from '../components/CountUp';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from 'recharts';
import { Cpu, Download, Upload, Zap, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import { useOverviewStore } from '../store/useOverviewStore';
import { useConnectionStore } from '../store/useConnectionStore';
import { formatBytes, formatRate, formatTimestamp } from '../lib/format';

const MODES = ['rule', 'global', 'direct'];

export default function Overview() {
  const { connected } = useConnectionStore();
  const {
    version,
    configs,
    currentUp,
    currentDown,
    currentMemory,
    totalUp,
    totalDown,
    trafficHistory,
    memoryHistory,
    loading,
    error,
    init,
    patchMode,
  } = useOverviewStore();

  useEffect(() => {
    if (connected && !version) init();
  }, [connected, version, init]);

  if (loading && !version) {
    return (
      <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">
        <div className="card h-24 skeleton" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card h-32 skeleton" />
          <div className="card h-32 skeleton" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card h-24 skeleton" />
          <div className="card h-24 skeleton" />
          <div className="card h-24 skeleton" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card"
          style={{ borderColor: 'rgb(var(--c-danger) / 0.3)' }}
        >
          <div className="text-sm font-medium mb-1 text-danger">连接失败</div>
          <div className="text-xs font-mono text-fg-muted">{error}</div>
          <button onClick={() => init()} className="btn-ghost mt-3">
            重试
          </button>
        </motion.div>
      </div>
    );
  }

  const chartData = trafficHistory.map((p, i) => ({
    idx: i,
    up: p.up,
    down: p.down,
    ts: formatTimestamp(p.ts),
  }));

  const memData = memoryHistory.map((v, i) => ({ idx: i, mem: v }));

  const currentMode = configs?.mode || 'rule';
  const modeList = configs?.['mode-list'] || MODES;

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">
      {/* 模式切换 + 版本信息 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="card flex flex-col md:flex-row md:items-center gap-4"
      >
        <div className="flex-1 min-w-0">
          <div className="text-xs font-mono text-fg-subtle uppercase tracking-wider mb-2">
            运行模式
          </div>
          <div className="flex gap-2">
            {modeList.map((mode) => {
              const isActive = currentMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => patchMode(mode)}
                  className={clsx(
                    'relative px-3.5 py-1.5 rounded-xl text-xs font-mono uppercase tracking-wide transition-all duration-200',
                    isActive ? 'text-accent' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="mode-active-bg"
                      className="absolute inset-0 rounded-xl"
                      style={{
                        background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.18), rgb(var(--c-accent-2) / 0.1))',
                        border: '1px solid rgb(var(--c-accent) / 0.32)',
                        boxShadow: '0 0 16px -4px rgb(var(--c-accent) / 0.35)',
                      }}
                      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                    />
                  )}
                  {!isActive && (
                    <div className="absolute inset-0 rounded-xl bg-white/[0.03] border border-white/[0.06]" />
                  )}
                  <span className="relative z-10">{mode}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          {version && (
            <div className="flex items-center gap-2">
              <Zap size={14} className={version.meta ? 'text-accent' : 'text-fg-muted'} />
              <span className="font-mono text-fg-muted">{version.version}</span>
              <span className="badge bg-ok/12 text-ok border border-ok/20">meta</span>
              <span className="badge bg-ok/12 text-ok border border-ok/20">premium</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* 速率卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          label="上行速率"
          icon={<Upload size={14} />}
          value={currentUp}
          format={(v) => formatRate(v)}
          gradId="upGrad"
          colorVar="--c-accent"
          delay={0.05}
          chart={
            <ResponsiveContainer width="100%" height={64}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="upGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(129,140,248)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="rgb(129,140,248)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="up"
                  stroke="rgb(129,140,248)"
                  strokeWidth={2}
                  fill="url(#upGrad)"
                  isAnimationActive
                  animationDuration={600}
                />
              </AreaChart>
            </ResponsiveContainer>
          }
        />
        <StatCard
          label="下行速率"
          icon={<Download size={14} />}
          value={currentDown}
          format={(v) => formatRate(v)}
          gradId="downGrad"
          colorVar="--c-accent-2"
          delay={0.1}
          chart={
            <ResponsiveContainer width="100%" height={64}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="downGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgb(45,212,191)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="rgb(45,212,191)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="down"
                  stroke="rgb(45,212,191)"
                  strokeWidth={2}
                  fill="url(#downGrad)"
                  isAnimationActive
                  animationDuration={600}
                />
              </AreaChart>
            </ResponsiveContainer>
          }
        />
      </div>

      {/* 内存 + 累计 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="内存 RSS"
          icon={<Cpu size={14} />}
          value={currentMemory}
          format={(v) => formatBytes(v)}
          gradId="memGrad"
          colorVar="--c-warn"
          delay={0.15}
          chart={
            memData.length > 0 && (
              <ResponsiveContainer width="100%" height={44}>
                <AreaChart data={memData}>
                  <defs>
                    <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(251,146,60)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="rgb(251,146,60)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="mem"
                    stroke="rgb(251,146,60)"
                    strokeWidth={2}
                    fill="url(#memGrad)"
                    isAnimationActive
                    animationDuration={600}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        />
        <SimpleStat
          label="累计上行"
          icon={<Upload size={14} />}
          value={formatBytes(totalUp)}
          delay={0.2}
        />
        <SimpleStat
          label="累计下行"
          icon={<Download size={14} />}
          value={formatBytes(totalDown)}
          delay={0.25}
        />
      </div>

      {/* 配置摘要 */}
      {configs && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="card"
        >
          <div className="flex items-center gap-2 mb-3.5">
            <Shield size={14} className="text-accent" />
            <span className="text-xs font-mono uppercase tracking-wider text-fg-muted">
              配置摘要
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <ConfigItem label="mode" value={configs.mode} />
            <ConfigItem label="log-level" value={configs['log-level']} />
            <ConfigItem label="allow-lan" value={String(configs['allow-lan'])} />
            <ConfigItem label="ipv6" value={String(configs.ipv6)} />
            {configs['mixed-port'] && <ConfigItem label="mixed-port" value={String(configs['mixed-port'])} />}
            {configs['socks-port'] && <ConfigItem label="socks-port" value={String(configs['socks-port'])} />}
            {configs['port'] && <ConfigItem label="http-port" value={String(configs['port'])} />}
            {configs.tun && <ConfigItem label="tun" value={configs.tun.enable ? 'on' : 'off'} />}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function StatCard({
  label,
  icon,
  value,
  format,
  colorVar,
  chart,
  delay = 0,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  format: (v: number) => string;
  gradId: string;
  colorVar: string;
  chart?: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="card overflow-hidden"
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: `rgb(var(${colorVar}))` }}>{icon}</span>
        <span className="text-xs font-mono uppercase tracking-wider text-fg-muted">
          {label}
        </span>
      </div>
      <div
        className="num text-2xl md:text-3xl font-bold mb-2"
        style={{ color: `rgb(var(${colorVar}))` }}
      >
        <CountUp
          end={value}
          duration={0.8}
          formattingFn={format}
          preserveValue
        />
      </div>
      {chart && <div className="-mx-4 -mb-4 mt-2">{chart}</div>}
    </motion.div>
  );
}

function SimpleStat({
  label,
  icon,
  value,
  delay = 0,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className="card"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-fg-muted">{icon}</span>
        <span className="text-xs font-mono uppercase tracking-wider text-fg-muted">
          {label}
        </span>
      </div>
      <div className="num text-xl font-bold text-fg">{value}</div>
    </motion.div>
  );
}

function ConfigItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-2.5 py-2 rounded-lg bg-white/[0.025] border border-white/[0.05]">
      <span className="text-fg-subtle font-mono text-[10px]">{label}</span>
      <span className="text-fg font-mono truncate">{value}</span>
    </div>
  );
}
