const appJson = require('./app.json');
const fs = require('fs');
const path = require('path');

function hydrateProcessEnvFromDotEnv() {
  const envPath = path.resolve(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

hydrateProcessEnvFromDotEnv();

function readText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

module.exports = () => {
  const expo = appJson.expo || {};
  const baseExtra = expo.extra || {};

  const clerkPublishableKey =
    readText(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) ||
    readText(baseExtra.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY) ||
    readText(baseExtra.clerkPublishableKey);

  const supabaseUrl =
    readText(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
    readText(baseExtra.EXPO_PUBLIC_SUPABASE_URL) ||
    readText(baseExtra.supabaseUrl);

  const supabaseAnonKey =
    readText(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
    readText(baseExtra.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
    readText(baseExtra.supabaseAnonKey);

  const backendUrl =
    readText(process.env.EXPO_PUBLIC_BACKEND_URL) ||
    readText(baseExtra.EXPO_PUBLIC_BACKEND_URL) ||
    readText(baseExtra.backendUrl);

  return {
    ...expo,
    extra: {
      ...baseExtra,
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKey,
      EXPO_PUBLIC_SUPABASE_URL: supabaseUrl,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
      EXPO_PUBLIC_BACKEND_URL: backendUrl,
      clerkPublishableKey,
      supabaseUrl,
      supabaseAnonKey,
      backendUrl,
    },
  };
};
