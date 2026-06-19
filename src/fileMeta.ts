import { Input, ALL_FORMATS, BlobSource } from 'mediabunny';
import { findJpegApp1 } from './jpegUtils';

export interface FileMeta {
  year?: string;
  month?: string;
  day?: string;
  hour?: string;
  minute?: string;
  timezone?: string;
  lat?: string;
  lon?: string;
  duration?: string;
}

/** Parse ISO 6709 decimal coordinate string, e.g. "+53.5616+009.9222+021.300/" */
function parseIso6709(s: string): { lat: number | null; lon: number | null } {
  const m = s.match(/^([+-]\d+\.?\d*)([+-]\d+\.?\d*)/);
  if (!m) return { lat: null, lon: null };
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  return { lat: isNaN(lat) ? null : lat, lon: isNaN(lon) ? null : lon };
}

/** Read EXIF metadata from a JPEG file's raw bytes. */
function parseExifMeta(jpeg: Uint8Array): FileMeta {
  const app1 = findJpegApp1(jpeg);
  // app1 = FF E1 (2) + length (2) + "Exif\0\0" (6) + TIFF data
  if (!app1 || app1.length < 18) return {};
  const tiff = app1.subarray(10);
  if (tiff.length < 8) return {};

  const isLE = tiff[0] === 0x49; // "II" = little-endian
  const r16 = (o: number) =>
    isLE ? tiff![o] | (tiff![o + 1] << 8) : (tiff![o] << 8) | tiff![o + 1];
  const r32 = (o: number) =>
    isLE
      ? (tiff![o] | (tiff![o + 1] << 8) | (tiff![o + 2] << 16) | (tiff![o + 3] << 24)) >>> 0
      : ((tiff![o] << 24) | (tiff![o + 1] << 16) | (tiff![o + 2] << 8) | tiff![o + 3]) >>> 0;

  if (r16(2) !== 0x002a) return {};

  function findEntry(ifdOff: number, tag: number) {
    const n = r16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      if (r16(e) === tag) return { type: r16(e + 2), count: r32(e + 4), dataOff: e + 8 };
    }
    return null;
  }

  function readAscii(ifdOff: number, tag: number): string | null {
    const entry = findEntry(ifdOff, tag);
    if (!entry || entry.type !== 2) return null;
    const off = entry.count > 4 ? r32(entry.dataOff) : entry.dataOff;
    return String.fromCharCode(...tiff!.subarray(off, off + entry.count - 1));
  }

  function readPtr(ifdOff: number, tag: number): number | null {
    const entry = findEntry(ifdOff, tag);
    return entry ? r32(entry.dataOff) : null;
  }

  const ifd0Off = r32(4);
  const exifIfdOff = readPtr(ifd0Off, 0x8769);
  const gpsIfdOff = readPtr(ifd0Off, 0x8825);
  const meta: FileMeta = {};

  // Date/time: prefer DateTimeOriginal in Exif IFD, fall back to DateTime in IFD0
  const dateStr =
    (exifIfdOff !== null ? readAscii(exifIfdOff, 0x9003) : null) ??
    readAscii(ifd0Off, 0x0132);
  if (dateStr && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    meta.year = dateStr.slice(0, 4);
    meta.month = dateStr.slice(5, 7);
    meta.day = dateStr.slice(8, 10);
    meta.hour = dateStr.slice(11, 13);
    meta.minute = dateStr.slice(14, 16);
  }

  // Timezone from OffsetTimeOriginal (Exif IFD tag 0x9011)
  if (exifIfdOff !== null) {
    const tz = readAscii(exifIfdOff, 0x9011);
    if (tz && /^[+-]\d{2}:\d{2}$/.test(tz)) meta.timezone = tz;
  }

  // GPS
  if (gpsIfdOff !== null) {
    const latRef = readAscii(gpsIfdOff, 0x0001)?.trim();
    const lonRef = readAscii(gpsIfdOff, 0x0003)?.trim();
    const latEntry = findEntry(gpsIfdOff, 0x0002);
    const lonEntry = findEntry(gpsIfdOff, 0x0004);
    if (latEntry && lonEntry && latEntry.count === 3 && lonEntry.count === 3) {
      const rat3 = (base: number) => {
        const r = (o: number) => { const n = r32(o), d = r32(o + 4); return d ? n / d : 0; };
        return r(base) + r(base + 8) / 60 + r(base + 16) / 3600;
      };
      meta.lat = ((latRef === 'S' ? -1 : 1) * rat3(r32(latEntry.dataOff))).toFixed(6);
      meta.lon = ((lonRef === 'W' ? -1 : 1) * rat3(r32(lonEntry.dataOff))).toFixed(6);
    }
  }

  return meta;
}

/** Extract metadata from a JPEG image file. Non-JPEG files return {}. */
export async function extractImageMeta(file: File): Promise<FileMeta> {
  if (file.type !== 'image/jpeg') return {};
  const buf = await file.slice(0, 65536).arrayBuffer();
  return parseExifMeta(new Uint8Array(buf));
}

/** Extract metadata from a video file via mediabunny (date, GPS, duration). */
export async function extractVideoMeta(file: File): Promise<FileMeta> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    const [tags, duration] = await Promise.all([
      input.getMetadataTags(),
      track ? input.getDurationFromMetadata([track]) : Promise.resolve(null),
    ]);
    const meta: FileMeta = {};

    // Date from normalized tags (mediabunny returns UTC Date)
    if (tags.date instanceof Date && !isNaN(tags.date.getTime())) {
      const d = tags.date;
      meta.year = String(d.getUTCFullYear());
      meta.month = String(d.getUTCMonth() + 1).padStart(2, '0');
      meta.day = String(d.getUTCDate()).padStart(2, '0');
      meta.hour = String(d.getUTCHours()).padStart(2, '0');
      meta.minute = String(d.getUTCMinutes()).padStart(2, '0');
    }

    // GPS from ©xyz (ISO 6709 string, e.g. "+53.5616+009.9222+021.300/")
    const xyz = tags.raw?.['©xyz'];
    if (typeof xyz === 'string') {
      const { lat, lon } = parseIso6709(xyz);
      if (lat !== null) meta.lat = lat.toFixed(6);
      if (lon !== null) meta.lon = lon.toFixed(6);
    }

    // Duration formatted as hh:mm:ss
    if (typeof duration === 'number' && duration > 0) {
      const s = Math.round(duration);
      meta.duration = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
        .map((v) => String(v).padStart(2, '0'))
        .join(':');
    }

    return meta;
  } finally {
    input.dispose();
  }
}
