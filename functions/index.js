/**
 * Garage Pro — Subscription Cloud Functions
 *
 * Two HTTP endpoints:
 *   POST /activateSubscription   — called by the website to record a purchase
 *   GET|POST /verifySubscription — called by the Python desktop app to check status
 *
 * Deploy with:
 *   firebase deploy --only functions
 *
 * The website POSTs JSON { userId, plan, billingCycle? } and the function writes
 * a subscription document under users/{userId}.subscription, plus a mirror in
 * licenses/{licenseKey}. The Python desktop app calls verifySubscription with
 * either a userId or a licenseKey and gets back { active: true/false, ... }.
 *
 * Designed so a real payment provider (Stripe) can slot in later: just have
 * Stripe's webhook hit activateSubscription with a verified signature instead
 * of the website calling it directly.
 */

const functions = require('firebase-functions');
const admin     = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ─── CORS ───────────────────────────────────────────────────────────────
// GitHub Pages site origin and Python desktop app both call these endpoints
// from outside Firebase, so CORS must allow cross-origin requests.
// In production you can tighten this to your specific Pages URL.
function setCORS(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '3600');
}

// ─── Helpers ────────────────────────────────────────────────────────────
const VALID_PLANS = ['solo', 'workshop', 'chain', 'pro', 'standard'];

function generateLicenseKey() {
  // 32-char unambiguous alphabet (no 0/O/1/I), 4 blocks of 4 = 16 chars
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => {
    let s = '';
    for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  };
  return `GP-${block()}-${block()}-${block()}-${block()}`;
}

function planLimits(planId) {
  // Default catalogue. The website also keeps its own catalogue under
  // siteConfig/plans — feel free to read from there instead if you want a
  // single source of truth.
  switch ((planId || '').toLowerCase()) {
    case 'solo':     return { maxBays: 1,   maxWorkers: 2,   maxBookings: 5   };
    case 'workshop': return { maxBays: 6,   maxWorkers: 8,   maxBookings: 20  };
    case 'chain':    return { maxBays: 999, maxWorkers: 999, maxBookings: 999 };
    case 'pro':      return { maxBays: 6,   maxWorkers: 8,   maxBookings: 20  };
    case 'standard': return { maxBays: 3,   maxWorkers: 4,   maxBookings: 10  };
    default:         return { maxBays: 1,   maxWorkers: 1,   maxBookings: 5   };
  }
}

function durationDays(billingCycle) {
  return billingCycle === 'weekly' ? 7 : 30;
}

