import type { KeyRecord, KeyRecordStore } from './vault';

const DB_NAME = 'ogg-vault';
const STORE = 'keys';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB on the vault origin. Only sealed keys are written; nothing here is ever in clear. */
export class IndexedDbKeyRecordStore implements KeyRecordStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<unknown[]> {
    return request((await this.store('readonly')).getAll());
  }

  async put(record: KeyRecord): Promise<void> {
    await request((await this.store('readwrite')).put(record));
  }

  async delete(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id));
  }
}
