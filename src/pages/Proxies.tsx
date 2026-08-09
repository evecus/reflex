import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Boxes,
  Zap,
  Loader,
  Boxes as BoxesIcon,
  RefreshCw,
  Globe,
  File,
  HeartPulse,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useProxiesStore } from '../store/useProxiesStore';
import { clashClient } from '../api/client';
import type {
  GroupDelayMap,
  GroupEntry,
  ProxyNode,
  ProxyProvider,
} from '../api/types';
import { delayColor, delayLabel } from '../lib/delay';
import { formatBytes, formatTime } from '../lib/format';

type Tab = 'groups' | 'providers';

function getMemberDelay(
  groupName: string,
  memberName: string,
  groupDelays: Record<string, GroupDelayMap>,
  proxies: Record<string, ProxyNode>,
): number | null | undefined {
  const node = proxies[memberName];
  if (node?.history && node.history.length > 0) {
    return node.history[node.history.length - 1].delay;
  }
  const groupMap = groupDelays[groupName];
  if (groupMap && memberName in groupMap) {
    return groupMap[memberName];
  }
  return undefined;
}

export default function Proxies() {
  const [tab, setTab] = useState<Tab>('groups');

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Tab 切换 */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
        <TabButton
          active={tab === 'groups'}
          onClick={() => setTab('groups')}
          icon={<Boxes size={14} />}
          label="代理分组"
        />
        <TabButton
          active={tab === 'providers'}
          onClick={() => setTab('providers')}
          icon={<BoxesIcon size={14} />}
          label="代理集"
        />
      </div>

      {tab === 'groups' ? <GroupsView /> : <ProxyProvidersView />}
    </div>
  );
}

// ── Tab 按钮 ──────────────────────────────────────────────────────────────────

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
          layoutId="proxies-tab-bg"
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

// ── 代理分组视图 ─────────────────────────────────────────────────────────────

function GroupsView() {
  const {
    groups,
    proxies,
    groupDelays,
    testingGroups,
    testingNodes,
    loading,
    error,
    refresh,
    selectProxy,
    testGroupDelay,
    testNodeDelay,
  } = useProxiesStore();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && groups.length === 0) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="card h-40 skeleton" />
        ))}
      </div>
    );
  }

  if (error && groups.length === 0) {
    return (
      <div className="card" style={{ borderColor: 'rgb(var(--c-danger) / 0.3)' }}>
        <div className="text-sm font-medium mb-1 text-danger">加载失败</div>
        <div className="text-xs font-mono text-fg-muted">{error}</div>
        <button onClick={() => refresh()} className="btn-ghost mt-3">
          重试
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map((group, idx) => (
          <GroupCard
            key={group.name}
            group={group}
            index={idx}
            proxies={proxies}
            groupDelays={groupDelays}
            testingGroup={testingGroups[group.name] ?? false}
            testingNodes={testingNodes}
            onSelect={(child) => selectProxy(group.name, child)}
            onTestGroup={() => testGroupDelay(group.name)}
            onTestNode={(node) => testNodeDelay(node)}
          />
        ))}
      </div>

      {groups.length === 0 && !loading && (
        <div className="card text-center text-fg-muted text-sm py-12">
          暂无代理分组
        </div>
      )}
    </>
  );
}

