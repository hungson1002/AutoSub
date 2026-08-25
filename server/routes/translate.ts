import type { FastifyInstance } from 'fastify';
import type { AIProvider, TranslationItem, TranslationMemoryItem } from '../types';
import { buildTranslationGuide, ProviderError, TranslationValidationError, translateBatch } from '../adapters';

interface Body {
  provider?: AIProvider;
  model?: string;
  items?: TranslationItem[];
  sourceLanguage?: string;
  targetLanguage?: string;
  style?: string;
  customPrompt?: string;
  glossary?: Array<{ source: string; target: string }>;
  translationMemory?: TranslationMemoryItem[];
  translationGuide?: string;
}

function sendProviderError(reply: { code: (status: number) => { send: (body: unknown) => unknown } }, error: unknown, fallback: string) {
  const message = error instanceof ProviderError ? error.message : fallback;
  return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
}

export async function translationRoutes(app: FastifyInstance) {
  app.post('/api/translate/guide', async (request, reply) => {
    const body = request.body as Body;
    if (!body.provider?.baseUrl || !body.model || !body.items?.length) return reply.code(400).send({ error: 'Translation guide cần provider, model và items.' });
    try {
      const guide = await buildTranslationGuide(body.provider, body.model, body.items, body.sourceLanguage || 'Auto Detect', body.targetLanguage || 'Tiếng Việt', body.style || 'Review phim', body.customPrompt || '', body.glossary || []);
      return { guide };
    } catch (error) {
      return sendProviderError(reply, error, 'Không thể tạo translation guide.');
    }
  });

  app.post('/api/translate', async (request, reply) => {
    const body = request.body as Body;
    if (!body.provider?.baseUrl || !body.model || !body.items?.length) return reply.code(400).send({ error: 'Translation cần provider, model và items.' });
    try {
      const result = new Map<string, { id: string; translation: string }>();
      let pending = [...body.items];
      let lastValidationMessage = '';
      for (let attempt = 0; attempt < 3 && pending.length; attempt += 1) {
        try {
          const translated = await translateBatch(body.provider, body.model, pending, body.sourceLanguage || 'Auto Detect', body.targetLanguage || 'Tiếng Việt', body.style || 'Phổ thông', body.customPrompt || '', body.glossary || [], body.translationMemory || [], body.translationGuide || '');
          translated.forEach((item) => result.set(item.id, item));
          pending = pending.filter((item) => !result.has(item.id));
        } catch (error) {
          if (error instanceof TranslationValidationError) {
            lastValidationMessage = error.message;
            error.partialItems.forEach((item) => result.set(item.id, item));
            pending = pending.filter((item) => !result.has(item.id));
          } else if (attempt === 2) throw error;
        }
      }
      const items = body.items.map((item) => result.get(item.id)!).filter(Boolean);
      if (pending.length) {
        return {
          items,
          pendingCueIds: pending.map((item) => item.id),
          warning: `${lastValidationMessage || 'Translation chưa hoàn tất.'} Còn ${pending.length} cue chưa dịch sau 3 lần retry.`,
        };
      }
      return { items, pendingCueIds: [] };
    } catch (error) {
      return sendProviderError(reply, error, 'Translation request thất bại.');
    }
  });
}
