import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TryWatch } from '../src/voice/vad.ts';
import { concat, hiss, mibo, mix, offset, rumble, silence, SR, vowel, white } from './signals.ts';

/**
 * Plays `room + speech` through a listening window the way listen.ts does:
 * 2048-sample blocks, Mibo talking for `miboS` seconds first (not armed).
 */
function listenTo(room: Float32Array, speech: Float32Array, miboS = 1.5) {
  const lead = mibo(miboS);
  const all = mix(room, concat(lead, speech));
  const w = new TryWatch(SR, { maxWait: 6, maxTry: 8, pause: 1.2 });
  const block = 2048;
  let endedAt = -1;
  for (let i = 0; i + block <= all.length && w.state === 'waiting'; i += block) {
    w.push(all.subarray(i, i + block), i >= lead.length);
    if (w.state !== 'waiting') endedAt = (i + block) / SR;
  }
  return { state: w.state, start: w.startAt >= 0 ? w.startAt - miboS : -1, endedAt: endedAt - miboS, summary: w.summary() };
}

test('a soft child voice below -50 dBFS in a quiet room is heard', () => {
  const room = white(12, -72);
  const r = listenTo(room, concat(silence(0.6), vowel(0.6, -56, 320), silence(4)));
  assert.equal(r.state, 'heard', r.summary);
  assert.ok(r.start > 0.5 && r.start < 0.75, `started at ${r.start}`);
});

test('a high, excited voice (480 Hz) is heard', () => {
  const r = listenTo(white(12, -70), concat(silence(0.4), vowel(0.5, -54, 480, [1200, 3400]), silence(4)));
  assert.equal(r.state, 'heard', r.summary);
});

test('a held "Sssss" over fan rumble is heard', () => {
  // the hiss is 17 dB quieter than the rumble overall, but alone above 3 kHz
  const room = mix(rumble(12, -45), white(12, -82, 9));
  const r = listenTo(room, concat(silence(0.5), hiss(1.5, -62), silence(4)));
  assert.equal(r.state, 'heard', r.summary);
  assert.ok(r.start > 0.4 && r.start < 0.7, `started at ${r.start}`);
});

test('a microphone with a DC offset still hears a soft voice', () => {
  const room = offset(white(12, -70), 0.02);   // the offset alone reads as -34 dBFS
  const r = listenTo(room, concat(silence(0.5), vowel(0.6, -55, 320), silence(4)));
  assert.equal(r.state, 'heard', r.summary);
});

test('a steady loud room is not a try', () => {
  // the old rule counted anything over -41 dBFS here as the child talking
  const r = listenTo(white(12, -38), silence(8));
  assert.equal(r.state, 'nothing', r.summary);
});

test('a hummy room with no one talking is not a try', () => {
  const r = listenTo(mix(rumble(12, -40), white(12, -75)), silence(8));
  assert.equal(r.state, 'nothing', r.summary);
});

test('a single tap on the screen does not start a try', () => {
  const click = silence(0.01).map((_, i) => (i % 2 ? 0.3 : -0.3));
  const r = listenTo(white(12, -70), concat(silence(1.021), click, silence(7)));
  assert.equal(r.state, 'nothing', r.summary);
});

test('a try ends after the pause, and several goes land in one window', () => {
  const room = white(14, -70);
  const goes = concat(silence(0.4), vowel(0.4, -45), silence(0.7), vowel(0.4, -45), silence(5));
  const r = listenTo(room, goes);
  assert.equal(r.state, 'heard', r.summary);
  // second go ends at 1.9 s; then 1.2 s of quiet
  assert.ok(r.endedAt > 3.0 && r.endedAt < 3.4, `ended at ${r.endedAt}`);
});

test('nothing said: gives up after maxWait', () => {
  const r = listenTo(white(12, -65), silence(8));
  assert.equal(r.state, 'nothing');
  assert.ok(r.endedAt > 6 && r.endedAt < 6.1, `ended at ${r.endedAt}`);
});

test('a child who starts as Mibo stops is still caught', () => {
  const r = listenTo(white(12, -70), concat(vowel(0.5, -50, 320), silence(4)));
  assert.equal(r.state, 'heard', r.summary);
  assert.ok(r.start < 0.15, `started at ${r.start}`);
});

test("Mibo's own echo dying away is not a try", () => {
  // a living room's echo: from -36 dBFS when listening starts, fading 10 dB every 75 ms
  const tail = white(0.5, -20, 7).map((v, i) => v * 10 ** ((-16 - (10 * i) / (0.075 * SR)) / 20));
  const r = listenTo(white(12, -70), concat(tail, silence(7)));
  assert.equal(r.state, 'nothing', r.summary);
});

test('a child who talks over the echo is still heard', () => {
  const tail = white(0.5, -20, 7).map((v, i) => v * 10 ** ((-16 - (10 * i) / (0.075 * SR)) / 20));
  const r = listenTo(white(12, -70), concat(mix(tail, concat(silence(0.1), vowel(0.5, -48))), silence(4)));
  assert.equal(r.state, 'heard', r.summary);
});
