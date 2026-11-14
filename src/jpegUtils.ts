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

const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * Return the XMP packet of the first standard XMP APP1 segment as a string,
 * or null if there is none.
 */
export function findJpegXmp(jpeg: Uint8Array): string | null {
  let pos = 2; // skip SOI (FF D8)
  while (pos + 4 <= jpeg.length) {
    if (jpeg[pos] !== 0xff) break;
    const marker = jpeg[pos + 1];
    if (marker === 0xda) break; // SOS — no more APPn segments ahead
    const segLen = (jpeg[pos + 2] << 8) | jpeg[pos + 3];
    const bodyStart = pos + 4;
    const bodyEnd = Math.min(pos + 2 + segLen, jpeg.length);
    if (marker === 0xe1 && bodyStart + XMP_HEADER.length <= bodyEnd) {
      const header = String.fromCharCode(...jpeg.subarray(bodyStart, bodyStart + XMP_HEADER.length));
      if (header === XMP_HEADER) {
        return new TextDecoder().decode(jpeg.subarray(bodyStart + XMP_HEADER.length, bodyEnd));
      }
    }
    pos += 2 + segLen;
  }
  return null;
}

/** Wrap an XMP packet in a JPEG APP1 segment (FF E1 + length + header + packet). */
export function buildXmpApp1(xmp: string): Uint8Array {
  const body = new TextEncoder().encode(XMP_HEADER + xmp);
  const segLen = body.length + 2;
  if (segLen > 0xffff) throw new Error('XMP packet too large for one APP1 segment');
  const seg = new Uint8Array(2 + segLen);
  seg.set([0xff, 0xe1, segLen >> 8, segLen & 0xff]);
  seg.set(body, 4);
  return seg;
}

export const GPANO_NS = 'http://ns.google.com/photos/1.0/panorama/';

/**
 * Read the GPano properties from an XMP packet. XMP allows both element form
 * (<GPano:Key>v</GPano:Key>) and attribute form (GPano:Key="v"). Returns null
 * if the packet does not use the GPano namespace.
 */
export function parseGPano(xmp: string): Map<string, string> | null {
  if (!xmp.includes(GPANO_NS)) return null;
  const props = new Map<string, string>();
  for (const m of xmp.matchAll(/<GPano:(\w+)>([^<]*)<\/GPano:\1>|GPano:(\w+)="([^"]*)"/g)) {
    const key = m[1] ?? m[3];
    const value = (m[2] ?? m[4]).trim();
    if (!props.has(key)) props.set(key, value);
  }
  return props;
}
