import { clashClient } from './client';

type WSHandler = (data: unknown) => void;

/**
 * reflex clash-api WebSocket 客户端。
 *
 * reflex 的 4 个 WS 端点：
 *   /traffic   每秒推送 {up, down}
 *   /memory    每秒推送 {inuse, oslimit}
 *   /logs      实时推送 {type, payload}
 *   /connections 每秒推送 {downloadTotal, uploadTotal, connections, memory}
 *
 * 浏览器不允许 WebSocket 设置 Authorization 头，reflex 支持 ?token= query 鉴权。
 * 断线自动指数退避重连（1s → 2s → 4s → 8s → 上限 30s）。
 */
export class ClashWS {
  private ws?: WebSocket;
  private retry = 0;
  private handlers = new Set<WSHandler>();
  private closed = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  // 状态回调（供 UI 显示连接状态）
  private statusHandlers = new Set<(status: WSStatus) => void>();
  private currentStatus: WSStatus = 'idle';
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** 建立连接 */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.closed = false;
    const url = clashClient.buildURL(this.path, undefined, true);
    // reflex WS 走 ws:// 或 wss://（与 HTTP 同端口，由 clash_api.rs 同一 listener 升级）
    const wsURL = url.replace(/^http/, 'ws');
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(wsURL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
    };
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.handlers.forEach((h) => h(data));
      } catch {
        // 忽略非 JSON 帧（reflex keepalive 等）
      }
    };
    this.ws.onerror = () => {
      this.setStatus('error');
    };
    this.ws.onclose = () => {
      this.setStatus('closed');
      if (!this.closed) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** this.retry, 30000);
    this.retry++;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: WSStatus) {
    this.currentStatus = status;
    this.statusHandlers.forEach((h) => h(status));
  }

  /** 订阅数据 */
  on(handler: WSHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** 订阅连接状态变化 */
  onStatus(handler: (status: WSStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.currentStatus);
    return () => this.statusHandlers.delete(handler);
  }

  /** 主动关闭，不再重连 */
  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.handlers.clear();
    this.statusHandlers.clear();
  }
}

export type WSStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error' | 'reconnecting';
