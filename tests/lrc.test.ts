import assert from 'node:assert/strict';
import test from 'node:test';
import { findActiveLyricIndex, parseLrc } from '../src/lib/lrc.ts';

test('parseLrc parses metadata, hundredths and multiple timestamps', () => {
  const parsed = parseLrc(`\uFEFF[ti:Midnight Walk]\n[ar:Demo Artist]\n[00:01.25]First line\n[00:03.500][00:04.00]Second line`);

  assert.deepEqual(parsed.metadata, { ti: 'Midnight Walk', ar: 'Demo Artist' });
  assert.deepEqual(parsed.lines, [
    { time: 1.25, text: 'First line' },
    { time: 3.5, text: 'Second line' },
    { time: 4, text: 'Second line' },
  ]);
});

test('findActiveLyricIndex returns the latest line at or before current time', () => {
  const lines = parseLrc('[00:02.00]A\n[00:05.00]B\n[00:09.00]C').lines;

  assert.equal(findActiveLyricIndex(lines, 0), -1);
  assert.equal(findActiveLyricIndex(lines, 2), 0);
  assert.equal(findActiveLyricIndex(lines, 7.5), 1);
  assert.equal(findActiveLyricIndex(lines, 20), 2);
});

test('parseLrc ignores malformed or empty timestamp lines', () => {
  const parsed = parseLrc('[00:01.00]\nnot a lyric\n[00:99.00]invalid\n[01:59.00]still parsed');

  assert.deepEqual(parsed.lines, [{ time: 119, text: 'still parsed' }]);
});
