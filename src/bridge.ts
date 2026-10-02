import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Persistent integer timing preferences and one supported shortcut preset. */
export interface Settings { delaySeconds: number; intervalMs: number; shortcut: 'F8' | 'F9' | 'F10' }
/** Invalid numeric editor values are null until corrected. */
export interface DraftSettings { delaySeconds: number | null; intervalMs: number | null; shortcut: Settings['shortcut'] }
/** Authoritative Rust task snapshot, ordered by sequence and containing no source text. */
export interface Snapshot {
  sequence: number; phase: 'idle' | 'arming' | 'countdown' | 'typing' | 'done' | 'stopped' | 'failed';
  sent: number; total: number; remainingSeconds: number; message: string;
  settings: Settings; shortcutError: string | null; interactionBlocked?: boolean;
}
/** Revisioned editor state submitted to Rust. */
export interface Draft { revision: number; text: string; settings: DraftSettings }
/** Default editor preferences match the Rust settings contract. */
export const defaults: Settings = { delaySeconds: 5, intervalMs: 50, shortcut: 'F8' };
/** Tauri boundary: no browser input simulation is included in the application. */
export const bridge = {
  snapshot: () => invoke<Snapshot>('get_snapshot'),
  sync: (draft: Draft) => invoke<void>('sync_draft', { draft }),
  start: (draft: Draft) => invoke<Snapshot>('start_task', { draft }),
  cancel: () => invoke<Snapshot>('cancel_task'),
  save: (settings: Settings) => invoke<Snapshot>('save_settings', { settings }),
  subscribe: (handler: (state: Snapshot) => void) => listen<Snapshot>('relay-state', event => handler(event.payload)),
};
