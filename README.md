# 💜 MoodSync

> A private relationship mood-tracking web app that helps couples stay emotionally in sync through daily check-ins, partner pairing, and real-time relationship health insights.

---

## 1. Product Requirements Document (PRD)

### 1.1 Overview

MoodSync is a two-person emotional wellness app designed for couples. Each user logs their daily mood on a 1–9 scale. The app pairs two users together, stores their entries, and surfaces shared insights — including a **Relationship Health Score** — to help partners understand and support each other's emotional states over time.

### 1.2 Goals

- Give couples a lightweight daily ritual to check in emotionally
- Surface data-driven relationship insights without requiring manual reflection
- Feel private, intimate, and visually distinctive compared to generic wellness apps

### 1.3 Target Users

- Couples in long-distance or busy daily-life relationships
- Partners who want a low-friction emotional check-in habit
- Users comfortable with simple web apps (no native app required)

### 1.4 Core Features

| Feature | Description |
|---|---|
| **Account creation** | Email + password signup with name; DB trigger auto-creates profile |
| **Secure login** | Email/password auth via Supabase Auth with session persistence |
| **Forgot password** | Email-based password reset link via Supabase Auth |
| **Partner pairing** | Each user gets a unique 8-char `pair_code`; User A enters User B's code to send a request; User B accepts/rejects |
| **Mood logging** | 5-option picker (Very Bad → Great) mapped to a 1–9 score with optional text note; one entry per day |
| **Mood history** | Paginated view of all mood entries for both partners; filter by user; delete own entries |
| **Relationship dashboard** | Displays health score, mood trend, partner mood, alignment percentage, and logging consistency |
| **Partner chat** | Real-time iMessage-style messaging with delivery/seen indicators, soft-delete, and tap-to-retry |
| **Settings & dissolution** | View relationship info; initiate dissolution with 15-day grace period; cancel dissolution |
| **Real-time updates** | Dashboard, pair page, and chat update instantly via Supabase Realtime subscriptions |
| **Logout** | Available on all protected pages

### 1.5 User Flow

```
Sign Up → (DB trigger creates profile) → Pair with partner
  → Enter partner's pair_code → Send request
  → Partner accepts → Couple created
  → Both users log daily moods
  → Dashboard shows shared insights + health score
  → Chat with partner in real-time
  → View full mood history (filterable by user)
  → Settings: view relationship info or initiate dissolution
```

### 1.6 Security Requirements

- Row Level Security (RLS) enabled on all Supabase tables
- Users can only read/write their own data
- Partners can read each other's mood logs only after a confirmed couple row exists
- `service_role` key never used in frontend code
- Password reset via server-side email link only — no client-side token exposure
- Input validated client-side before any Supabase call (email format, password length, confirm match)

### 1.7 Out of Scope (current version)

- Mobile native apps (iOS / Android)
- Push notifications
- Multiple partners or group moods
- Social sharing

---

## 2. Tech Stack

### Frontend

| Layer | Technology |
|---|---|
| Markup | Vanilla HTML5 (semantic elements, ARIA attributes) |
| Styling | Vanilla CSS3 — custom design system, no frameworks |
| Scripting | Vanilla JavaScript (ES2020+, `"use strict"`, no bundler) |
| Fonts | Google Fonts — Inter (300–800 weight range) |
| Icons | Emoji — zero external icon libraries |

### Backend

