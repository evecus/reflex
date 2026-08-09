import { useEffect, useReducer, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ListOrdered,
  Search,
  ChevronDown,
  RefreshCw,
  Route as RouteIcon,
  Globe,
  FileText,
  Loader,
  File,
} from 'lucide-react';
import { clsx } from 'clsx';
import { clashClient } from '../api/client';
import type { Rule, RuleProvider } from '../api/types';
import { formatTime } from '../lib/format';

// ── 状态管理 ──────────────────────────────────────────────────────────────────

interface RulesState {
  loading: boolean;
  error: string | null;
  rules: Rule[];
  searchTerm: string;
}

type RulesAction =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; rules: Rule[] }
  | { type: 'FETCH_ERROR'; error: string }
  | { type: 'SET_SEARCH'; term: string };

const initialState: RulesState = {
  loading: false,
  error: null,
  rules: [],
  searchTerm: '',
};

function rulesReducer(state: RulesState, action: RulesAction): RulesState {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_SUCCESS':
      return { ...state, loading: false, rules: action.rules };
    case 'FETCH_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'SET_SEARCH':
      return { ...state, searchTerm: action.term };
    default:
      return state;
  }
}

// ── 主组件 ─────────────────────────────────────────────────────────────────────

type Tab = 'route' | 'dns' | 'providers';

export default function Rules() {
  const [tab, setTab] = useState<Tab>('route');

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Tab 切换 */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
        <TabButton
          active={tab === 'route'}
          onClick={() => setTab('route')}
          icon={<RouteIcon size={14} />}
          label="路由规则"
        />
        <TabButton
          active={tab === 'dns'}
          onClick={() => setTab('dns')}
          icon={<Globe size={14} />}
          label="DNS 规则"
        />
        <TabButton
          active={tab === 'providers'}
          onClick={() => setTab('providers')}
          icon={<FileText size={14} />}
          label="规则集"
        />
      </div>

      {tab === 'providers' ? (
        <RuleProvidersView />
      ) : (
        <RulesListView kind={tab as 'route' | 'dns'} />
      )}
    </div>
  );
}

// ── Tab 按钮 ───────────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-lg transition-colors duration-200',
        active ? 'text-accent' : 'text-fg-muted hover:text-fg',
      )}
    >
      {active && (
        <motion.div
          layoutId="rules-tab-bg"
          className="absolute inset-0 rounded-lg"
          style={{
            background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.18), rgb(var(--c-accent-2) / 0.1))',
            boxShadow: '0 1px 0 0 rgb(255 255 255 / 0.08) inset',
          }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        />
      )}
      <span className="relative z-10 flex items-center gap-1.5">
        {icon}
        {label}
      </span>
    </button>
  );
}

// ── 规则列表视图 ───────────────────────────────────────────────────────────────

