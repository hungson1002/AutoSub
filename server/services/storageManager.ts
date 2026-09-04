import { lstat, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { workdir } from './ffmpeg';

export type StorageCategoryId = 'uploads' | 'jobs' | 'review-jobs' | 'product-ad-jobs' | 'ai-video-jobs' | 'animation-projects' | 'animation-render-jobs' | 'animation-render-cache' | 'movie-projects';

export interface StorageItem {
  id: string;
  categoryId: StorageCategoryId;
  name: string;
  displayName: string;
  detail: string;
  sizeBytes: number;
  fileCount: number;
  modifiedAt: string;
  status?: string;
  canDelete: boolean;
  deleteBlockedReason?: string;
}

export interface StorageCategory {
  id: StorageCategoryId;
  label: string;
  description: string;
  sizeBytes: number;
  items: StorageItem[];
}

export interface StorageSnapshot {
  workdir: string;
  totalBytes: number;
  managedBytes: number;
  otherBytes: number;
  itemCount: number;
  scannedAt: string;
  categories: StorageCategory[];
}

type CategoryDefinition = Omit<StorageCategory, 'sizeBytes' | 'items'>;

const categoryDefinitions: CategoryDefinition[] = [
  { id: 'uploads', label: 'File nguồn & video đã tải', description: 'Video/audio đã nhập vào AutoSub, gồm file tải từ Douyin và Bilibili.' },
  { id: 'jobs', label: 'Kết quả lồng tiếng', description: 'Voice, timeline và kết quả của từng job lồng tiếng.' },
  { id: 'review-jobs', label: 'Video review', description: 'Kịch bản, clip trung gian và video review đã dựng.' },
  { id: 'ai-video-jobs', label: 'AI Video Studio', description: 'Các cảnh Flow và video AI hoàn chỉnh.' },
  { id: 'product-ad-jobs', label: 'Quảng cáo sản phẩm', description: 'Asset và video quảng cáo đã tạo.' },
  { id: 'animation-projects', label: 'Project Animation', description: 'Project và lịch sử phiên bản Animation Studio.' },
  { id: 'animation-render-jobs', label: 'Video Animation đã xuất', description: 'Bản ghi và MP4 của các lượt render Animation Studio.' },
  { id: 'animation-render-cache', label: 'Cache render Animation', description: 'MP4 có thể tạo lại khi xuất project.' },
  { id: 'movie-projects', label: 'Project phim cũ', description: 'Dữ liệu project phim đã lưu từ các phiên bản trước.' },
];

const activeStatuses = new Set([
  'queued', 'running', 'paused', 'planning', 'generating', 'composing',
  'transcribing', 'scripting', 'voicing', 'rendering', 'uploading', 'processing',
]);

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

async function readMetadata(target: string) {
  for (const filename of ['upload.json', 'job.json', 'project.json']) {
    try {
      return object(JSON.parse(await readFile(path.join(target, filename), 'utf8')));
    } catch { /* Try the next known record. */ }
  }
  return undefined;
}

async function pathStats(target: string) {
  let sizeBytes = 0;
  let fileCount = 0;
  const pending = [target];
  while (pending.length) {
    const current = pending.pop()!;
    const info = await lstat(current).catch(() => undefined);
    if (!info) continue;
    if (!info.isDirectory() || info.isSymbolicLink()) {
      sizeBytes += info.size;
      fileCount += 1;
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) pending.push(path.join(current, entry.name));
  }
  return { sizeBytes, fileCount };
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

function valueAt(record: JsonRecord | undefined, ...keys: string[]) {
  let value: unknown = record;
  for (const key of keys) value = object(value)?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

async function describeItem(root: string, definition: CategoryDefinition, name: string): Promise<StorageItem> {
  const target = path.join(root, definition.id, name);
  const [info, stats, metadata] = await Promise.all([lstat(target), pathStats(target), readMetadata(target)]);
  const status = valueAt(metadata, 'status').toLowerCase();
  const filename = valueAt(metadata, 'filename');
  const projectName = valueAt(metadata, 'name');
  const brief = valueAt(metadata, 'brief') || valueAt(metadata, 'input', 'brief') || valueAt(metadata, 'input', 'productName');
  const displayName = filename || projectName || brief || `${definition.label} · ${new Date(info.mtimeMs).toLocaleDateString('vi-VN')}`;
  const detail = filename ? (valueAt(metadata, 'sourceMode') === 'linked' ? 'File liên kết · bản gốc nằm ngoài AutoSub' : 'Bản sao lưu trong AutoSub') : name;
  const canDelete = !activeStatuses.has(status);
  return {
    id: `${definition.id}:${name}`,
    categoryId: definition.id,
    name,
    displayName,
    detail,
    sizeBytes: stats.sizeBytes,
    fileCount: stats.fileCount,
    modifiedAt: info.mtime.toISOString(),
    status: status || undefined,
    canDelete,
    deleteBlockedReason: canDelete ? undefined : 'Tác vụ đang hoạt động. Hãy dừng hoặc chờ hoàn tất trước khi xóa.',
  };
}

function definitionFor(categoryId: string) {
  return categoryDefinitions.find((item) => item.id === categoryId);
}

function safeItemPath(root: string, categoryId: string, itemName: string) {
  const definition = definitionFor(categoryId);
  if (!definition || !itemName || itemName !== path.basename(itemName) || itemName === '.' || itemName === '..') throw new Error('Mục lưu trữ không hợp lệ.');
  const categoryRoot = path.resolve(root, definition.id);
  const target = path.resolve(categoryRoot, itemName);
  if (!target.startsWith(`${categoryRoot}${path.sep}`)) throw new Error('Đường dẫn lưu trữ không hợp lệ.');
  return { definition, target };
}

export async function inspectStorage(root = workdir): Promise<StorageSnapshot> {
  const categories = await Promise.all(categoryDefinitions.map(async (definition): Promise<StorageCategory> => {
    const directory = path.join(root, definition.id);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const items = await mapLimited(entries, 4, (entry) => describeItem(root, definition, entry.name));
    items.sort((left, right) => right.sizeBytes - left.sizeBytes || right.modifiedAt.localeCompare(left.modifiedAt));
    return { ...definition, sizeBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0), items };
  }));
  const managedNames = new Set(categoryDefinitions.map((item) => item.id));
  const unmanaged = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => !managedNames.has(entry.name as StorageCategoryId));
  const unmanagedStats = await mapLimited(unmanaged, 4, (entry) => pathStats(path.join(root, entry.name)));
  const managedBytes = categories.reduce((sum, category) => sum + category.sizeBytes, 0);
  const otherBytes = unmanagedStats.reduce((sum, item) => sum + item.sizeBytes, 0);
  return {
    workdir: root,
    totalBytes: managedBytes + otherBytes,
    managedBytes,
    otherBytes,
    itemCount: categories.reduce((sum, category) => sum + category.items.length, 0),
    scannedAt: new Date().toISOString(),
    categories,
  };
}

export async function deleteStorageItems(items: Array<{ categoryId: string; name: string }>, root = workdir) {
  if (!Array.isArray(items) || !items.length || items.length > 200) throw new Error('Danh sách xóa phải có từ 1 đến 200 mục.');
  let freedBytes = 0;
  let deletedCount = 0;
  const errors: Array<{ categoryId: string; name: string; error: string }> = [];
  for (const item of items) {
    try {
      const { definition, target } = safeItemPath(root, String(item.categoryId || ''), String(item.name || ''));
      const current = await describeItem(root, definition, path.basename(target));
      if (!current.canDelete) throw new Error(current.deleteBlockedReason);
      const latestStatus = valueAt(await readMetadata(target), 'status').toLowerCase();
      if (activeStatuses.has(latestStatus)) throw new Error('Tác vụ vừa bắt đầu hoạt động nên AutoSub đã dừng xóa mục này.');
      await rm(target, { recursive: true, force: true });
      freedBytes += current.sizeBytes;
      deletedCount += 1;
    } catch (error) {
      errors.push({ categoryId: String(item.categoryId || ''), name: String(item.name || ''), error: error instanceof Error ? error.message : 'Không thể xóa mục.' });
    }
  }
  return { deletedCount, freedBytes, errors };
}
