import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Persistent integer timing preferences and one supported shortcut preset. */
export interface Settings { intervalMs: number; shortcut: 'F8' | 'F9' | 'F10' }
/** Invalid numeric editor values are null until corrected. */
export interface DraftSettings { intervalMs: number | null; shortcut: Settings['shortcut'] }
/** Authoritative Rust task snapshot, ordered by sequence and containing no source text. */
export interface Snapshot {
  sequence: number; phase: 'idle' | 'targeting' | 'typing' | 'done' | 'stopped' | 'failed';
  sent: number; total: number; target: { x: number; y: number; title: string } | null; message: string;
  settings: Settings; shortcutError: string | null; interactionBlocked?: boolean;
}
/** Revisioned editor state submitted to Rust. */
export interface Draft { revision: number; text: string; settings: DraftSettings }
/** Default editor preferences match the Rust settings contract. */
export const defaults: Settings = { intervalMs: 50, shortcut: 'F8' };
/** Tauri boundary: no browser input simulation is included in the application. */
export const bridge = {
  snapshot: () => invoke<Snapshot>('get_snapshot'),
  sync: (draft: Draft) => invoke<void>('sync_draft', { draft }),
  start: (draft: Draft) => invoke<Snapshot>('start_task', { draft }),
  cancel: () => invoke<Snapshot>('cancel_task'),
  save: (settings: Settings) => invoke<Snapshot>('save_settings', { settings }),
  close: () => invoke<void>('close_app'),
  subscribeClose: (handler: () => void) => listen('relay-close-requested', handler),
  subscribe: (handler: (state: Snapshot) => void) => listen<Snapshot>('relay-state', event => handler(event.payload)),
};

/** Full source of one task that reached native submission; time is Unix milliseconds. */
export interface HistoryEntry { id: number; time: number; text: string; pinned: boolean }
/** Ordered local archive state; its preferences are independent of input timing. */
export interface TextState { sequence: number; draft: string; entries: HistoryEntry[]; restoreDraft: boolean; saveHistory: boolean; error: string | null }
/** Mutations of local saved content; clear affects history and clearDraft affects saved draft only. */
export type TextAction = { kind: 'preferences'; restoreDraft: boolean; saveHistory: boolean } | { kind: 'delete'; id: number } | { kind: 'pin'; id: number; pinned: boolean } | { kind: 'clear'; includePinned: boolean } | { kind: 'clearDraft' | 'retry' };
/** Text storage commands are serialized by the native task and disk owners. */
export const archiveBridge = {
  read: () => invoke<TextState>('get_text_state'),
  change: (action: TextAction) => invoke<TextState>('change_text_state', { action }),
  flush: () => invoke<TextState>('flush_text'),
  subscribe: (handler: (state: TextState) => void) => listen<TextState>('text-state', event => handler(event.payload)),
};

/** Ordered update metadata; package bytes and signing keys stay in Rust. */
export interface UpdateSnapshot {
  sequence: number; phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  installed: boolean; autoCheck: boolean; version: string | null; notes: string;
  downloaded: number; total: number | null; message: string;
}
/** Restricted commands use the official endpoint configured by the native build. */
export const updateBridge = {
  snapshot: () => invoke<UpdateSnapshot>('get_update_state'),
  preference: (autoCheck: boolean) => invoke<UpdateSnapshot>('set_update_preference', { autoCheck }),
  check: () => invoke<UpdateSnapshot>('check_update'),
  download: () => invoke<UpdateSnapshot>('download_update'),
  install: () => invoke<UpdateSnapshot>('install_update', { confirmed: true }),
  subscribe: (handler: (state: UpdateSnapshot) => void) => listen<UpdateSnapshot>('update-state', event => handler(event.payload)),
};
