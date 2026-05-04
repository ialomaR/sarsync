import { z } from 'zod';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  // Comma-separated emails that should be promoted to platform-level admin
  // automatically on signin/signup (e.g. founder + ops staff). Optional.
  SYSTEM_ADMIN_EMAILS: z.string().default(''),
  // SendGrid for transactional email (verify-email, password reset, invites).
  // When unset, those flows fall back to logging the link in the server log
  // so local dev still works without a key.
  SENDGRID_API_KEY: z.string().default(''),
  SENDGRID_FROM_EMAIL: z.string().default('noreply@sarsync.com'),
  SENDGRID_FROM_NAME: z.string().default('SarSync'),
  // AWS S3 for file storage. When AWS_S3_BUCKET is set, every new upload
  // (card attachments, media library, chat files) is written to S3. When
  // unset, files live on local disk under ./uploads (dev default).
  // Credentials are read by the SDK from env: AWS_ACCESS_KEY_ID +
  // AWS_SECRET_ACCESS_KEY (or an IAM role on EC2 — preferred in prod).
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: z.string().default(''),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
