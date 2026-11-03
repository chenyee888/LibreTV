import { describe, expect, it } from 'vitest';
import { is4kGuluToken, is4kLineLabel, isAllowedOrangeLine } from './spider-adapters';

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

describe('Orange Juice allowed 4K lines', () => {
  it.each(['自建4K-3', '自建 4K-3', 'VIP4K', 'VIP 4K'])('keeps requested line: %s', label => {
    expect(isAllowedOrangeLine(label)).toBe(true);
  });
  it.each(['qq', 'bilibili', '自建4K-2', 'VIP', '1080P'])('rejects all other lines: %s', label => {
    expect(isAllowedOrangeLine(label)).toBe(false);
  });
});
