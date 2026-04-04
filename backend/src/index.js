const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken } = require('@clerk/backend');

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 10000);
const imageBucket = process.env.SUPABASE_IMAGE_BUCKET || 'campus-items';

const clientOriginRaw = process.env.CLIENT_ORIGIN || '*';
const allowedOrigins = clientOriginRaw
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const geminiApiKey = readText(process.env.GEMINI_API_KEY);
const geminiModel = readText(process.env.GEMINI_MODEL) || 'gemini-1.5-flash';
const PICKUP_EDIT_WINDOW_MS = 5 * 60 * 1000;

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
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '12mb' }));

function readText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function readPositiveNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function tokenize(value) {
  return Array.from(
    new Set(
      readText(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3),
    ),
  );
}

function overlapCount(leftTokens, rightTokens) {
  const rightSet = new Set(rightTokens);
  return leftTokens.reduce((count, token) => count + (rightSet.has(token) ? 1 : 0), 0);
}

function extensionForMimeType(mimeType) {
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
}

function normalizeMimeType(value) {
  const lower = readText(value).toLowerCase();

  if (['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(lower)) {
    return lower === 'image/jpg' ? 'image/jpeg' : lower;
  }

  return 'image/jpeg';
}

function stripBase64Prefix(value) {
  return readText(value).replace(/^data:[^;]+;base64,/, '');
}

function relationObject(value) {
  if (Array.isArray(value)) {
    return value[0] || null;
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return null;
}

function classifyItemFromSignals({ hintText, fileName, width, height, preferredLabel, preferredCategory }) {
  const joined = `${readText(hintText)} ${readText(fileName)}`.toLowerCase();

  if (preferredLabel || preferredCategory) {
    return {
      label: readText(preferredLabel) || 'Item',
      category: readText(preferredCategory) || 'General',
      confidence: 0.98,
      tags: tokenize(`${preferredLabel} ${preferredCategory}`).slice(0, 4),
      source: 'manual',
    };
  }

  const textRules = [
    { pattern: /(laptop|macbook|notebook)/, label: 'Laptop', category: 'Electronics', tags: ['electronics', 'laptop'] },
    { pattern: /(phone|iphone|android|mobile)/, label: 'Phone', category: 'Electronics', tags: ['electronics', 'phone'] },
    { pattern: /(wallet|purse|cardholder)/, label: 'Wallet', category: 'Wallet', tags: ['wallet', 'cards'] },
    { pattern: /(id card|student id|identity|id badge|badge)/, label: 'ID Card', category: 'Identity', tags: ['identity', 'card'] },
    { pattern: /(keys|keychain|key ring|car key)/, label: 'Keys', category: 'Keys', tags: ['keys', 'metal'] },
    { pattern: /(backpack|bag|sling|tote)/, label: 'Bag', category: 'Bags', tags: ['bag', 'carry'] },
    { pattern: /(watch|smartwatch)/, label: 'Watch', category: 'Accessories', tags: ['watch', 'wearable'] },
    { pattern: /(earbuds|headphone|airpods)/, label: 'Earbuds', category: 'Electronics', tags: ['audio', 'electronics'] },
  ];

  const matchedRule = textRules.find((rule) => rule.pattern.test(joined));
  if (matchedRule) {
    return {
      label: matchedRule.label,
      category: matchedRule.category,
      confidence: 0.9,
      tags: matchedRule.tags,
      source: 'text',
    };
  }

  const safeWidth = readPositiveNumber(width);
  const safeHeight = readPositiveNumber(height);

  if (safeWidth > 0 && safeHeight > 0) {
    const ratio = safeWidth / safeHeight;
    const area = safeWidth * safeHeight;

    if (ratio > 1.25 && ratio < 1.9 && area > 200000) {
      return {
        label: 'Laptop',
        category: 'Electronics',
        confidence: 0.62,
        tags: ['electronics', 'wide'],
        source: 'shape',
      };
    }

    if (ratio > 0.42 && ratio < 0.7) {
      return {
        label: 'Phone',
        category: 'Electronics',
        confidence: 0.58,
        tags: ['electronics', 'portrait'],
        source: 'shape',
      };
    }

    if (ratio > 0.85 && ratio < 1.15 && area < 280000) {
      return {
        label: 'Wallet',
        category: 'Wallet',
        confidence: 0.54,
        tags: ['wallet', 'compact'],
        source: 'shape',
      };
    }
  }

  return {
    label: 'Personal Item',
    category: 'General',
    confidence: 0.42,
    tags: ['campus', 'item'],
    source: 'fallback',
  };
}

function parseJsonObjectFromText(text) {
  const raw = readText(text);
  if (!raw) {
    return null;
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');

  if (start < 0 || end < start) {
    return null;
  }

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function classifyItemWithGemini({
  imageBase64,
  mimeType,
  hintText,
  locationHint,
  fileName,
  preferredLabel,
  preferredCategory,
}) {
  if (!geminiApiKey) {
    return null;
  }

  const imageData = stripBase64Prefix(imageBase64);
  if (!imageData) {
    return null;
  }

  const prompt = [
    'You classify a campus lost-and-found product image.',
    'Return strict JSON only with keys: label, category, confidence, tags.',
    'label and category must be short strings.',
    'confidence must be a number between 0 and 1.',
    'tags must be an array of up to 6 lowercase tags.',
    `context: hint=${readText(hintText)} location=${readText(locationHint)} file=${readText(fileName)} preferred_label=${readText(preferredLabel)} preferred_category=${readText(preferredCategory)}`,
  ].join(' ');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: normalizeMimeType(mimeType),
                  data: imageData,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 220,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Gemini request failed (${response.status}) ${details}`.trim());
    }

    const payload = await response.json();
    const parts = payload?.candidates?.[0]?.content?.parts;

    const rawText = Array.isArray(parts)
      ? parts
          .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
          .join('\n')
          .trim()
      : '';

    const parsed = parseJsonObjectFromText(rawText);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const label = readText(parsed.label) || 'Personal Item';
    const category = readText(parsed.category) || 'General';
    const confidence = clampNumber(Number(parsed.confidence) || 0.56, 0.01, 0.99);

    const tags = Array.isArray(parsed.tags)
      ? parsed
          .tags
          .map((value) => readText(value).toLowerCase())
          .filter(Boolean)
          .slice(0, 6)
      : [];

    return {
      label,
      category,
      confidence,
      tags: tags.length ? tags : tokenize(`${label} ${category}`).slice(0, 6),
      source: 'gemini',
    };
  } catch (error) {
    console.error('Gemini classification failed, falling back to local rules.', error);
    return null;
  }
}

async function uploadBase64Image({ imageBase64, mimeType, folder, userId }) {
  const base64Payload = stripBase64Prefix(imageBase64);

  if (!base64Payload) {
    throw new Error('Image base64 payload is missing.');
  }

  const normalizedMimeType = normalizeMimeType(mimeType);
  const extension = extensionForMimeType(normalizedMimeType);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const objectPath = `${folder}/${userId}/${fileName}`;
  const imageBuffer = Buffer.from(base64Payload, 'base64');

  const { error } = await supabase.storage.from(imageBucket).upload(objectPath, imageBuffer, {
    contentType: normalizedMimeType,
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(imageBucket).getPublicUrl(objectPath);

  return {
    imageUrl: data.publicUrl,
    objectPath,
  };
}

function formatReasonLabel(reason) {
  return readText(reason) || 'activity';
}

function computeMatchScore({ foundItem, detection, hintText, locationHint }) {
  const foundCategory = readText(foundItem.category).toLowerCase();
  const foundTitle = readText(foundItem.title).toLowerCase();
  const foundLocation = readText(foundItem.location).toLowerCase();

  const detectedCategory = readText(detection.category).toLowerCase();
  const detectedLabel = readText(detection.label).toLowerCase();
  const normalizedHint = readText(hintText).toLowerCase();
  const normalizedLocationHint = readText(locationHint).toLowerCase();

  let score = 0;

  if (detectedCategory && foundCategory === detectedCategory) {
    score += 34;
  } else if (detectedCategory && (foundCategory.includes(detectedCategory) || detectedCategory.includes(foundCategory))) {
    score += 22;
  }

  if (detectedLabel && (foundTitle.includes(detectedLabel) || foundCategory.includes(detectedLabel))) {
    score += 20;
  }

  const hintTokens = tokenize(normalizedHint);
  const titleTokens = tokenize(foundTitle);
  const titleOverlap = overlapCount(hintTokens, titleTokens);
  score += Math.min(26, titleOverlap * 8);

  const locationHintTokens = tokenize(normalizedLocationHint);
  const locationTokens = tokenize(foundLocation);
  const locationOverlap = overlapCount(locationHintTokens, locationTokens);
  score += Math.min(16, locationOverlap * 8);

  const createdAt = new Date(foundItem.created_at).getTime();
  if (Number.isFinite(createdAt)) {
    const ageHours = Math.max(Date.now() - createdAt, 0) / (1000 * 60 * 60);

    if (ageHours <= 24) {
      score += 12;
    } else if (ageHours <= 72) {
      score += 9;
    } else if (ageHours <= 168) {
      score += 6;
    } else {
      score += 3;
    }
  }

  if (foundItem.image_url) {
    score += 2;
  }

  return clampNumber(Math.round(score), 0, 100);
}

async function awardPointsSafely({ userId, points, reason, referenceType, referenceId }) {
  if (!userId || !points) {
    return;
  }

  const { error } = await supabase.rpc('award_points', {
    p_user_id: userId,
    p_points: points,
    p_reason: formatReasonLabel(reason),
    p_reference_type: referenceType || null,
    p_reference_id: referenceId || null,
  });

  if (error) {
    console.error('Failed to award points', error);
  }
}

function resolvePickupEditWindow(pickupConfirmedAt) {
  const iso = readText(pickupConfirmedAt);
  if (!iso) {
    return {
      editableUntil: null,
      isEditable: false,
      remainingSeconds: 0,
    };
  }

  const pickupMs = new Date(iso).getTime();
  if (!Number.isFinite(pickupMs)) {
    return {
      editableUntil: null,
      isEditable: false,
      remainingSeconds: 0,
    };
  }

  const editableUntilMs = pickupMs + PICKUP_EDIT_WINDOW_MS;
  const remainingMs = Math.max(editableUntilMs - Date.now(), 0);

  return {
    editableUntil: new Date(editableUntilMs).toISOString(),
    isEditable: remainingMs > 0,
    remainingSeconds: Math.ceil(remainingMs / 1000),
  };
}

async function awardPointsOnce({ userId, points, reason, referenceType, referenceId }) {
  if (!userId || !points) {
    return false;
  }

  const normalizedReason = formatReasonLabel(reason);

  if (referenceType && referenceId) {
    const { data: existing, error: existingError } = await supabase
      .from('points_ledger')
      .select('id')
      .eq('user_id', userId)
      .eq('reason', normalizedReason)
      .eq('reference_type', referenceType)
      .eq('reference_id', referenceId)
      .limit(1);

    if (!existingError && existing && existing.length) {
      return false;
    }
  }

  await awardPointsSafely({
    userId,
    points,
    reason: normalizedReason,
    referenceType,
    referenceId,
  });

  return true;
}

async function loadMatchRequestWithParticipants(requestId) {
  const { data, error } = await supabase
    .from('match_requests')
    .select(
      `
      id,
      found_item_id,
      lost_item_id,
      claimant_user_id,
      status,
      created_at,
      reviewed_at,
      reviewer_user_id,
      pickup_confirmed_at,
      pickup_confirmed_by,
      found_item:found_items!inner(
        id,
        title,
        category,
        location,
        image_url,
        created_by
      )
    `,
    )
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  return {
    ...data,
    found_item: relationObject(data.found_item),
  };
}

async function buildLatestClaimMap(foundItemIds, statuses = ['submitted', 'approved', 'picked_up']) {
  const validIds = foundItemIds.filter((value) => Boolean(readText(value)));

  if (!validIds.length) {
    return new Map();
  }

  const validStatuses = Array.isArray(statuses)
    ? statuses.map((value) => readText(value)).filter(Boolean)
    : [];

  if (!validStatuses.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('match_requests')
    .select('id, found_item_id, claimant_user_id, status, reviewed_at, created_at')
    .in('found_item_id', validIds)
    .in('status', validStatuses)
    .order('reviewed_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const latestByFoundItem = new Map();

  (data ?? []).forEach((entry) => {
    const key = readText(entry.found_item_id);
    if (!key || latestByFoundItem.has(key)) {
      return;
    }

    latestByFoundItem.set(key, entry);
  });

  return latestByFoundItem;
}

async function loadPublicFoundItems(limit = 120) {
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Number(limit)) : 120;

  const primaryResponse = await supabase
    .from('found_items')
    .select('*')
    .eq('is_public_visible', true)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (!primaryResponse.error) {
    return primaryResponse.data ?? [];
  }

  const errorMessage = readText(primaryResponse.error?.message).toLowerCase();
  if (!errorMessage.includes('is_public_visible')) {
    throw primaryResponse.error;
  }

  // Backward-compatible fallback for databases that do not yet have 018 migration.
  const fallbackResponse = await supabase
    .from('found_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (fallbackResponse.error) {
    throw fallbackResponse.error;
  }

  const rows = fallbackResponse.data ?? [];
  const activeClaimMap = await buildLatestClaimMap(rows.map((item) => item.id));

  return rows.filter((item) => !activeClaimMap.has(item.id));
}

async function assertFoundItemClaimable(foundItemId) {
  const { data: foundItem, error: foundError } = await supabase
    .from('found_items')
    .select('id, title, category, location, image_url, created_at, created_by')
    .eq('id', foundItemId)
    .maybeSingle();

  if (foundError) {
    throw foundError;
  }

  if (!foundItem) {
    throw new Error('Found item not found.');
  }

  const latestMap = await buildLatestClaimMap([foundItemId]);
  if (latestMap.has(foundItemId)) {
    throw new Error('This item has already been claimed and is not public anymore.');
  }

  return foundItem;
}

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

app.get('/api/found-items', async (req, res) => {
  try {
    const items = await loadPublicFoundItems(120);

    res.json({ items });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch found items.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/found-items', requireClerkAuth, async (req, res) => {
  const body = req.body || {};

  const title = readText(body.title);
  const category = readText(body.category) || 'General';
  const location = readText(body.location);
  const imageUrlInput = readText(body.image_url);
  const imageBase64 = readText(body.image_base64);
  const mimeType = normalizeMimeType(body.mime_type);

  if (!title || !location) {
    res.status(400).json({ error: 'title and location are required.' });
    return;
  }

  try {
    let imageUrl = imageUrlInput || null;

    if (!imageUrl && imageBase64) {
      const uploaded = await uploadBase64Image({
        imageBase64,
        mimeType,
        folder: 'found-items',
        userId: req.auth.userId,
      });
      imageUrl = uploaded.imageUrl;
    }

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

    await awardPointsSafely({
      userId: req.auth.userId,
      points: 10,
      reason: 'found_item_reported',
      referenceType: 'found_item',
      referenceId: data.id,
    });

    res.status(201).json({ item: data, pointsAwarded: 10 });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create found item.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.get('/api/lost-items', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('lost_items')
      .select('*')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(40);

    if (error) {
      throw error;
    }

    res.json({ items: data ?? [] });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch lost items.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/lost-items', requireClerkAuth, async (req, res) => {
  const body = req.body || {};

  const title = readText(body.title);
  const description = readText(body.description);
  const category = readText(body.category) || 'General';
  const expectedLocation = readText(body.expected_location);
  const imageBase64 = readText(body.image_base64);
  const imageUrlInput = readText(body.image_url);
  const mimeType = normalizeMimeType(body.mime_type);

  if (!title) {
    res.status(400).json({ error: 'title is required for lost item report.' });
    return;
  }

  try {
    let imageUrl = imageUrlInput || null;

    if (!imageUrl && imageBase64) {
      const uploaded = await uploadBase64Image({
        imageBase64,
        mimeType,
        folder: 'lost-items',
        userId: req.auth.userId,
      });
      imageUrl = uploaded.imageUrl;
    }

    const detection = classifyItemFromSignals({
      hintText: `${title} ${description}`,
      fileName: body.file_name,
      width: body.width,
      height: body.height,
      preferredLabel: body.ai_detected_label,
      preferredCategory: category,
    });

    const { data, error } = await supabase
      .from('lost_items')
      .insert({
        title,
        description: description || null,
        category: category || detection.category,
        expected_location: expectedLocation || null,
        image_url: imageUrl,
        ai_detected_label: detection.label,
        reported_by: req.auth.userId,
        status: 'open',
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    await awardPointsSafely({
      userId: req.auth.userId,
      points: 8,
      reason: 'lost_item_reported',
      referenceType: 'lost_item',
      referenceId: data.id,
    });

    res.status(201).json({ item: data, pointsAwarded: 8, detection });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create lost item.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.get('/api/points/me', requireClerkAuth, async (req, res) => {
  try {
    const { data: profile, error: profileError } = await supabase
      .from('user_points')
      .select('*')
      .eq('user_id', req.auth.userId)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const { data: ledger, error: ledgerError } = await supabase
      .from('points_ledger')
      .select('id, points, reason, reference_type, reference_id, created_at')
      .eq('user_id', req.auth.userId)
      .order('created_at', { ascending: false })
      .limit(12);

    if (ledgerError) {
      throw ledgerError;
    }

    res.json({
      totalPoints: profile?.total_points ?? 0,
      level: profile?.level ?? 'Seed',
      recentActivity: ledger ?? [],
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch points summary.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/vision/classify-item', requireClerkAuth, async (req, res) => {
  const body = req.body || {};
  const imageBase64 = readText(body.image_base64);

  if (!imageBase64) {
    res.status(400).json({ error: 'image_base64 is required for scan.' });
    return;
  }

  try {
    const detection =
      (await classifyItemWithGemini({
        imageBase64,
        mimeType: body.mime_type,
        hintText: body.hint_text,
        locationHint: body.location_hint,
        fileName: body.file_name,
        preferredLabel: body.detected_label,
        preferredCategory: body.detected_category,
      })) ||
      classifyItemFromSignals({
      hintText: `${readText(body.hint_text)} ${readText(body.location_hint)}`,
      fileName: body.file_name,
      width: body.width,
      height: body.height,
      preferredLabel: body.detected_label,
      preferredCategory: body.detected_category,
      });

    const uploaded = await uploadBase64Image({
      imageBase64,
      mimeType: normalizeMimeType(body.mime_type),
      folder: 'scans',
      userId: req.auth.userId,
    });

    res.status(201).json({
      detection,
      imageUrl: uploaded.imageUrl,
      objectPath: uploaded.objectPath,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to scan item image.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/match-requests/auto', requireClerkAuth, async (req, res) => {
  const body = req.body || {};

  const proofImageBase64 = readText(body.proof_image_base64);
  const hintText = readText(body.hint_text);
  const locationHint = readText(body.location_hint);
  const lostTitle = readText(body.lost_title);
  const lostDescription = readText(body.lost_description);

  if (!proofImageBase64) {
    res.status(400).json({ error: 'proof_image_base64 is required.' });
    return;
  }

  try {
    const detection = classifyItemFromSignals({
      hintText,
      fileName: body.file_name,
      width: body.width,
      height: body.height,
      preferredLabel: body.detected_label,
      preferredCategory: body.detected_category,
    });

    const uploadedProof = await uploadBase64Image({
      imageBase64: proofImageBase64,
      mimeType: normalizeMimeType(body.mime_type),
      folder: 'proof',
      userId: req.auth.userId,
    });

    let lostItemId = readText(body.lost_item_id);

    if (!lostItemId) {
      const { data: createdLost, error: lostInsertError } = await supabase
        .from('lost_items')
        .insert({
          title: lostTitle || `Lost ${detection.label}`,
          description: lostDescription || hintText || null,
          category: detection.category,
          expected_location: locationHint || null,
          image_url: uploadedProof.imageUrl,
          ai_detected_label: detection.label,
          reported_by: req.auth.userId,
          status: 'open',
        })
        .select('id')
        .single();

      if (lostInsertError) {
        throw lostInsertError;
      }

      lostItemId = createdLost.id;

      await awardPointsSafely({
        userId: req.auth.userId,
        points: 8,
        reason: 'lost_item_reported',
        referenceType: 'lost_item',
        referenceId: lostItemId,
      });
    }

    const rawFoundItems = await loadPublicFoundItems(120);
    const claimableFoundItems = rawFoundItems;

    if (!claimableFoundItems.length) {
      res.status(200).json({
        matched: false,
        reason: 'No found items available to match against yet.',
        detection,
        proofImageUrl: uploadedProof.imageUrl,
        lostItemId,
      });
      return;
    }

    const scored = claimableFoundItems
      .map((candidate) => ({
        candidate,
        score: computeMatchScore({
          foundItem: candidate,
          detection,
          hintText,
          locationHint,
        }),
      }))
      .sort((left, right) => right.score - left.score);

    const best = scored[0];

    if (!best || best.score < 45) {
      res.status(200).json({
        matched: false,
        reason: 'No strong match yet. We saved your loss report and proof image.',
        detection,
        proofImageUrl: uploadedProof.imageUrl,
        lostItemId,
        bestSuggestion: best
          ? {
              foundItemId: best.candidate.id,
              title: best.candidate.title,
              score: best.score,
            }
          : null,
      });
      return;
    }

    const { data: requestRow, error: requestError } = await supabase
      .from('match_requests')
      .insert({
        found_item_id: best.candidate.id,
        lost_item_id: lostItemId,
        claimant_user_id: req.auth.userId,
        proof_image_url: uploadedProof.imageUrl,
        ai_detected_label: detection.label,
        match_score: best.score,
        status: 'submitted',
      })
      .select('*')
      .single();

    if (requestError) {
      throw requestError;
    }

    await supabase
      .from('lost_items')
      .update({ status: 'matched' })
      .eq('id', lostItemId)
      .eq('reported_by', req.auth.userId);

    await awardPointsSafely({
      userId: req.auth.userId,
      points: 15,
      reason: 'match_request_submitted',
      referenceType: 'match_request',
      referenceId: requestRow.id,
    });

    res.status(201).json({
      matched: true,
      request: requestRow,
      foundItem: {
        id: best.candidate.id,
        title: best.candidate.title,
        category: best.candidate.category,
        location: best.candidate.location,
        image_url: best.candidate.image_url,
      },
      detection,
      proofImageUrl: uploadedProof.imageUrl,
      pointsAwarded: 15,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to auto-submit match request.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/match-requests', requireClerkAuth, async (req, res) => {
  const body = req.body || {};

  const foundItemId = readText(body.found_item_id);
  const proofImageBase64 = readText(body.proof_image_base64);
  const proofImageUrlInput = readText(body.proof_image_url);
  const hintText = readText(body.hint_text);
  const locationHint = readText(body.location_hint);
  const lostTitle = readText(body.lost_title);
  const lostDescription = readText(body.lost_description);

  if (!foundItemId) {
    res.status(400).json({ error: 'found_item_id is required.' });
    return;
  }

  if (!proofImageBase64 && !proofImageUrlInput) {
    res.status(400).json({ error: 'Attach a valid proof image to submit claim request.' });
    return;
  }

  try {
    const foundItem = await assertFoundItemClaimable(foundItemId);

    if (readText(foundItem.created_by) === req.auth.userId) {
      res.status(400).json({ error: 'You cannot claim your own uploaded found item.' });
      return;
    }

    let proofImageUrl = proofImageUrlInput || null;

    if (!proofImageUrl && proofImageBase64) {
      const uploadedProof = await uploadBase64Image({
        imageBase64: proofImageBase64,
        mimeType: normalizeMimeType(body.mime_type),
        folder: 'proof',
        userId: req.auth.userId,
      });

      proofImageUrl = uploadedProof.imageUrl;
    }

    const detection = classifyItemFromSignals({
      hintText: `${hintText} ${lostTitle} ${lostDescription}`,
      fileName: body.file_name,
      width: body.width,
      height: body.height,
      preferredLabel: body.detected_label,
      preferredCategory: body.detected_category || foundItem.category,
    });

    let lostItemId = readText(body.lost_item_id);

    if (!lostItemId) {
      const { data: createdLost, error: lostInsertError } = await supabase
        .from('lost_items')
        .insert({
          title: lostTitle || `Lost ${foundItem.title}`,
          description: lostDescription || hintText || null,
          category: detection.category || foundItem.category || 'General',
          expected_location: locationHint || foundItem.location || null,
          image_url: proofImageUrl,
          ai_detected_label: detection.label,
          reported_by: req.auth.userId,
          status: 'matched',
        })
        .select('id')
        .single();

      if (lostInsertError) {
        throw lostInsertError;
      }

      lostItemId = createdLost.id;

      await awardPointsSafely({
        userId: req.auth.userId,
        points: 8,
        reason: 'lost_item_reported',
        referenceType: 'lost_item',
        referenceId: lostItemId,
      });
    }

    const computedScore = computeMatchScore({
      foundItem,
      detection,
      hintText,
      locationHint,
    });

    const { data: existingSubmitted, error: existingError } = await supabase
      .from('match_requests')
      .select('id')
      .eq('found_item_id', foundItemId)
      .eq('claimant_user_id', req.auth.userId)
      .eq('status', 'submitted')
      .limit(1);

    if (existingError) {
      throw existingError;
    }

    if (existingSubmitted && existingSubmitted.length) {
      res.status(409).json({ error: 'You already have a pending request for this item.' });
      return;
    }

    const { data: requestRow, error: requestError } = await supabase
      .from('match_requests')
      .insert({
        found_item_id: foundItemId,
        lost_item_id: lostItemId,
        claimant_user_id: req.auth.userId,
        proof_image_url: proofImageUrl,
        ai_detected_label: detection.label,
        match_score: computedScore,
        status: 'submitted',
      })
      .select('*')
      .single();

    if (requestError) {
      throw requestError;
    }

    await awardPointsSafely({
      userId: req.auth.userId,
      points: 12,
      reason: 'match_request_submitted',
      referenceType: 'match_request',
      referenceId: requestRow.id,
    });

    res.status(201).json({
      request: requestRow,
      foundItem,
      proofImageUrl: proofImageUrl,
      detection,
      pointsAwarded: 12,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to submit claim request.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.get('/api/match-requests/inbox', requireClerkAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('match_requests')
      .select(
        `
        id,
        found_item_id,
        lost_item_id,
        claimant_user_id,
        proof_image_url,
        ai_detected_label,
        match_score,
        status,
        created_at,
        found_item:found_items!inner(
          id,
          title,
          category,
          location,
          image_url,
          created_by
        ),
        lost_item:lost_items(
          id,
          title,
          category,
          expected_location,
          image_url,
          reported_by
        )
      `,
      )
      .eq('status', 'submitted')
      .eq('found_items.created_by', req.auth.userId)
      .order('created_at', { ascending: false })
      .limit(24);

    if (error) {
      throw error;
    }

    const items = (data ?? []).map((row) => ({
      ...row,
      found_item: relationObject(row.found_item),
      lost_item: relationObject(row.lost_item),
    }));

    res.json({ items });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch incoming claim inbox.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.get('/api/match-requests/history/me', requireClerkAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('match_requests')
      .select(
        `
        id,
        found_item_id,
        lost_item_id,
        claimant_user_id,
        proof_image_url,
        ai_detected_label,
        match_score,
        status,
        created_at,
        reviewed_at,
        reviewer_user_id,
        pickup_confirmed_at,
        pickup_confirmed_by,
        found_item:found_items(
          id,
          title,
          category,
          location,
          image_url,
          created_by
        ),
        lost_item:lost_items(
          id,
          title,
          category,
          expected_location,
          image_url,
          reported_by
        )
      `,
      )
      .in('status', ['submitted', 'approved', 'rejected', 'picked_up', 'cancelled'])
      .order('created_at', { ascending: false })
      .limit(120);

    if (error) {
      throw error;
    }

    const userId = req.auth.userId;
    const items = (data ?? [])
      .map((row) => {
        const normalized = {
          ...row,
          found_item: relationObject(row.found_item),
          lost_item: relationObject(row.lost_item),
        };

        const pickupEditWindow = resolvePickupEditWindow(normalized.pickup_confirmed_at);

        return {
          ...normalized,
          pickup_editable_until: pickupEditWindow.editableUntil,
          pickup_is_editable: pickupEditWindow.isEditable,
          pickup_edit_seconds_remaining: pickupEditWindow.remainingSeconds,
        };
      })
      .filter((row) => {
        const ownerId = readText(row.found_item?.created_by);
        const claimantId = readText(row.claimant_user_id);
        return ownerId === userId || claimantId === userId;
      });

    res.json({ items });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch claim history.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/match-requests/:requestId/resolve', requireClerkAuth, async (req, res) => {
  const requestId = readText(req.params.requestId);
  const action = readText(req.body?.action).toLowerCase();

  if (!requestId) {
    res.status(400).json({ error: 'requestId is required.' });
    return;
  }

  if (action !== 'approve' && action !== 'reject') {
    res.status(400).json({ error: 'action must be approve or reject.' });
    return;
  }

  try {
    const { data: requestRow, error: requestError } = await supabase
      .from('match_requests')
      .select(
        `
        id,
        found_item_id,
        lost_item_id,
        claimant_user_id,
        status,
        match_score,
        found_item:found_items!inner(
          id,
          title,
          created_by
        ),
        lost_item:lost_items(
          id,
          title,
          status,
          reported_by
        )
      `,
      )
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      throw requestError;
    }

    if (!requestRow) {
      res.status(404).json({ error: 'Match request not found.' });
      return;
    }

    const foundItem = relationObject(requestRow.found_item);
    if (!foundItem || readText(foundItem.created_by) !== req.auth.userId) {
      res.status(403).json({ error: 'Only the finder can review this claim request.' });
      return;
    }

    if (readText(requestRow.status) !== 'submitted') {
      res.status(409).json({ error: 'This request has already been reviewed.' });
      return;
    }

    const nowIso = new Date().toISOString();

    if (action === 'reject') {
      const { data: updatedRequest, error: updateError } = await supabase
        .from('match_requests')
        .update({
          status: 'rejected',
          reviewed_at: nowIso,
          reviewer_user_id: req.auth.userId,
        })
        .eq('id', requestId)
        .eq('status', 'submitted')
        .select('*')
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      if (!updatedRequest) {
        res.status(409).json({ error: 'Request could not be rejected. It may already be resolved.' });
        return;
      }

      res.json({ resolved: true, action: 'reject', request: updatedRequest });
      return;
    }

    const { data: existingApproved, error: approvedError } = await supabase
      .from('match_requests')
      .select('id')
      .eq('found_item_id', requestRow.found_item_id)
      .eq('status', 'approved')
      .neq('id', requestId)
      .limit(1);

    if (approvedError) {
      throw approvedError;
    }

    if (existingApproved && existingApproved.length) {
      res.status(409).json({ error: 'This found item already has an approved claim.' });
      return;
    }

    const { data: updatedRequest, error: updateError } = await supabase
      .from('match_requests')
      .update({
        status: 'approved',
        reviewed_at: nowIso,
        reviewer_user_id: req.auth.userId,
      })
      .eq('id', requestId)
      .eq('status', 'submitted')
      .select('*')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updatedRequest) {
      res.status(409).json({ error: 'Request could not be approved. It may already be resolved.' });
      return;
    }

    await supabase
      .from('match_requests')
      .update({
        status: 'rejected',
        reviewed_at: nowIso,
        reviewer_user_id: req.auth.userId,
      })
      .eq('found_item_id', requestRow.found_item_id)
      .eq('status', 'submitted')
      .neq('id', requestId);

    await supabase
      .from('lost_items')
      .update({ status: 'claimed' })
      .eq('id', requestRow.lost_item_id);

    const finderUserId = readText(foundItem.created_by);
    const claimantUserId = readText(requestRow.claimant_user_id);

    const finderPointsAwarded = 35;
    const claimantPointsAwarded = finderUserId && finderUserId !== claimantUserId ? 20 : 0;

    await awardPointsSafely({
      userId: finderUserId,
      points: finderPointsAwarded,
      reason: 'found_item_claimed_by_owner',
      referenceType: 'match_request',
      referenceId: updatedRequest.id,
    });

    if (claimantPointsAwarded > 0) {
      await awardPointsSafely({
        userId: claimantUserId,
        points: claimantPointsAwarded,
        reason: 'ownership_verified',
        referenceType: 'match_request',
        referenceId: updatedRequest.id,
      });
    }

    res.json({
      resolved: true,
      action: 'approve',
      request: updatedRequest,
      finderPointsAwarded,
      claimantPointsAwarded,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to resolve match request.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/match-requests/:requestId/confirm-pickup', requireClerkAuth, async (req, res) => {
  const requestId = readText(req.params.requestId);

  if (!requestId) {
    res.status(400).json({ error: 'requestId is required.' });
    return;
  }

  try {
    const { data: requestRow, error: requestError } = await supabase
      .from('match_requests')
      .select(
        `
        id,
        found_item_id,
        lost_item_id,
        claimant_user_id,
        status,
        found_item:found_items!inner(
          id,
          title,
          created_by
        )
      `,
      )
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      throw requestError;
    }

    if (!requestRow) {
      res.status(404).json({ error: 'Match request not found.' });
      return;
    }

    const foundItem = relationObject(requestRow.found_item);
    const ownerId = readText(foundItem?.created_by);

    if (ownerId !== req.auth.userId) {
      res.status(403).json({ error: 'Only uploader can confirm owner pickup.' });
      return;
    }

    if (readText(requestRow.status) !== 'approved') {
      res.status(409).json({ error: 'Only approved claims can be marked as picked up.' });
      return;
    }

    const nowIso = new Date().toISOString();

    const { data: updatedRequest, error: updateError } = await supabase
      .from('match_requests')
      .update({
        status: 'picked_up',
        pickup_confirmed_at: nowIso,
        pickup_confirmed_by: req.auth.userId,
      })
      .eq('id', requestId)
      .eq('status', 'approved')
      .select('*')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updatedRequest) {
      res.status(409).json({ error: 'Pickup confirmation failed. Request state changed.' });
      return;
    }

    await supabase
      .from('lost_items')
      .update({ status: 'closed' })
      .eq('id', requestRow.lost_item_id);

    const claimantUserId = readText(requestRow.claimant_user_id);

    const finderPickupPoints = 15;
    const claimantPickupPoints = ownerId !== claimantUserId ? 10 : 0;

    const finderPointsAwardedNow = await awardPointsOnce({
      userId: ownerId,
      points: finderPickupPoints,
      reason: 'owner_pickup_confirmed',
      referenceType: 'match_request',
      referenceId: updatedRequest.id,
    });

    if (claimantPickupPoints > 0) {
      await awardPointsOnce({
        userId: claimantUserId,
        points: claimantPickupPoints,
        reason: 'item_received',
        referenceType: 'match_request',
        referenceId: updatedRequest.id,
      });
    }

    const pickupEditWindow = resolvePickupEditWindow(updatedRequest.pickup_confirmed_at);

    res.json({
      confirmed: true,
      request: updatedRequest,
      finderPickupPoints: finderPointsAwardedNow ? finderPickupPoints : 0,
      claimantPickupPoints,
      pickupEditableUntil: pickupEditWindow.editableUntil,
      pickupEditSecondsRemaining: pickupEditWindow.remainingSeconds,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to confirm pickup.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/match-requests/:requestId/revert-pickup', requireClerkAuth, async (req, res) => {
  const requestId = readText(req.params.requestId);

  if (!requestId) {
    res.status(400).json({ error: 'requestId is required.' });
    return;
  }

  try {
    const requestRow = await loadMatchRequestWithParticipants(requestId);

    if (!requestRow) {
      res.status(404).json({ error: 'Match request not found.' });
      return;
    }

    const ownerId = readText(requestRow.found_item?.created_by);
    if (ownerId !== req.auth.userId) {
      res.status(403).json({ error: 'Only uploader can update pickup status.' });
      return;
    }

    if (readText(requestRow.status) !== 'picked_up') {
      res.status(409).json({ error: 'Only picked up claims can be changed back.' });
      return;
    }

    const pickupEditWindow = resolvePickupEditWindow(requestRow.pickup_confirmed_at);
    if (!pickupEditWindow.isEditable) {
      res.status(409).json({
        error: 'Pickup status can only be changed within 5 minutes.',
        editableUntil: pickupEditWindow.editableUntil,
      });
      return;
    }

    const { data: updatedRequest, error: updateError } = await supabase
      .from('match_requests')
      .update({
        status: 'approved',
        pickup_confirmed_at: null,
        pickup_confirmed_by: null,
      })
      .eq('id', requestId)
      .eq('status', 'picked_up')
      .select('*')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (!updatedRequest) {
      res.status(409).json({ error: 'Could not revert pickup status. Request changed.' });
      return;
    }

    if (readText(requestRow.lost_item_id)) {
      await supabase
        .from('lost_items')
        .update({ status: 'claimed' })
        .eq('id', requestRow.lost_item_id);
    }

    res.json({
      reverted: true,
      request: updatedRequest,
      message: 'Pickup was reverted. You can confirm pickup again when handover is complete.',
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to revert pickup status.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.get('/api/match-requests/:requestId/messages', requireClerkAuth, async (req, res) => {
  const requestId = readText(req.params.requestId);

  if (!requestId) {
    res.status(400).json({ error: 'requestId is required.' });
    return;
  }

  try {
    const requestRow = await loadMatchRequestWithParticipants(requestId);

    if (!requestRow) {
      res.status(404).json({ error: 'Match request not found.' });
      return;
    }

    const ownerId = readText(requestRow.found_item?.created_by);
    const claimantId = readText(requestRow.claimant_user_id);

    if (req.auth.userId !== ownerId && req.auth.userId !== claimantId) {
      res.status(403).json({ error: 'You are not allowed to access this message thread.' });
      return;
    }

    const { data: messages, error: messagesError } = await supabase
      .from('match_request_messages')
      .select('id, match_request_id, sender_user_id, message_text, created_at')
      .eq('match_request_id', requestId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (messagesError) {
      throw messagesError;
    }

    res.json({
      items: messages ?? [],
      messagingActive: readText(requestRow.status) !== 'picked_up',
      requestStatus: readText(requestRow.status),
      foundItem: requestRow.found_item,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch messages.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.post('/api/match-requests/:requestId/messages', requireClerkAuth, async (req, res) => {
  const requestId = readText(req.params.requestId);
  const messageText = readText(req.body?.message);

  if (!requestId) {
    res.status(400).json({ error: 'requestId is required.' });
    return;
  }

  if (!messageText) {
    res.status(400).json({ error: 'message is required.' });
    return;
  }

  if (messageText.length > 1000) {
    res.status(400).json({ error: 'message must be 1000 characters or less.' });
    return;
  }

  try {
    const requestRow = await loadMatchRequestWithParticipants(requestId);

    if (!requestRow) {
      res.status(404).json({ error: 'Match request not found.' });
      return;
    }

    const ownerId = readText(requestRow.found_item?.created_by);
    const claimantId = readText(requestRow.claimant_user_id);

    if (req.auth.userId !== ownerId && req.auth.userId !== claimantId) {
      res.status(403).json({ error: 'You are not allowed to send messages for this request.' });
      return;
    }

    if (readText(requestRow.status) === 'picked_up') {
      res.status(409).json({ error: 'Messaging is closed after item is marked picked up.' });
      return;
    }

    const { data: messageRow, error: insertError } = await supabase
      .from('match_request_messages')
      .insert({
        match_request_id: requestId,
        sender_user_id: req.auth.userId,
        message_text: messageText,
      })
      .select('id, match_request_id, sender_user_id, message_text, created_at')
      .single();

    if (insertError) {
      throw insertError;
    }

    res.status(201).json({
      message: messageRow,
      messagingActive: true,
      requestStatus: readText(requestRow.status),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to send message.',
      details: error && typeof error === 'object' && 'message' in error ? error.message : null,
    });
  }
});

app.listen(port, () => {
  console.log(`UniSync backend listening on port ${port}`);
});