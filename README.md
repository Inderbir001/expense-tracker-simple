# Mom's Expense Tracker

Mom adds an expense in three taps: **photo → price → Save**. You see totals, a daily chart and every photo on your dashboard.

## Run it

Needs [Node.js](https://nodejs.org) (v18 or newer). No `npm install` needed.

- **Windows:** double-click `start.bat`
- **Anywhere:** `node server.js`

The console prints two things:

| What | Looks like | Who |
|---|---|---|
| Mom's link | `http://192.168.1.5:3000/?key=AbC123...` | Send to Mom once. She opens it and her phone remembers it. |
| Dashboard | `http://192.168.1.5:3000/admin` + a 6-digit PIN | You |

Tip for Mom's phone: open the link, then browser menu → **Add to Home screen**. It becomes an app icon.

## Where is everything saved?

In the `data/` folder next to `server.js`:

- `expenses.json` — all entries
- `photos/` — all photos
- `config.json` — Mom's key and your PIN

Copy that folder to back everything up. "Remove" in the app only hides an entry (it stays in `expenses.json`).

## Letting Mom use it away from home

At home (same Wi-Fi) the printed `192.168.x.x` link works as-is. For anywhere-access the app has to run on a computer that is always on and reachable from the internet, i.e. a small hosted server (Render, Railway, Fly.io, a VPS). Whatever host you use, it needs a **persistent disk** mounted at the data folder, otherwise photos disappear on every restart.

Settings via environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where entries and photos are stored |
| `ACCESS_KEY` | random | Secret in Mom's link |
| `ADMIN_PIN` | random 6 digits | Your dashboard PIN |
| `CURRENCY` | `₹` | Symbol shown before amounts |
| `LOCALE` | `en-IN` | Number formatting (`en-US`, `en-GB`, ...) |

## Files

```
server.js            the whole backend (no dependencies)
public/index.html    Mom's page          public/mom.js
public/admin.html    your dashboard      public/admin.js
public/common.js     shared helpers      public/style.css
```
