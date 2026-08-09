import { create } from 'zustand';
import type { LogEntry } from '../api/types';
import { ClashWS } from '../api/ws';

const MAX_LOGS = 500; // 内存保留上限，避免无限增长

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'silent';

interface LogsState {
  logs: LogEntry[];
  level: LogLevel;
  paused: boolean;
  ws?: ClashWS;
  streaming: boolean;

  setLevel: (level: LogLevel) => void;
  togglePause: () => void;
  startStream: () => void;
  stop: () => void;
  clear: () => void;
}

export const useLogsStore = create<LogsState>((set, get) => ({
  logs: [],
  level: 'info',
  paused: false,
  streaming: false,

  setLevel: (level) => {
    set({ level });
    // 改级别需要重连 WS（reflex 通过 ?level= 过滤）
    if (get().streaming) {
      get().stop();
      // 下一 tick 重建，避免状态竞争
      setTimeout(() => get().startStream(), 0);
    }
  },

  togglePause: () => set({ paused: !get().paused }),

  startStream: () => {
    if (get().streaming) return;
    const level = get().level;
    const ws = new ClashWS(`/logs?level=${level}`);
    ws.on((data) => {
      if (get().paused) return;
      const entry = data as LogEntry;
      const logs = [...get().logs, entry];
      if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
      set({ logs });
    });
    ws.connect();
    set({ ws, streaming: true });
  },

  stop: () => {
    get().ws?.close();
    set({ ws: undefined, streaming: false });
  },

  clear: () => set({ logs: [] }),
}));
