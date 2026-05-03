import bcrypt from 'bcrypt';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Mirrors the validation we do client-side. Server authoritative.
export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw)) return 'Password must contain upper and lower case letters';
  if (!/\d/.test(pw)) return 'Password must contain at least one number';
  return null;
}
