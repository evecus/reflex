import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings as SettingsIcon,
  Loader,
  Zap,
  Search,
  Database,
  Trash2,
  RefreshCw,
  Sun,
  Moon,
  Type,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useOverviewStore } from '../store/useOverviewStore';
import { useThemeStore, type FontFamily, type Theme } from '../store/useThemeStore';
import { clashClient } from '../api/client';
import type { DnsQueryResp, DnsQueryType } from '../api/types';

const LOG_LEVELS = ['error', 'warning', 'info', 'debug', 'silent'];
const FALLBACK_MODES = ['rule', 'global', 'direct'];
const MODE_DESCRIPTIONS: Record<string, string> = {
  rule: '按规则分流',
  global: '全部走代理',
  direct: '全部直连',
};

const QUERY_TYPES: DnsQueryType[] = [
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'NS',
  'TXT',
  'PTR',
  'SRV',
  'SOA',
  'CAA',
];

function cardMotion(delay: number) {
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  };
}

export default function Settings() {
  const {
    version,
    configs,
    refreshConfigs,
    patchMode,
    patchLogLevel,
  } = useOverviewStore();
  const { theme, font, setTheme, setFont } = useThemeStore();

  const [dnsName, setDnsName] = useState('example.com');
  const [qtype, setQtype] = useState<DnsQueryType>('A');
  const [querying, setQuerying] = useState(false);
  const [dnsResult, setDnsResult] = useState<DnsQueryResp | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [flushingCache, setFlushingCache] = useState(false);
  const [flushingFakeip, setFlushingFakeip] = useState(false);
  const [opMsg, setOpMsg] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  useEffect(() => {
    void refreshConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuery = async () => {
    const trimmed = dnsName.trim();
    if (!trimmed) return;
    setQuerying(true);
    setQueryError(null);
    setDnsResult(null);
    try {
      const resp = await clashClient.dnsQuery(trimmed, qtype);
      setDnsResult(resp);
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuerying(false);
    }
  };

  const handleFlushCache = async () => {
    if (!window.confirm('确认清空 DNS 缓存？')) return;
    setFlushingCache(true);
    setOpMsg(null);
    try {
      await clashClient.flushDnsCache();
      setOpMsg({ text: 'DNS 缓存已清空', ok: true });
    } catch (e) {
      setOpMsg({
        text: `清空失败：${e instanceof Error ? e.message : String(e)}`,
        ok: false,
      });
    } finally {
      setFlushingCache(false);
    }
  };

  const handleFlushFakeip = async () => {
    if (!window.confirm('确认重置 FakeIP 池？')) return;
    setFlushingFakeip(true);
    setOpMsg(null);
    try {
      await clashClient.flushFakeip();
      setOpMsg({ text: 'FakeIP 池已重置', ok: true });
    } catch (e) {
      setOpMsg({
        text: `重置失败：${e instanceof Error ? e.message : String(e)}`,
        ok: false,
      });
    } finally {
      setFlushingFakeip(false);
    }
  };

  const currentMode = configs?.mode || 'rule';
  const modeList = configs?.['mode-list'] || FALLBACK_MODES;
  const currentLogLevel = configs?.['log-level'] || 'info';

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-x-6 lg:gap-y-4">
      {/* 面板外观：主题 + 字体 */}
      <motion.div {...cardMotion(0)} className="card space-y-4">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center">
            <SettingsIcon size={15} className="text-accent" />
          </span>
          <span className="text-sm font-medium">面板外观</span>
        </div>

        {/* 主题切换 */}
        <div className="space-y-2">
          <div className="text-xs font-mono uppercase tracking-wider text-fg-subtle">
            主题
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: 'dark', label: '暗色', icon: <Moon size={14} /> },
              { v: 'light', label: '亮色', icon: <Sun size={14} /> },
            ] as { v: Theme; label: string; icon: React.ReactNode }[]).map(
              (opt) => {
                const isActive = theme === opt.v;
                return (
                  <button
                    key={opt.v}
                    onClick={() => setTheme(opt.v)}
                    className={clsx(
                      'relative flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs transition-all duration-200',
                      isActive ? 'text-accent' : 'text-fg-muted hover:text-fg',
                    )}
                    style={
                      isActive
                        ? {
                            background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent-2) / 0.08))',
                            border: '1px solid rgb(var(--c-accent) / 0.32)',
                            boxShadow: '0 0 14px -4px rgb(var(--c-accent) / 0.35)',
                          }
                        : {
                            background: 'rgb(var(--glass-bg) / 0.03)',
                            border: '1px solid rgb(var(--c-line) / 0.06)',
                          }
                    }
                  >
                    {opt.icon}
                    <span className="font-mono uppercase tracking-wide">{opt.label}</span>
                  </button>
                );
              },
            )}
          </div>
        </div>

        {/* 字体切换 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-fg-subtle">
            <Type size={12} />
            字体
          </div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { v: 'sans', label: 'Manrope', sample: 'Aa 正文' },
              { v: 'mono', label: 'JetBrains', sample: 'Aa 等宽' },
              { v: 'display', label: 'Space Mono', sample: 'Aa 数字' },
            ] as { v: FontFamily; label: string; sample: string }[]).map(
              (opt) => {
                const isActive = font === opt.v;
                return (
                  <button
                    key={opt.v}
                    onClick={() => setFont(opt.v)}
                    className={clsx(
                      'relative flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-xl text-left transition-all duration-200',
                      isActive ? 'text-accent' : 'text-fg-muted hover:text-fg',
                    )}
                    style={
                      isActive
                        ? {
                            background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent-2) / 0.08))',
                            border: '1px solid rgb(var(--c-accent) / 0.32)',
                            boxShadow: '0 0 14px -4px rgb(var(--c-accent) / 0.35)',
                          }
                        : {
                            background: 'rgb(var(--glass-bg) / 0.03)',
                            border: '1px solid rgb(var(--c-line) / 0.06)',
                          }
                    }
                  >
                    <span className="text-[10px] font-mono uppercase tracking-wide">
                      {opt.label}
                    </span>
                    <span
                      className={clsx(
                        'text-sm',
                        opt.v === 'sans' && 'font-sans',
                        opt.v === 'mono' && 'font-mono',
                        opt.v === 'display' && 'font-display',
                      )}
                    >
                      {opt.sample}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </div>
      </motion.div>

      {/* 内核版本 + 运行模式 */}
      <motion.div {...cardMotion(0.05)} className="card flex flex-col md:flex-row md:items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center shrink-0">
            <Zap size={15} className={version?.meta ? 'text-accent' : 'text-fg-muted'} />
          </span>
          <div className="text-xs font-mono text-fg-muted">
            版本 <span className="text-fg">{version?.version ?? '-'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:ml-auto">
          {modeList.map((mode) => {
            const isActive = currentMode === mode;
            return (
              <button
                key={mode}
                onClick={() => patchMode(mode)}
                className={clsx(
                  'relative flex flex-col items-start gap-0.5 px-3 py-1.5 rounded-xl transition-all duration-200',
                  isActive ? 'text-accent' : 'text-fg-muted hover:text-fg',
                )}
                style={
                  isActive
                    ? {
                        background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent-2) / 0.08))',
                        border: '1px solid rgb(var(--c-accent) / 0.32)',
                        boxShadow: '0 0 14px -4px rgb(var(--c-accent) / 0.35)',
                      }
                    : {
                        background: 'rgb(var(--glass-bg) / 0.03)',
                        border: '1px solid rgb(var(--c-line) / 0.06)',
                      }
                }
              >
                <span className="text-xs font-mono uppercase tracking-wide">
                  {mode}
                </span>
                <span
                  className={clsx(
                    'text-[10px]',
                    isActive ? 'text-accent/80' : 'text-fg-subtle',
                  )}
                >
                  {MODE_DESCRIPTIONS[mode] || '自定义模式'}
                </span>
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* 日志级别 */}
      <motion.div {...cardMotion(0.1)} className="card space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center">
            <SettingsIcon size={13} className="text-accent" />
          </span>
          <span className="text-xs font-mono uppercase tracking-wider text-fg-muted">
            日志级别
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {LOG_LEVELS.map((lv) => {
            const isActive = currentLogLevel === lv;
            return (
              <button
                key={lv}
                onClick={() => void patchLogLevel(lv)}
                className={clsx(
                  'relative px-3 py-1.5 rounded-xl text-xs font-mono uppercase tracking-wide transition-all duration-200',
                  isActive ? 'text-accent' : 'text-fg-muted hover:text-fg',
                )}
                style={
                  isActive
                    ? {
                        background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent-2) / 0.08))',
                        border: '1px solid rgb(var(--c-accent) / 0.32)',
                        boxShadow: '0 0 14px -4px rgb(var(--c-accent) / 0.35)',
                      }
                    : {
                        background: 'rgb(var(--glass-bg) / 0.03)',
                        border: '1px solid rgb(var(--c-line) / 0.06)',
                      }
                }
              >
                {lv}
              </button>
            );
          })}
        </div>
      </motion.div>

      {/* DNS 查询测试 */}
      <motion.div {...cardMotion(0.15)} className="card space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center">
            <Search size={15} className="text-accent" />
          </span>
          <span className="text-sm font-medium">DNS 查询测试</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={dnsName}
            onChange={(e) => setDnsName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleQuery();
            }}
            placeholder="example.com"
            className="input flex-1 font-mono text-xs"
          />
          <select
            value={qtype}
            onChange={(e) => setQtype(e.target.value as DnsQueryType)}
            className="input sm:w-28 font-mono text-xs"
          >
            {QUERY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <button
            onClick={handleQuery}
            disabled={querying || !dnsName.trim()}
            className="btn-accent flex items-center gap-1.5 shrink-0 justify-center"
          >
            {querying ? (
              <Loader size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            <span className="text-xs">查询</span>
          </button>
        </div>

        {queryError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="text-xs font-mono text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2.5"
          >
            {queryError}
          </motion.div>
        )}

        {dnsResult && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl overflow-hidden border border-white/[0.06]"
            style={{ background: 'rgb(var(--c-ink-950) / 0.5)' }}
          >
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-wider text-fg-subtle flex-wrap">
              <span>
                Status: <span className="text-fg">{dnsResult.Status}</span>
              </span>
              <span>
                Server: <span className="text-fg">{dnsResult.Server || '-'}</span>
              </span>
              {dnsResult.Question[0] && (
                <span>
                  Q:{' '}
                  <span className="text-fg">
                    {dnsResult.Question[0].Name} (type {dnsResult.Question[0].Qtype})
                  </span>
                </span>
              )}
            </div>
            {dnsResult.Answer && dnsResult.Answer.length > 0 ? (
              <div className="divide-y divide-white/[0.05]">
                {dnsResult.Answer.map((a, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_56px_56px_1fr] gap-2 px-3 py-2 text-xs font-mono items-center"
                  >
                    <span className="text-fg truncate" title={a.name}>
                      {a.name}
                    </span>
                    <span className="text-fg-muted">type {a.type}</span>
                    <span className="text-fg-muted">TTL {a.TTL}</span>
                    <span className="text-accent truncate" title={a.data}>
                      {a.data}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-3 py-6 text-center text-fg-subtle text-xs font-mono">
                无 Answer 记录
              </div>
            )}
          </motion.div>
        )}
      </motion.div>

      {/* 缓存操作 */}
      <motion.div {...cardMotion(0.25)} className="card space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center">
            <Database size={15} className="text-accent" />
          </span>
          <span className="text-sm font-medium">缓存操作</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleFlushCache}
            disabled={flushingCache}
            className="btn-ghost flex items-center gap-1.5 justify-center"
          >
            {flushingCache ? (
              <Loader size={14} className="animate-spin text-accent" />
            ) : (
              <Trash2 size={14} />
            )}
            <span className="text-xs">清空 DNS 缓存</span>
          </button>
          <button
            onClick={handleFlushFakeip}
            disabled={flushingFakeip}
            className="btn-ghost flex items-center gap-1.5 justify-center"
          >
            {flushingFakeip ? (
              <Loader size={14} className="animate-spin text-accent" />
            ) : (
              <RefreshCw size={14} />
            )}
            <span className="text-xs">重置 FakeIP</span>
          </button>
        </div>

        {opMsg && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className={clsx(
              'text-xs font-mono rounded-xl px-3 py-2.5 border',
              opMsg.ok
                ? 'bg-ok/10 text-ok border-ok/25'
                : 'bg-danger/10 text-danger border-danger/25',
            )}
          >
            {opMsg.text}
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
