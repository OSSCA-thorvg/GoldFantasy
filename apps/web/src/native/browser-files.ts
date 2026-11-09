import type { DocumentFiles } from '../../../../packages/native-editors/src/documents';

interface StoredFile {
  path: string;
  text: string;
}
interface PendingFile extends StoredFile {
  revision: number;
}
const encoder = new TextEncoder();
function filePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (!parts.length) throw new Error('Invalid file path');
  return '/' + parts.join('/');
}
function storedFile(value: unknown): value is StoredFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'text' in value &&
    typeof value.text === 'string'
  );
}
function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let rejected = false;
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('files'))
        request.result.createObjectStore('files', { keyPath: 'path' });
    };
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open saved files.'));
    request.onblocked = () => {
      rejected = true;
      reject(new Error('Saved files are open in an incompatible tab.'));
    };
  });
}
/** Hydrated file cache provides native synchronous scene commands; IndexedDB replaces the host filesystem. */
export class BrowserFiles implements DocumentFiles {
  private readonly cache = new Map<string, string>();
  private readonly pending = new Map<string, PendingFile>();
  private revision = 0;
  private closed = false;
  private flushing: Promise<void> | undefined;
  private scheduled = false;
  private constructor(private readonly database: IDBDatabase) {
    database.onversionchange = () => {
      this.closed = true;
      database.close();
    };
  }
  static async open(name = 'GoldFantasy.native-files'): Promise<BrowserFiles> {
    const database = await openDatabase(name),
      files = new BrowserFiles(database);
    try {
      const all = await new Promise<unknown[]>((resolve, reject) => {
        const transaction = database.transaction('files', 'readonly'),
          request = transaction.objectStore('files').getAll();
        let rows: unknown[] = [];
        request.onsuccess = () => {
          rows = request.result;
        };
        transaction.oncomplete = () => resolve(rows);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });
      for (const value of all) {
        if (!storedFile(value)) throw new Error('Invalid saved file record.');
        files.cache.set(value.path, value.text);
      }
      return files;
    } catch (error) {
      database.close();
      throw error;
    }
  }
  private assertOpen(): void {
    if (this.closed) throw new Error('Saved files are closed.');
  }
  exists(path: string): boolean {
    this.assertOpen();
    return this.cache.has(filePath(path));
  }
  readSync(path: string, maxBytes = 96 * 1024 * 1024): string {
    this.assertOpen();
    const text = this.cache.get(filePath(path));
    if (text === undefined) throw new Error('File does not exist');
    if (encoder.encode(text).byteLength > maxBytes) throw new Error('File exceeds size limit');
    return text;
  }
  async read(path: string, maxBytes: number): Promise<string> {
    return this.readSync(path, maxBytes);
  }
  stage(path: string, text: string, maxBytes = 96 * 1024 * 1024): void {
    this.assertOpen();
    if (encoder.encode(text).byteLength > maxBytes) throw new Error('File exceeds size limit');
    const canonical = filePath(path);
    this.cache.set(canonical, text);
    this.pending.set(canonical, { path: canonical, text, revision: ++this.revision });
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (!this.closed) void this.sync().catch((error) => console.error(error));
      });
    }
  }
  async write(path: string, text: string, maxBytes: number): Promise<void> {
    this.stage(path, text, maxBytes);
    await this.sync();
  }
  sync(): Promise<void> {
    this.assertOpen();
    if (this.flushing) return this.flushing.then(() => this.sync());
    if (!this.pending.size) return Promise.resolve();
    const flush = async () => {
      while (this.pending.size) {
        const batch = [...this.pending.values()];
        await new Promise<void>((resolve, reject) => {
          const transaction = this.database.transaction('files', 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the file.'));
          transaction.onerror = () => {};
          const store = transaction.objectStore('files');
          for (const value of batch) store.put({ path: value.path, text: value.text });
        });
        for (const value of batch)
          if (this.pending.get(value.path)?.revision === value.revision) this.pending.delete(value.path);
      }
    };
    const promise = flush();
    this.flushing = promise;
    void promise.then(
      () => {
        if (this.flushing === promise) this.flushing = undefined;
      },
      () => {
        if (this.flushing === promise) this.flushing = undefined;
      },
    );
    return promise;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.sync();
    } finally {
      this.closed = true;
      this.database.close();
    }
  }
}
