# Socia Research — Admin Guide

**Live URL:** `https://socia-research.trungnguyen6890.workers.dev`
**Admin UI:** `/admin/` — password được set qua `wrangler secret put ADMIN_PASSWORD`

---

## Mục lục

1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [Dashboard](#2-dashboard)
3. [Sources — Quản lý nguồn dữ liệu](#3-sources)
4. [Keywords — Từ khóa gắn tag](#4-keywords)
5. [Goals — Mục tiêu nghiên cứu](#5-goals)
6. [Content — Xem kết quả](#6-content)
7. [Schedules](#7-schedules)
8. [Config JSON tham chiếu nhanh](#8-config-json-tham-chiếu-nhanh)
9. [Cách scoring hoạt động](#9-cách-scoring-hoạt-động)
10. [Pending / Chưa hoàn thiện](#10-pending--chưa-hoàn-thiện)

---

## 1. Kiến trúc tổng quan

```
Cron trigger (*/30 phút)
       ↓
  Mỗi source active:
    Connector.fetch()  ← gọi API/scrape web
         ↓
    Normalize          ← chuẩn hoá trường, tính hash
         ↓
    Lookback filter    ← lọc bài quá cũ (nếu set lookback_days)
         ↓
    Dedupe             ← so sánh URL + hash với DB
         ↓
    Tag                ← khớp Keywords → gắn category tags
         ↓
    Score              ← tính quality_score + signal_score
         ↓
    Insert D1          ← lưu vào database
```

**Infrastructure:**
- Worker: Cloudflare Workers (serverless, edge)
- Database: Cloudflare D1 (SQLite)
- Rate limiter state: Cloudflare KV
- Cron: `*/30 * * * *` — chạy tất cả sources mỗi 30 phút

---

## 2. Dashboard

`/admin/` hiển thị:

| Thẻ | Ý nghĩa |
|-----|---------|
| **Total Items** | Tổng content items đã collect |
| **Items (24h)** | Items được fetch trong 24 giờ qua |
| **Active Sources** | Số sources đang active / tổng |

**Recent Runs** — bảng 15 lần chạy gần nhất, mỗi dòng gồm:
- Source name, Status (success/error), số items fetched, thời gian chạy, thông báo lỗi nếu có

---

## 3. Sources

`/admin/sources` — quản lý toàn bộ nguồn dữ liệu.

### Tạo source mới

Click **+ Add Source**, điền:

| Field | Mô tả |
|-------|-------|
| **Name** | Tên hiển thị (ví dụ: "VnExpress Tech") |
| **Connector Type** | Loại connector (xem bảng dưới) |
| **Source Mode** | `rss`, `website_parse`, `official_api`, `manual_watch`, `provider_api` |
| **URL or Handle** | URL, Channel ID, Page ID, hoặc username tuỳ connector |
| **Config (JSON)** | Cấu hình thêm (xem mục 8) |
| **Tags** | Nhãn phân loại source (comma-separated, ví dụ: `tech, vietnam`) |
| **Priority** | 1 = cao nhất, 10 = thấp nhất |

### Connector types

| Connector | URL/Handle | API Key cần | Ghi chú |
|-----------|-----------|-------------|---------|
| `rss` | RSS feed URL | Không | Hỗ trợ RSS 2.0 và Atom |
| `website` | Trang web URL | Không | Scrape HTML bằng CSS selector |
| `youtube` | Channel ID (UCxxxx) | `YOUTUBE_API_KEY` | Lấy videos mới nhất |
| `x_twitter` | User ID (số) | `X_BEARER_TOKEN` | Free tier: 10 tweets/15 phút |
| `telegram` | @channelname | `TELEGRAM_BOT_TOKEN` | Bot phải là admin của channel |
| `facebook_page` | Page ID | `FB_ACCESS_TOKEN` | Cần permission `pages_read_engagement` |
| `instagram_pro` | IG Business Account ID | `IG_ACCESS_TOKEN` | Cần Facebook Business account |
| `facebook_profile_watch` | Profile URL | Không | **Watch-only** — nhập thủ công |
| `tiktok_watch` | @username hoặc URL | Không | **Watch-only** — nhập thủ công |
| `threads_watch` | @username | Không | **Watch-only** — nhập thủ công |

> **Watch-only** connectors không tự động fetch được. Chỉ dùng để lưu link theo dõi thủ công.

### Actions

- **Edit** — sửa cấu hình source
- **▶ Run** — chạy ngay lập tức (không chờ cron)
- **Disable/Enable** — bật/tắt source
- **Del** — xoá source và toàn bộ lịch sử run

---

## 4. Keywords

`/admin/keywords` — từ khóa dùng để gắn tag tự động cho content.

### Cách hoạt động

Khi pipeline chạy, mỗi item được so khớp với tất cả active keywords. Nếu match → item được gắn tag = **category** của keyword đó.

### Tạo keyword

| Field | Mô tả |
|-------|-------|
| **Keyword** | Từ/cụm từ/regex cần tìm |
| **Category** | Nhãn gắn vào item khi match (ví dụ: `ai`, `startup`, `competitor`) |
| **Match Mode** | `contains` (mặc định), `exact`, `regex` |

### Ví dụ thực tế

| Keyword | Category | Match Mode | Kết quả |
|---------|----------|------------|---------|
| `ChatGPT` | `ai` | `contains` | Gắn tag `ai` nếu title/text chứa "chatgpt" |
| `startup` | `startup` | `contains` | Gắn tag `startup` |
| `\b(OpenAI\|Anthropic\|Google)\b` | `big-tech` | `regex` | Gắn tag `big-tech` |
| `Series A` | `funding` | `contains` | Gắn tag `funding` |

> Keywords được so khớp **case-insensitive** trên `title + text_content` của item.

---

## 5. Goals

`/admin/goals` — mục tiêu nghiên cứu, dùng để tính **signal_score**.

### Cách hoạt động

Mỗi goal liên kết với một tập keywords (qua category). Items được score cao hơn nếu tags của chúng match nhiều goals.

### Tạo goal

| Field | Mô tả |
|-------|-------|
| **Name** | Tên goal (ví dụ: "Theo dõi AI") |
| **Description** | Mô tả mục đích |
| **Priority** | 1–10 |
| **Linked Keywords** | Chọn keywords liên quan |

### Ví dụ setup đầy đủ

```
Keywords:
  chatgpt   → category: ai
  claude    → category: ai
  series a  → category: funding
  startup   → category: startup

Goals:
  "Theo dõi AI"       → linked: [chatgpt, claude]
  "Theo dõi Funding"  → linked: [series a]
```

Một bài viết về "Anthropic raises Series A" sẽ match cả 2 goals → signal_score cao.

---

## 6. Content

`/admin/content` — xem toàn bộ content đã collect.

### Bộ lọc

| Filter | Mô tả |
|--------|-------|
| **Search** | Tìm theo title/text |
| **Source** | Lọc theo nguồn |
| **Min score** | Chỉ hiện items có quality_score ≥ X (0.0–1.0) |
| **Hide dups** | Ẩn items bị đánh dấu duplicate |

### Cột hiển thị

| Cột | Ý nghĩa |
|-----|---------|
| **Title/Text** | Click để xem chi tiết |
| **Source** | Loại connector |
| **Quality** | quality_score (0–1): độ giàu nội dung |
| **Signal** | signal_score (0–1): độ liên quan tới goals |
| **Tags** | Categories được gắn tự động |
| **Published** | Thời điểm đăng gốc |
| **Dup** | Đánh dấu nếu là duplicate |

### Trang chi tiết item

Click vào title → xem đầy đủ:
- Metadata: source, URL, thời gian publish/fetch
- Scores chi tiết
- Tags đã gắn
- Engagement snapshot (views, likes, retweets...)
- Full text content
- Raw data JSON từ API

---

## 7. Schedules

`/admin/schedules` — ghi chú cron expression per-source.

> **Lưu ý quan trọng:** Cron trigger thực sự chỉ có **1 schedule toàn cục** `*/30 * * * *` được set trong `wrangler.toml`. Bảng Schedules trong UI chỉ là metadata tham chiếu, không điều khiển thời gian chạy thực tế.

Nếu muốn thay đổi tần suất chạy, sửa `wrangler.toml`:
```toml
[triggers]
crons = ["*/30 * * * *"]   # mỗi 30 phút
# crons = ["0 * * * *"]    # mỗi giờ
# crons = ["0 */6 * * *"]  # mỗi 6 giờ
```
Rồi deploy lại: `npm run deploy`

---

## 8. Config JSON tham chiếu nhanh

Config được nhập ở field **Config (JSON)** khi tạo/sửa source.

### RSS
```json
{
  "lookback_days": 7,
  "max_results": 50
}
```

### Website
```json
{
  "item_selector": "article",
  "title_selector": "h2|h3",
  "link_selector": "a",
  "text_selector": "p|.summary",
  "lookback_days": 3
}
```

> Dùng `|` để chỉ nhiều selector (HTMLRewriter không hỗ trợ dấu phẩy).

**Ví dụ thực tế đã test:**

| Site | Config |
|------|--------|
| Hacker News | `{"item_selector":"tr.athing","title_selector":".titleline a","link_selector":".titleline a","text_selector":".subline"}` |
| VnExpress | Dùng RSS feed thay vì website parse |
| Medium | `{"item_selector":"article","title_selector":"h2","text_selector":"p"}` |

### YouTube
```json
{
  "max_results": 10,
  "lookback_days": 14
}
```
URL/Handle: Channel ID dạng `UCxxxxxxxxxxxxxxxxxxxxxx` (lấy từ URL kênh YouTube)

### X / Twitter
```json
{
  "username": "elonmusk",
  "max_results": 10
}
```
URL/Handle: **User ID (số)**, không phải username. Tìm User ID tại [tweeterid.com](https://tweeterid.com).

### Telegram
```json
{
  "max_results": 25
}
```
URL/Handle: `@channelname` hoặc `channelname`
Bot phải được thêm làm admin channel trước.

### Facebook Page
```json
{
  "max_results": 25,
  "lookback_days": 7
}
```
URL/Handle: Page ID (số) hoặc page username

### Tham số chung (áp dụng cho mọi connector)

| Key | Mặc định | Mô tả |
|-----|---------|-------|
| `lookback_days` | null (không giới hạn) | Chỉ lấy bài trong N ngày gần nhất |
| `max_results` | 25 | Số items tối đa mỗi lần fetch |

---

## 9. Cách scoring hoạt động

### quality_score (0–1)

Đánh giá độ giàu nội dung của item, **không phụ thuộc vào keywords/goals**:

| Điều kiện | Điểm cộng |
|-----------|-----------|
| text_content > 10 ký tự | +0.20 |
| text_content > 100 ký tự | +0.15 |
| Có title | +0.15 |
| Có engagement data (views/likes > 0) | +0.20 |
| Bài đăng trong vòng 24h | +0.15 |
| Không phải duplicate | +0.15 |

→ Max: 1.0 | Website items thường đạt ~0.5 (không có date, không có engagement)

### signal_score (0–1)

Đánh giá độ liên quan tới **research goals**, **phụ thuộc vào Keywords và Goals đã setup**:

| Trường hợp | Score |
|-----------|-------|
| Chưa có goals | 0.1 (mặc định) |
| Có goals nhưng item không match keyword nào | 0.1 |
| Match 1 goal | 0.4 |
| Match nhiều goals | tăng dần → 1.0 |

> **Để signal_score có ý nghĩa:** cần setup ít nhất 1 Keyword + 1 Goal liên kết keyword đó.

---

## 10. Pending / Chưa hoàn thiện

Các tính năng chưa được implement hoặc cần test thêm:

### A. Website connector — không extract được publish_time

**Hiện trạng:** Website connector (HTMLRewriter) không lấy được ngày đăng bài. Tất cả website items có `publish_time = null`.

**Hệ quả:**
- `quality_score` mất +0.15 điểm (điều kiện "bài đăng trong 24h")
- `lookback_days` filter **không áp dụng** được (không có date để so sánh)

**Giải pháp tạm:** Dùng RSS feed thay vì website parse khi có thể.

**Fix đề xuất:** Thêm `date_selector` vào config để extract date từ HTML, ví dụ:
```json
{ "date_selector": "time|.date|.published" }
```

### B. X/Twitter — bị giới hạn Free tier

**Hiện trạng:** Twitter API v2 Free tier chỉ cho 10 tweets/15 phút và 1,500 tweets/tháng.

**Hệ quả:** Sources Twitter sẽ lỗi hoặc trả về rất ít data nếu vượt rate limit.

**API keys cần set:**
```bash
wrangler secret put X_BEARER_TOKEN
```

### C. Telegram — cần setup bot

**Hiện trạng:** Connector dùng Telegram Bot API `getUpdates`. Bot chỉ nhận được messages **sau khi bot được thêm vào channel**, không lấy được lịch sử cũ.

**Setup:**
1. Tạo bot qua @BotFather → lấy token
2. Thêm bot làm **admin** của channel cần theo dõi
3. Set secret: `wrangler secret put TELEGRAM_BOT_TOKEN`

### D. Facebook / Instagram — cần Business account

**Hiện trạng:** Graph API yêu cầu xác minh Business account và page access token.

**API keys:**
```bash
wrangler secret put FB_ACCESS_TOKEN   # Facebook Page
wrangler secret put IG_ACCESS_TOKEN   # Instagram Pro
```

**Lưu ý:** Access token Facebook hết hạn sau 60 ngày (long-lived token). Cần refresh định kỳ.

### E. YouTube

**Setup:**
1. Vào [Google Cloud Console](https://console.cloud.google.com) → Enable YouTube Data API v3
2. Tạo API Key
3. Set secret: `wrangler secret put YOUTUBE_API_KEY`
4. URL/Handle: Channel ID dạng `UCxxxxxx` (xem trong URL kênh YouTube)

### F. Schedules per-source chưa có tác dụng thực

**Hiện trạng:** Bảng `schedules` trong DB chỉ là metadata. Cron thực tế chạy tất cả sources mỗi 30 phút không phân biệt.

**Fix đề xuất:** Trong cron handler, đọc `cron_expression` từ bảng `schedules` và chỉ chạy source nào match thời điểm hiện tại.

### G. Export / API endpoint

**Hiện trạng:** Không có API endpoint để export content ra ngoài (CSV, JSON feed...).

**Ứng dụng:** Tích hợp với tools khác (Notion, Google Sheets, Slack notifications...).

### H. Notification khi có content mới

**Hiện trạng:** Không có alert/notification.

**Ý tưởng:** Sau khi pipeline chạy, nếu có items với signal_score > threshold → gửi Telegram/Slack/email.

---

## Quick Start — Setup đầy đủ từ đầu

```bash
# 1. Cài wrangler
npm install -g wrangler
wrangler login

# 2. Deploy
cd cloudflare
npm install
npm run deploy

# 3. Set password admin
wrangler secret put ADMIN_PASSWORD

# 4. Chạy migration DB
npm run db:migrate

# 5. Truy cập admin
# https://socia-research.<subdomain>.workers.dev/admin/
```

**Setup nhanh để test ngay (không cần API key):**
1. Vào `/admin/sources` → Add Source
2. Connector: `rss`, URL: `https://vnexpress.net/rss/tin-moi-nhat.rss`
3. Config: `{"lookback_days": 3}`
4. Click **▶ Run**
5. Vào `/admin/content` → xem kết quả