// ── 分组卡片 ──────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  index,
  proxies,
  groupDelays,
  testingGroup,
  testingNodes,
  onSelect,
  onTestGroup,
  onTestNode,
}: {
  group: GroupEntry;
  index: number;
  proxies: Record<string, ProxyNode>;
  groupDelays: Record<string, GroupDelayMap>;
  testingGroup: boolean;
  testingNodes: Record<string, boolean>;
  onSelect: (child: string) => void;
  onTestGroup: () => void;
  onTestNode: (node: string) => void;
}) {
  const members = group.all ?? [];
  const current = group.now;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index * 0.04, 0.32), duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="card flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate" title={group.name}>
            {group.name}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="badge bg-accent/12 text-accent border border-accent/22">{group.type}</span>
            {current && (
              <span className="text-xs text-fg-muted font-mono truncate">
                → {current}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onTestGroup}
          disabled={testingGroup}
          className="btn-ghost flex items-center gap-1 shrink-0 !px-2.5 !py-1.5"
          title="测速全组"
        >
          {testingGroup ? (
            <Loader size={14} className="animate-spin text-accent" />
          ) : (
            <Zap size={14} />
          )}
          <span className="text-xs hidden sm:inline">测速</span>
        </button>
      </div>

      {members.length === 0 ? (
        <div className="text-xs text-fg-subtle py-2">暂无成员</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {members.map((member) => {
            const delay = getMemberDelay(
              group.name,
              member,
              groupDelays,
              proxies,
            );
            const colors = delayColor(delay);
            const isSelected = member === current;
            const isTesting = testingNodes[member] ?? false;

            return (
              <motion.div
                key={member}
                role="button"
                tabIndex={0}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                className={clsx(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-all duration-200',
                  'w-[120px] sm:w-[140px]',
                  isSelected
                    ? 'text-fg'
                    : 'text-fg-muted hover:text-fg',
                )}
                style={
                  isSelected
                    ? {
                        background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.16), rgb(var(--c-accent-2) / 0.08))',
                        border: '1px solid rgb(var(--c-accent) / 0.4)',
                        boxShadow: '0 0 14px -4px rgb(var(--c-accent) / 0.4)',
                      }
                    : {
                        background: 'rgb(var(--glass-bg) / 0.03)',
                        border: '1px solid rgb(var(--c-line) / 0.06)',
                      }
                }
                onClick={() => onSelect(member)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(member);
                  }
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTestNode(member);
                  }}
                  disabled={isTesting}
                  className={clsx(
                    'shrink-0 w-9 h-5 rounded-md text-[10px] font-mono flex items-center justify-center border',
                    'hover:opacity-80 transition-opacity',
                    colors.bg,
                    colors.text,
                    colors.border,
                  )}
                  title="点击测速"
                >
                  {isTesting ? (
                    <Loader size={10} className="animate-spin" />
                  ) : (
                    delayLabel(delay)
                  )}
                </button>
                <span className="truncate flex-1" title={member}>
                  {member}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ── 代理集 Provider 视图 ───────────────────────────────────────────────────

function ProxyProvidersView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProxyProvider[]>([]);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [healthchecking, setHealthchecking] = useState<Set<string>>(new Set());

  const fetchProviders = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await clashClient.getProxyProviders();
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
      await clashClient.refreshProxyProvider(name);
      await fetchProviders();
    } catch {
      // 静默失败
    } finally {
      setRefreshing((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const handleHealthcheck = async (name: string) => {
    setHealthchecking((prev) => new Set(prev).add(name));
    try {
      await clashClient.healthcheckProxyProvider(name);
    } catch {
      // 静默失败
    } finally {
      setHealthchecking((prev) => {
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
            <div key={i} className="card h-32 skeleton" />
          ))}
        </div>
      ) : providers.length === 0 && !error ? (
        <div className="card text-center text-fg-muted text-sm py-12">
          暂无代理集
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {providers.map((p, idx) => (
            <ProxyProviderCard
              key={p.name}
              provider={p}
              index={idx}
              refreshing={refreshing.has(p.name)}
              healthchecking={healthchecking.has(p.name)}
              onRefresh={() => void handleRefresh(p.name)}
              onHealthcheck={() => void handleHealthcheck(p.name)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function ProxyProviderCard({
  provider,
  index,
  refreshing,
  healthchecking,
  onRefresh,
  onHealthcheck,
}: {
  provider: ProxyProvider;
  index: number;
  refreshing: boolean;
  healthchecking: boolean;
  onRefresh: () => void;
  onHealthcheck: () => void;
}) {
  const isHTTP = provider.vehicleType === 'HTTP';
  const nodeCount = provider.proxies?.length ?? 0;
  const sub = provider.subscriptionInfo;

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
              {provider.type}
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
            {nodeCount > 0 && (
              <span className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06]">
                {nodeCount} 节点
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onHealthcheck}
            disabled={healthchecking}
            className="btn-ghost flex items-center gap-1 !px-2 !py-1.5"
            title="健康检查"
          >
            {healthchecking ? (
              <Loader size={12} className="animate-spin text-accent" />
            ) : (
              <HeartPulse size={12} />
            )}
          </button>
          {isHTTP && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="btn-ghost flex items-center gap-1 !px-2 !py-1.5"
              title="更新订阅"
            >
              {refreshing ? (
                <Loader size={12} className="animate-spin text-accent" />
              ) : (
                <RefreshCw size={12} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* 订阅流量信息 */}
      {sub && (sub.Total || sub.Expire) && (
        <div className="grid grid-cols-2 gap-2 text-xs font-mono">
          {sub.Total != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-fg-subtle">流量</span>
              <span className="text-fg">
                {formatBytes((sub.Download ?? 0) + (sub.Upload ?? 0))} /{' '}
                {formatBytes(sub.Total ?? 0)}
              </span>
            </div>
          )}
          {sub.Expire != null && sub.Expire > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-fg-subtle">到期</span>
              <span className="text-fg">
                {formatTime(new Date(sub.Expire * 1000).toISOString())}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs font-mono pt-2 border-t border-white/[0.06]">
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
