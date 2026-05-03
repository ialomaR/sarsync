import { config } from '../config.js';
import { prisma } from '../db.js';

// Returns the lowercased emails configured to be platform admins.
function adminEmails(): Set<string> {
  return new Set(
    (config.SYSTEM_ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isInSystemAdminList(email: string): boolean {
  return adminEmails().has(email.toLowerCase());
}

// Idempotently sync the user's isSystemAdmin flag with the env list. Called
// on signup + signin so that promoting/demoting a user only requires editing
// the env (and a redeploy or signin event).
export async function syncSystemAdminFlag(userId: string, email: string) {
  const should = isInSystemAdminList(email);
  await prisma.user.update({
    where: { id: userId },
    data: { isSystemAdmin: should },
  }).catch(() => {});
}
