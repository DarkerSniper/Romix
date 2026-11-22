/** Locates the PCM payload inside a RIFF/WAVE header (ffmpeg may add LIST chunks before "data"). */
export function wavDataRange(header: Uint8Array, fileSize: number): { offset: number; length: number } {
  const ascii = (o: number) => String.fromCharCode(header[o], header[o + 1], header[o + 2], header[o + 3]);
  const u32 = (o: number) => (header[o] | (header[o + 1] << 8) | (header[o + 2] << 16) | (header[o + 3] << 24)) >>> 0;
  if (header.length < 12 || ascii(0) !== "RIFF" || ascii(8) !== "WAVE") throw new Error("Not a WAV file");
  let o = 12;
  while (o + 8 <= header.length) {
    const id = ascii(o);
    const size = u32(o + 4);
    if (id === "data") {
      const offset = o + 8;
      // Streaming writers may leave the size as 0 or 0xFFFFFFFF; fall back to the file size.
      const length = size === 0 || size === 0xffffffff || offset + size > fileSize ? fileSize - offset : size;
      return { offset, length };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("WAV data chunk not found");
}
