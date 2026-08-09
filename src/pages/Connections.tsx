import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Cable,
  X,
  AlertTriangle,
  Upload,
  Download,
  ArrowRight,
  Globe,
  Server,
  Network,
  Clock,
  Hourglass,
  ArrowUpDown,
  Check,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useConnectionsStore } from '../store/useConnectionsStore';
import type { Connection, ConnMetadata } from '../api/types';
import { formatBytes, formatDuration } from '../lib/format';

const GRID_COLS =
  'grid-cols-[1fr_130px_56px_1fr_140px_72px_72px_64px_36px]';

/** 去掉 IPv4-mapped IPv6 前缀（::ffff:），双栈 socket 上 IPv4 连接的源/目标
 *  IP 会以内核映射形式出现（如 ::ffff:10.0.0.101），显示为纯 IPv4 更直观 */
function cleanIP(ip: string): string {
  return ip.replace(/^::ffff:/, '');
}

function getHost(metadata: ConnMetadata): string {
  return (
    metadata.host ||
    metadata.sniffHost ||
    `${cleanIP(metadata.destinationIP)}:${metadata.destinationPort}`
  );
}

function getSourceIP(metadata: ConnMetadata): string {
  return metadata.sourceIP ? cleanIP(metadata.sourceIP) : '-';
}

// ── 连接排序 ────────────────────────────────────────────────────────────────

type SortMode =
  | 'default' // 内核推送顺序（不做排序）
  | 'start-desc' // 最近开始
  | 'start-asc' // 最早开始
  | 'download-desc' // 下载量最大
  | 'download-asc' // 下载量最小
  | 'upload-desc' // 上传量最大
  | 'upload-asc' // 上传量最小
  | 'total-desc' // 总流量最大
  | 'host-asc'; // Host 字母序 A→Z

const SORT_OPTIONS: { value: SortMode; label: string; hint: string }[] = [
  { value: 'default', label: '默认顺序', hint: '内核推送顺序' },
  { value: 'start-desc', label: '最近开始', hint: '连接时间越新越靠前' },
  { value: 'start-asc', label: '最早开始', hint: '连接时间越久越靠前' },
  { value: 'download-desc', label: '下载量最大', hint: '↓ 流量从高到低' },
  { value: 'download-asc', label: '下载量最小', hint: '↓ 流量从低到高' },
  { value: 'upload-desc', label: '上传量最大', hint: '↑ 流量从高到低' },
  { value: 'upload-asc', label: '上传量最小', hint: '↑ 流量从低到高' },
  { value: 'total-desc', label: '总流量最大', hint: '上传 + 下载最多' },
  { value: 'host-asc', label: 'Host 字母序', hint: '按域名 / IP 排序' },
];

const SORT_STORAGE_KEY = 'reflex.connections.sort';

function getStartTime(conn: Connection): number {
  const t = Date.parse(conn.start);
  return Number.isNaN(t) ? 0 : t;
}

function sortConnections(conns: Connection[], mode: SortMode): Connection[] {
  const list = [...conns];
  switch (mode) {
    case 'start-desc':
      return list.sort((a, b) => getStartTime(b) - getStartTime(a));
    case 'start-asc':
      return list.sort((a, b) => getStartTime(a) - getStartTime(b));
    case 'download-desc':
      return list.sort((a, b) => b.download - a.download);
    case 'download-asc':
      return list.sort((a, b) => a.download - b.download);
    case 'upload-desc':
      return list.sort((a, b) => b.upload - a.upload);
    case 'upload-asc':
      return list.sort((a, b) => a.upload - b.upload);
    case 'total-desc':
      return list.sort((a, b) => b.upload + b.download - (a.upload + a.download));
    case 'host-asc':
      return list.sort((a, b) =>
        (getHost(a.metadata) || '').localeCompare(getHost(b.metadata) || ''),
      );
    default:
      return list;
  }
}

function loadSortMode(): SortMode {
  const saved = localStorage.getItem(SORT_STORAGE_KEY) as SortMode | null;
  return SORT_OPTIONS.some((o) => o.value === saved) ? (saved as SortMode) : 'default';
}

