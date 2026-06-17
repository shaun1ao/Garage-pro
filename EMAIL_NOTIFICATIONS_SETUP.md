# Email Notifications — 4-minute setup

The site sends transactional emails (welcome, license keys, trial confirmations) through a tiny Google Apps Script that runs in your own Google account. **No API keys, no Gmail App Password, no paid services, no backend.** Free Gmail sends up to 100 emails/day this way; Google Workspace accounts get 1,500/day.

## Step 1 — Open Apps Script

Go to **[script.google.com](https://script.google.com)** and sign in with the Gmail you want emails to come from.

Click **+ New project**. You'll get a blank script editor with `Code.gs` open.

## Step 2 — Paste the script

Select all the existing code in `Code.gs` and delete it. Paste this:

```javascript
/**
 * Garage Pro — email relay
 * Receives JSON POSTs from the website and sends an email via your Gmail.
 * Deploy as a Web App with: Execute as = Me, Who has access = Anyone.
 */

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const to       = body.to;
    const subject  = body.subject;
    const text     = body.body  || '';
    const html     = body.html  || text;
    const fromName = body.fromName || 'Garage Pro';
    const replyTo  = body.replyTo  || '';

    if (!to || !subject) {
      return reply({ ok: false, error: 'Missing "to" or "subject"' });
    }

    const options = {
      htmlBody: html,
      name:     fromName
    };
    if (replyTo) options.replyTo = replyTo;

    MailApp.sendEmail(to, subject, text, options);
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** Quick health check — visit the web-app URL in a browser to see "OK". */
function doGet() {
  return ContentService.createTextOutput('Garage Pro email relay — OK');
}

function reply(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Click the **💾 Save** icon (or `Cmd+S`). Name the project anything — "Garage Pro Email" works.

## Step 3 — Deploy as a web app

1. Click the blue **Deploy** button (top-right) → **New deployment**.
2. Click the ⚙️ gear icon next to "Select type" → choose **Web app**.
3. Fill in the form:
   - **Description**: `Email relay v1` (anything; it's a label)
   - **Execute as**: **Me** (`your.email@gmail.com`)
   - **Who has access**: **Anyone**
4. Click **Deploy**.
5. Google will ask you to **Authorize access** — click through:
   - Pick the same Gmail
   - Click **Advanced** → **Go to (project name) (unsafe)** — this scary warning is normal; the script is yours, it's "unsafe" only in the sense that Google hasn't reviewed it
   - Click **Allow** on the Gmail-send permission
6. You'll see a **Web app URL** that ends in `/exec`. Copy it.

That URL looks like:
```
https://script.google.com/macros/s/AKfycbz...XYZ/exec
```

## Step 4 — Paste the URL into the admin panel

1. Open your site → sign in as admin
2. **Admin Panel → Pricing tab** → scroll to **Email Notifications**
3. Tick **Enable email notifications**
4. Paste the URL into **Apps Script web-app URL**
5. Set **From name** to whatever you want to appear in customer inboxes (e.g. "Garage Pro Support")
6. Optionally set a **Reply-to address** — if a customer hits reply, it goes there instead of your personal Gmail
7. Choose which events trigger emails — Sign-up, Plan purchase, Free trial start, Admin-issued license
8. Click **Save Email Settings**
9. Click **Send Test Email** — type your own address. Within ~5 seconds you should get an email titled "Garage Pro — test email"

If it works, you're done. The site will now automatically email customers whenever the matching event fires.

## What gets sent — at a glance

| Event | Template | When |
|---|---|---|
| Sign-up | "Welcome to Garage Pro, FirstName!" | After a customer creates an account (email/password OR Google) |
| Plan purchase | "Your Workshop license key — Garage Pro" | After they complete fake payment for any plan |
| Free trial start | "Your free trial is live" | After they click "Start free trial" |
| Admin-issued | "Your Workshop license key — Garage Pro" | When you manually generate a license from the admin panel |

The trial email has slightly different copy: "Trial ends" instead of "Renews on", and the trial length is shown.

## If it doesn't work

**Test email says "Send failed":**
- Make sure the Apps Script deployment is set to **Execute as: Me** and **Who has access: Anyone**. If you set Anyone *with Google account*, browsers send a redirect that breaks the call.
- Visit the URL in a browser — you should see "Garage Pro email relay — OK". If you see Google sign-in instead, your deployment access is wrong.

**Test email "succeeds" but no email arrives:**
- Check the **Sent** folder of the Gmail you deployed under — that's where Apps Script emails land for the sender
- Check the recipient's spam folder — first emails from any new sender often land there
- In Apps Script editor → **Executions** (left sidebar) — see if it logged an error like "Quota exceeded" or "Invalid email address"

**"You have exceeded the limit"** — you've sent more than 100 emails in 24 hours from a personal Gmail. Wait 24h or upgrade the sending account to Google Workspace ($6/mo per user) for the 1,500/day quota.

**Customers reply to the email and you don't get the reply:**
- Set the **Reply-to address** in the admin panel — that's the address Gmail puts in the Reply-To header, and any customer reply will route there instead of your personal Gmail.

## When you redeploy the script

If you edit the Apps Script later (e.g. tweak the HTML template, change the subject), you need to **deploy a new version** for the changes to take effect:

1. **Deploy** → **Manage deployments** → click ✏️ on the existing deployment
2. Change the **Version** dropdown to **New version**
3. Click **Deploy**

The URL stays the same. If you click **New deployment** instead, you'll get a *different* URL and have to update it in the admin panel.

## Customising the email templates

The templates live in `EMAIL_TPL` inside `index.html` (search for "EMAIL_TPL"). Each template is a function that takes a data object and returns `{ subject, html }`. Tweak the HTML directly — no need to touch the Apps Script for any visual changes. The script only sends what the site passes to it.

That's it — the entire flow is: site → Apps Script (your Gmail) → customer's inbox.
