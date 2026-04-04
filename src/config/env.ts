export const backendEnv = {
  clerkPublishableKey: (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').trim(),
  supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim(),
  supabaseAnonKey: (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
  backendUrl: (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim(),
};

export const missingEnvKeys = [
  !backendEnv.clerkPublishableKey ? 'EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY' : null,
  !backendEnv.supabaseUrl ? 'EXPO_PUBLIC_SUPABASE_URL' : null,
  !backendEnv.supabaseAnonKey ? 'EXPO_PUBLIC_SUPABASE_ANON_KEY' : null,
].filter((value): value is string => Boolean(value));

export const isBackendConfigured = missingEnvKeys.length === 0;
export const hasRenderBackendUrl = Boolean(backendEnv.backendUrl);
