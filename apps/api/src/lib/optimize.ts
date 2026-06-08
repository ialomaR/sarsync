import sharp from 'sharp';

// Re-encodes uploaded photographs to WebP at a sensible web size. Saves
// bandwidth and storage without visible quality loss. GIFs are skipped to
// preserve animation, SVG is left alone (vector + sanitization risk).
//
// Buffer-in / buffer-out so it works with both the local-disk and S3
// storage backends without touching the filesystem.

const OPTIMIZABLE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
]);

const MAX_EDGE = 1920;        // covers desktop retina; phones serve smaller via thumbs
const WEBP_QUALITY = 82;      // sweet spot for photos: ~70% smaller than jpeg q90

// Cap decoded pixels to defuse decompression bombs — a small (under the byte
// cap) but absurdly high-resolution image would otherwise force sharp to
// allocate a huge pixel buffer. 24MP comfortably covers real photos.
const MAX_INPUT_PIXELS = 24_000_000;

const THUMB_EDGE = 480;       // for chat / media grid previews
const THUMB_QUALITY = 78;

export interface OptimizedImage {
  buffer: Buffer;
  mimeType: string;
  filename: (original: string) => string;
}

export function isOptimizable(mime: string): boolean {
  return OPTIMIZABLE_MIMES.has(mime.toLowerCase());
}

// Re-encodes the image buffer to optimised WebP. Returns null if the input
// isn't an image we want to touch (caller stores the original as-is).
export async function optimizeImageBuffer(input: Buffer, mime: string): Promise<OptimizedImage | null> {
  if (!isOptimizable(mime)) return null;
  const buffer = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // honor EXIF orientation BEFORE the resize
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return {
    buffer,
    mimeType: 'image/webp',
    filename: (original) => {
      const m = original.match(/^(.*)\.[^.]+$/);
      return (m ? m[1] : original) + '.webp';
    },
  };
}

// Generates a 480px-edge thumbnail (WebP) from the same buffer used for the
// optimized original. Skips non-images.
export async function generateThumbBuffer(input: Buffer, mime: string): Promise<Buffer | null> {
  if (!isOptimizable(mime)) return null;
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}
