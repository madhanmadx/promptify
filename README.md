# PROMPTIFY

**AI Image Generation Challenge — submission, verification & judging system.**

A dedicated event portal (not a Google Form) where participants scan a QR code, upload their AI
artwork, submit the *exact prompt* behind it, and receive a submission ID such as
`PF-2026-001`. Organizers verify entries, judges score them blindly against a 100-point rubric,
and a leaderboard can be revealed at the award ceremony.

```
Scan QR  →  Participant details  →  Upload artwork  →  Original prompt  →  Preview & confirm
   →  PF-2026-001  →  Organizer verification  →  Judge dashboard  →  Scoring /100  →  🏆 Leaderboard
```

---

## Quick start

```bash
npm install
npm start
```

Then open:

| Who | URL |
| --- | --- |
| Participants | http://localhost:3000/ |
| Organizer | http://localhost:3000/#/admin |
| Judge | http://localhost:3000/#/judge |
| Leaderboard | http://localhost:3000/#/leaderboard |
| QR station board | http://localhost:3000/#/qr |

**No MongoDB install needed.** If `MONGODB_URI` is not set, the server boots a local MongoDB that
downloads on first run and persists its files in `./data`. Set `MONGODB_URI` to an Atlas cluster
when you deploy.

### Accounts (created automatically on first run)

| Role | Username | Password |
| --- | --- | --- |
| Organizer | `admin` | `promptify2026` |
| Judge | `judge1` / `judge2` / `judge3` | `judge2026` |

Change them with `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` **before** the first start.

### Optional scripts

```bash
npm run seed    # load 12 sample entries + judge scores (rehearsals, screenshots)
npm run reset   # wipe submissions & scores, keep accounts
npm run dev     # start with auto-restart on file changes
```

You can also load demo data from the dashboard — **Judges →** or via the API:
`POST /api/admin/demo-data { "wipe": true }` (organizer token required).

---

## Configuration

Copy `.env.example` to `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | *(auto)* | Base URL encoded into the QR code — set this for the real venue |
| `MONGODB_URI` | *(empty)* | Empty = local in-memory MongoDB with `./data` persistence |
| `DB_PATH` | `./data` | Where the fallback MongoDB stores files |
| `JWT_SECRET` | dev value | Token signing secret — **change in production** |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `promptify2026` | Seeded organizer account |
| `LOGIN_HINTS` | `false` | Print demo logins on the login screens — keep off for the live event |
| `EVENT_YEAR` | `2026` | Used for IDs: `PF-2026-001` |
| `CHALLENGE_MINUTES` | `30` | Minutes between pressing *Start* and finishing the upload |
| `CHALLENGE_GRACE_MINUTES` | `2` | Extra minutes granted only for the upload itself |

---

## Access levels

| | Participant | Organizer | Judge |
| --- | --- | --- | --- |
| Create submission | ✅ (once) | — | — |
| View own status | ✅ (ID + device token) | ✅ | — |
| See other submissions | gallery of published entries | ✅ | anonymised only |
| Verify / reject / flag | ❌ | ✅ | ❌ |
| See names & colleges | own only | ✅ | ❌ |
| Score entries | ❌ | — | ✅ |
| Other judges' scores | ❌ | ✅ | after submitting own score |
| Manage accounts / settings | ❌ | ✅ | ❌ |

Participants never log in. Their `checkToken` is stored on their device when they submit, which is
what unlocks full details on the *Check status* page.

### Keeping the dashboards out of sight

The header and footer contain **no link** to `#/admin` or `#/judge` — ordinary participants have
nothing to click, and the QR board, rules and success pages never reference them. The routes still
exist so staff can bookmark them:

| Area | URL | Gate |
| --- | --- | --- |
| Organizer | `/#/admin` | login, `role=admin` |
| Judge | `/#/judge` | login, `role=judge` |

Enforced in two places, not just one:

* **Client** — `ensureAuth()` renders a login card instead of the dashboard when the stored token
  is missing, expired, or the wrong role.
* **Server** — every `/api/admin/*` request goes through `requireRole('admin')`, which answers
  `401` with no token and `403` for a judge token. The dashboard cannot load a single row of data
  without an organizer token, so nothing leaks even if someone reaches the URL.

Login screens do **not** print demo credentials unless you set `LOGIN_HINTS=true`, so a live event
never advertises its own password.

---

## The 30-minute challenge clock

The submission page opens on a gate — **Start my 30 minutes**. Pressing it opens a session for this
device on the server, and from then on a countdown is pinned to the screen through all four steps.

| Moment | What happens |
| --- | --- |
| Press **Start** | `POST /api/timer/start` stores `startedAt` / `expiresAt` for this device; the chip starts counting |
| Mid-flow | The chip turns amber at 5 minutes, red and blinking at 60 seconds |
| Upload | `POST /api/submissions` answers `403` when the deadline (plus `CHALLENGE_GRACE_MINUTES`) has passed |
| Success | The session is deleted and the receipt replaces the clock |
| Expired | The submit button locks and offers **Start new 30 minutes** — the draft is kept |