| Layer | Technology |
|---|---|
| Platform | [Supabase](https://supabase.com) (fully managed Postgres + Auth + Realtime) |
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth — email/password + JWT sessions |
| Realtime | Supabase Realtime channels (WebSocket-based row subscriptions) |
| Client SDK | `@supabase/supabase-js` v2 loaded via CDN |

### Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User display name, email, unique `pair_code` |
| `pairing_requests` | Pending / accepted / rejected partner requests |
| `couples` | Confirmed partner pairs (`user1_id`, `user2_id`) + dissolution tracking |
| `mood_logs` | Daily mood entries (`score` 1–9, `note`, `logged_at`, `couple_id`) |
| `messages` | Real-time chat messages between partners (`couple_id` scoped) |
| `dissolution_audit_log` | Audit trail for dissolution events (admin-only access) |

### Infrastructure

| Concern | Approach |
|---|---|
| Hosting | Static files — deployable to Netlify, Vercel, or GitHub Pages |
| Secrets | Supabase `anon` key is safe for client-side use; `service_role` key never in codebase |
| Version control | Git + GitHub (private repo) |
| Environment isolation | `.gitignore` covers `.env` files; no build step required |

---

## 3. How the App Works & Design Style

### 3.1 Application Architecture

MoodSync is a **multi-page application (MPA)** with no build step or bundler. Each HTML page is self-contained and loads a shared set of JavaScript modules in order:

```
supabaseClient.js   → initialises the Supabase client (loaded first, always)
auth.js             → auth API, session guards, login/signup/forgot-password page logic
ui.js               → shared UI helpers (toasts, loading states)
data.js             → centralized data utilities, partner resolution, subscription management
main.js             → global nav behaviour (hamburger menu, scroll effects)
mood.js             → mood logging API + mood.html page logic       (mood pages only)
pairing.js          → pairing API + pair.html page logic            (pair page only)
dashboard.js        → dashboard data loading + rendering            (dashboard only)
algorithm.js        → pure Relationship Health Score calculation     (dashboard only)
chat.js             → real-time partner messaging                   (chat page only)
mood-history.js     → paginated mood history view                   (history page only)
settings.js         → relationship settings + dissolution UI        (settings page only)
```

Each module exposes a pure JS public API (no ES module syntax — compatible with direct `<script>` tags) and handles its own page detection inside `DOMContentLoaded`.

### 3.2 Key Flows

**Sign up**
1. User fills in name, email, password, confirm password
2. `auth.js` validates fields client-side (format, length, match)
3. `supabaseClient.auth.signUp()` creates the auth user
4. A PostgreSQL trigger (`handle_new_user`) fires and inserts a `profiles` row using `raw_user_meta_data.name`
5. If a session is immediately available, `auth.js` also runs an `update` to guarantee name accuracy
6. User is redirected to `pair.html`

**Partner pairing**
1. User sees their own `pair_code` on `pair.html`
2. User enters their partner's code and submits
3. `pairing.js` looks up the profile with that code, checks for existing couples/duplicate requests, then inserts a `pairing_requests` row
4. Partner sees the request in real-time (Supabase Realtime subscription)
5. Partner accepts → a `couples` row is created → both users are now paired

**Mood logging**
1. User selects one of 5 emoji options (mapped to scores 1, 3, 5, 7, 9) and optionally types a note
2. `mood.js` calls `saveMood()` → inserts into `mood_logs`
3. The dashboard auto-refreshes via a Realtime INSERT subscription on `mood_logs`

**Relationship Health Score**
Calculated entirely in `algorithm.js` — a pure function with no side effects:

```
Health Score (0–100) =
  40% × Mood Average      (normalised 0–1 from 1–9 scale)
  25% × Mood Trend        (improving / stable / declining over last 7 days)
  20% × Mood Alignment    (how close both partners' averages are)
  15% × Logging Frequency (consistency over last 14 days)
```

A `confidence` value (0–1) is also returned — the dashboard dims insights when data is sparse.

An alternative **V2 algorithm** is also available:
```
V2 Health Score (0–100) =
  average of (user1Avg + user2Avg + compatibility) / 3
  where compatibility = 100 - |user1Avg - user2Avg|
```

**Partner Chat**
1. User opens `chat.html` — `requireCouple()` ensures both users are paired
2. `chat.js` loads recent messages (last 50) and subscribes to INSERT/UPDATE events
3. Messages are sent optimistically — bubble appears immediately with "Sending…" state
4. On success, bubble updates to "✓ Delivered"; on failure, shows "⚠ Tap to retry"
5. Partner's messages are marked as "seen" (`seen_at` timestamp) when the chat page is open
6. Soft-delete: users can delete their own messages → shows "Message deleted" for both

**Mood History**
1. User opens `mood-history.html` — `requireCouple()` guard
2. `mood-history.js` loads paginated mood entries (50 per page) for both partners
3. Filter tabs: All / Me / Partner — dynamically filter the view
4. Users can delete their own entries with typed confirmation ("delete my data")

**Relationship Dissolution**
1. Either partner can initiate dissolution from `settings.html`
2. User must type "dissolve relationship" to confirm
3. A 15-day grace period begins — either partner can cancel during this time
4. If not cancelled, a cleanup function deletes: `mood_logs`, `messages`, `pairing_requests`, and the `couples` row
5. All deletions are scoped by `couple_id` (never by `user_id`) to prevent accidental data loss
6. Audit log tracks all dissolution events for compliance

### 3.3 Design Style — Liquid Glass

The entire visual system is built around a **Liquid Glass** aesthetic:

- **Frosted glass cards** — `backdrop-filter: blur()` with semi-transparent backgrounds (`rgba(255,255,255,0.06–0.12)`) and hairline `1px` borders at low opacity
- **Animated gradient text** — headings and brand names use `background-clip: text` with a flowing `@keyframes gradientFlow` animation cycling through lavender → pink → teal
- **Ambient background orbs** — 4 absolutely-positioned blurred blobs (`border-radius: 50%; filter: blur(80–120px)`) drift slowly via `@keyframes orbDrift`, giving pages depth without images
- **Micro-interactions** — inputs show a coloured focus ring + animated caret; buttons have glass specular highlights via `::before` pseudo-elements; all transitions use a custom cubic-bezier `--ease-smooth`
- **Custom animated caret** — all text inputs use `@keyframes caretColorCycle` (red → green → pink → blue → yellow loop at ~1s per colour) with a synced `caretGlow` box-shadow bloom
- **Colour tokens** — defined as CSS custom properties on `:root`: `--clr-lavender`, `--clr-pink`, `--clr-teal`, `--clr-mint`, `--clr-rose`, `--clr-purple` with a dark base (`#0d0d12`)
- **Typography** — Inter at weights 300–800; headings use negative letter-spacing (`-0.03em`); secondary text uses `var(--clr-text-secondary)` at reduced opacity
- **Responsive** — fluid type with `clamp()`, mobile breakpoints at 640px, container max-width 1200px with horizontal padding

### 3.4 File Structure

```
/
├── index.html              Landing page
├── create-account.html     Sign up
├── login.html              Sign in
├── forgot-password.html    Password reset
├── pair.html               Partner pairing
├── mood.html               Daily mood logger
├── mood-history.html       Full mood history (paginated)
├── dashboard.html          Relationship insights
├── chat.html               Partner-to-partner messaging
├── settings.html           Relationship settings + dissolution
│
├── supabase-schema.sql     Core DB schema + RLS policies + triggers
├── supabase-rls-fixes.sql  RLS policy updates and fixes
├── supabase-dissolution.sql  Dissolution system migration
│
├── css/
│   ├── style.css           Global design system (tokens, glass, animations)
│   ├── create-account.css  Signup page styles
│   ├── login.css           Login / forgot-password styles
│   ├── setup.css           Pair page + setup form styles
│   ├── dashboard.css       Dashboard card styles
│   ├── mood.css            Mood picker styles
│   ├── mood-history.css    Mood history page styles
│   ├── chat.css            Chat interface styles
│   └── settings.css        Settings page styles
│
└── js/
    ├── supabaseClient.js   Supabase client init
    ├── auth.js             Auth API + page logic (login, signup, forgot pw)
    ├── ui.js               Shared UI helpers (toasts, loading states)
    ├── data.js             Centralized data utilities + subscription management
    ├── main.js             Global nav / scroll behaviour
    ├── pairing.js          Pairing API + pair.html logic
    ├── mood.js             Mood API + mood.html logic
    ├── mood-history.js     Mood history page logic (pagination, filters)
    ├── dashboard.js        Dashboard data + render
    ├── algorithm.js        Relationship Health Score (pure functions V1 + V2)
    ├── chat.js             Real-time chat (iMessage-style UI)
    └── settings.js         Settings page + dissolution UI
```

---

## 4. Module Public APIs

### 4.1 data.js — Centralized Data Utilities

```javascript
// Session management
getCurrentUser()              → user | null
requireValidSession()         → user | null (redirects if not authenticated)

// Partner & couple resolution
getPartnerData()              → { partnerId, partnerName } | null
getCoupleData()               → { user, couple, partnerId, myName, partnerName } | null

// Mood logs
getMoodLogs(userIds, opts)    → array of { id, date, userId, score, note, loggedAt }
getCoupleMoodLogs(couple, days) → array (fetches for both partners)

// Subscription management
subscribeWithCleanup(name, config, callback) → channel
unsubscribeAll()              → void
unsubscribeChannel(name)      → void

// Dissolution
initiateDissolve()            → { coupleId, scheduledFor, daysRemaining }
cancelDissolve()              → couple record
getDissolveStatus()           → { isPending, scheduledFor, initiatedBy, daysRemaining }

// Graph utilities
normalizeGraphData(logs, userId) → [{ date, score }]
generateTimeline(logs, days)     → [{ date, displayDate, score, hasData }]
prepareTimelineGraph(...)        → { datasets, labels } (Chart.js ready)
```

### 4.2 algorithm.js — Health Score Calculation

```javascript
// V1 Algorithm (weighted average)
calculateHealthScore(userLogs, partnerLogs)
  → { healthScore, trend, confidence, average, partnerAverage, moodDiff }

// V2 Algorithm (simpler average)
calculateHealthScoreV2(userLogs, partnerLogs)
  → { healthScore, user1Avg, user2Avg, compatibility }
```

### 4.3 chat.js — Chat Features

- **iMessage-style bubbles** with delivery states (Sending → ✓ Delivered → ✓✓ Seen)
- **Tap-to-retry** for failed messages
- **Soft-delete** — messages show "Message deleted" instead of being removed
- **Pagination** — "Load older messages" button for history
- **Date separators** — automatic grouping by day
- **Realtime** — INSERT and UPDATE subscriptions for instant updates

---

## 5. Database Schema Details

### 5.1 Couples Table (with dissolution)

```sql
couples (
    id                        uuid PRIMARY KEY,
    user1_id                  uuid REFERENCES profiles(id),
    user2_id                  uuid REFERENCES profiles(id),
    created_at                timestamptz,
    dissolution_initiated_at  timestamptz,  -- when dissolution started
    dissolution_initiated_by  uuid,          -- who initiated
    dissolution_scheduled_for timestamptz,  -- grace period end date
    dissolution_cancelled_at  timestamptz   -- if cancelled
)
```

### 5.2 Messages Table

```sql
messages (
    id           uuid PRIMARY KEY,
    sender_id    uuid REFERENCES auth.users,
    receiver_id  uuid REFERENCES auth.users,
    couple_id    uuid REFERENCES couples(id),  -- relationship-scoped
    message      text NOT NULL,
    created_at   timestamptz,
    delivered_at timestamptz,
    seen_at      timestamptz,
    is_deleted   boolean DEFAULT false
)
```

### 5.3 Dissolution Audit Log

```sql
dissolution_audit_log (
    id                 uuid PRIMARY KEY,
    couple_id          uuid,
    user1_id           uuid,
    user2_id           uuid,
    event_type         text,  -- 'initiated' | 'cancelled' | 'completed'
    initiated_by       uuid,
    mood_logs_deleted  integer,
    messages_deleted   integer,
    created_at         timestamptz
)
```

---

## 6. Security & RLS Policies

All tables use Row Level Security:

| Table | Policy |
|---|---|
| `profiles` | View own + partner (via couples join) |
| `couples` | View/create only if participant |
| `mood_logs` | View own + partner's from current relationship |
| `messages` | View only from current active relationship |
| `pairing_requests` | View if sender or receiver |
| `dissolution_audit_log` | No public access (service_role only) |

Key security principles:
- `service_role` key never used in frontend
- Dissolution deletes by `couple_id`, never by `user_id`
- Input validated client-side before Supabase calls
- XSS prevention via `textContent` assignment (no `innerHTML` with user data)
