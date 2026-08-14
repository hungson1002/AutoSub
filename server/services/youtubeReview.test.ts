import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyYouTubeVideoStatus } from './youtubeReview';

test('YouTube processing success still requires a manual Content ID check', () => {
  const status = classifyYouTubeVideoStatus('video123', { status: { uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } });
  assert.equal(status.state, 'manual_check_required');
  assert.equal(status.studioUrl, 'https://studio.youtube.com/video/video123/edit');
});

test('YouTube copyright rejection is reported without claiming the upload passed', () => {
  const status = classifyYouTubeVideoStatus('video456', { status: { uploadStatus: 'rejected', rejectionReason: 'copyright' } });
  assert.equal(status.state, 'rejected');
  assert.equal(status.rejectionReason, 'copyright');
});
