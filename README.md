# Mom's Expense Tracker

Mom adds an expense in three taps: **photo → price → Save**. You see totals, a daily chart and every photo on your dashboard.

Two ways to run it. Same app, same screens.

## A) On Vercel (use it from anywhere, free)

Entries and photos are stored in **Vercel Blob** (a private store), so nothing is lost on redeploys.

1. **Import** this repo at <https://vercel.com/new>. Leave the framework preset as is.
2. Under **Environment Variables**, add (before pressing Deploy):

   | Name | Value |
   |---|---|
   | `ACCESS_KEY` | a long random secret (at least 10 characters). It becomes Mom's link. |
   | `ADMIN_PIN` | your dashboard PIN (at least 4 characters). After 8 wrong tries sign-in locks for 15 minutes, so a short PIN is OK. |

3. Press **Deploy**.
4. In the project, open **Storage → Create → Blob**, choose **Private**, and **connect it to the project** (this adds `BLOB_READ_WRITE_TOKEN` automatically).
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the app picks up the storage.

Then:

- **Mom's link:** `https://<your-project>.vercel.app/?key=<ACCESS_KEY>`. Send it to her once. Her phone remembers it. On her phone use browser menu → **Add to Home screen**.
- **Your dashboard:** `https://<your-project>.vercel.app/admin` and your `ADMIN_PIN`.

Until step 4 and 5 are done, the app shows "Storage is not connected yet".

## B) On your own computer

Needs [Node.js](https://nodejs.org) (v18+).

```
npm install
node server.js        # or double-click start.bat on Windows
```

It prints Mom's link and your PIN. Data is saved in the `data/` folder (copy it to back up). On the same Wi-Fi, Mom can use the printed `192.168.x.x` address.

## Settings (environment variables, all optional)

| Variable | Default | Meaning |
|---|---|---|
| `ACCESS_KEY` | random (local) / required (Vercel) | Secret in Mom's link |
| `ADMIN_PIN` | random 6 digits (local) / required (Vercel) | Your dashboard PIN |
| `CURRENCY` | `₹` | Symbol shown before amounts |
| `LOCALE` | `en-IN` | Number formatting (`en-US`, `en-GB`, ...) |
| `PORT` | `3000` | Local server port |
| `DATA_DIR` | `./data` | Local data folder |

"Remove" in the app only hides an entry; the record and photo stay in storage.

## Files

```
api/[...slug].js     Vercel entry point (all API calls land here)
lib/app.js           routes, login, validation (shared)
lib/store-blob.js    storage on Vercel Blob
lib/store-fs.js      storage in a local folder
server.js            local server
public/              the two pages: index.html (Mom) and admin.html (you)
vercel.json          Vercel routing
```
