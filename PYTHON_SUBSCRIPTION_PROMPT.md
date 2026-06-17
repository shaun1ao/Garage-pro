# Prompt for the Garage Pro Python desktop-app Claude chat

Paste everything below the line into your other Claude session that's working on the Python desktop app. Replace `garage-pro-874c6` with your actual Firebase project ID before sending if it differs.

---

I need you to add **license-key verification + a confirmation screen + dynamic branding** to my Garage Pro Python desktop app. The marketing website I just built sells subscriptions, writes them to Firestore directly from the browser using Firebase Auth, and exposes those documents publicly read-only through the **Firestore REST API**. The Python app calls that REST API once when the user enters their license key, shows them a confirmation screen with all the details, and only unlocks the app after they confirm.

**There is no custom backend.** No Cloud Functions, no service accounts, no Firebase Admin SDK — anywhere. The Python app makes plain HTTPS GET requests to a public read-only endpoint.

## What already exists (do not rebuild)

- A **Firebase Authentication** user account per customer (email + password)
- A Firestore document at `users/{uid}` containing the customer's profile and a `subscription` sub-object
- A mirror document at `licenses/{licenseKey}` so the desktop app can look up by key alone
- **Firestore security rules** that allow public READ access on `licenses/*`
- **License key format**: `GP-XXXX-XXXX-XXXX-XXXX` — four random blocks of 4 alphanumeric characters from the unambiguous set `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I). Treat it as an opaque string. The garage name is stored as a separate field on the license document, not embedded in the key.

## Document shape — `licenses/{licenseKey}`

```json
{
  "key":          "GP-K7QM-3PXR-T8VL-W2YZ",
  "uid":          "firebase-auth-uid",
  "email":        "raj@speedauto.in",
  "name":         "Rajesh Kumar",
  "garageName":   "Speed Auto Care",
  "plan":         "workshop",
  "planName":     "Workshop",
  "billingCycle": "monthly",
  "status":       "active",
  "activatedAt":  { "timestampValue": "2026-06-04T10:23:18.401Z" },
  "expiry":       { "timestampValue": "2026-07-04T10:23:18.401Z" },
  "indefinite":   false,
  "maxBays":      6,
  "maxWorkers":   8,
  "maxBookings":  20,
  "paidStatus":   "paid",
  "issuedByAdmin": false,
  "isTrial":      false,
  "trialDays":    0
}
```

- `indefinite: true` → no expiry; treat as always valid until `status` changes
- `paidStatus`: `"paid"` or `"unpaid"` (admin can issue free/comp licenses) — usually informational
- `issuedByAdmin: true` → the admin generated the key manually rather than via purchase
- `billingCycle`: `"monthly"` | `"yearly"` | `"weekly"` | `"trial"`
- **`isTrial: true`** → this is a free demo / trial license. The desktop app should make this visually obvious (see "Trial mode" section below). When the expiry hits, the existing date-comparison logic locks the app out — no separate code path needed.
- **`trialDays: <int>`** → how long the trial was originally granted for (e.g. `7`). Use it to calculate "X days left" in the trial banner.

## Hard rules — read these first

1. **No Firebase Admin SDK in Python.** No service-account JSON, no `firebase-admin` package, no `google-cloud-firestore` package.
2. **No secrets in the binary.** Only the Firebase **Project ID** (public — it's in the URL).
3. **No password decryption.** The Python app never sees the user's password. The user types their license key, period.
4. **Read-only.** The app never writes to Firestore. Activation happens on the website.
5. **Offline grace period.** App keeps working for **7 days** without a successful online check.
6. **Confirmation required.** After fetching the license, show the customer all the details and let them confirm before unlocking the app.

## The verification URL

```
https://firestore.googleapis.com/v1/projects/garage-pro-874c6/databases/(default)/documents/licenses/{LICENSE_KEY}
```

Plain HTTP GET, no headers, no auth required. Replace `{LICENSE_KEY}` with the key the user entered.

**Example response when the license exists:**

```json
{
  "name": "projects/garage-pro-874c6/databases/(default)/documents/licenses/GP-K7QM-3PXR-T8VL-W2YZ",
  "fields": {
    "key":          { "stringValue":    "GP-K7QM-3PXR-T8VL-W2YZ" },
    "uid":          { "stringValue":    "abc123..." },
    "email":        { "stringValue":    "raj@speedauto.in" },
    "name":         { "stringValue":    "Rajesh Kumar" },
    "garageName":   { "stringValue":    "Speed Auto Care" },
    "plan":         { "stringValue":    "workshop" },
    "planName":     { "stringValue":    "Workshop" },
    "billingCycle": { "stringValue":    "monthly" },
    "status":       { "stringValue":    "active" },
    "expiry":       { "timestampValue": "2026-07-04T10:23:18.401Z" },
    "activatedAt":  { "timestampValue": "2026-06-04T10:23:18.401Z" },
    "indefinite":   { "booleanValue":   false },
    "maxBays":      { "integerValue":   "6" },
    "maxWorkers":   { "integerValue":   "8" },
    "maxBookings":  { "integerValue":   "20" }
  },
  "createTime": "...",
  "updateTime": "..."
}
```

**When the license doesn't exist:** HTTP 404 with `{"error": {"code": 404, "status": "NOT_FOUND"}}`.

You need a small helper that flattens Firestore's `{ typeName: value }` wrappers into plain Python values:

```python
def _flatten(field):
    if not field: return None
    for t, v in field.items():
        if t == "stringValue":    return v
        if t == "integerValue":   return int(v)
        if t == "doubleValue":    return float(v)
        if t == "booleanValue":   return v
        if t == "timestampValue": return datetime.fromisoformat(v.replace("Z", "+00:00"))
        if t == "nullValue":      return None
        if t == "arrayValue":     return [_flatten(x) for x in v.get("values", [])]
        if t == "mapValue":       return {k: _flatten(x) for k, x in v.get("fields", {}).items()}
    return None
