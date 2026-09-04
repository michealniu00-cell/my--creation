export function sanitizeApiKey(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const withoutBearer = trimmed.replace(/^Bearer\s+/i, '');
  const withoutQuotes = withoutBearer.replace(/^['"]|['"]$/g, '').trim();
  return withoutQuotes || null;
}
