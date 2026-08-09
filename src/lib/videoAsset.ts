import type { VideoAsset } from '../types';

export async function videoAssetUploadFile(asset: VideoAsset, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  if (asset.file) return asset.file;
  const response = await fetcher(asset.url, { signal });
  if (!response.ok) throw new Error(`Không thể đọc lại video preview (${response.status}).`);
  const blob = await response.blob();
  return new File([blob], asset.name, { type: asset.type || blob.type || 'video/mp4' });
}
