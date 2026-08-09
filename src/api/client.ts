import type {
  Configs,
  ConnectionsResp,
  DelayResp,
  DnsQueryResp,
  DnsQueryType,
  DnsStats,
  GroupDelayMap,
  GroupEntry,
  GroupResp,
  ProxyProvidersResp,
  ProxiesResp,
  RuleProvidersResp,
  RulesResp,
  StorageData,
  VersionInfo,
} from './types';

// reflex clash-api 端点封装。
// 鉴权策略：HTTP 请求用 Authorization: Bearer 头；WebSocket / EventSource 用 ?token= query。
class ClashClient {
  private baseURL: string;
  private secret: string;

  constructor(baseURL: string, secret: string = '') {
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.secret = secret;
  }

  setCredentials(baseURL: string, secret: string = '') {
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.secret = secret;
  }

  getBaseURL() {
    return this.baseURL;
  }

  getSecret() {
    return this.secret;
  }

  private authHeaders(): HeadersInit {
    return this.secret ? { Authorization: `Bearer ${this.secret}` } : {};
  }

  /**
   * 构建完整 URL。
   * attachToken=true 时追加 ?token= 用于 WebSocket / EventSource（浏览器不允许这些 API 设置 Authorization 头）。
   */
  buildURL(path: string, query?: Record<string, string | number | undefined>, attachToken = false): string {
    // 兼容 baseURL 可能已含 path 前缀
    const sep = path.startsWith('/') ? '' : '/';
    const url = new URL(this.baseURL + sep + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, String(v));
        }
      }
    }
    if (attachToken && this.secret) {
      url.searchParams.set('token', this.secret);
    }
    return url.toString();
  }

  private async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const res = await fetch(this.buildURL(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
    }
    // 部分端点返回空 body
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  // ── 元信息 ──────────────────────────────────────────────
  getVersion() {
    return this.request<VersionInfo>('/version');
  }

  getConfigs() {
    return this.request<Configs>('/configs');
  }

  patchConfigs(body: { mode?: string; 'log-level'?: string }) {
    return this.request<void>('/configs', { method: 'PATCH', body });
  }

  // ── 代理 ────────────────────────────────────────────────
  getProxies() {
    return this.request<ProxiesResp>('/proxies');
  }

  getProxy(name: string) {
    return this.request<ProxiesResp['proxies'][string]>(
      `/proxies/${encodeURIComponent(name)}`,
    );
  }

  selectProxy(name: string, child: string) {
    return this.request<void>(`/proxies/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: { name: child },
    });
  }

  clearProxySelection(name: string) {
    return this.request<void>(`/proxies/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  testProxyDelay(name: string, url?: string, timeout?: number) {
    return this.request<DelayResp>(
      `/proxies/${encodeURIComponent(name)}/delay`,
      { query: { url, timeout } },
    );
  }

  // ── 分组 ────────────────────────────────────────────────
  getGroups() {
    return this.request<GroupResp>('/group');
  }

  getGroup(name: string) {
    return this.request<GroupEntry>(`/group/${encodeURIComponent(name)}`);
  }

  testGroupDelay(name: string, url?: string, timeout?: number) {
    return this.request<GroupDelayMap>(
      `/group/${encodeURIComponent(name)}/delay`,
      { query: { url, timeout } },
    );
  }

  // ── 连接 ────────────────────────────────────────────────
  getConnections() {
    return this.request<ConnectionsResp>('/connections');
  }

  closeAllConnections() {
    return this.request<void>('/connections', { method: 'DELETE' });
  }

  closeConnection(id: string) {
    return this.request<void>(`/connections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ── 规则 ────────────────────────────────────────────────
  getRules() {
    return this.request<RulesResp>('/rules');
  }

  // ── DNS 规则 ─────────────────────────────────────────────
  getDnsRules() {
    return this.request<RulesResp>('/dns/rules');
  }

  // ── 规则集 provider ─────────────────────────────────────
  getRuleProviders() {
    return this.request<RuleProvidersResp>('/providers/rules');
  }

  refreshRuleProvider(name: string) {
    return this.request<void>(`/providers/rules/${encodeURIComponent(name)}`, {
      method: 'PUT',
    });
  }

  // ── 代理集 provider（订阅）──────────────────────────────
  // reflex 后端 /providers/proxies 当前为占位实现，接口已就绪待后端补全。
  getProxyProviders() {
    return this.request<ProxyProvidersResp>('/providers/proxies');
  }

  refreshProxyProvider(name: string) {
    return this.request<void>(`/providers/proxies/${encodeURIComponent(name)}`, {
      method: 'PUT',
    });
  }

  /** provider 级健康检查（reflex 在无 provider 数据时返回 204） */
  healthcheckProxyProvider(name: string, url?: string, timeout?: number) {
    return this.request<void>(
      `/providers/proxies/${encodeURIComponent(name)}/healthcheck`,
      { query: { url, timeout } },
    );
  }

  // ── DNS ─────────────────────────────────────────────────
  dnsQuery(name: string, type: DnsQueryType) {
    return this.request<DnsQueryResp>('/dns/query', { query: { name, type } });
  }

  getDnsStats() {
    return this.request<DnsStats>('/dns/stats');
  }

  flushDnsCache() {
    return this.request<void>('/cache/dns/flush', { method: 'POST' });
  }

  flushFakeip() {
    return this.request<void>('/cache/fakeip/flush', { method: 'POST' });
  }

  // ── 存储（面板自身偏好持久化）────────────────────────────
  getStorage<T = StorageData>(key: string) {
    return this.request<T>(`/storage/${encodeURIComponent(key)}`);
  }

  putStorage(key: string, body: unknown) {
    return this.request<void>(`/storage/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body,
    });
  }

  deleteStorage(key: string) {
    return this.request<void>(`/storage/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

// 单例客户端，供全局使用
// 若未配置 baseURL，自动从当前页面地址推导（reflex 在同源根路径提供 clash-api）
function detectBaseURL(): string {
  const stored = localStorage.getItem('reflex.baseURL');
  if (stored) return stored;
  // reflex 通过 external_ui 在 /ui/ 下服务面板，clash-api 在同源根路径
  const { origin } = window.location;
  return origin;
}
export const clashClient = new ClashClient(
  detectBaseURL(),
  localStorage.getItem('reflex.secret') || '',
);

export { ClashClient };
