import { strict as assert } from 'node:assert';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import Fastify from 'fastify';
import test from 'node:test';
import type { AIProvider } from '../types';
import { workdir } from '../services/ffmpeg';
import { createDubbingJob } from '../services/dubbingJobs';
import { dubbingRoutes } from './dubbing';

const jobsRoot = `${workdir}/jobs`;

test('dubbing result streams from disk and supports HTTP Range 206', async () => {
  const provider: AIProvider = {
    id: 'range-test-provider',
    name: 'Range Test Provider',
    baseUrl: 'http://127.0.0.1:1/v1',
    enabled: true,
    models: [],
    providerType: 'openai-compatible',
    authType: 'none',
    capabilities: { tts: true },
  };
  const job = await createDubbingJob({
    cues: [{
      id: 'range-cue', index: 1, startMs: 0, endMs: 1000,
      originalText: 'Original', translatedText: 'Translated', text: 'Translated',
      previousText: '', nextText: '', provider, model: 'model', voice: 'voice', speed: 1, volume: 1,
    }],
  });
  const directory = `${jobsRoot}/${job.id}`;
  const audio = Buffer.alloc(1024 * 1024, 0x5a);
  const audioPath = `${directory}/result/track.wav`;
  const metadataPath = `${directory}/result/metadata.json`;
  const jobPath = `${directory}/job.json`;
  const app = Fastify({ logger: false });

  try {
    await mkdir(`${directory}/result`, { recursive: true });
    await writeFile(audioPath, audio);
    await writeFile(metadataPath, '[]', 'utf8');
    const persisted = JSON.parse(await readFile(jobPath, 'utf8')) as Record<string, unknown>;
    persisted.status = 'completed';
    persisted.doneCues = 1;
    persisted.result = { audioFile: 'result/track.wav', metadataFile: 'result/metadata.json', durationMs: 1000, masteringVersion: 1 };
    await writeFile(jobPath, JSON.stringify(persisted), 'utf8');

    await dubbingRoutes(app);
    await app.ready();

    const full = await app.inject({ method: 'GET', url: `/api/dubbing/jobs/${job.id}/result/audio` });
    assert.equal(full.statusCode, 200);
    assert.equal(full.headers['accept-ranges'], 'bytes');
    assert.equal(Number(full.headers['content-length']), audio.length);
    assert.equal(full.rawPayload.length, audio.length);

    const ranged = await app.inject({
      method: 'GET',
      url: `/api/dubbing/jobs/${job.id}/result/audio`,
      headers: { range: 'bytes=100-199' },
    });
    assert.equal(ranged.statusCode, 206);
    assert.equal(ranged.headers['content-range'], `bytes 100-199/${audio.length}`);
    assert.equal(Number(ranged.headers['content-length']), 100);
    assert.deepEqual(ranged.rawPayload, audio.subarray(100, 200));
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
