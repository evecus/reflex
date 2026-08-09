import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles/globals.css';
import App from './App';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Proxies from './pages/Proxies';
import Connections from './pages/Connections';
import Rules from './pages/Rules';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import { useConnectionStore } from './store/useConnectionStore';

/**
 * 计算 React Router basename。
 *
 * reflex 通过 `/ui/*` 路径服务 SPA（external_ui 配置），
 * 此时浏览器 URL 是 `http://host:9090/ui/` 或 `http://host:9090/ui/overview`。
 * BrowserRouter 默认 basename 是 `/`，会把 `/ui/overview` 当作路由名去匹配 → 报错
 * "No routes matched location /ui/"。
 *
 * 解决：检测路径前缀，若以 `/ui` 开头则 basename 设为 `/ui`，
 * 让路由匹配时去掉这个前缀；dev 模式（vite 在 `/`）下 basename 为 `/`。
 */
function getBasename(): string {
  const path = window.location.pathname;
  // reflex 服务在 /ui 下；用 indexOf 容忍 /ui/、/ui、/ui/index.html 等形式
  if (path === '/ui' || path.startsWith('/ui/')) return '/ui';
  return '/';
}

/**
 * 路由守卫：凭据未验证（verified=false）时重定向到 /login，
 * 并通过 ?from= 记住来源路径，登录成功后跳回。
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const verified = useConnectionStore((s) => s.verified);
  const location = useLocation();
  if (!verified) {
    const from = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?from=${from}`} replace />;
  }
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={getBasename()}>
      <Routes>
        {/* 独立全屏鉴权页，不套 App 布局 */}
        <Route path="/login" element={<Login />} />
        {/* 受保护的面板路由 */}
        <Route
          element={
            <RequireAuth>
              <App />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="proxies" element={<Proxies />} />
          <Route path="connections" element={<Connections />} />
          <Route path="rules" element={<Rules />} />
          <Route path="logs" element={<Logs />} />
          <Route path="settings" element={<Settings />} />
          {/* 兜底：未知路径重定向到概览 */}
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
