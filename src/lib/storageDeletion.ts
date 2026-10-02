export type StorageDeleteItem = { categoryId: string; name: string };
export type StorageDeleteResult = {
  deletedCount: number;
  freedBytes: number;
  errors: Array<StorageDeleteItem & { error: string }>;
};

/** Keep each request within the server limit while allowing any UI selection. */
export async function deleteStorageInBatches(
  items: StorageDeleteItem[],
  send: (batch: StorageDeleteItem[]) => Promise<StorageDeleteResult>,
  onProgress?: (processed: number, total: number) => void,
): Promise<StorageDeleteResult> {
  const result: StorageDeleteResult = { deletedCount: 0, freedBytes: 0, errors: [] };
  for (let offset = 0; offset < items.length; offset += 200) {
    const batch = items.slice(offset, offset + 200);
    let response: StorageDeleteResult;
    try {
      response = await send(batch);
    } catch (error) {
      if (offset === 0) throw error;
      // Earlier batches are already deleted. Report that progress and retain
      // every unprocessed item for another attempt rather than starting over.
      const message = error instanceof Error ? error.message : 'Không thể gửi yêu cầu xóa.';
      result.errors.push(...items.slice(offset).map(item => ({ ...item, error: message })));
      break;
    }
    result.deletedCount += response.deletedCount;
    result.freedBytes += response.freedBytes;
    result.errors.push(...response.errors);
    onProgress?.(offset + batch.length, items.length);
  }
  return result;
}
