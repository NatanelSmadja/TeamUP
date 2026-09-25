export function avatarUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  // Retain support for existing profile URLs. New avatars are constrained paths.
  if (/^https:\/\//i.test(value)) return value;
  if (!/^[0-9a-f-]{36}\/avatar\?v=[0-9a-f-]{36}$/i.test(value)) return undefined;
  const base = import.meta.env.VITE_SUPABASE_URL;
  return base ? `${base}/storage/v1/object/public/profile-avatars/${value}` : undefined;
}
