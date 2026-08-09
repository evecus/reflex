// reflex clash-api 的 TypeScript 类型定义
// 严格对齐 /workspace/reflex/src/app/clash_api.rs 的响应结构

export interface VersionInfo {
  premium: boolean;
  version: string;
  meta: boolean;
}

export interface Configs {
  port?: number;
  'socks-port'?: number;
  'redir-port'?: number;
  'tproxy-port'?: number;
  'mixed-port'?: number;
  'allow-lan': boolean;
  'bind-address'?: string;
  mode: string;
  'mode-list': string[];
  modes?: string[];
  'log-level': string;
  ipv6: boolean;
  tun?: { enable: boolean };
}

export interface DelayHistory {
  time: string;
  delay: number;
  meanDelay: number;
}

export interface ProxyNode {
  type: string;
  name: string;
  udp: boolean;
  history: DelayHistory[];
  now?: string;
  all?: string[];
}

export interface ProxiesResp {
  proxies: Record<string, ProxyNode>;
}

export interface GroupEntry {
  type: string;
  name: string;
  udp: boolean;
  history: DelayHistory[];
  now?: string;
  all?: string[];
}

export interface GroupResp {
  proxies: GroupEntry[];
}

export interface DelayResp {
  delay: number;
  meanDelay: number;
}

export type GroupDelayMap = Record<string, number | null>;

export interface ConnMetadata {
  network: 'tcp' | 'udp';
  type: string;
  host: string;
  sniffHost: string;
  destinationIP: string;
  destinationPort: string;
  sourceIP: string;
  sourcePort: string;
  inboundName: string;
  inboundPort: string;
  inboundUser: string;
  process: string;
  processPath: string;
  dnsMode: string;
  remoteDestination: string;
  specialProxy: string;
  specialRules: string;
}

export interface Connection {
  id: string;
  metadata: ConnMetadata;
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
}

export interface ConnectionsResp {
  downloadTotal: number;
  uploadTotal: number;
  connections: Connection[];
  memory: number;
}

export interface Rule {
  type: string;
  payload: string;
  proxy: string;
  size: number;
  reflex?: Record<string, unknown>;
  /** DNS 规则专用：命中后是否禁用缓存 */
  disableCache?: boolean;
}

export interface RulesResp {
  rules: Rule[];
}

export interface RuleProvider {
  behavior: string;
  format: string;
  name: string;
  ruleCount: number;
  type: string;
  updatedAt: string;
  vehicleType: string;
}

export interface RuleProvidersResp {
  providers: Record<string, RuleProvider>;
}

/**
 * 代理集 Provider（订阅）。
 * reflex 后端 /providers/proxies 当前为占位实现，结构对齐 clash API。
 */
export interface ProxyProvider {
  name: string;
  type: string; // Proxy
  vehicleType: string; // HTTP / File / Clash
  proxies?: string[];
  updatedAt?: string;
  subscriptionInfo?: {
    Upload?: number;
    Download?: number;
    Total?: number;
    Expire?: number;
  };
}

export interface ProxyProvidersResp {
  providers: Record<string, ProxyProvider>;
}

export interface DnsStats {
  inbound_queries: number;
  hijacked_queries: number;
  hijacked_tcp: number;
  hijacked_udp: number;
  errors: number;
}

export interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DnsQueryResp {
  Status: number;
  TC: boolean;
  RD: boolean;
  RA: boolean;
  AD: boolean;
  CD: boolean;
  Question: { Name: string; Qtype: number; Qclass: number }[];
  Answer?: DnsAnswer[];
  Server: string;
}

export interface TrafficData {
  up: number;
  down: number;
}

export interface MemoryData {
  inuse: number;
  oslimit: number;
}

export interface LogEntry {
  type: string;
  payload: string;
}

export interface StorageData {
  [key: string]: unknown;
}

export type DnsQueryType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'NS'
  | 'TXT'
  | 'PTR'
  | 'SRV'
  | 'SOA'
  | 'CAA';
