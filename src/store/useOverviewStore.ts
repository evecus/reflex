import { create } from 'zustand';
import type { Configs, TrafficData, MemoryData, VersionInfo } from '../api/types';
import { clashClient } from '../api/client';
import { ClashWS } from '../api/ws';

const TRAFFIC_HISTORY_LEN = 60; // 60 秒滚动窗口

interface TrafficPoint {
  up: number;
  down: number;
  ts: number;
}

interface OverviewState {
  version: VersionInfo | null;
  configs: Configs | null;
  // 实时速率（每秒 delta）
  currentUp: number;
  currentDown: number;
  currentMemory: number;
  // 累计总量（由 /traffic 每秒 delta 累加得到）
  totalUp: number;
  totalDown: number;
  // 历史采样点（用于曲线）
  trafficHistory: TrafficPoint[];
  memoryHistory: number[];
  // WS 实例
  trafficWS?: ClashWS;
  memoryWS?: ClashWS;
  realtimeStarted: boolean;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  /** 建立实时速率 / 内存 WS（幂等；由 App 挂载时调用，所有页面共享顶栏速率） */
  startRealtime: () => void;
  stop: () => void;
  refreshConfigs: () => Promise<void>;
  patchMode: (mode: string) => Promise<void>;
  patchLogLevel: (level: string) => Promise<void>;
}

export const useOverviewStore = create<OverviewState>((set, get) => ({
  version: null,
  configs: null,
  currentUp: 0,
  currentDown: 0,
  currentMemory: 0,
  totalUp: 0,
  totalDown: 0,
  trafficHistory: [],
  memoryHistory: [],
  realtimeStarted: false,
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const [version, configs] = await Promise.all([
        clashClient.getVersion(),
        clashClient.getConfigs(),
      ]);
      set({ version, configs, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  startRealtime: () => {
    // 幂等：已启动则直接复用现有 WS
    if (get().realtimeStarted) return;

    const trafficWS = new ClashWS('/traffic');
    trafficWS.on((data) => {
      const t = data as TrafficData;
      const up = typeof t.up === 'number' ? t.up : 0;
      const down = typeof t.down === 'number' ? t.down : 0;
      const history = [...get().trafficHistory, { up, down, ts: Date.now() }];
      if (history.length > TRAFFIC_HISTORY_LEN) history.shift();
      set({
        currentUp: up,
        currentDown: down,
        // 累计总量：delta 逐秒累加，修复旧实现 totalUp/totalDown
        // 从未被赋值导致 Overview 累计卡片恒显示 0 B 的问题
        totalUp: get().totalUp + up,
        totalDown: get().totalDown + down,
        trafficHistory: history,
      });
    });
    trafficWS.connect();

    const memoryWS = new ClashWS('/memory');
    memoryWS.on((data) => {
      const m = data as MemoryData;
      const inuse = typeof m.inuse === 'number' ? m.inuse : 0;
      const history = [...get().memoryHistory, inuse];
      if (history.length > TRAFFIC_HISTORY_LEN) history.shift();
      set({ currentMemory: inuse, memoryHistory: history });
    });
    memoryWS.connect();

    set({ trafficWS, memoryWS, realtimeStarted: true });
  },

  stop: () => {
    const { trafficWS, memoryWS } = get();
    trafficWS?.close();
    memoryWS?.close();
    set({ trafficWS: undefined, memoryWS: undefined, realtimeStarted: false });
  },

  refreshConfigs: async () => {
    try {
      const configs = await clashClient.getConfigs();
      set({ configs });
    } catch {
      // 静默失败，不打断 UI
    }
  },

  patchMode: async (mode: string) => {
    await clashClient.patchConfigs({ mode });
    await get().refreshConfigs();
  },

  patchLogLevel: async (level: string) => {
    await clashClient.patchConfigs({ 'log-level': level });
    await get().refreshConfigs();
  },
}));
