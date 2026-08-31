import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Boxes,
  Cable,
  ListOrdered,
  LogOut,
  ScrollText,
  Settings as SettingsIcon,
  Wifi,
  X,
  Menu,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useConnectionStore } from './store/useConnectionStore';
import { useOverviewStore } from './store/useOverviewStore';
import { useConnectionsStore } from './store/useConnectionsStore';
import { useLogsStore } from './store/useLogsStore';
import { formatRate } from './lib/format';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/overview', label: '概览', icon: Activity },
  { to: '/proxies', label: '代理', icon: Boxes },
  { to: '/connections', label: '连接', icon: Cable },
  { to: '/rules', label: '规则', icon: ListOrdered },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/settings', label: '设置', icon: SettingsIcon },
];

export default function App() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const { recheck, connected } = useConnectionStore();
  const currentUp = useOverviewStore((s) => s.currentUp);
  const currentDown = useOverviewStore((s) => s.currentDown);
  const startRealtime = useOverviewStore((s) => s.startRealtime);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  // 连接建立后全局启动 /traffic + /memory 实时流，
  // 使顶栏速率在任意页面都能显示（旧实现只在 Overview.init 里建立 WS，
  // 直接进入其他页面时顶栏恒为 0 / 不显示）。
  useEffect(() => {
    if (connected) startRealtime();
  }, [connected, startRealtime]);

  useLifecycleCleanup();

  const currentPath = location.pathname;
  const activeItem = NAV_ITEMS.find((n) => currentPath.startsWith(n.to));

  return (
    <div className="flex h-full bg-aurora">
      {/* 桌面端侧栏 */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:shrink-0 relative">
        <div
          className="absolute inset-0 border-r"
          style={{
            background:
              'linear-gradient(180deg, rgb(var(--glass-bg) / 0.05), rgb(var(--glass-bg) / 0.02))',
            backdropFilter: 'blur(24px) saturate(140%)',
            WebkitBackdropFilter: 'blur(24px) saturate(140%)',
            borderColor: 'rgb(var(--c-line) / 0.08)',
          }}
        />
        <div className="relative flex flex-col h-full">
          <Brand />
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {NAV_ITEMS.map((item, i) => (
              <SideNavItem
                key={item.to}
                item={item}
                active={currentPath.startsWith(item.to)}
                index={i}
              />
            ))}
          </nav>
          <ConnectionStatus />
        </div>
      </aside>

      {/* 移动端抽屉 */}
      <AnimatePresence>
        {mobileNavOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={() => setMobileNavOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="md:hidden fixed left-0 top-0 bottom-0 w-72 z-50 flex flex-col"
              style={{
                background:
                  'linear-gradient(165deg, rgb(var(--c-ink-900) / 0.98), rgb(var(--c-ink-950) / 0.98))',
                backdropFilter: 'blur(24px) saturate(140%)',
                WebkitBackdropFilter: 'blur(24px) saturate(140%)',
                borderRight: '1px solid rgb(var(--c-line) / 0.1)',
              }}
            >
              <div className="flex items-center justify-between px-4 h-16 border-b border-white/5">
                <Brand compact />
                <button
                  onClick={() => setMobileNavOpen(false)}
                  className="p-2 rounded-xl hover:bg-white/5 text-fg-muted transition-colors"
                  aria-label="关闭菜单"
                >
                  <X size={18} />
                </button>
              </div>
              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                {NAV_ITEMS.map((item, i) => (
                  <SideNavItem
                    key={item.to}
                    item={item}
                    active={currentPath.startsWith(item.to)}
                    index={i}
                    onClick={() => setMobileNavOpen(false)}
                  />
                ))}
              </nav>
              <ConnectionStatus />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* 主区域 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶栏 */}
        <header
          className="h-16 shrink-0 flex items-center px-4 gap-3 relative z-20"
          style={{
            background:
              'linear-gradient(180deg, rgb(var(--glass-bg) / 0.05), rgb(var(--glass-bg) / 0.02))',
            backdropFilter: 'blur(24px) saturate(140%)',
            WebkitBackdropFilter: 'blur(24px) saturate(140%)',
            borderBottom: '1px solid rgb(var(--c-line) / 0.08)',
          }}
        >
          <button
            onClick={() => setMobileNavOpen(true)}
            className="md:hidden p-2 rounded-xl hover:bg-white/5 text-fg-muted transition-colors"
            aria-label="打开菜单"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            {activeItem && (
              <motion.div
                key={activeItem.to}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2"
              >
                <span className="w-7 h-7 rounded-lg bg-accent/12 border border-accent/25 flex items-center justify-center">
                  <activeItem.icon size={14} className="text-accent" />
                </span>
                <span className="text-sm font-semibold tracking-tight truncate">{activeItem.label}</span>
              </motion.div>
            )}
          </div>

          {/* 顶栏实时速率（桌面端） */}
          {connected && (
            <div className="hidden sm:flex items-center gap-3 ml-auto">
              <div className="flex items-center gap-4 text-xs font-mono px-3.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <span className="flex items-center gap-1.5 text-fg-muted">
                  <Wifi size={12} className="text-accent" />
                  <span className="text-accent num">{formatRate(currentUp)}</span>
                  <span className="text-fg-subtle">↑</span>
                </span>
                <span className="w-px h-3 bg-white/10" />
                <span className="flex items-center gap-1.5 text-fg-muted">
                  <span className="text-fg-subtle">↓</span>
                  <span className="text-accent-2 num">{formatRate(currentDown)}</span>
                </span>
              </div>
            </div>
          )}
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-y-auto relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="min-h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────────────────────────────────

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-3 px-4', compact ? 'h-full' : 'h-16 border-b border-white/5')}>
      <motion.div
        className="w-9 h-9 rounded-xl flex items-center justify-center relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.25), rgb(var(--c-accent-2) / 0.18))',
          border: '1px solid rgb(var(--c-accent) / 0.35)',
        }}
        animate={{ boxShadow: ['0 0 12px -2px rgb(var(--c-accent) / 0.3)', '0 0 20px -2px rgb(var(--c-accent) / 0.5)', '0 0 12px -2px rgb(var(--c-accent) / 0.3)'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="Reflex"
          width={20}
          height={19}
          className="relative z-10"
          draggable={false}
        />
      </motion.div>
      <div className="leading-tight">
        <div className="text-sm font-bold tracking-tight text-gradient">Reflex</div>
        <div className="text-[10px] font-mono text-fg-subtle uppercase tracking-wider">Dashboard</div>
      </div>
    </div>
  );
}

function SideNavItem({
  item,
  active,
  index,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  index: number;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        to={item.to}
        onClick={onClick}
        className={clsx(
          'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200',
          active ? 'text-accent' : 'text-fg-muted hover:text-fg',
        )}
      >
        {active && (
          <motion.div
            layoutId="nav-active-bg"
            className="absolute inset-0 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.14), rgb(var(--c-accent-2) / 0.08))',
              border: '1px solid rgb(var(--c-accent) / 0.28)',
              boxShadow: '0 0 20px -6px rgb(var(--c-accent) / 0.35), inset 0 1px 0 0 rgb(255 255 255 / 0.08)',
            }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          />
        )}
        {!active && (
          <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/[0.04]" />
        )}
        <Icon size={16} className="relative z-10 shrink-0" />
        <span className="relative z-10">{item.label}</span>
      </Link>
    </motion.div>
  );
}

function ConnectionStatus() {
  const { baseURL, connected, logout } = useConnectionStore();
  return (
    <div className="px-3 py-4">
      <div
        className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl"
        style={{
          background: 'rgb(var(--glass-bg) / 0.04)',
          border: '1px solid rgb(var(--c-line) / 0.07)',
        }}
      >
        <span className="relative flex shrink-0 w-2 h-2">
          {connected && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
          )}
          <span
            className={clsx(
              'relative inline-flex rounded-full w-2 h-2',
              connected ? 'bg-ok' : 'bg-danger',
            )}
          />
        </span>
        <span className="text-fg-muted truncate font-mono flex-1" title={baseURL}>
          {baseURL || '未配置'}
        </span>
        <span className={clsx('font-mono text-[10px]', connected ? 'text-ok' : 'text-danger')}>
          {connected ? '在线' : '离线'}
        </span>
        <button
          onClick={logout}
          className="p-1 rounded-lg hover:bg-danger/15 text-fg-subtle hover:text-danger transition-colors shrink-0"
          title="退出登录"
          aria-label="退出登录"
        >
          <LogOut size={13} />
        </button>
      </div>
    </div>
  );
}

// ── 应用生命周期清理 ────────────────────────────────────────────────────────

function useLifecycleCleanup() {
  const overview = useOverviewStore();
  const conns = useConnectionsStore();
  const logs = useLogsStore();
  useEffect(() => {
    return () => {
      overview.stop();
      conns.stop();
      logs.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
