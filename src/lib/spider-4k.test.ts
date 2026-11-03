import { describe, expect, it } from 'vitest';
import { is4kGuluToken, is4kLineLabel, isAllowedGuluLine, isAllowedOrangeLine } from './spider-adapters';

describe('4K-only Spider line selection', () => {
  it.each(['咖啡4K', '新咕噜4K', '2160P', 'UHD', '超高清'])('accepts explicit 4K label: %s', label => {
    expect(is4kLineLabel(label)).toBe(true);
  });

  it.each(['蚂蚁', '熊出没', '旋风金牌', '1080P', '蓝光', '高清'])('rejects non-4K label: %s', label => {
    expect(is4kLineLabel(label)).toBe(false);
  });

  it.each(['CO4K_abc', 'rose_abc', 'xfy-abc'])('accepts Gulu 4K token: %s', token => {
    expect(is4kGuluToken(token)).toBe(true);
  });

  it.each(['NBY-abc', 'qsvip-abc', 'qingshan-abc', 'JP-abc'])('rejects non-4K Gulu token: %s', token => {
    expect(is4kGuluToken(token)).toBe(false);
  });
});

describe('Gulu selected upstream lines', () => {
  it.each(['JD4K', 'newxfyun', 'NB4K', 'qsvip'])('keeps requested line: %s', label => {
    expect(isAllowedGuluLine(label)).toBe(true);
  });
  it.each(['pylg', 'KZNB', 'covip', 'rose', 'youku', 'bfzym3u8'])('rejects other line: %s', label => {
    expect(isAllowedGuluLine(label)).toBe(false);
  });
});

describe('Orange Juice selected upstream lines', () => {
  it.each(['JD4K', 'SH4K', 'qsvip'])('keeps requested line: %s', label => {
    expect(isAllowedOrangeLine(label)).toBe(true);
  });
  it.each(['pylg', 'tocyyds', 'newxfyun', 'VIP4K', 'vod_1080'])('rejects all other lines: %s', label => {
    expect(isAllowedOrangeLine(label)).toBe(false);
  });
});
