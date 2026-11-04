# HomeOps MVP

HomeOps is a two-sided technician marketplace pilot connecting local customers with verified technicians for home services (Plumbing, Electrical, AC repair) using Telegram Bot for conversational interactions, a Cloudflare Worker webhook backend, Supabase PostgreSQL, and a React Operator Dashboard on Cloudflare Pages.

## Monorepo Layout

- **`supabase/`**: PostgreSQL migrations, Row-Level Security (RLS) policies, atomic assignment stored procedures, and catalog seed data.
- **`worker/`**: Cloudflare Worker TypeScript codebase implementing the Telegram webhook, state machines, Haversine distance calculator, ranked batch matching engine, and notification dispatcher.
- **`dashboard/`**: React + Vite + Tailwind CSS Operator Dashboard with 6 operational screens for verification, active request management, monitoring, complaints, and marketplace configurations.

## Architecture Highlights

1. **Zero Marginal Infrastructure Cost**: Telegram Bot API + Cloudflare Worker + Supabase Free Tier + Cloudflare Pages.
2. **Three-Tier Location Privacy**:
   - *Matching Level*: Backend calculates straight-line distance via Haversine.
   - *Offer Level*: General locality & approximate distance shown to candidates.
   - *Assignment Level*: Exact coordinates & contact details revealed ONLY to the atomically assigned technician.
3. **Atomic Assignment**: Prevents race conditions and double-assignments when multiple technicians click Accept simultaneously via PostgreSQL transaction locks.
4. **Direct Settlement**: HomeOps coordinates discovery, trust, and records; visiting charges, labor, parts, and payments are settled directly between customer and technician.

## Setup & Local Development

### 1. Supabase Setup
- Create a Supabase project at [supabase.com](https://supabase.com).
- Run SQL migrations in `supabase/migrations/` in numerical order, followed by `supabase/seed.sql`.

### 2. Cloudflare Worker Setup
```bash
cd worker
npm install
cp wrangler.example.toml wrangler.toml # Populate environment variables
npm run dev
```

### 3. Operator Dashboard Setup
```bash
cd dashboard
npm install
npm run dev
```