function RulesListView({ kind }: { kind: 'route' | 'dns' }) {
  const [state, dispatch] = useReducer(rulesReducer, initialState);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchRules = async () => {
    dispatch({ type: 'FETCH_START' });
    try {
      const resp =
        kind === 'route'
          ? await clashClient.getRules()
          : await clashClient.getDnsRules();
      dispatch({ type: 'FETCH_SUCCESS', rules: resp.rules ?? [] });
    } catch (e) {
      dispatch({
        type: 'FETCH_ERROR',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  useEffect(() => {
    void fetchRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const term = state.searchTerm.trim().toLowerCase();
  const filtered: { rule: Rule; index: number }[] = term
    ? state.rules
        .map((rule, index) => ({ rule, index }))
        .filter(
          ({ rule }) =>
            rule.type.toLowerCase().includes(term) ||
            rule.payload.toLowerCase().includes(term) ||
            rule.proxy.toLowerCase().includes(term),
        )
    : state.rules.map((rule, index) => ({ rule, index }));

  const toggleExpand = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const label = kind === 'route' ? '路由规则' : 'DNS 规则';

  return (
    <>
      {/* 顶部工具栏 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col sm:flex-row sm:items-center gap-3"
      >
        <div className="flex items-center gap-2">
          <ListOrdered size={16} className="text-accent" />
          <span className="text-sm font-medium">{label}列表</span>
          <span className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06]">
            {state.rules.length}
          </span>
          {term && filtered.length !== state.rules.length && (
            <span className="text-xs text-fg-subtle">
              匹配 {filtered.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          <div className="relative flex-1 sm:flex-initial">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <input
              type="text"
              value={state.searchTerm}
              onChange={(e) =>
                dispatch({ type: 'SET_SEARCH', term: e.target.value })
              }
              placeholder="搜索 type / payload / proxy..."
              className="input pl-8 text-xs w-full sm:w-64"
            />
          </div>
          <button
            onClick={fetchRules}
            disabled={state.loading}
            className="btn-ghost flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw
              size={14}
              className={state.loading ? 'animate-spin' : ''}
            />
            <span className="text-xs hidden sm:inline">刷新</span>
          </button>
        </div>
      </motion.div>

      {/* 错误状态 */}
      {state.error && (
        <div className="card" style={{ borderColor: 'rgb(var(--c-danger) / 0.3)' }}>
          <div className="text-sm font-medium mb-1 text-danger">加载失败</div>
          <div className="text-xs font-mono text-fg-muted">{state.error}</div>
          <button onClick={fetchRules} className="btn-ghost mt-3">
            重试
          </button>
        </div>
      )}

      {/* 加载状态 */}
      {state.loading && state.rules.length === 0 ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card h-10 skeleton" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-fg-muted text-sm py-12">
          {state.searchTerm ? `未匹配到${label}` : `暂无${label}`}
        </div>
      ) : (
        <>
          {/* 桌面端：表格 */}
          <div className="hidden md:block card !p-0 overflow-hidden">
            <div className="grid grid-cols-[120px_1fr_160px_40px] gap-2 px-3 py-2.5 border-b border-white/[0.06] text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
              <span>Type</span>
              <span>Payload</span>
              <span>Proxy</span>
              <span></span>
            </div>
            <div className="max-h-[calc(100vh-15rem)] overflow-auto">
              {filtered.map(({ rule, index }) => (
                <RuleRow
                  key={`${rule.type}-${index}`}
                  rule={rule}
                  isMatch={rule.type === 'MATCH'}
                  hasReflex={
                    !!rule.reflex && Object.keys(rule.reflex).length > 0
                  }
                  isExpanded={expanded.has(index)}
                  onToggle={() => toggleExpand(index)}
                />
              ))}
            </div>
          </div>

          {/* 移动端：卡片列表 */}
          <div className="md:hidden space-y-2 max-h-[calc(100vh-12rem)] overflow-auto">
            {filtered.map(({ rule, index }) => (
              <RuleCard
                key={`${rule.type}-${index}`}
                rule={rule}
                isMatch={rule.type === 'MATCH'}
                hasReflex={
                  !!rule.reflex && Object.keys(rule.reflex).length > 0
                }
                isExpanded={expanded.has(index)}
                onToggle={() => toggleExpand(index)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ── 桌面端单行 ──────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  isMatch,
  hasReflex,
  isExpanded,
  onToggle,
}: {
  rule: Rule;
  isMatch: boolean;
  hasReflex: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-white/[0.04]">
      <div
        className={clsx(
          'grid grid-cols-[120px_1fr_160px_40px] gap-2 px-3 py-2 text-xs items-center row-hover',
          isMatch && 'bg-accent/[0.04]',
        )}
      >
        <span className="flex items-center gap-1.5">
          <span
            className={clsx(
              'badge border',
              isMatch
                ? 'bg-accent/12 text-accent border-accent/25'
                : 'bg-white/[0.04] text-fg-muted border-white/[0.06]',
            )}
          >
            {rule.type}
          </span>
          {rule.disableCache && (
            <span
              className="badge bg-warn/12 text-warn border border-warn/22"
              title="命中后禁用缓存"
            >
              no-cache
            </span>
          )}
        </span>
        <span
          className="font-mono text-fg truncate"
          title={rule.payload}
        >
          {rule.payload || '*'}
        </span>
        <span
          className="font-mono text-fg-muted truncate"
          title={rule.proxy}
        >
          {rule.proxy}
        </span>
        <span className="text-right">
          {hasReflex && (
            <button
              onClick={onToggle}
              className="p-1 rounded-lg hover:bg-accent/10 text-fg-subtle hover:text-accent transition-colors"
              title={isExpanded ? '收起' : '展开 reflex 扩展'}
            >
              <ChevronDown
                size={14}
                className={clsx(
                  'transition-transform duration-200',
                  isExpanded && 'rotate-180',
                )}
              />
            </button>
          )}
        </span>
      </div>
      {hasReflex && isExpanded && (
        <div className="px-3 py-2.5 bg-black/20 border-t border-white/[0.04]">
          <pre className="text-[10px] font-mono text-fg-muted whitespace-pre-wrap break-all">
            {JSON.stringify(rule.reflex, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── 移动端卡片 ──────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  isMatch,
  hasReflex,
  isExpanded,
  onToggle,
}: {
  rule: Rule;
  isMatch: boolean;
  hasReflex: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={clsx('card !p-3', isMatch && 'bg-accent/[0.04]')}
      style={isMatch ? { borderColor: 'rgb(var(--c-accent) / 0.25)' } : undefined}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className={clsx(
            'badge border',
            isMatch
              ? 'bg-accent/12 text-accent border-accent/25'
              : 'bg-white/[0.04] text-fg-muted border-white/[0.06]',
          )}
        >
          {rule.type}
        </span>
        {rule.disableCache && (
          <span
            className="badge bg-warn/12 text-warn border border-warn/22"
            title="命中后禁用缓存"
          >
            no-cache
          </span>
        )}
        <span
          className="text-xs font-mono text-fg-muted truncate flex-1"
          title={rule.proxy}
        >
          → {rule.proxy}
        </span>
        {hasReflex && (
          <button
            onClick={onToggle}
            className="p-1 rounded-lg hover:bg-accent/10 text-fg-subtle hover:text-accent transition-colors shrink-0"
          >
            <ChevronDown
              size={14}
              className={clsx(
                'transition-transform duration-200',
                isExpanded && 'rotate-180',
              )}
            />
          </button>
        )}
      </div>
      <div
        className="text-xs font-mono text-fg truncate"
        title={rule.payload}
      >
        {rule.payload || '*'}
      </div>
      {hasReflex && isExpanded && (
        <pre className="mt-2 text-[10px] font-mono text-fg-muted whitespace-pre-wrap break-all bg-black/20 rounded-lg p-2">
          {JSON.stringify(rule.reflex, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── 规则集 Provider 视图 ───────────────────────────────────────────────────

function RuleProvidersView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<RuleProvider[]>([]);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  const fetchProviders = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await clashClient.getRuleProviders();
      setProviders(Object.values(resp.providers ?? {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchProviders();
  }, []);

  const handleRefresh = async (name: string) => {
    setRefreshing((prev) => new Set(prev).add(name));
    try {
      await clashClient.refreshRuleProvider(name);
      await fetchProviders();
    } catch {
      // 静默失败，用户可手动重试
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <span className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06]">{providers.length}</span>
        <button
          onClick={fetchProviders}
          disabled={loading}
          className="btn-ghost flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="text-xs">刷新</span>
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'rgb(var(--c-danger) / 0.3)' }}>
          <div className="text-sm font-medium mb-1 text-danger">加载失败</div>
          <div className="text-xs font-mono text-fg-muted">{error}</div>
          <button onClick={fetchProviders} className="btn-ghost mt-3">
            重试
          </button>
        </div>
      )}

      {loading && providers.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-28 skeleton" />
          ))}
        </div>
      ) : providers.length === 0 && !error ? (
        <div className="card text-center text-fg-muted text-sm py-12">
          暂无规则集
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((p, idx) => (
            <RuleProviderCard
              key={p.name}
              provider={p}
              index={idx}
              refreshing={refreshing.has(p.name)}
              onRefresh={() => void handleRefresh(p.name)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RuleProviderCard({
  provider,
  index,
  refreshing,
  onRefresh,
}: {
  provider: RuleProvider;
  index: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const isHTTP = provider.vehicleType === 'HTTP';
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.32), duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="card flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate" title={provider.name}>
            {provider.name}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="badge bg-accent/12 text-accent border border-accent/22">
              {provider.behavior}
            </span>
            <span className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06]">
              {provider.format}
            </span>
            <span
              className={clsx(
                'badge border',
                isHTTP ? 'bg-warn/12 text-warn border-warn/22' : 'bg-ok/12 text-ok border-ok/22',
              )}
            >
              <span className="mr-1 inline-flex items-center">
                {isHTTP ? <Globe size={10} /> : <File size={10} />}
              </span>
              {provider.vehicleType}
            </span>
          </div>
        </div>
        {isHTTP && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-ghost flex items-center gap-1 shrink-0"
            title="刷新规则集"
          >
            {refreshing ? (
              <Loader size={12} className="animate-spin text-accent" />
            ) : (
              <RefreshCw size={12} />
            )}
            <span className="text-xs hidden sm:inline">刷新</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs font-mono pt-2 border-t border-white/[0.06]">
        <span className="flex items-center gap-1.5">
          <span className="text-fg-subtle">规则数</span>
          <span className="num text-fg">{provider.ruleCount}</span>
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-fg-subtle shrink-0">更新于</span>
          <span className="text-fg-muted truncate" title={provider.updatedAt}>
            {provider.updatedAt ? formatTime(provider.updatedAt) : '-'}
          </span>
        </span>
      </div>
    </motion.div>
  );
}
