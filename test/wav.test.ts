import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pcmToWav, wavToPcm } from '../src/voice/analyze.ts';

const pcm = new Uint8Array([1, 0, 2, 0, 255, 127, 0, 128]);

test('reads back a plain 44-byte WAV', () => {
  const got = wavToPcm(pcmToWav(pcm, 24000));
  assert.ok(got);
  assert.equal(got.sr, 24000);
  assert.deepEqual([...got.pcm], [...pcm]);
});

test('finds the samples after a LIST chunk (no fixed 44-byte header)', () => {
  const plain = pcmToWav(pcm, 48000);
  const list = new Uint8Array([...'LIST'].map(c => c.charCodeAt(0)).concat([6, 0, 0, 0], [...'INFOab'].map(c => c.charCodeAt(0))));
  const wav = new Uint8Array(plain.length + list.length);
  wav.set(plain.subarray(0, 36));
  wav.set(list, 36);
  wav.set(plain.subarray(36), 36 + list.length);
  const got = wavToPcm(wav);
  assert.ok(got);
  assert.equal(got.sr, 48000);
  assert.deepEqual([...got.pcm], [...pcm]);
});

test('bare PCM is not mistaken for a WAV', () => {
  assert.equal(wavToPcm(pcm), null);
});
