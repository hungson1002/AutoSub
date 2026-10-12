import { ProviderError } from '../adapters/errors';

function disabledModels() {
  return new Set((process.env.AUTOSUB_STT_DISABLED_MODELS || '').split(',').map(id => id.trim()).filter(Boolean));
}

export function allowedLocalSttModels<T extends { id: string }>(models: T[]): T[] {
  const disabled = disabledModels();
  return models.filter(model => !disabled.has(model.id));
}

export function assertLocalSttAllowed(model: string) {
  if (disabledModels().has(model)) throw new ProviderError('Model STT này đã được tắt trên máy vì tải nặng hoặc trùng lựa chọn tốt hơn. Hãy chọn Faster Whisper Small/Medium INT8, Small Q5 hoặc SenseVoiceSmall.', 400);
}
