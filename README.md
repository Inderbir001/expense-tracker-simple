# Family Expense Tracker

Everyone in the family adds expenses in three taps: **photo, price, Save**. Each person has a monthly budget and can see how much they have spent and how much is left. You, the admin, see everything.

## How it works

- **One website address for everyone.** People tap their name and enter their own PIN. Logins last a year and renew while in use.
- **Admin** (you) signs in with "I'm the admin" and the admin PIN. From the dashboard you can add family members, set each person's PIN and monthly budget, switch people off, and see every expense (filter by person, month, day), budgets used and left, and download everything as CSV.
- **Family members** see only their own things, through the menu (hamburger): **Add expense**, **My expenses** and **My budget** (budget, spent, left, safe amount per day, pace, last 6 months).
- **Ration list** (one shared list for the whole family): anyone taps items from a catalog of common Indian groceries (searchable in English and Hindi, e.g. "gehun" finds Atta) or types their own, and adjusts how much. The admin sees the list, marks items as ordered, and can share it on WhatsApp or copy it.

## Run it on Vercel (use it from anywhere, free)

Entries and photos are stored in **Vercel Blob** (a private store), so nothing is lost on redeploys.

1. **Import** this repo at <https://vercel.com/new>.
2. Add two **Environment Variables**:

   | Name | Value |
   |---|---|
   | `ADMIN_PIN` | the admin's PIN (at least 4 characters). 8 wrong tries lock that sign-in for 15 minutes. |
   | `ACCESS_KEY` | a long random secret (at least 10 characters) used to sign logins. Keep it the same, otherwise everyone is signed out. |

3. **Deploy**, then in the project open **Storage → Create → Blob**, choose **Private**, and connect it to the project.
4. In **Settings → Deployment Protection** switch **Vercel Authentication** off (the app has its own sign-in).
5. **Redeploy** so the app picks up the storage.

Open the address, tap **I'm the admin**, enter `ADMIN_PIN`, add your family.

## Run it on your own computer

Needs [Node.js](https://nodejs.org) (v18+).

```
npm install
node server.js        # or double-click start.bat on Windows
```

It prints the address and the admin PIN. Data is saved in the `data/` folder (copy it to back up).

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_PIN` | random (local) / required (Vercel) | The admin's PIN |
| `ACCESS_KEY` | required on Vercel | Secret used to sign logins |
| `CURRENCY` | `₹` | Symbol shown before amounts |
| `LOCALE` | `en-IN` | Number formatting (`en-US`, `en-GB`, ...) |
| `PORT` | `3000` | Local server port |
| `DATA_DIR` | `./data` | Local data folder |

## Notes

- Family PINs are stored hashed (scrypt), never as plain text.
- "Remove" hides an expense (the record and photo stay in storage). A family member who has expenses can only be switched off; a person with none can be deleted.
- Budgets are per calendar month.

## Files

```
api/index.js         Vercel entry point (vercel.json rewrites /api/* and /photos/* here)
lib/app.js           login, members, budgets, expenses (shared)
lib/store-blob.js    storage on Vercel Blob
lib/store-fs.js      storage in a local folder
server.js            local server
public/index.html    sign in + family pages (member.js)
public/ration.js     the ration list page and grocery catalog (shared by both apps)
public/admin.html    admin dashboard (admin.js)
vercel.json          Vercel routing
```