```

## What to build

### 1. `license_client.py`

Single self-contained module, standard library only (`urllib.request` is fine, no `requests` needed).

```python
@dataclass(frozen=True)
class SubscriptionStatus:
    active:        bool
    status:        str  | None
    plan:          str  | None              # internal id, e.g. "workshop"
    plan_name:     str  | None              # display name, e.g. "Workshop"
    billing_cycle: str  | None              # "monthly" | "yearly" | "weekly" | "trial"
    expiry:        datetime | None          # None if indefinite
    indefinite:    bool                     # True = never expires
    license_key:   str  | None
    email:         str  | None
    name:          str  | None              # customer's full name
    garage_name:   str  | None              # company / workshop name — DISPLAY THIS PROMINENTLY
    max_bays:      int  | None
    max_workers:   int  | None
    max_bookings:  int  | None
    is_trial:      bool                     # True = free demo subscription
    trial_days:    int  | None              # total trial length when issued (e.g. 7)
    checked_at:    datetime
    reason:        str  | None              # "expired", "revoked", "not_found", "grace_expired", "offline", "not_activated"

    @property
    def trial_days_left(self) -> int | None:
        """How many days remain on a trial. None for paid / indefinite licences."""
        if not self.is_trial or not self.expiry:
            return None
        delta = self.expiry - datetime.now(timezone.utc)
        return max(0, delta.days)

class LicenseClient:
    def __init__(self, project_id: str, cache_path: Path | None = None): ...
    def activate(self, license_key: str) -> SubscriptionStatus: ...
    def verify(self, force_online: bool = False) -> SubscriptionStatus: ...
    def status(self) -> SubscriptionStatus: ...
    def clear(self) -> None: ...