The deadline lives in the database, not in the browser: refreshing, closing the tab or clearing
storage buys no extra time, and pressing *Start* again while a session is still running hands back
the **remaining** time rather than resetting it. The client only counts its own elapsed time from
the value the server sent, so a wrong device clock does not help either.

Change the length for the whole event with `CHALLENGE_MINUTES` (default `30`).

### What the organizer sees

Two places on the **organizer dashboard** read the same clock:

| Where | Shows |
| --- | --- |
| **⏱ Challenge sessions** panel (under the stat tiles) | one row per device — *Started*, *Ends in*, a **live** *Time left* (amber at 5 min, red at 60 s) and running/expired status; it refreshes every 20 s and prunes clocks that expired over an hour ago |
| **Entry detail panel** | `⏱ Challenge — Started 14:02 → submitted 14:25 · used 23/30 min within the window` |
| **Table** | `⏱ 23m` next to each title — how long that entry took |
| **CSV / ZIP dossier** | `Clock Started`, `Challenge Deadline`, `Window (min)`, `Time Used (min)` columns and `Clock started` / `Clock ends` / `Time used` lines |

The window is stamped onto the submission itself when it is created, so the record survives the
session disappearing: `challengeStartedAt`, `challengeEndsAt`, `challengeMinutes`. Entries made
outside the timed flow (demo data, imports) say *Not recorded*.

---

## Unlimited submissions

A participant may submit as many times as they like. Each `POST /api/submissions` mints a **new**
`PF-YYYY-NNN` id from the shared counter and writes a **new document** — nothing is matched,
merged or overwritten against an earlier entry, so the same name, email or device can appear
several times, each with its own image, timestamp and status.

The server-side 409 conflict check (same person / same email / same device / same team member)
and the *One entry per participant* card on the submit page were both removed. Reaching the form
is now unconditional: `#/submit` always renders the four steps, and the receipt's
**Submit another entry** button wipes the local form, file preview and draft, then opens a fresh
30-minute window so the next submission starts on a blank page.

Local storage is used only for the in-progress draft and the device id — it never holds a
submission. Everything submitted goes to the API and the database, which is what the organizer
dashboard reads.

---

## Artwork gallery

`#/gallery` lets participants see what everyone else created. The endpoint returns only entries
the organizer has released (`verified`, `judging_completed`, `finalist`); submitted,
under-verification and rejected entries stay private. Participant names appear only while
**Settings → Show participant names** is on — otherwise each card shows the submission ID alone,
matching the leaderboard.

Prompts and concepts are **not** exposed on the gallery. They stay with the organizer, the judges,
and the participant who wrote them.

---

## Status pipeline

`submitted` → `verifying` → `verified` → `judging_completed` → `finalist`
(`rejected` can be set at the verification stage)

Judging automatically advances an entry to *Judging Completed* once the required number of judges
(configurable in **Settings**) has submitted scores.

---

## Scoring rubric (100 points)

| Category | Max |
| --- | ---: |
| Creativity | 25 |
| Prompt Quality | 20 |
| Originality | 20 |
| Visual Quality | 15 |
| Theme Relevance | 10 |
| AI Utilization | 10 |

---

## Deploying (so anyone can scan the QR)

Running on a laptop means the QR encodes a **private** address
(`http://10.x.x.x:3000`) — only phones on that same Wi‑Fi/hotspot can open it;
everyone else gets *"site can't be reached"*. For the event, give it a public URL.

### Render (free · blueprint included)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads `render.yaml`.
3. Fill the two values marked `sync: false`:
   - `MONGODB_URI` — your Atlas string **with a database name** (`…/promptify`)
   - `ADMIN_PASSWORD` — the organizer password
4. After the first deploy, set `PUBLIC_URL` to the real service URL
   (Settings → Environment) and redeploy — that is exactly what the QR encodes.
5. Open `https://your-app.onrender.com/#/qr` and confirm the link printed
   *under* the code before you print the board.

Health check endpoint: `GET /api/health`.

### Anywhere else

`npm ci && npm start` with the variables from `.env.example` set. Node ≥ 18.11.

| Must set | Why |
| --- | --- |
| `PUBLIC_URL` | the QR encodes it — leave blank only behind a proxy |
| `MONGODB_URI` with a database name (`/promptify`) | never land in another app's database |
| `JWT_SECRET` | the dev value is public on GitHub |
| `LOGIN_HINTS=false` | never print a password on a public site |

> The 30-minute clock and the one-entry rule are enforced **server-side**, so a
> public deployment behaves exactly like the local one.

---

## Project structure

