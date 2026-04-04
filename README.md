# UniSync

## Local Setup

1. Create your app env file from [.env.example](.env.example).
2. Create backend env from [backend/.env.example](backend/.env.example) and set:
	- `SUPABASE_URL`
	- `SUPABASE_SERVICE_ROLE_KEY`
	- `CLERK_SECRET_KEY`
3. Run Supabase SQL migrations in order from [supabase/sql/README.md](supabase/sql/README.md).
4. Start Expo: `npm run start:lan`
5. Start backend locally: `npm run backend:dev`

## Home Features Implemented

- Campus points and level progression (`/api/points/me`)
- Lost board feed (`/api/lost-items`)
- Camera/gallery scan with item-type detection (`/api/vision/classify-item`)
- Auto match claim submission with proof image (`/api/match-requests/auto`)

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
