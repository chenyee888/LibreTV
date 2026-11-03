import { describe, expect, it } from 'vitest';
import { isM3u8Url } from './m3u8';

describe('isM3u8Url', () => {
  it('识别不带查询参数的 m3u8 地址', () => {
    expect(isM3u8Url('https://cdn.example/video.m3u8')).toBe(true);
  });

  it('识别带签名查询参数的 m3u8 地址', () => {
    expect(isM3u8Url('https://cdn.example/video.m3u8?verify=token&expires=123')).toBe(true);
  });

  it('识别带片段标识的 m3u8 地址', () => {
    expect(isM3u8Url('https://cdn.example/video.m3u8#playlist')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isM3u8Url('https://cdn.example/VIDEO.M3U8?token=x')).toBe(true);
  });

  it('不把普通媒体分片误判为 m3u8', () => {
    expect(isM3u8Url('https://cdn.example/segment.ts?token=x')).toBe(false);
  });

  it('无效 URL 时仍按路径后缀安全降级判断', () => {
    expect(isM3u8Url('/video.m3u8?token=x')).toBe(true);
  });
});
