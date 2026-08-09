import { create } from 'zustand';
import type { GroupEntry, GroupDelayMap, ProxyNode } from '../api/types';
import { clashClient } from '../api/client';

interface ProxiesState {
  proxies: Record<string, ProxyNode>;
  groups: GroupEntry[];
  loading: boolean;
  error: string | null;
  // 单个分组的测速结果 { groupName: { memberTag: delay|null } }
  groupDelays: Record<string, GroupDelayMap>;
  testingGroups: Record<string, boolean>;
  // 单节点测速状态
  testingNodes: Record<string, boolean>;

  refresh: () => Promise<void>;
  selectProxy: (group: string, child: string) => Promise<void>;
  testGroupDelay: (group: string, url?: string, timeout?: number) => Promise<void>;
  testNodeDelay: (node: string, url?: string, timeout?: number) => Promise<void>;
  clearSelection: (group: string) => Promise<void>;
}

const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const DEFAULT_TIMEOUT = 5000;

export const useProxiesStore = create<ProxiesState>((set, get) => ({
  proxies: {},
  groups: [],
  loading: false,
  error: null,
  groupDelays: {},
  testingGroups: {},
  testingNodes: {},

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [proxiesResp, groupsResp] = await Promise.all([
        clashClient.getProxies(),
        clashClient.getGroups(),
      ]);
      set({
        proxies: proxiesResp.proxies,
        groups: groupsResp.proxies,
        loading: false,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  selectProxy: async (group: string, child: string) => {
    await clashClient.selectProxy(group, child);
    // 乐观更新
    const proxies = { ...get().proxies };
    if (proxies[group]) {
      proxies[group] = { ...proxies[group], now: child };
    }
    const groups = get().groups.map((g) =>
      g.name === group ? { ...g, now: child } : g,
    );
    set({ proxies, groups });
  },

  testGroupDelay: async (group: string, url = DEFAULT_TEST_URL, timeout = DEFAULT_TIMEOUT) => {
    set({ testingGroups: { ...get().testingGroups, [group]: true } });
    try {
      const delays = await clashClient.testGroupDelay(group, url, timeout);
      set({
        groupDelays: { ...get().groupDelays, [group]: delays },
      });
      // 同步更新 proxy history（用于全局节点列表显示）
      const proxies = { ...get().proxies };
      for (const [tag, delay] of Object.entries(delays)) {
        if (proxies[tag]) {
          const history = delay !== null
            ? [{ time: new Date().toISOString(), delay, meanDelay: delay }]
            : [];
          proxies[tag] = { ...proxies[tag], history };
        }
      }
      set({ proxies });
    } catch {
      set({
        groupDelays: { ...get().groupDelays, [group]: {} },
      });
    } finally {
      set({ testingGroups: { ...get().testingGroups, [group]: false } });
    }
  },

  testNodeDelay: async (node: string, url = DEFAULT_TEST_URL, timeout = DEFAULT_TIMEOUT) => {
    set({ testingNodes: { ...get().testingNodes, [node]: true } });
    try {
      const resp = await clashClient.testProxyDelay(node, url, timeout);
      const proxies = { ...get().proxies };
      if (proxies[node]) {
        proxies[node] = {
          ...proxies[node],
          history: [
            { time: new Date().toISOString(), delay: resp.delay, meanDelay: resp.meanDelay },
          ],
        };
      }
      set({ proxies });
    } catch {
      // 失败时清除 history（对齐 reflex 行为）
      const proxies = { ...get().proxies };
      if (proxies[node]) {
        proxies[node] = { ...proxies[node], history: [] };
      }
      set({ proxies });
    } finally {
      set({ testingNodes: { ...get().testingNodes, [node]: false } });
    }
  },

  clearSelection: async (group: string) => {
    await clashClient.clearProxySelection(group);
    await get().refresh();
  },
}));
