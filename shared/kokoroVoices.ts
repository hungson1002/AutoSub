export interface KokoroVoiceRecord {
  id: string;
  name: string;
  language: 'en-us' | 'en-gb';
  description: string;
}

export const KOKORO_VOICE_PREVIEW_TEXT = 'Hello. Let me tell you something surprising: the story you know may be missing its most important detail.';

const VIETNAMESE_WORDS = /\b(?:xin chào|tôi|bạn|mình|chúng|đây|là|và|của|một|người|không|được|những|này|đó|đang|sẽ|trong|với|cho|có|để|vì|sao|thì|khi|nào)\b/iu;
const VIETNAMESE_TONE_MARKS = /[áàạảãấầậẩẫắằặẳẵéèẹẻẽếềệểễíìịỉĩóòọỏõốồộổỗớờợởỡúùụủũứừựửữýỳỵỷỹ]/giu;

export function isLikelyVietnamese(text: string) {
  const toneMarks = text.match(VIETNAMESE_TONE_MARKS)?.length || 0;
  return VIETNAMESE_WORDS.test(text) || /[ăđơư]/iu.test(text) || toneMarks >= 3;
}

const voice = (id: string, name: string, language: KokoroVoiceRecord['language'], description: string): KokoroVoiceRecord => ({ id, name, language, description });

export const KOKORO_ENGLISH_VOICES: KokoroVoiceRecord[] = [
  voice('af_alloy', 'Alloy · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_aoede', 'Aoede · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_bella', 'Bella · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_heart', 'Heart · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_jessica', 'Jessica · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_kore', 'Kore · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_nicole', 'Nicole · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_nova', 'Nova · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_river', 'River · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_sarah', 'Sarah · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('af_sky', 'Sky · Nữ · Mỹ', 'en-us', 'English (US) · female'),
  voice('am_adam', 'Adam · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_echo', 'Echo · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_eric', 'Eric · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_fenrir', 'Fenrir · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_liam', 'Liam · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_michael', 'Michael · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_onyx', 'Onyx · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('am_puck', 'Puck · Nam · Mỹ', 'en-us', 'English (US) · male'),
  voice('bf_alice', 'Alice · Nữ · Anh', 'en-gb', 'English (UK) · female'),
  voice('bf_emma', 'Emma · Nữ · Anh', 'en-gb', 'English (UK) · female'),
  voice('bf_isabella', 'Isabella · Nữ · Anh', 'en-gb', 'English (UK) · female'),
  voice('bf_lily', 'Lily · Nữ · Anh', 'en-gb', 'English (UK) · female'),
  voice('bm_daniel', 'Daniel · Nam · Anh', 'en-gb', 'English (UK) · male'),
  voice('bm_fable', 'Fable · Nam · Anh', 'en-gb', 'English (UK) · male'),
  voice('bm_george', 'George · Nam · Anh', 'en-gb', 'English (UK) · male'),
  voice('bm_lewis', 'Lewis · Nam · Anh', 'en-gb', 'English (UK) · male'),
];
