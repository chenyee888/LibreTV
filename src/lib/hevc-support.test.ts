import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEVC_MIME_TYPE,
  codecFromMimeType,
  isHevcCodec,
  isHevcSupported,
  isHevcUnsupportedError,
} from './hevc-support';

function mockMediaSource(supported: boolean) {
  vi.stubGlobal(
    'MediaSource',
    {
      isTypeSupported: (mimeType: string) =>
        supported && mimeType === HEVC_MIME_TYPE,
    } as unknown as typeof MediaSource
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isHevcSupported', () => {
  it('MediaSource 支持 HEVC 时返回 true', () => {
    mockMediaSource(true);
    expect(isHevcSupported()).toBe(true);
  });

  it('MediaSource 不支持 HEVC 时返回 false', () => {
    mockMediaSource(false);
    expect(isHevcSupported()).toBe(false);
  });

  it('没有 MediaSource（SSR）时返回 false，不抛错', () => {
    expect(isHevcSupported()).toBe(false);
  });

  it('isTypeSupported 抛错时返回 false', () => {
    vi.stubGlobal('MediaSource', {
      isTypeSupported: () => {
        throw new Error('boom');
      },
    } as unknown as typeof MediaSource);
    expect(isHevcSupported()).toBe(false);
  });
});

describe('codecFromMimeType / isHevcCodec', () => {
  it('从 mimeType 取出编码名（带引号、大小写不敏感）', () => {
    expect(codecFromMimeType('video/mp4;codecs="hvc1.1.6.L120.90"')).toBe(
      'hvc1.1.6.l120.90'
    );
    expect(codecFromMimeType('video/mp4;codecs=hvc1.1.6.L120.90')).toBe(
      'hvc1.1.6.l120.90'
    );
    expect(codecFromMimeType('video/mp4;codecs="avc1.640028"')).toBe('avc1.640028');
  });

  it('mimeType 缺失时返回 undefined', () => {
    expect(codecFromMimeType(undefined)).toBeUndefined();
    expect(codecFromMimeType(null)).toBeUndefined();
    expect(codecFromMimeType('video/mp4')).toBeUndefined();
  });

  it('只认 hvc1 / hev1 前缀', () => {
    expect(isHevcCodec('hvc1.1.6.L120.90')).toBe(true);
    expect(isHevcCodec('hev1.1.6.L120.90')).toBe(true);
    expect(isHevcCodec('HVC1.2.4.L153.B0')).toBe(true);
    expect(isHevcCodec('avc1.640028')).toBe(false);
    expect(isHevcCodec('mp4a.40.2')).toBe(false);
    expect(isHevcCodec(undefined)).toBe(false);
    expect(isHevcCodec('')).toBe(false);
  });
});

describe('isHevcUnsupportedError', () => {
  it('bufferAddCodecError + video 轨 HEVC + 浏览器不支持 → true', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', {
        mimeType: 'video/mp4;codecs="hvc1.1.6.L120.90"',
        sourceBufferName: 'video',
      })
    ).toBe(true);
  });

  it('bufferAddCodecError + 音频轨 → false（不误判音频编码问题）', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', {
        mimeType: 'audio/mp4;codecs="ac-3"',
        sourceBufferName: 'audio',
      })
    ).toBe(false);
  });

  it('bufferAddCodecError + H.264 → false', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', {
        mimeType: 'video/mp4;codecs="avc1.640028"',
        sourceBufferName: 'video',
      })
    ).toBe(false);
  });

  it('bufferAddCodecError + mimeType 缺失时用档位 videoCodec 兜底', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', {
        sourceBufferName: 'video',
        videoCodec: 'hvc1.1.6.L120.90',
      })
    ).toBe(true);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', {
        sourceBufferName: 'video',
        videoCodec: 'avc1.640028',
      })
    ).toBe(false);
  });

  it('bufferAddCodecError + 编码未知 → false（不猜）', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', { sourceBufferName: 'video' })
    ).toBe(false);
  });

  it('manifestIncompatibleCodecsError + 档位声明 HEVC → true，H.264 → false', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('manifestIncompatibleCodecsError', {
        videoCodec: 'hvc1.1.6.L120.90',
      })
    ).toBe(true);
    expect(
      isHevcUnsupportedError('manifestIncompatibleCodecsError', {
        videoCodec: 'avc1.640028',
      })
    ).toBe(false);
  });

  it('浏览器支持 HEVC 时一律 false', () => {
    mockMediaSource(true);
    expect(
      isHevcUnsupportedError('bufferAddCodecError', {
        mimeType: 'video/mp4;codecs="hvc1.1.6.L120.90"',
        sourceBufferName: 'video',
      })
    ).toBe(false);
    expect(
      isHevcUnsupportedError('manifestIncompatibleCodecsError', {
        videoCodec: 'hvc1.1.6.L120.90',
      })
    ).toBe(false);
  });

  it('其他错误类型一律 false', () => {
    mockMediaSource(false);
    expect(
      isHevcUnsupportedError('bufferAppendError', {
        mimeType: 'video/mp4;codecs="hvc1.1.6.L120.90"',
        sourceBufferName: 'video',
      })
    ).toBe(false);
    expect(isHevcUnsupportedError('fragLoadError', {})).toBe(false);
  });
});
