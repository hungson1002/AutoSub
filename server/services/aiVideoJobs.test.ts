import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableNoChargeFlowError, parseBlurScore } from './aiVideoJobs';

test('parseBlurScore averages FFmpeg blur measurements', () => {
  assert.equal(parseBlurScore('blur mean: 4.0\nblur mean: 6.0'), 5);
});

test('parseBlurScore rejects missing or invalid measurements', () => {
  assert.equal(parseBlurScore('blur mean: unknown'), Number.POSITIVE_INFINITY);
});

test('only retries Flow failures that explicitly did not charge credit', () => {
  assert.equal(isRetryableNoChargeFlowError(new Error('Flow báo tạo video không thành công và xác nhận chưa tính phí.')), true);
  assert.equal(isRetryableNoChargeFlowError(new Error("Generation failed. You weren't charged.")), true);
  assert.equal(isRetryableNoChargeFlowError(new Error('Google Flow session expired or unauthorized (HTTP 401).')), false);
  assert.equal(isRetryableNoChargeFlowError(new Error('Không tải được video Flow.')), false);
});
