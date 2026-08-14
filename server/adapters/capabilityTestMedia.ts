import { ProviderError } from './errors';

const spokenTestOgg = Buffer.from('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', 'base64');

export function capabilityTestSpeech() {
  return Buffer.from(spokenTestOgg);
}

export function assertExpectedTranscript(text: string) {
  const normalized = text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  if (!/\bhello\b/.test(normalized)) throw new ProviderError('STT có phản hồi nhưng không nhận dạng đúng audio kiểm tra có câu “Hello Auto Sub”.', 502);
}

export function assertPlayableAudio(audio: Buffer) {
  const wav = audio.length >= 12 && audio.subarray(0, 4).toString('ascii') === 'RIFF' && audio.subarray(8, 12).toString('ascii') === 'WAVE';
  const mp3 = audio.length >= 3 && (audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
  const ogg = audio.length >= 4 && audio.subarray(0, 4).toString('ascii') === 'OggS';
  const flac = audio.length >= 4 && audio.subarray(0, 4).toString('ascii') === 'fLaC';
  const mp4 = audio.length >= 12 && audio.subarray(4, 8).toString('ascii') === 'ftyp';
  if (audio.length < 128 || !(wav || mp3 || ogg || flac || mp4)) throw new ProviderError('TTS phản hồi nhưng dữ liệu trả về không phải file audio hợp lệ.', 502);
}
