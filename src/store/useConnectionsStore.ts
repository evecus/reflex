import { create } from 'zustand';
import type { Connection, ConnectionsResp } from '../api/types';
import { clashClient } from '../api/client';
import { ClashWS } from '../api/ws';

interface ConnectionsState {
  connections: Connection[];
  downloadTotal: number;
  uploadTotal: number;
  memory: number;
  loading: boolean;
  error: string | null;
  ws?: ClashWS;
  /** 是否已建立 WS */
  streaming: boolean;

  /** 一次性快照 */
  snapshot: () => Promise<void>;
  /** 建立 WS 持续推送 */
  startStream: () => void;
  stop: () => void;
  closeAll: () => Promise<void>;
  closeOne: (id: string) => Promise<void>;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  downloadTotal: 0,
  uploadTotal: 0,
  memory: 0,
  loading: false,
  error: null,
  streaming: false,

  snapshot: async () => {
    set({ loading: true, error: null });
    try {
      const resp = await clashClient.getConnections();
      set({
        connections: resp.connections,
        downloadTotal: resp.downloadTotal,
        uploadTotal: resp.uploadTotal,
        memory: resp.memory,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  startStream: () => {
    if (get().streaming) return;
    const ws = new ClashWS('/connections');
    ws.on((data) => {
      const resp = data as ConnectionsResp;
      set({
        connections: resp.connections || [],
        downloadTotal: resp.downloadTotal ?? 0,
        uploadTotal: resp.uploadTotal ?? 0,
        memory: resp.memory ?? 0,
      });
    });
    ws.connect();
    set({ ws, streaming: true });
  },

  stop: () => {
    get().ws?.close();
    set({ ws: undefined, streaming: false });
  },

  closeAll: async () => {
    await clashClient.closeAllConnections();
    // WS 下一帧会自然清空，但乐观更新提升体验
    set({ connections: [] });
  },

  closeOne: async (id: string) => {
    await clashClient.closeConnection(id);
    set({ connections: get().connections.filter((c) => c.id !== id) });
  },
}));
