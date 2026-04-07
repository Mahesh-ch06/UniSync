const ADMIN_EMAILS = ['chitikeshimahesh6@gmail.com'];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') {
    return false;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return ADMIN_EMAILS.includes(normalized);
}

export function getAdminEmails(): string[] {
  return [...ADMIN_EMAILS];
}
