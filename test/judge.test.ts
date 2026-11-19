import assert from 'node:assert/strict';
import { test } from 'node:test';

import { judgeTry } from '../src/voice/judge.ts';
import { concat, hiss, mix, offset, rumble, silence, SR, vowel, white } from './signals.ts';

/** "sun"-like: an /s/ hiss, then a vowel at the child's pitch. */
const sWord = (f0: number, hissDb: number, vowelDb: number) =>
  concat(silence(0.4), hiss(0.28, hissDb), vowel(0.35, vowelDb, f0, [450, 2900]), silence(0.6));

test('a clear grown-up /s/ word still reads as /s/', () => {
  const v = judgeTry(mix(white(2, -75), sWord(200, -38, -30)), SR, 's', 'word');
  assert.equal(v.heard, 's');
  assert.equal(v.match, true);
});

test("a soft child's /s/ in an ordinary room reads as /s/, not /θ/", () => {
  // before: the room's noise flattened the hiss's spectrum and it read as a lisp
  const v = judgeTry(mix(white(2, -66), sWord(420, -50, -42)), SR, 's', 'word');
  assert.equal(v.heard, 's', JSON.stringify(v.feats));
});

test('a soft child word with hum and a DC offset still counts as speech', () => {
  // before: the offset and hum filled the quiet part, so the try read as no speech at all
  const x = offset(mix(mix(white(2, -70), rumble(2, -58)), sWord(420, -50, -42)), 0.02);
  const v = judgeTry(x, SR, 's', 'word');
  assert.equal(v.speech, true);
  assert.equal(v.heard, 's', JSON.stringify(v.feats));
});

test('"tun" for "sun" (no hiss) is still caught as a stopped sound', () => {
  const v = judgeTry(mix(white(2, -72), concat(silence(0.4), vowel(0.4, -42, 420), silence(0.6))), SR, 's', 'word');
  assert.equal(v.heard, 'stop');
  assert.equal(v.match, false);
});

test('room noise alone is not speech', () => {
  const v = judgeTry(white(2, -60), SR, 's', 'word');
  assert.equal(v.speech, false);
});
