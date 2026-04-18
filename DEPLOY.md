# Crypto Swarm Command — Next.js Deployment Guide

## Why Next.js?
The Claude.ai artifact sandbox blocks outbound API calls to Anthropic.
Next.js runs the 7-agent swarm on the server (Vercel), so calls work correctly.
The forward outcomes cron also runs automatically on Vercel every 5 minutes.

---

## Prerequisites
- Node.js 18+ installed
- Vercel account (free tier works)
- Anthropic API key
- Supabase project (already set up)

---

## Step 1 — Get your Anthropic API key
1. Go to console.anthropic.com
2. Settings → API Keys → Create Key
3. Copy it — you'll need it in Step 3

---

## Step 2 — Install dependencies
```bash
cd crypto-swarm-command
npm install
```

---

## Step 3 — Set environment variables
Copy the example file:
```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in:
```
ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
NEXT_PUBLIC_SUPABASE_URL=https://iebvusteqgwotdkofvqe.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
CRON_SECRET=any-random-string-you-choose
```

**Where to find Supabase keys:**
supabase.com → your project → Settings → API
- Project URL ✓ (already in the file)
- anon/public key → NEXT_PUBLIC_SUPABASE_ANON_KEY
- service_role key → SUPABASE_SERVICE_ROLE_KEY

---

## Step 4 — Run locally to test
```bash
npm run dev
```
Open http://localhost:3000
Click "Deploy 7 Agents" on BTC — watch the system log.
You should see: ✓ Saved to Supabase · ID: ...

---

## Step 5 — Deploy to Vercel
```bash
npm install -g vercel
vercel
```

Follow the prompts:
- Link to existing project? No → create new
- Project name: crypto-swarm-command
- Framework: Next.js (auto-detected)
- Root directory: ./

Then add environment variables in Vercel dashboard:
vercel.com → your project → Settings → Environment Variables
Add all 5 variables from your .env.local

---

## Step 6 — Verify cron is running
After deployment:
1. Go to Vercel dashboard → your project → Cron Jobs
2. You should see `/api/forward-outcomes` scheduled every 5 minutes
3. This fills in +1h/+4h/+24h prices automatically

---

## Step 7 — Update Supabase CRON_SECRET
The cron job sends `Authorization: Bearer YOUR_CRON_SECRET`
to the `/api/forward-outcomes` endpoint.
Make sure CRON_SECRET in Vercel matches what you set locally.

---

## Architecture
```
Browser (React)
  ↓ POST /api/swarm
Next.js API Route (server-side)
  ↓ Parallel calls
Anthropic API (7 agents + Chief Strategist)
  ↓ SSE stream back to browser
  ↓ Writes to Supabase
Browser receives results in real-time

Vercel Cron (every 5 min)
  ↓ GET /api/forward-outcomes
  ↓ Fetch current prices from CoinGecko
  ↓ Update forward_outcomes table
```

---

## Supabase migrations reminder
Make sure all migrations are run in order:
1. 001_initial_schema.sql
2. 002_analytics_views.sql
3. 003_rls_and_functions.sql
4. Migration 004 (idempotency — in Config panel)
5. Migration 005 (forward outcome guard — in Config panel)
6. Admin cleanup sequence (in Diagnostics → Legacy Hygiene)
