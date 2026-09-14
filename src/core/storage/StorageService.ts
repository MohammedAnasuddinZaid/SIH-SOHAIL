// Storage abstraction. Default implementation is localStorage-backed JSON.
// The interface is designed so a real backend / IndexedDB can replace it later.

let memoryFallback: Map<string, string> | null = null;

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const k = "__rep_arena_probe__";
      window.localStorage.setItem(k, "1");
      window.localStorage.removeItem(k);
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export const storageBackend: Storage | null = safeLocalStorage();

function backendGet(key: string): string | null {
  if (storageBackend) return storageBackend.getItem(key);
  if (!memoryFallback) memoryFallback = new Map();
  return memoryFallback.get(key) ?? null;
}

function backendSet(key: string, value: string): void {
  if (storageBackend) storageBackend.setItem(key, value);
  else {
    if (!memoryFallback) memoryFallback = new Map();
    memoryFallback.set(key, value);
  }
}

function backendRemove(key: string): void {
  if (storageBackend) storageBackend.removeItem(key);
  else memoryFallback?.delete(key);
}

export class StorageService {
  constructor(private readonly namespace: string) {}

  private key(id: string): string {
    return `${this.namespace}:${id}`;
  }

  async get<T>(id: string): Promise<T | null> {
    const raw = backendGet(this.key(id));
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async getAll<T>(ids?: string[]): Promise<Array<{ id: string; value: T }>> {
    if (!storageBackend && !memoryFallback) return [];
    const prefix = `${this.namespace}:`;
    const keys = ids ?? this.keys();
    const out: Array<{ id: string; value: T }> = [];
    for (const k of keys) {
      const full = k.startsWith(prefix) ? k : `${prefix}${k}`;
      const raw = backendGet(full);
      if (raw === null) continue;
      try {
        out.push({ id: k.replace(prefix, ""), value: JSON.parse(raw) as T });
      } catch {
        // skip corrupt entries
      }
    }
    return out;
  }

  keys(): string[] {
    const prefix = `${this.namespace}:`;
    if (storageBackend) {
      const out: string[] = [];
      for (let i = 0; i < storageBackend.length; i++) {
        const k = storageBackend.key(i);
        if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out;
    }
    if (memoryFallback) return [...memoryFallback.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
    return [];
  }

  async put<T>(id: string, value: T): Promise<void> {
    backendSet(this.key(id), JSON.stringify(value));
  }

  async remove(id: string): Promise<void> {
    backendRemove(this.key(id));
  }

  async clear(): Promise<void> {
    for (const k of this.keys()) backendRemove(`${this.namespace}:${k}`);
  }

  async has(id: string): Promise<boolean> {
    return backendGet(this.key(id)) !== null;
  }
}

export interface KVCollection<T> {
  get(id: string): Promise<T | null>;
  getAll<V>(ids?: string[]): Promise<Array<{ id: string; value: V }>>;
  keys(): string[];
  put(id: string, value: T): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  has(id: string): Promise<boolean>;
}

export const store = <T>(namespace: string): KVCollection<T> => new StorageService(namespace) as unknown as KVCollection<T>;

export function createId(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

export function now(): number {
  return Date.now();
}