export default function Connections() {
  const {
    connections,
    downloadTotal,
    uploadTotal,
    startStream,
    stop,
    closeAll,
    closeOne,
  } = useConnectionsStore();

  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [selectedConn, setSelectedConn] = useState<Connection | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [sortOpen, setSortOpen] = useState(false);

  // 每秒 WS 推送新数组，用 useMemo 避免每帧全量重排
  const sortedConnections = useMemo(
    () => sortConnections(connections, sortMode),
    [connections, sortMode],
  );

  const handleSelectSort = (mode: SortMode) => {
    setSortMode(mode);
    localStorage.setItem(SORT_STORAGE_KEY, mode);
    setSortOpen(false);
  };

  const sortLabel =
    SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? '默认顺序';

  useEffect(() => {
    startStream();
    return () => stop();
  }, [startStream, stop]);

  const handleCloseAll = async () => {
    await closeAll();
    setConfirmCloseAll(false);
  };

  const handleCloseOne = async (id: string) => {
    await closeOne(id);
    // 关闭后若该行正是弹窗中的，关闭弹窗
    setSelectedConn((cur) => (cur && cur.id === id ? null : cur));
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* 顶部统计栏 */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="card flex flex-col md:flex-row md:items-center gap-4"
      >
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-accent/12 border border-accent/22 flex items-center justify-center">
            <Cable size={15} className="text-accent" />
          </span>
          <span className="text-sm font-medium">活跃连接</span>
          <span className="num text-xl font-bold text-gradient">
            {sortedConnections.length}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono md:ml-auto px-3.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Upload size={12} className="text-accent" />
            <span className="text-fg-subtle">累计↑</span>
            <span className="text-fg num">{formatBytes(uploadTotal)}</span>
          </span>
          <span className="w-px h-3 bg-white/10" />
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Download size={12} className="text-accent-2" />
            <span className="text-fg-subtle">累计↓</span>
            <span className="text-fg num">{formatBytes(downloadTotal)}</span>
          </span>
        </div>

        {/* 关闭全部按钮（带确认） */}
        <div className="flex items-center gap-2 md:ml-2">
          {/* 排序按钮 */}
          <button
            onClick={() => setSortOpen(true)}
            className="btn-ghost flex items-center gap-1.5 shrink-0"
            title="连接排序"
          >
            <ArrowUpDown size={14} className="text-accent" />
            <span className="text-xs hidden sm:inline">{sortLabel}</span>
          </button>

          <AnimatePresence mode="wait">
            {confirmCloseAll ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="flex items-center gap-2"
              >
                <button
                  onClick={handleCloseAll}
                  className="btn-danger flex items-center gap-1"
                >
                  <AlertTriangle size={14} />
                  <span className="text-xs">确认关闭</span>
                </button>
                <button
                  onClick={() => setConfirmCloseAll(false)}
                  className="btn-ghost"
                >
                  <span className="text-xs">取消</span>
                </button>
              </motion.div>
            ) : (
              <motion.button
                key="trigger"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => setConfirmCloseAll(true)}
                disabled={connections.length === 0}
                className="btn-danger flex items-center gap-1"
              >
                <X size={14} />
                <span className="text-xs">关闭全部</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* 连接列表 */}
      {sortedConnections.length === 0 ? (
        <div className="card text-center text-fg-muted text-sm py-12">
          暂无活跃连接
        </div>
      ) : (
        <>
          {/* 桌面端：虚拟滚动表格 */}
          <div className="hidden md:block card !p-0 overflow-hidden">
            <VirtualTable
              connections={sortedConnections}
              onClose={closeOne}
              onSelect={setSelectedConn}
            />
          </div>

          {/* 移动端：卡片列表 */}
          <div className="md:hidden space-y-2">
            {sortedConnections.map((conn) => (
              <MobileCard
                key={conn.id}
                conn={conn}
                onClose={closeOne}
                onSelect={setSelectedConn}
              />
            ))}
          </div>
        </>
      )}

      {/* 排序方式弹窗 */}
      <SortModal
        open={sortOpen}
        current={sortMode}
        onSelect={handleSelectSort}
        onClose={() => setSortOpen(false)}
      />

      {/* 连接详情弹窗 */}
      <ConnectionDetailModal
        conn={selectedConn}
        onClose={() => setSelectedConn(null)}
        onCloseOne={handleCloseOne}
      />
    </div>
  );
}

// ── 桌面端虚拟滚动表格 ──────────────────────────────────────────────────────────

