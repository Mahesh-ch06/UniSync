import Constants from 'expo-constants';

function readText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function readExtraValue(...keys: string[]): string {
  const expoExtra =
    Constants.expoConfig && typeof Constants.expoConfig === 'object'
      ? ((Constants.expoConfig as { extra?: Record<string, unknown> }).extra ?? {})
      : {};

  const manifest2Extra =
    (Constants as unknown as { manifest2?: { extra?: Record<string, unknown> } }).manifest2?.extra ?? {};

  for (const key of keys) {
    const fromExpoExtra = readText(expoExtra[key]);
    if (fromExpoExtra) {
      return fromExpoExtra;
    }

    const fromManifest2Extra = readText(manifest2Extra[key]);
    if (fromManifest2Extra) {
      return fromManifest2Extra;
    }
  }

  return '';
}

export const backendEnv = {
  clerkPublishableKey:
    readText(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) ||
    readExtraValue('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY', 'clerkPublishableKey'),
  supabaseUrl:
    readText(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
    readExtraValue('EXPO_PUBLIC_SUPABASE_URL', 'supabaseUrl'),
  supabaseAnonKey:
    readText(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
    readExtraValue('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'supabaseAnonKey'),
  backendUrl:
    readText(process.env.EXPO_PUBLIC_BACKEND_URL) ||
    readExtraValue('EXPO_PUBLIC_BACKEND_URL', 'backendUrl'),
};

export const missingEnvKeys = [
  !backendEnv.clerkPublishableKey ? 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY' : null,
  !backendEnv.supabaseUrl ? 'EXPO_PUBLIC_SUPABASE_URL' : null,
  !backendEnv.supabaseAnonKey ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY' : null,
].filter((value): value is string => Boolean(value));

export const isBackendConfigured = missingEnvKeys.length === 0;
export const hasRenderBackendUrl = Boolean(backendEnv.backendUrl);
