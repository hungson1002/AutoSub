// Keep the Canvas API stable while all TTS callers share pronunciation/prosody.
export { SPEECH_STYLES as CANVAS_SPEECH_STYLES, normalizeSpokenText as normalizeCanvasSpokenText, resolveSpeech as resolveCanvasSpeech } from './speech';