function VirtualTable({
  connections,
  onClose,
  onSelect,
}: {
  connections: Connection[];
  onClose: (id: string) => void;
  onSelect: (conn: Connection) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: connections.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      style={{ height: 'calc(100vh - 15rem)', minHeight: '300px' }}
      className="overflow-auto"
    >
      {/* 表头（sticky） */}
      <div
        className="sticky top-0 z-10 border-b border-white/[0.06]"
        style={{ background: 'rgb(var(--c-ink-900) / 0.9)', backdropFilter: 'blur(12px)' }}
      >
        <div
          className={clsx(
            'grid gap-2 px-3 py-2.5 text-[10px] font-mono uppercase tracking-wider text-fg-subtle',
            GRID_COLS,
          )}
        >
          <span>Host</span>
          <span>源 IP</span>
          <span>Net</span>
          <span>Chain</span>
          <span>Rule</span>
          <span className="text-right">↑</span>
          <span className="text-right">↓</span>
          <span className="text-right">Time</span>
          <span></span>
        </div>
      </div>

      {/* 虚拟行容器 */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const conn = connections[virtualItem.index];
          if (!conn) return null;
          return (
            <div
              key={conn.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              className="row-hover border-b border-white/[0.04]"
            >
              <ConnRow conn={conn} onClose={onClose} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 单行连接（桌面端） ──────────────────────────────────────────────────────────

function ConnRow({
  conn,
  onClose,
  onSelect,
}: {
  conn: Connection;
  onClose: (id: string) => void;
  onSelect: (conn: Connection) => void;
}) {
  const host = getHost(conn.metadata);
  const sourceIp = getSourceIP(conn.metadata);
  const ruleText = conn.rulePayload
    ? `${conn.rule}(${conn.rulePayload})`
    : conn.rule;

  return (
    <div
      onClick={() => onSelect(conn)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(conn);
        }
      }}
      className={clsx(
        'grid gap-2 px-3 py-2 text-xs items-center cursor-pointer',
        GRID_COLS,
      )}
    >
      <span className="truncate text-fg" title={host}>
        {host}
      </span>
      <span className="truncate text-fg-muted font-mono" title={sourceIp}>
        {sourceIp}
      </span>
      <span>
        <span
          className={clsx(
            'badge border',
            conn.metadata.network === 'tcp'
              ? 'bg-accent/12 text-accent border-accent/22'
              : 'bg-warn/12 text-warn border-warn/22',
          )}
        >
          {conn.metadata.network}
        </span>
      </span>
      <span
        className="truncate text-fg-muted font-mono"
        title={conn.chains.join(' > ')}
      >
        {conn.chains.join(' > ')}
      </span>
      <span
        className="truncate text-fg-muted font-mono"
        title={ruleText}
      >
        {ruleText}
      </span>
      <span className="text-right num text-fg-muted">
        {formatBytes(conn.upload)}
      </span>
      <span className="text-right num text-fg-muted">
        {formatBytes(conn.download)}
      </span>
      <span className="text-right num text-fg-subtle">
        {formatDuration(conn.start)}
      </span>
      <span className="text-right" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => void onClose(conn.id)}
          className="p-1.5 rounded-lg hover:bg-danger/15 text-fg-subtle hover:text-danger transition-colors"
          title="关闭连接"
        >
          <X size={12} />
        </button>
      </span>
    </div>
  );
}

// ── 移动端卡片 ──────────────────────────────────────────────────────────────────

function MobileCard({
  conn,
  onClose,
  onSelect,
}: {
  conn: Connection;
  onClose: (id: string) => void;
  onSelect: (conn: Connection) => void;
}) {
  const host = getHost(conn.metadata);
  const sourceIp = getSourceIP(conn.metadata);
  const ruleText = conn.rulePayload
    ? `${conn.rule}(${conn.rulePayload})`
    : conn.rule;

  return (
    <div
      className="card !p-3 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(conn)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(conn);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm text-fg truncate flex-1" title={host}>
          {host}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            void onClose(conn.id);
          }}
          className="p-1.5 rounded-lg hover:bg-danger/15 text-fg-subtle hover:text-danger transition-colors shrink-0"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span
          className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06] font-mono"
          title={sourceIp}
        >
          源 {sourceIp}
        </span>
        <span
          className={clsx(
            'badge border',
            conn.metadata.network === 'tcp'
              ? 'bg-accent/12 text-accent border-accent/22'
              : 'bg-warn/12 text-warn border-warn/22',
          )}
        >
          {conn.metadata.network}
        </span>
        <span
          className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06] font-mono truncate max-w-[60%]"
          title={ruleText}
        >
          {ruleText}
        </span>
      </div>
      <div
        className="text-xs text-fg-muted font-mono truncate mb-2"
        title={conn.chains.join(' > ')}
      >
        {conn.chains.join(' > ')}
      </div>
      <div className="flex items-center gap-3 text-xs font-mono">
        <span className="text-fg-subtle">
          ↑ <span className="num text-fg-muted">{formatBytes(conn.upload)}</span>
        </span>
        <span className="text-fg-subtle">
          ↓{' '}
          <span className="num text-fg-muted">
            {formatBytes(conn.download)}
          </span>
        </span>
        <span className="text-fg-subtle ml-auto">
          {formatDuration(conn.start)}
        </span>
      </div>
    </div>
  );
}

