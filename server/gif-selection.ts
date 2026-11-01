// Structural playback metadata; frame count may legitimately decrease when duplicate frames merge.
export function gifInfo(source: Uint8Array) {
  const b = Buffer.from(source);
  if (b.length < 14 || !/^GIF8[79]a$/.test(b.toString("ascii", 0, 6)))
    throw Error("GIF格式无效");
  const width = b.readUInt16LE(6),
    height = b.readUInt16LE(8);
  if (!width || !height) throw Error("GIF尺寸无效");
  let at = 13 + (b[10] & 128 ? 3 * (1 << ((b[10] & 7) + 1)) : 0),
    pages = 0,
    duration = 0,
    delay = 0,
    loop: number | null = null,
    ended = false;
  const blocks = () => {
    const chunks: Buffer[] = [];
    while (true) {
      if (at >= b.length) throw Error("GIF截断");
      const n = b[at++];
      if (!n) break;
      if (at + n > b.length) throw Error("GIF截断");
      chunks.push(b.subarray(at, at + n));
      at += n;
    }
    return chunks;
  };
  while (at < b.length) {
    const code = b[at++];
    if (code === 0x3b) {
      ended = true;
      break;
    }
    if (code === 0x21) {
      if (at >= b.length) throw Error("GIF截断");
      const label = b[at++],
        parts = blocks();
      if (label === 0xf9) {
        if (parts.length !== 1 || parts[0].length !== 4)
          throw Error("GIF控制块无效");
        delay = parts[0].readUInt16LE(1);
      }
      if (
        label === 0xff &&
        parts.length >= 2 &&
        /^(NETSCAPE2.0|ANIMEXTS1.0)$/.test(parts[0].toString("ascii")) &&
        parts[1].length >= 3 &&
        parts[1][0] === 1
      )
        loop = parts[1].readUInt16LE(1);
    } else if (code === 0x2c) {
      if (at + 9 > b.length) throw Error("GIF截断");
      const packed = b[at + 8];
      at += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0);
      if (at >= b.length) throw Error("GIF截断");
      at++;
      blocks();
      pages++;
      duration += delay;
      delay = 0;
    } else throw Error("GIF数据无效");
  }
  if (!ended || !pages) throw Error("GIF未完整结束");
  return { width, height, pages, duration, loop };
}
export function selectSmallerGif(original: Uint8Array, candidate: Uint8Array) {
  const input = gifInfo(original);
  try {
    const out = gifInfo(candidate);
    if (
      out.width !== input.width ||
      out.height !== input.height ||
      out.duration !== input.duration ||
      out.loop !== input.loop
    )
      return {
        bytes: original,
        source: "original",
        reason: "播放元数据变化",
        input,
        output: out,
      };
    if (candidate.length >= original.length)
      return {
        bytes: original,
        source: "original",
        reason: "优化结果未减小",
        input,
        output: out,
      };
    return {
      bytes: candidate,
      source: "optimized",
      reason: "优化结果更小且播放元数据一致",
      input,
      output: out,
    };
  } catch (error) {
    return {
      bytes: original,
      source: "original",
      reason: "优化结果无效: " + String(error),
      input,
    };
  }
}
