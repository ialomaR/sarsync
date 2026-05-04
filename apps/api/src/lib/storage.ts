import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  S3Client, PutObjectCommand, GetObjectCommand,
  DeleteObjectCommand, CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';

// Unified storage layer. Backend chosen by AWS_S3_BUCKET:
//   - set     → S3 (production)
//   - unset   → local disk under ./uploads (dev / single-server deploy)
//
// All keys are RELATIVE paths like "cards/<cardId>/<file>" or
// "media/<deptId>/<file>". The local backend roots at ./uploads/<key>;
// the S3 backend uses the key as-is under the bucket.

const LOCAL_ROOT = path.resolve(process.cwd(), 'uploads');

function isS3() { return !!config.AWS_S3_BUCKET; }

let _s3: S3Client | null = null;
function getS3(): S3Client {
  if (!_s3) _s3 = new S3Client({ region: config.AWS_REGION });
  return _s3;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (isS3()) {
    await getS3().send(new PutObjectCommand({
      Bucket: config.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  } else {
    const fp = path.join(LOCAL_ROOT, key);
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, body);
  }
}

// Returns the object as a Buffer, or null if the key doesn't exist. Used by
// download endpoints — small enough payloads (≤100MB) that buffering is
// simpler than streaming. Switch to streaming if memory becomes a concern.
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  if (isS3()) {
    try {
      const out = await getS3().send(new GetObjectCommand({
        Bucket: config.AWS_S3_BUCKET, Key: key,
      }));
      const stream = out.Body as Readable;
      const chunks: Buffer[] = [];
      for await (const c of stream) {
        chunks.push(typeof c === 'string' ? Buffer.from(c) : Buffer.from(c as Uint8Array));
      }
      return Buffer.concat(chunks);
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      // S3 sometimes returns 403 for missing keys depending on bucket policy
      const code = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (code === 403 || code === 404) return null;
      throw err;
    }
  } else {
    try {
      return await fs.readFile(path.join(LOCAL_ROOT, key));
    } catch (err) {
      if ((err as { code?: string }).code === 'ENOENT') return null;
      throw err;
    }
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (isS3()) {
    await getS3().send(new DeleteObjectCommand({
      Bucket: config.AWS_S3_BUCKET, Key: key,
    })).catch(() => {});
  } else {
    await fs.unlink(path.join(LOCAL_ROOT, key)).catch(() => {});
  }
}

// Copy an object server-side (no round-trip of bytes through us).
export async function copyObject(srcKey: string, destKey: string): Promise<boolean> {
  if (isS3()) {
    try {
      await getS3().send(new CopyObjectCommand({
        Bucket: config.AWS_S3_BUCKET,
        CopySource: `${config.AWS_S3_BUCKET}/${encodeURIComponent(srcKey)}`,
        Key: destKey,
      }));
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      const src = path.join(LOCAL_ROOT, srcKey);
      const dst = path.join(LOCAL_ROOT, destKey);
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      return true;
    } catch {
      return false;
    }
  }
}

export function backendName(): 's3' | 'local' {
  return isS3() ? 's3' : 'local';
}