// ─── /activateSubscription ──────────────────────────────────────────────
// POST { userId, plan, billingCycle? }
// Writes:
//   users/{userId}.subscription = { status, plan, expiry, licenseKey, ... }
//   licenses/{licenseKey}       = { mirror doc for desktop-app lookup }
exports.activateSubscription = functions.https.onRequest(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const userId = (body.userId || '').toString().trim();
  const plan   = (body.plan   || '').toString().trim().toLowerCase();
  const cycle  = body.billingCycle === 'weekly' ? 'weekly' : 'monthly';

  if (!userId)                       return res.status(400).json({ error: 'Missing userId' });
  if (!plan)                         return res.status(400).json({ error: 'Missing plan'   });
  if (!VALID_PLANS.includes(plan))   return res.status(400).json({ error: `Invalid plan: ${plan}` });
  // Basic sanity check — keep userId reasonable
  if (userId.length > 200)           return res.status(400).json({ error: 'userId too long' });

  const days       = durationDays(cycle);
  const now        = admin.firestore.Timestamp.now();
  const expiryDate = new Date(Date.now() + days * 86400000);
  const expiry     = admin.firestore.Timestamp.fromDate(expiryDate);
  const limits     = planLimits(plan);

  // Re-use the existing license key if the user already has an active sub,
  // so plan changes don't generate a new key every time.
  let licenseKey;
  try {
    const existing = await db.collection('users').doc(userId).get();
    const prevKey  = existing.exists && existing.data().subscription
                     ? existing.data().subscription.licenseKey
                     : null;
    licenseKey = prevKey || generateLicenseKey();
  } catch (e) {
    licenseKey = generateLicenseKey();
  }

  const subscription = {
    status:           'active',
    plan,
    billingCycle:     cycle,
    activatedAt:      now,
    expiry,
    licenseKey,
    maxBays:          limits.maxBays,
    maxWorkers:       limits.maxWorkers,
    maxBookings:      limits.maxBookings,
    lastPaymentMethod:'fake-test-payment'   // Stripe will overwrite this later
  };

  try {
    // 1) Main subscription record under the user
    await db.collection('users').doc(userId).set({
      email:     userId,
      updatedAt: now,
      subscription
    }, { merge: true });

    // 2) Mirror under licenses/{key} so the desktop app can verify by key alone
    await db.collection('licenses').doc(licenseKey).set({
      key:          licenseKey,
      userId,
      email:        userId,
      plan,
      billingCycle: cycle,
      status:       'active',
      activatedAt:  now,
      expiry,
      maxBays:      limits.maxBays,
      maxWorkers:   limits.maxWorkers,
      maxBookings:  limits.maxBookings,
      createdAt:    now
    }, { merge: true });

    return res.json({
      success:      true,
      userId,
      plan,
      billingCycle: cycle,
      licenseKey,
      expiry:       expiryDate.toISOString(),
      maxBays:      limits.maxBays,
      maxWorkers:   limits.maxWorkers,
      maxBookings:  limits.maxBookings
    });
  } catch (err) {
    console.error('activateSubscription error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

// ─── /verifySubscription ────────────────────────────────────────────────
// GET ?userId=...   OR   GET ?licenseKey=...
// (POST with the same fields in body also accepted)
// Returns: { active, status, plan, expiry, licenseKey, maxBays, ... }
exports.verifySubscription = functions.https.onRequest(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const source     = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const userId     = (source.userId     || '').toString().trim();
  const licenseKey = (source.licenseKey || '').toString().trim();

  if (!userId && !licenseKey) {
    return res.status(400).json({ error: 'Provide userId or licenseKey' });
  }

  try {
    let sub  = null;
    let key  = null;
    let owner = null;

    if (licenseKey) {
      const doc = await db.collection('licenses').doc(licenseKey).get();
      if (doc.exists) {
        const d = doc.data() || {};
        sub = {
          status:       d.status,
          plan:         d.plan,
          billingCycle: d.billingCycle || 'monthly',
          expiry:       d.expiry,
          maxBays:      d.maxBays,
          maxWorkers:   d.maxWorkers,
          maxBookings:  d.maxBookings
        };
        key   = d.key || licenseKey;
        owner = d.userId || d.email || null;
      }
    } else {
      const doc = await db.collection('users').doc(userId).get();
      if (doc.exists && doc.data().subscription) {
        const s = doc.data().subscription;
        sub = {
          status:       s.status,
          plan:         s.plan,
          billingCycle: s.billingCycle || 'monthly',
          expiry:       s.expiry,
          maxBays:      s.maxBays,
          maxWorkers:   s.maxWorkers,
          maxBookings:  s.maxBookings
        };
        key   = s.licenseKey || null;
        owner = userId;
      }
    }

    if (!sub) return res.json({ active: false, reason: 'not_found' });

    const expiryDate = sub.expiry && sub.expiry.toDate ? sub.expiry.toDate() : (sub.expiry ? new Date(sub.expiry) : null);
    const now        = new Date();
    const isExpired  = expiryDate && expiryDate.getTime() < now.getTime();
    const isActive   = sub.status === 'active' && !isExpired;

    return res.json({
      active:       isActive,
      status:       sub.status,
      plan:         sub.plan,
      billingCycle: sub.billingCycle,
      expiry:       expiryDate ? expiryDate.toISOString() : null,
      licenseKey:   key,
      userId:       owner,
      maxBays:      sub.maxBays,
      maxWorkers:   sub.maxWorkers,
      maxBookings:  sub.maxBookings,
      reason:       !isActive ? (isExpired ? 'expired' : sub.status) : null,
      checkedAt:    now.toISOString()
    });
  } catch (err) {
    console.error('verifySubscription error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─── /revokeSubscription (admin-only) ───────────────────────────────────
// Lets your admin panel kill a user's access without deleting the doc.
// Protect this with an admin secret in production — for now it's open.
exports.revokeSubscription = functions.https.onRequest(async (req, res) => {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  const { userId, licenseKey } = body;
  if (!userId && !licenseKey) {
    return res.status(400).json({ error: 'Provide userId or licenseKey' });
  }

  const now = admin.firestore.Timestamp.now();
  try {
    if (userId) {
      await db.collection('users').doc(userId).set({
        subscription: { status: 'revoked', revokedAt: now }
      }, { merge: true });
    }
    if (licenseKey) {
      await db.collection('licenses').doc(licenseKey).set({
        status: 'revoked', revokedAt: now
      }, { merge: true });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('revokeSubscription error:', err);
    return res.status(500).json({ error: err.message });
  }
});