// ── 连接详情弹窗 ─────────────────────────────────────────────────────────────

function ConnectionDetailModal({
  conn,
  onClose,
  onCloseOne,
}: {
  conn: Connection | null;
  onClose: () => void;
  onCloseOne: (id: string) => Promise<void>;
}) {
  // ESC 关闭
  useEffect(() => {
    if (!conn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conn, onClose]);

  return (
    <AnimatePresence>
      {conn && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* 背景遮罩 */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* 弹窗主体 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto card !p-0"
          >
            <ConnectionDetail
              conn={conn}
              onClose={onClose}
              onCloseOne={onCloseOne}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ConnectionDetail({
  conn,
  onClose,
  onCloseOne,
}: {
  conn: Connection;
  onClose: () => void;
  onCloseOne: (id: string) => Promise<void>;
}) {
  const m = conn.metadata;
  const sourceIP = getSourceIP(m);
  const destIP = cleanIP(m.destinationIP);
  const chains = conn.chains.length > 0 ? conn.chains.join(' › ') : '-';
  const ruleText = conn.rulePayload
    ? `${conn.rule} (${conn.rulePayload})`
    : conn.rule || '-';
  const startedAt = (() => {
    try {
      const d = new Date(conn.start);
      return d.toLocaleString('zh-CN', { hour12: false });
    } catch {
      return conn.start;
    }
  })();

  return (
    <div className="p-5 space-y-4">
      {/* 标题栏 */}
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-accent/12 border border-accent/25 flex items-center justify-center shrink-0">
          <Cable size={16} className="text-accent" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate" title={m.host || destIP}>
            {m.host || destIP || '(unknown host)'}
          </div>
          <div className="text-[11px] font-mono text-fg-subtle mt-0.5 flex items-center gap-1.5">
            <span
              className={clsx(
                'badge border',
                m.network === 'tcp'
                  ? 'bg-accent/12 text-accent border-accent/22'
                  : 'bg-warn/12 text-warn border-warn/22',
              )}
            >
              {m.network}
            </span>
            <span className="badge bg-white/[0.04] text-fg-muted border border-white/[0.06]">
              {m.type}
            </span>
            <span className="badge bg-white/[0.04] text-fg-subtle border border-white/[0.06]">
              {formatDuration(conn.start)}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-fg-muted hover:text-fg transition-colors"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>

      {/* 连接 ID（次要） */}
      <div className="text-[11px] font-mono text-fg-subtle truncate" title={conn.id}>
        ID · {conn.id}
      </div>

      {/* 流量卡片 */}
      <div className="grid grid-cols-3 gap-2.5">
        <FlowStat icon={<Upload size={13} />} label="↑ 上传" value={formatBytes(conn.upload)} />
        <FlowStat
          icon={<Download size={13} />}
          label="↓ 下载"
          value={formatBytes(conn.download)}
        />
        <FlowStat
          icon={<Hourglass size={13} />}
          label="时长"
          value={formatDuration(conn.start)}
        />
      </div>

      {/* 目标 */}
      <DetailGroup icon={<Globe size={13} />} title="目标">
        <DetailRow label="Host" value={m.host || '-'} mono />
        <DetailRow label="Sniff Host" value={m.sniffHost || '-'} mono />
        <DetailRow
          label="目标地址"
          value={`${destIP}${m.destinationPort ? `:${m.destinationPort}` : ''}`}
          mono
        />
        {m.remoteDestination && (
          <DetailRow label="远端目标" value={m.remoteDestination} mono />
        )}
      </DetailGroup>

      {/* 源 */}
      <DetailGroup icon={<ArrowRight size={13} />} title="源">
        <DetailRow
          label="源 IP"
          value={`${sourceIP}${m.sourcePort ? `:${m.sourcePort}` : ''}`}
          mono
        />
      </DetailGroup>

      {/* 入站 */}
      <DetailGroup icon={<Server size={13} />} title="入站">
        <DetailRow label="名称" value={m.inboundName || '-'} mono />
        <DetailRow label="端口" value={m.inboundPort || '-'} mono />
        {m.inboundUser && <DetailRow label="用户" value={m.inboundUser} mono />}
        <DetailRow label="DNS 模式" value={m.dnsMode || 'normal'} mono />
      </DetailGroup>

      {/* 路由 */}
      <DetailGroup icon={<Network size={13} />} title="路由">
        <DetailRow label="Chain" value={chains} mono />
        <DetailRow label="Rule" value={ruleText} mono />
        {m.specialRules && (
          <DetailRow label="特殊规则" value={m.specialRules} mono />
        )}
        {m.specialProxy && (
          <DetailRow label="特殊代理" value={m.specialProxy} mono />
        )}
      </DetailGroup>

      {/* 进程（可空） */}
      {(m.process || m.processPath) && (
        <DetailGroup icon={<Network size={13} />} title="进程">
          {m.process && <DetailRow label="名称" value={m.process} mono />}
          {m.processPath && <DetailRow label="路径" value={m.processPath} mono />}
        </DetailGroup>
      )}

      {/* 时间 */}
      <DetailGroup icon={<Clock size={13} />} title="时间">
        <DetailRow label="开始于" value={startedAt} mono />
      </DetailGroup>

      {/* 操作 */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
        <button onClick={onClose} className="btn-ghost text-xs">
          关闭
        </button>
        <button
          onClick={() => void onCloseOne(conn.id)}
          className="btn-danger text-xs flex items-center gap-1.5"
        >
          <X size={13} />
          关闭此连接
        </button>
      </div>
    </div>
  );
}

function FlowStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5"
      style={{
        background: 'rgb(var(--glass-bg) / 0.04)',
        border: '1px solid rgb(var(--c-line) / 0.08)',
      }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="num text-sm font-semibold text-fg truncate">{value}</div>
    </div>
  );
}

function DetailGroup({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-fg-subtle">
        {icon}
        {title}
      </div>
      <div
        className="rounded-xl overflow-hidden divide-y divide-white/[0.05]"
        style={{
          background: 'rgb(var(--glass-bg) / 0.03)',
          border: '1px solid rgb(var(--c-line) / 0.06)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 px-3 py-1.5 text-xs">
      <span className="text-fg-subtle font-mono">{label}</span>
      <span
        className={clsx(
          'text-fg break-all',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

// ── 排序方式弹窗 ────────────────────────────────────────────────────────────

function SortModal({
  open,
  current,
  onSelect,
  onClose,
}: {
  open: boolean;
  current: SortMode;
  onSelect: (mode: SortMode) => void;
  onClose: () => void;
}) {
  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm card !p-0 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
              <span className="w-7 h-7 rounded-lg bg-accent/12 border border-accent/25 flex items-center justify-center">
                <ArrowUpDown size={14} className="text-accent" />
              </span>
              <span className="text-sm font-medium">连接排序</span>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-white/[0.06] text-fg-muted hover:text-fg transition-colors ml-auto"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-2 max-h-[60vh] overflow-y-auto">
              {SORT_OPTIONS.map((opt) => {
                const isActive = current === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => onSelect(opt.value)}
                    className={clsx(
                      'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors duration-150',
                      isActive ? 'bg-accent/[0.08]' : 'hover:bg-white/[0.04]',
                    )}
                  >
                    <span
                      className={clsx(
                        'w-4 h-4 rounded-full border flex items-center justify-center shrink-0',
                        isActive
                          ? 'border-accent'
                          : 'border-fg-subtle/40',
                      )}
                    >
                      {isActive && <Check size={11} className="text-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={clsx(
                          'block text-xs',
                          isActive ? 'text-fg' : 'text-fg-muted',
                        )}
                      >
                        {opt.label}
                      </span>
                      <span className="block text-[10px] text-fg-subtle font-mono mt-0.5">
                        {opt.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
