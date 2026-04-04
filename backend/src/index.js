const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('@clerk/backend');

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 10000);

const clientOrigin = process.env.CLIENT_ORIGIN || '*';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend environment variables.',
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

app.use(
  cors({
    origin: clientOrigin === '*' ? true : clientOrigin,
    credentials: true,
  }),
);
app.use(express.json());

async function requireClerkAuth(req, res, next) {
  if (!clerkSecretKey) {
    res.status(500).json({
      error: 'Backend auth is not configured. Add CLERK_SECRET_KEY on Render.',
    });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  try {
    const payload = await verifyToken(token, { secretKey: clerkSecretKey });
    req.auth = {
      userId: payload.sub,
      sessionId: payload.sid,
    };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid auth token.' });
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'unisync-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/found-items', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('found_items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    res.json({ items: data ?? [] });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch found items.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/found-items', requireClerkAuth, async (req, res) => {
  const body = req.body || {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : 'General';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  const imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : null;

  if (!title || !location) {
    res.status(400).json({ error: 'title and location are required.' });
    return;
  }

  try {
    const { data, error } = await supabase
      .from('found_items')
      .insert({
        title,
        category,
        location,
        image_url: imageUrl,
        created_by: req.auth.userId,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({ item: data });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create found item.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.listen(port, () => {
  console.log(`UniSync backend listening on port ${port}`);
});
