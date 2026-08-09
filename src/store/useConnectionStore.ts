import { create } from 'zustand';
import { clashClient } from '../api/client';

interface ConnectionState {
  baseURL: string;
  secret: string;
  /** 运行时是否在线（每次刷新页面会重置为 false，需重新探活） */
  connected: boolean;
  connecting: boolean;
  error: string | null;
  /** 凭据是否已验证保存过（从 localStorage 恢复，决定是否跳过登录页） */
  verified: boolean;

  /** 测试连接并保存凭据（登录页 / 设置页使用） */
  testAndSave: (baseURL: string, secret: string) => Promise<boolean>;
  /** 基于已保存凭据重新探活（刷新页面后调用，不修改凭据） */
  recheck: () => Promise<void>;
  /** 仅更新凭据（不测试） */
  setCredentials: (baseURL: string, secret: string) => void;
  setConnected: (v: boolean) => void;
  setError: (e: string | null) => void;
  /** 退出登录：清除验证标记，回到登录页 */
  logout: () => void;
}

const VERIFIED_KEY = 'reflex.verified';

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  baseURL: localStorage.getItem('reflex.baseURL') || (typeof window !== 'undefined' ? window.location.origin : ''),
  secret: localStorage.getItem('reflex.secret') || '',
  connected: false,
  connecting: false,
  error: null,
  verified: localStorage.getItem(VERIFIED_KEY) === '1',

  testAndSave: async (baseURL: string, secret: string) => {
    set({ connecting: true, error: null });
    try {
      const prevBase = clashClient.getBaseURL();
      const prevSecret = clashClient.getSecret();
      clashClient.setCredentials(baseURL, secret);
      try {
        // 用 /version 探活
        await clashClient.getVersion();
        localStorage.setItem('reflex.baseURL', baseURL);
        localStorage.setItem('reflex.secret', secret);
        localStorage.setItem(VERIFIED_KEY, '1');
        set({
          baseURL,
          secret,
          connected: true,
          connecting: false,
          error: null,
          verified: true,
        });
        return true;
      } catch (e) {
        // 回滚凭据
        clashClient.setCredentials(prevBase, prevSecret);
        throw e;
      }
    } catch (e) {
      set({
        connected: false,
        connecting: false,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  },

  recheck: async () => {
    if (get().connecting) return;
    set({ connecting: true, error: null });
    try {
      await clashClient.getVersion();
      set({ connected: true, connecting: false, error: null });
    } catch (e) {
      set({
        connected: false,
        connecting: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },

  setCredentials: (baseURL: string, secret: string) => {
    clashClient.setCredentials(baseURL, secret);
    localStorage.setItem('reflex.baseURL', baseURL);
    localStorage.setItem('reflex.secret', secret);
    set({ baseURL, secret });
  },
  setConnected: (v) => set({ connected: v }),
  setError: (e) => set({ error: e }),

  logout: () => {
    localStorage.removeItem(VERIFIED_KEY);
    set({ verified: false, connected: false, error: null });
  },
}));
