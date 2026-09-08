import test from 'node:test';
import assert from 'node:assert/strict';
import { inferTrackInfo, mergeTrackInfoFromLrc } from '../src/lib/track-info.ts';

test('inferTrackInfo parses artist-title filenames and removes instrumental suffixes', () => {
  assert.deepEqual(inferTrackInfo('周杰伦 - 晴天.mp3'), {
    artist: '周杰伦',
    title: '晴天',
  });
  assert.deepEqual(inferTrackInfo('一场游戏一场梦-伴奏.mp3'), {
    artist: '',
    title: '一场游戏一场梦',
  });
});

test('inferTrackInfo supports an artist in trailing brackets', () => {
  assert.deepEqual(inferTrackInfo('晴天（周杰伦）.mp3'), {
    artist: '周杰伦',
    title: '晴天',
  });
});

test('mergeTrackInfoFromLrc lets LRC metadata override filename guesses', () => {
  assert.deepEqual(mergeTrackInfoFromLrc({ title: '晴天', artist: '' }, { ti: '稻香', ar: '周杰伦' }), {
    artist: '周杰伦',
    title: '稻香',
  });
});
