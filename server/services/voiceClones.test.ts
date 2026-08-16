import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProviderError } from '../adapters/errors';
import { run } from './ffmpeg';
import { createVoiceCloneProfile, deleteVoiceCloneProfile, listVoiceCloneProfiles, resolveVoiceCloneReference, VOICE_REFERENCE_SAMPLE_RATE, VOICE_REFERENCE_VERSION } from './voiceClones';

test('voice clone profile requires explicit authorization', async () => {
  await assert.rejects(
    () => createVoiceCloneProfile({ name: 'No consent', sourcePath: 'missing.wav', sourceName: 'missing.wav', authorized: false }),
    (error: unknown) => error instanceof ProviderError && error.status === 400 && /xác nhận|cho phép/i.test(error.message),
  );
});

test('voice clone profile normalizes, lists, resolves and deletes a reference', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'autosub-voice-clone-'));
  const source = path.join(temporary, 'sample.wav');
  let profileId = '';
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3.2', '-ac', '1', '-ar', '24000', source]);
    const profile = await createVoiceCloneProfile({ name: '  Test   Voice  ', sourcePath: source, sourceName: 'sample.wav', authorized: true });
    profileId = profile.id;
    assert.equal(profile.name, 'Test Voice');
    assert.equal(profile.authorized, true);
    assert.equal(profile.referenceVersion, VOICE_REFERENCE_VERSION);
    assert.ok(profile.durationMs >= 3_000);
    assert.ok((await listVoiceCloneProfiles()).some((item) => item.id === profile.id));
    const resolved = await resolveVoiceCloneReference(profile.id);
    assert.equal(resolved.profile.id, profile.id);
    assert.equal(path.basename(resolved.referencePath), 'reference.wav');
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'default=nw=1:nk=1', resolved.referencePath]);
    assert.equal(Number(probe.stdout.trim()), VOICE_REFERENCE_SAMPLE_RATE);
    await deleteVoiceCloneProfile(profile.id);
    profileId = '';
    await assert.rejects(() => resolveVoiceCloneReference(profile.id || profile.id), (error: unknown) => error instanceof ProviderError && error.status === 404);
  } finally {
    if (profileId) await deleteVoiceCloneProfile(profileId).catch(() => undefined);
    await rm(temporary, { recursive: true, force: true });
  }
});