```

Behaviour same as before: 5-second timeout, 7-day offline grace, atomic JSON cache file in the OS config dir.

### 2. Activation flow — 3 screens

#### Screen 1: Enter License Key

A simple dialog with one input (uppercased, auto-formats to `GP-XXXX-XXXX-XXXX-XXXX` as the user types). One **Verify** button. Below it: small "Buy at garagepro.app" link.

#### Screen 2: ⭐ Confirmation screen (new, key part of this task) ⭐

After `client.activate(key)` returns an active subscription, **do not unlock the app yet**. Show this screen instead:

```
┌─────────────────────────────────────────┐
│  Is this your license?                  │
│                                         │
│  License key:    GP-K7QM-3PXR-T8VL-W2YZ│
│  Name:           Rajesh Kumar           │
│  Garage:         Speed Auto Care        │
│  Product:        Workshop               │
│  Renews on:      4 Jul 2026             │
│  Renewal type:   Monthly                │
│                                         │
│  [ Yes, that's me ]   [ Wrong key ]    │
└─────────────────────────────────────────┘
```

Format rules:
- `License key`: monospace font, exactly as fetched
- `Name`: `SubscriptionStatus.name`
- `Garage`: `SubscriptionStatus.garage_name` — this is what will appear in the app's top-left after activation
- `Product`: `SubscriptionStatus.plan_name` (capitalised display name, not the internal id)
- `Renews on`: human-formatted expiry date, e.g. `4 Jul 2026`. If `indefinite == True`, show `Never expires` instead.
- `Renewal type`: `Monthly` / `Yearly` / `Weekly` (capitalised). If `indefinite == True`, hide this row.

**Trial variant** — if `is_trial == True`:
- Show a yellow "FREE TRIAL" pill at the top of the confirmation card
- Change "Renews on" → **"Trial ends:"** (same date format)
- Hide the "Renewal type" row (it's `trial`, which the user doesn't need to see)
- Add a one-line note below the buttons: *"Your trial gives you full access for {trial_days} days. After that the app locks — but you can subscribe any time at garagepro.app/account to keep your data."*

**Yes, that's me** → save the cache, set the app's branding (see screen 3 / point 3), unlock the main UI.

**Wrong key** → clear the freshly-fetched data (don't write the cache), return to Screen 1.

#### Screen 3: Locked / error states

If `client.activate(key)` returns inactive, show one of these instead of Screen 2:

| `status.reason`  | Screen                                                        |
| ---------------- | ------------------------------------------------------------- |
| `not_found`      | "License key not recognised. Check the key or contact support." |
| `revoked`        | "This license has been revoked. Contact support."             |
| `expired`        | "This subscription expired on {expiry}. Renew at garagepro.app/account." |
| any network error| "Couldn't reach the verification server. Check your connection." |

### 3. Dynamic branding — show the garage name in the top-left

Once a license is activated and confirmed:

- Update the **app title bar / top-left corner** to show the garage name from `SubscriptionStatus.garage_name` next to (or replacing) the Garage Pro logo.
- For example, if `garage_name == "Speed Auto Care"`, the header should read **"Speed Auto Care"** (large, bold) with a small "powered by Garage Pro" or the logo beside it.
- The fallback (no license / not activated yet) keeps the default "Garage Pro" branding.
- Persist this so on every subsequent app launch the branding loads from the cache before the network check completes — feels instant.

```python
def app_brand() -> str:
    """Return the title to show in the app header."""
    sub = client.status()
    return sub.garage_name or "Garage Pro"
```

Wire this into whatever component renders the header (Qt label, Tkinter label, etc.) and have it refresh whenever the subscription updates.

### 3b. Trial mode — visual differentiation

When `SubscriptionStatus.is_trial == True`, the app should make it obvious the customer is on a trial so they understand the clock is ticking. Make these UI tweaks:

1. **Header pill** — next to the garage name in the top-left, show a small yellow/amber chip labelled **"FREE TRIAL — N days left"** where `N` is `sub.trial_days_left`. Update the countdown on every app launch and every background re-check.
2. **Subtle banner** in the main UI (below the menu bar) that says **"You're on a free trial of {plan_name}. Subscribe before {expiry_date} to keep your data."** with a **"Subscribe now"** button that opens `https://garagepro.app/account` via `webbrowser.open(...)`. Make the banner dismissable (per-session — don't permanently hide it).
3. **Trial-ending warning** — when `trial_days_left <= 2`, escalate the banner to amber/red and change the wording to **"Your trial ends in {N} days. Subscribe now to keep using Garage Pro."**
4. **My Plan panel** — show "Free Trial" instead of "Workshop · Monthly", and "Trial ends" instead of "Renews on".

When the trial expires, the existing date-comparison in `verify()` returns `active=False, reason="expired"` — your normal "expired" screen fires. Re-use that flow; don't write a separate "trial expired" path. Just optionally word the locked screen as **"Your free trial has ended. Subscribe at garagepro.app/account to continue using Garage Pro and your existing data."** when `is_trial == True` was the last known state.

```python
def header_pill_text(sub: SubscriptionStatus) -> str | None:
    """Returns the small pill text to show next to the garage name, or None."""
    if not sub.active or not sub.is_trial:
        return None
    days_left = sub.trial_days_left or 0
    return f"FREE TRIAL · {days_left} day{'s' if days_left != 1 else ''} left"
```

Keep this purely cosmetic — gating logic still flows through the normal `active` / `expired` / `revoked` checks. A trial license is just a paid license with a short clock and a flag.

### 4. App startup flow

```
1. Splash screen
2. client = LicenseClient(project_id="garage-pro-874c6")
3. status = client.verify(force_online=False)
4. if not status.active:
      → Activation flow (Screen 1 → 2 → main UI)
   if status.active:
      → Set garage name in header
      → Main UI
5. Start 30-min background re-check
```

### 5. Background re-check (every 30 min)

`client.verify(force_online=True)` on a timer. If the new status is no longer active, fire a `subscription_lost` event:
- Grey out create-buttons (new booking, add bay, add mechanic)
- Show a banner: "Your subscription is no longer active. Renew at garagepro.app/account"
- Do **not** delete data, log the user out, or change the garage-name branding

### 6. Plan-limit enforcement

`SubscriptionStatus.max_bays`, `.max_workers`, `.max_bookings` come straight from Firestore. Gate every "add resource" action:

```python
def can_add_bay() -> tuple[bool, str | None]:
    sub = app.subscription
    if not sub.active:
        return False, "Your subscription is not active."
    cap = sub.max_bays or 0
    if cap >= 999:
        return True, None              # unlimited
    current = len(db.bays())
    if current >= cap:
        return False, f"Your {sub.plan_name} plan allows {cap} bays. Upgrade at garagepro.app/account."
    return True, None
```

Repeat the same shape for workers and concurrent bookings.

### 7. "My Plan" panel in Settings

Show all the same fields as the confirmation screen:
- License key (with copy button)
- Name + Garage name
- Plan
- Renewal date + renewal type
- Days remaining
- A **Manage subscription / Change plan** button that opens `https://garagepro.app/account` via `webbrowser.open(...)`

### 8. Security checklist before you finish

- [ ] No `firebase-admin`, `google-cloud-firestore`, or any other Firebase SDK
- [ ] No service-account JSON shipped with the app
- [ ] No API keys, secrets, or private keys in any Python file
- [ ] All Firestore reads use the public REST API; the app makes zero writes
- [ ] The verification request includes only the license key — no password, no PII
- [ ] Network errors fall through to cached status (don't crash)
- [ ] Cache file is plain JSON, not encrypted
- [ ] Code structured so a future "real backend" requires zero Python changes — `LicenseClient` keeps the same surface

## End-to-end test

1. On the website, sign up as `test@garage.in` / `test1234` with garage name **"Demo Workshop"**.
2. Buy the Workshop plan via fake payment. The dashboard shows a key like `GP-XXXX-XXXX-XXXX-XXXX`.
3. Copy that key.
4. Run the Python app. Enter the key on Screen 1.
5. Screen 2 appears with: Name = Test User, Garage = Demo Workshop, Product = Workshop, Renews on = today + 30 days, Renewal type = Monthly.
6. Click "Yes, that's me".
7. Main UI unlocks. The top-left now reads **"Demo Workshop"** instead of "Garage Pro".
8. Restart the app. Within 1 second of startup the cached license loads and Demo Workshop appears in the header. Then the background re-check confirms it's still active.
9. In Firebase Console → Firestore → `licenses/<your-key>` → change `status` to `"revoked"`. Within 30 minutes (or restart) the app drops into read-only mode but keeps the Demo Workshop branding.
10. Disconnect from the internet, restart the app. It should keep working with cached limits and branding.
11. Skip 8 days forward (system clock), restart offline. App should show "please reconnect to verify your subscription" because the 7-day grace expired.

## Deliverables

1. `license_client.py` — verification module
2. Activation Screen 1 (license entry)
3. Activation Screen 2 (confirmation — **the key new feature**)
4. Locked / revoked / expired / not-found / grace-expired UI screens
5. Dynamic header that shows the garage name once activated
6. 30-min background re-check loop
7. Plan-limit gates around bay / worker / booking creation
8. "My Plan" panel in Settings
9. Short README explaining the cache location on each OS

When you're done, tell me which files you changed, where the cache lives on each OS (Windows / macOS / Linux), and confirm all eleven test steps pass.
