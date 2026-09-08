export interface SavedFileHandle {
  name: string;
  getFile(): Promise<File>;
  queryPermission?: (descriptor?: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode: 'read' }) => Promise<PermissionState>;
}

export interface AssetHandleSet {
  audio: SavedFileHandle;
  cover: SavedFileHandle;
  lyrics: SavedFileHandle;
}

export interface AssetFileSet {
  audio: File;
  cover: File;
  lyrics: File;
}

export interface AssetSource {
  handles?: AssetHandleSet;
  files?: AssetFileSet;
}

export interface AssetHistoryEntry {
  id: string;
  label: string;
  createdAt: number;
  audioName: string;
  coverName: string;
  lyricsName: string;
  songTitle?: string;
  artistName?: string;
  lyricsOffsetMs?: number;
}

interface StoredAssetHistoryRecord extends AssetHistoryEntry {
  handles?: AssetHandleSet;
  files?: AssetFileSet;
}

export interface AssetHistorySnapshot {
  entry: AssetHistoryEntry;
  source: AssetSource;
}

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<SavedFileHandle[]>;
}

const HISTORY_STORAGE_KEY = 'open-karaoke:asset-history';
const HISTORY_DB_NAME = 'open-karaoke-assets';
const HISTORY_STORE_NAME = 'asset-history';

function readHistoryMetadata(): AssetHistoryEntry[] {
  try {
    const value = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AssetHistoryEntry => {
      if (!item || typeof item !== 'object') return false;
      const entry = item as Partial<AssetHistoryEntry>;
      return typeof entry.id === 'string'
        && typeof entry.label === 'string'
        && typeof entry.createdAt === 'number'
        && typeof entry.audioName === 'string'
        && typeof entry.coverName === 'string'
        && typeof entry.lyricsName === 'string';
    });
  } catch {
    return [];
  }
}

function writeHistoryMetadata(entries: AssetHistoryEntry[]): void {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('当前浏览器不支持本地素材历史记录。'));
      return;
    }

    const request = indexedDB.open(HISTORY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地素材历史记录。'));
  });
}

async function withHistoryStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openHistoryDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HISTORY_STORE_NAME, mode);
    const request = callback(transaction.objectStore(HISTORY_STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地素材历史记录操作失败。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本地素材历史记录操作失败。'));
    transaction.oncomplete = () => database.close();
  });
}

export function supportsRememberedAssets(): boolean {
  return 'showOpenFilePicker' in window && 'indexedDB' in window;
}

export async function pickRememberedAssetHandles(): Promise<SavedFileHandle[]> {
  const pickerWindow = window as FilePickerWindow;
  if (!pickerWindow.showOpenFilePicker) {
    throw new Error('当前浏览器不支持可记忆的文件选择，请使用最新版 Chrome 或 Edge。');
  }
  return pickerWindow.showOpenFilePicker({ multiple: true });
}

export class AssetHistoryStore {
  list(): AssetHistoryEntry[] {
    return readHistoryMetadata().sort((a, b) => b.createdAt - a.createdAt);
  }

  async save(entry: AssetHistoryEntry, source: AssetSource): Promise<void> {
    const record: StoredAssetHistoryRecord = { ...entry, ...source };
    await withHistoryStore('readwrite', (store) => store.put(record));
    const entries = readHistoryMetadata().filter((item) => item.id !== entry.id);
    writeHistoryMetadata([entry, ...entries].sort((a, b) => b.createdAt - a.createdAt));
  }

  async getSnapshot(id: string): Promise<AssetHistorySnapshot | undefined> {
    const record = await withHistoryStore<StoredAssetHistoryRecord | undefined>('readonly', (store) => store.get(id));
    if (!record) return undefined;
    const { handles, files, ...entry } = record;
    return { entry, source: { handles, files } };
  }

  async remove(id: string): Promise<void> {
    await withHistoryStore('readwrite', (store) => store.delete(id));
    writeHistoryMetadata(readHistoryMetadata().filter((item) => item.id !== id));
  }
}

export async function readRememberedAsset(handle: SavedFileHandle): Promise<File> {
  const permission = await handle.queryPermission?.({ mode: 'read' });
  if (permission !== 'granted') {
    const requestedPermission = await handle.requestPermission?.({ mode: 'read' });
    if (requestedPermission !== 'granted') {
      throw new Error(`没有读取文件“${handle.name}”的权限。`);
    }
  }
  return handle.getFile();
}
