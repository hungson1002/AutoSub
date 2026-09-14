export type UploadedSubtitleFont = {
  family: string;
  name: string;
  file: File;
  url: string;
};

type StoredFont = {
  family: string;
  name: string;
  type: string;
  data: ArrayBuffer;
};

const DB_NAME = 'autosub-font-library';
const STORE_NAME = 'fonts';

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'family' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const requestResult = <T,>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function registerFont(file: File, family: string): Promise<UploadedSubtitleFont> {
  const url = URL.createObjectURL(file);
  try {
    const face = new FontFace(family, `url(${url})`);
    await face.load();
    document.fonts.add(face);
    await document.fonts.load(`16px "${family.replace(/"/g, '')}"`);
    return { family, name: file.name, file, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function saveSubtitleFont(file: File, family: string) {
  const data = await file.arrayBuffer();
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ family, name: file.name, type: file.type, data } satisfies StoredFont);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function addSubtitleFont(file: File, family: string) {
  const font = await registerFont(file, family);
  try {
    await saveSubtitleFont(file, family);
  } catch { /* IndexedDB can be unavailable in private mode; keep the session font. */ }
  return font;
}

export async function loadSubtitleFonts() {
  if (typeof indexedDB === 'undefined') return [];
  const database = await openDatabase();
  try {
    const records = await requestResult(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()) as StoredFont[];
    const loaded: UploadedSubtitleFont[] = [];
    for (const record of records) {
      try {
        const file = new File([record.data], record.name, { type: record.type || 'font/ttf' });
        loaded.push(await registerFont(file, record.family));
      } catch {
        // Keep one damaged font from hiding the rest of the user's library.
      }
    }
    return loaded;
  } finally {
    database.close();
  }
}
