# UniSync

## Local Setup

1. Create your app env file from [.env.example](.env.example).
2. Start Expo: `npm run start:lan`
3. Start backend locally (optional): `npm run backend:dev`

## Render Backend Setup

Select: **New Web Service**

Use these settings in Render:

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm run start`

Set these environment variables in Render:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLERK_SECRET_KEY`
- `CLIENT_ORIGIN` (comma-separated origins are supported, for example `http://localhost:8081,https://your-frontend-domain.com` or `*` while testing)

After deploy, copy the Render service URL and set:

- `EXPO_PUBLIC_BACKEND_URL` in [.env](.env)
