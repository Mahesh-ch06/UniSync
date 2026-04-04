import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { backendEnv } from '../config/env';

export const isSupabaseConfigured = Boolean(
  backendEnv.supabaseUrl && backendEnv.supabaseAnonKey,
);

let client: SupabaseClient | null = null;

function createSupabaseClient(accessToken?: string): SupabaseClient {
  return createClient(backendEnv.supabaseUrl, backendEnv.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: accessToken
        ? {
            Authorization: `Bearer ${accessToken}`,
          }
        : undefined,
    },
  });
}

if (isSupabaseConfigured) {
  client = createSupabaseClient();
}

export const supabase = client;

export function buildSupabaseClient(accessToken?: string): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }

  return createSupabaseClient(accessToken);
}

export function requireSupabaseClient(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return supabase;
}
