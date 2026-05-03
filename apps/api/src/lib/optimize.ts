import fs from 'node:fs/promises';
import sharp from 'sharp';

// Re-encodes uploaded photographs to WebP at a sensible web size. Saves
// bandwidth and storage without visible quality loss. GIFs are skipped to
// preserve animation, SVG is left alone (vector + sanitization risk).

const OPTIMIZABLE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
]);

const MAX_EDGE = 1920;        // covers desktop retina; phones serve smaller via thumbs
const WEBP_QUALITY = 82;      // sweet spot for photos: ~70% smaller than jpeg q90

export interface OptimizeResult {
  mimeType: string;
  sizeBytes: number;
  // Returns the original filename with its extension swapped to .webp.
  filename: (original: string) => string;
}

// Re-encodes the file at `diskPath` IN PLACE if it's an optimizable image.
// Returns null when the file isn't an image we want to touch.
export async function optimizeImageInPlace(
  diskPath: string,
  originalMime: string,
): Promise<OptimizeResult | null> {
  if (!OPTIMIZABLE_MIMES.has(originalMime.toLowerCase())) return null;

  const tmp = `${diskPath}.opt`;
  try {
    await sharp(diskPath)
      .rotate() // honor EXIF orientation BEFORE the resize
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toFile(tmp);
    await fs.rename(tmp, diskPath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }

  const stat = await fs.stat(diskPath);
  return {
    mimeType: 'image/webp',
    sizeBytes: stat.size,
    filename: (original) => {
      const m = original.match(/^(.*)\.[^.]+$/);
      return (m ? m[1] : original) + '.webp';
    },
  };
}
