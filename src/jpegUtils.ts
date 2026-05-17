/**
 * Walk JPEG segments (starting after SOI) and return the first EXIF APP1
 * segment (FF E1 + 2-byte length + "Exif\0\0" + TIFF data) as a subarray,
 * or null if none is found.
 */
export function findJpegApp1(jpeg: Uint8Array): Uint8Array | null {
  let pos = 2; // skip SOI (FF D8)
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) break;
    const marker = jpeg[pos + 1];
    if (marker === 0xda) break; // SOS — no more APPn segments ahead
    const segLen = (jpeg[pos + 2] << 8) | jpeg[pos + 3];
    if (
      marker === 0xe1 &&
      pos + 10 <= jpeg.length &&
      jpeg[pos + 4] === 0x45 && jpeg[pos + 5] === 0x78 && jpeg[pos + 6] === 0x69 &&
      jpeg[pos + 7] === 0x66 && jpeg[pos + 8] === 0x00 && jpeg[pos + 9] === 0x00
    ) {
      return jpeg.subarray(pos, pos + 2 + segLen);
    }
    pos += 2 + segLen;
  }
  return null;
}
