# `/tablet` — Cloud tablet route

This folder makes `https://garagepro.me/tablet` work as the public entry point for the Garage Pro tablet interface.

## Files in this folder

| File | What it is | Replace? |
|---|---|---|
| `index.html` | Branded launcher landing page — shown at `/tablet`. Has a **Launch Tablet** button that navigates to `app.html`. | No — leave as-is unless you want to re-brand. |
| `app.html`   | **Placeholder.** Until you drop your real tablet HTML here, visitors see a "not deployed yet" message with instructions. | **Yes — replace this file.** |
| `README.md`  | This file. | — |

## How to deploy your tablet

1. Take the standalone `tablet_online.html` from the Garage Pro app repo (the version that talks directly to Firebase Firestore — no Python server needed).
2. Copy it into this folder, renaming it to **`app.html`** (overwrite the placeholder).
3. Commit + push to the website's GitHub repo.
4. Within ~1 minute, GitHub Pages serves it at `https://garagepro.me/tablet/app.html` and the launcher's button starts the real tablet flow.

That's it. No backend changes, no CORS config, no rewrites — GitHub Pages handles everything.

## How users reach it

- **Direct URL:** `https://garagepro.me/tablet` → loads `index.html` automatically
- **From the marketing site:** there's a "Tablet" link in the main site's nav
- **Once a workshop is bookmarked:** users can bookmark `https://garagepro.me/tablet/app.html` to skip the launcher

## Sign-in flow (handled inside `app.html`)

1. **Branch login** — Branch ID + password, verified against `branches/{branchId}` in the shared Firebase project `garage-pro-874c6`
2. **Worker PIN** — selects the worker (or admin), using PINs stored in the workshop's own Firebase

The garagepro.me website itself touches **none** of this auth — it's a 100% static host. The tablet HTML talks directly to Firestore.

## Custom domain note

If your repo is hosted at `username.github.io/garage-pro/` rather than the custom `garagepro.me` domain, the URL becomes `username.github.io/garage-pro/tablet/`. All the relative links in the launcher (`./app.html`, `../`) will still resolve correctly.

## Security recap

- Branch passwords are SHA-256 hashed in Firebase — never plaintext
- The shared Firebase config holds only public web keys (safe to expose in browser)
- Each workshop's data lives in **their own** Firebase project
- The launcher / placeholder never touch workshop data — only the real tablet HTML does
