/**
 * HEVC（H.265）播放支持检测。
 *
 * 背景：部分 4K 线路（如咕噜 CO4K）给的是 HEVC 编码视频，而 Chromium/Chrome 的
 * hls.js + MSE 管线无法解码 HEVC——服务端链路（解析 → 代理 → 播放列表 → 分片）
 * 全通的情况下，浏览器里依然黑屏并最终报「媒体解码错误多次恢复无效」。
 * hls.js 在这种情况下的行为：
 * - 清单声明了 CODECS 且浏览器不支持 → 致命 manifestIncompatibleCodecsError；
 * - 清单没声明 CODECS（单码率媒体清单常见）→ 建 SourceBuffer 时抛错，
 *   触发**非致命** bufferAddCodecError（data.mimeType 里带实际编码），随后
 *   hls.js 移除该档位，播放器在后续致命错误里空转重试，最终只剩通用报错。
 *
 * 所以不能只在「创建 Hls 之前」做一次无条件检测——那会把 H.264 线路也拦掉
 * （Chrome 同样不支持 HEVC，但 H.264 播得好好的）。正确做法是：编码信息
 * 已知时再判定（清单声明的档位编码，或建 SourceBuffer 失败时的 mimeType），
 * 命中即停掉重试循环并给明确提示。
 */

/** 诊断用 HEVC 4K 的 MSE mime 类型（ffprobe 实测 CO4K 为 hevc 3840x2160） */
export const HEVC_MIME_TYPE = 'video/mp4; codecs="hvc1.1.6.L120.90"';

/** 当前浏览器能否用 MSE 解码 HEVC：MediaSource 缺失或抛错都按「不支持」处理 */
export function isHevcSupported(): boolean {
  try {
    const MediaSourceCtor =
      typeof MediaSource !== 'undefined' ? MediaSource : undefined;
    return typeof MediaSourceCtor?.isTypeSupported === 'function'
      ? MediaSourceCtor.isTypeSupported(HEVC_MIME_TYPE)
      : false;
  } catch {
    return false;
  }
}

/** 从 mimeType 的 codecs= 值里取出编码名（可能带引号、可能跟多个编码） */
export function codecFromMimeType(mimeType?: string | null): string | undefined {
  if (!mimeType) return undefined;
  const match = /codecs\s*=\s*"?([^";,]+)"?/i.exec(mimeType);
  return match?.[1]?.trim().toLowerCase();
}

/** 编码名是否为 HEVC（hvc1 / hev1） */
export function isHevcCodec(codec?: string | null): boolean {
  if (!codec) return false;
  const c = codec.trim().toLowerCase();
  return c.startsWith('hvc1') || c.startsWith('hev1');
}

/** HEVC 线路在当前浏览器播不了时给用户的明确提示（替代通用解码错误） */
export const HEVC_UNSUPPORTED_MESSAGE =
  '该线路为 HEVC（H.265）4K 视频，当前浏览器无法解码，请使用 Safari 播放，或在 Windows 上安装 HEVC 视频扩展后使用 Edge 播放';

/**
 * hls.js 报错是否意味着「HEVC 编码且浏览器不支持」。
 * - bufferAddCodecError（非致命）：建 SourceBuffer 失败，data.mimeType 是实际编码；
 *   只认 video 轨，避免音频编码问题被误判；mimeType 缺失时退到档位声明的 videoCodec。
 * - manifestIncompatibleCodecsError（致命）：清单声明的编码与浏览器不兼容，
 *   用档位声明的 videoCodec 判断。
 * 其余情况一律返回 false，绝不凭空猜测编码。
 */
export function isHevcUnsupportedError(
  details: string,
  opts: {
    mimeType?: string | null;
    sourceBufferName?: string | null;
    videoCodec?: string | null;
  } = {}
): boolean {
  if (isHevcSupported()) return false;
  if (details === 'bufferAddCodecError') {
    if (opts.sourceBufferName && opts.sourceBufferName !== 'video') return false;
    const codec = codecFromMimeType(opts.mimeType) ?? opts.videoCodec;
    return isHevcCodec(codec);
  }
  if (details === 'manifestIncompatibleCodecsError') {
    return isHevcCodec(opts.videoCodec);
  }
  return false;
}