```
promptify/
├─ server/
│  ├─ index.js            Express app, static hosting, error handling
│  ├─ config.js           Event settings, rubric, statuses, departments, AI tools
│  ├─ db.js               Atlas connection or local MongoDB fallback
│  ├─ safeRouter.js       Router that catches async handler errors
│  ├─ seed.js             Account seeding + demo dataset (also a CLI)
│  ├─ middleware/auth.js  JWT sign/verify, role guard
│  ├─ models/             Submission, Score, User, Setting, Counter
│  └─ routes/             auth · submissions · admin · judge · public
├─ public/                Single-page frontend (no build step)
│  ├─ index.html          App shell
│  ├─ css/styles.css      Design system (mobile-first)
│  └─ js/
│     ├─ api.js           Fetch client + token/draft storage
│     ├─ ui.js            Escaping, toasts, modals, receipt image
│     ├─ app.js           Hash router
│     └─ views/           landing · submit · check · rules · leaderboard · qr · admin · judge
└─ package.json
```

---

## API overview

```
GET    /api/meta                          departments, AI tools, rubric, feature flags
POST   /api/timer/start                    open a challenge window { deviceToken }
GET    /api/timer/status?device=           remaining time for this device
POST   /api/submissions                   multipart upload → submission ID + check token
                                          (403 outside the window, 409 if already entered)
GET    /api/submissions/check/:id?token=  public status, full detail with token
GET    /api/artwork/:id                   the image itself
GET    /api/gallery?page=&limit=          published artworks for the participant gallery
GET    /api/leaderboard                   revealed standings (admin can preview)
GET    /api/qr?path=/#/submit             PNG QR code for the venue board

POST   /api/auth/login                    { username, password } → JWT
GET    /api/auth/me

GET    /api/admin/stats                   dashboard tiles (+ active challenge sessions)
GET    /api/admin/timer-sessions          live clocks: started / ends / time left per device
GET    /api/admin/submissions?status&q&page
GET    /api/admin/submissions/:id         detail + judge scores
PATCH  /api/admin/submissions/:id/status  verify / reject / reset (+ notes)
PATCH  /api/admin/submissions/:id/flags   prompt-authenticity flags
PATCH  /api/admin/submissions/:id/finalist
GET    /api/admin/export                  CSV of every entry (accepts ?status&q)
GET    /api/admin/export/archive          ZIP: artwork + details.txt/json per entry
                                          (?ids=…, or ?status&q to match the table)
GET/PUT /api/admin/settings               submissions open, leaderboard reveal, judges required
GET/POST/PATCH /api/admin/judges          judge account management
POST   /api/admin/demo-data               load rehearsal data

GET    /api/judge/queue                   anonymised entries to score
GET    /api/judge/queue/:id               one entry + my score + others (after I submit)
POST   /api/judge/scores                  submit / update my score
GET    /api/judge/scores/mine             everything I have scored
```

---

## Downloading artwork, prompts and details

Two export buttons sit in the top bar of the organizer dashboard:

| Button | What you get |
| --- | --- |
| **⬇ Export CSV** | One spreadsheet row per entry — IDs, names, colleges, prompts, scores. |
| **⬇ Images + details** | A ZIP with every entry as its own folder. |

Each folder in the ZIP looks like this:

```
index.csv                                   whole event as a spreadsheet
PF-2026-047 - Neon Bazaar/
  artwork.jpg                                the original uploaded image
  details.txt                                printable dossier: participant,
                                              college, title, AI tool, the full
                                              prompt, concept, organizer notes,
                                              flags and every judge score + comment
  details.json                               the same record, machine-readable
```

The ZIP follows whatever the table is showing — pick a status chip or type in the search box first
and **⬇ Images + details** exports only that set. From an open entry, **⬇ Download entry** in the
panel footer downloads just that one entry's folder. Both need an organizer login; the endpoint
refuses anything else.

---

## Event-day checklist

1. Set `PUBLIC_URL` to the venue URL and restart, then print the **QR board** (`#/qr`, A3 or larger).
2. Confirm **Settings → Accept new submissions** is on.
3. After the deadline: turn submissions off, go through the queue, and **verify** good entries.
4. Use the **Prompt authenticity check** on each entry — compare the artwork against the pasted
   prompt and the AI tool, and flag anything that does not match.
5. Give judges their logins; they only ever see artwork, prompt and concept.
6. When every entry has the required number of scores, review totals and **promote finalists**.
7. **Settings → Reveal the leaderboard** (turn on *Show participant names* for the announcement),
   then project `#/leaderboard`.
8. **Export CSV** for your records, and **⬇ Images + details** for the archive — every artwork with
   its prompt, concept and judge scores, one folder per entry.

---

## Notes on the artwork storage

Images are stored inline as MongoDB binaries (capped at 10 MB, JPG/PNG only) and streamed back by
`/api/artwork/:id`, so the app needs no object-storage bucket. For a very large event, swap the
Buffer for GridFS or S3 without touching the frontend — only `POST /api/submissions` and
`GET /api/artwork/:id` would change.
