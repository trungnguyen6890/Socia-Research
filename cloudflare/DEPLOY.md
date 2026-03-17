# Deploy to Cloudflare

## Prerequisites

```bash
npm install -g wrangler
wrangler login
```

---

## Step 1 — Create D1 database

```bash
cd cloudflare
wrangler d1 create socia-research
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "socia-research"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # <-- paste here
```

---

## Step 2 — Create KV namespace (rate limiter)

```bash
wrangler kv:namespace create RATE_KV
```

Copy the `id` and paste into `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "RATE_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"   # <-- paste here
```

---

## Step 3 — Run database migrations

```bash
# Apply to production D1
npm run db:migrate

# Apply to local D1 (for dev)
npm run db:migrate:local
```

---

## Step 4 — Set secrets

```bash
wrangler secret put ADMIN_PASSWORD       # Admin UI password
wrangler secret put YOUTUBE_API_KEY      # YouTube Data API v3
wrangler secret put X_BEARER_TOKEN       # Twitter/X API v2 Bearer Token
wrangler secret put TELEGRAM_BOT_TOKEN   # Telegram Bot API token
wrangler secret put FB_ACCESS_TOKEN      # Facebook Graph API token
wrangler secret put IG_ACCESS_TOKEN      # Instagram Graph API token
```

You only need to set the secrets for connectors you actually use.

---

## Step 5 — Deploy

```bash
npm run deploy
```

Your Worker will be live at:
- `https://socia-research.<your-subdomain>.workers.dev/admin/`

---

## Step 6 — Local development

```bash
npm run dev
```

Open `http://localhost:8787/admin/` — uses a local D1 database.

---

## Cloudflare Dashboard settings

After deploying, go to **Workers & Pages → socia-research → Settings**:

1. **Triggers → Cron Triggers**: verify `*/30 * * * *` is registered
2. **Usage Model**: set to **Unbound** (recommended for cron jobs making many external API calls)

---

## Cron trigger schedule

The cron `*/30 * * * *` runs all active sources every 30 minutes.

To change the global schedule, edit `wrangler.toml`:
```toml
[triggers]
crons = ["*/30 * * * *"]   # every 30 minutes
# crons = ["0 * * * *"]    # every hour
# crons = ["0 */6 * * *"]  # every 6 hours
```

Per-source schedules in the admin UI (`/admin/schedules`) are stored in D1 but the
cron trigger fires all sources. You can use the cron_expression field to filter
sources client-side if you need finer control.

---

## Connector notes

| Connector | Requirement |
|-----------|-------------|
| RSS / Website | No API key needed |
| YouTube | YouTube Data API v3 key (Google Cloud Console) |
| X / Twitter | Bearer Token from Twitter Developer Portal (Free tier: 10 tweets/15min) |
| Telegram | Create a bot via @BotFather, add bot as admin to channel |
| Facebook Page | Page Access Token with `pages_read_engagement` permission |
| Instagram Pro | Instagram Graph API (requires Facebook Business account) |
| TikTok / Threads / FB Profile | Watch-only — enter manually in admin UI |

---

## Architecture on Cloudflare

```
Browser → Cloudflare Worker (Hono) → D1 (SQLite)
                   ↑
            Cron Trigger (*/30 * * * *)
                   ↓
         For each active source:
           Connector fetch (external APIs)
           → Normalize → Dedupe (D1 lookup)
           → Tag (keyword matching)
           → Score (quality + signal)
           → Insert to D1
```

All state lives in D1. No servers to manage.
