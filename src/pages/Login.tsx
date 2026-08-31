import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Link2,
  KeyRound,
  Loader,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import { useConnectionStore } from '../store/useConnectionStore';

/**
 * 独立全屏鉴权页面（不套 App 布局）。
 *
 * 初次访问设备时显示，填写 Base URL + Secret 后测试连接，
 * 成功则将凭据持久化到 localStorage（reflex.baseURL / reflex.secret / reflex.verified），
 * 后续访问由路由守卫（RequireAuth）直接放行进入面板。
 */
export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { baseURL: savedBase, secret: savedSecret, testAndSave, connecting, error } =
    useConnectionStore();

  const [baseURL, setBaseURL] = useState(savedBase);
  const [secret, setSecret] = useState(savedSecret);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await testAndSave(baseURL.trim(), secret.trim());
    if (ok) {
      const from = searchParams.get('from') || '/overview';
      navigate(from, { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-aurora p-4 relative overflow-hidden">
      {/* 浮动装饰光斑 */}
      <motion.div
        className="absolute w-72 h-72 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgb(var(--c-accent) / 0.18), transparent 70%)', top: '10%', left: '8%' }}
        animate={{ y: [0, -20, 0], x: [0, 12, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-96 h-96 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgb(var(--c-accent-2) / 0.14), transparent 70%)', bottom: '5%', right: '10%' }}
        animate={{ y: [0, 24, 0], x: [0, -16, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm relative z-10"
      >
        {/* 品牌 */}
        <div className="flex flex-col items-center mb-8">
          <motion.div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgb(var(--c-accent) / 0.22), rgb(var(--c-accent-2) / 0.16))',
              border: '1px solid rgb(var(--c-accent) / 0.35)',
            }}
            animate={{ boxShadow: ['0 0 24px -4px rgb(var(--c-accent) / 0.35)', '0 0 40px -4px rgb(var(--c-accent) / 0.55)', '0 0 24px -4px rgb(var(--c-accent) / 0.35)'] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <img
              src={`${import.meta.env.BASE_URL}favicon.svg`}
              alt="Reflex"
              width={32}
              height={30}
              className="relative z-10"
              draggable={false}
            />
          </motion.div>
          <h1 className="text-2xl font-bold tracking-tight text-gradient">Reflex Dashboard</h1>
          <p className="text-xs font-mono text-fg-subtle uppercase tracking-wider mt-1.5">
            连接到内核
          </p>
        </div>

        {/* 表单卡片 */}
        <form onSubmit={handleSubmit} className="card space-y-4">
          {/* baseURL */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-fg-muted">
              <Link2 size={12} className="text-accent" />
              Base URL
            </label>
            <input
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="http://127.0.0.1:9090"
              className="input font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
            <p className="text-[11px] text-fg-subtle leading-relaxed">
              reflex 的 <code className="text-accent font-mono">external_controller</code> 地址。
              支持带路径前缀。
            </p>
          </div>

          {/* secret */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-fg-muted">
              <KeyRound size={12} className="text-accent" />
              Secret
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="可选"
              className="input font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-[11px] text-fg-subtle leading-relaxed">
              配置文件中 <code className="text-accent font-mono">clash_api.secret</code> 的值。
              未设置可留空。
            </p>
          </div>

          {/* 错误反馈 */}
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex items-start gap-2 text-xs font-mono bg-danger/10 text-danger border border-danger/25 rounded-xl px-3 py-2.5"
            >
              <XCircle size={14} className="shrink-0 mt-0.5" />
              <span className="break-all">{error}</span>
            </motion.div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={connecting || !baseURL.trim()}
            className="btn-accent w-full flex items-center justify-center gap-1.5 py-2.5"
          >
            {connecting ? (
              <Loader size={14} className="animate-spin" />
            ) : (
              <ArrowRight size={14} />
            )}
            <span className="text-xs font-medium">
              {connecting ? '连接中...' : '连接'}
            </span>
          </button>
        </form>

        <p className="text-center text-[11px] text-fg-subtle mt-6 leading-relaxed">
          凭据将保存在本浏览器中，下次访问自动登录。
        </p>
      </motion.div>
    </div>
  );
}
