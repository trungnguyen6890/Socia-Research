# Nitter Local — Setup Guide

Chạy Nitter trên máy local và expose qua Cloudflare Tunnel để CF Workers có thể gọi được.

## Yêu cầu

1. **Docker Desktop** — https://www.docker.com/products/docker-desktop/
2. **cloudflared** — tự cài qua script hoặc: `brew install cloudflare/cloudflare/cloudflared`

## Chạy

```bash
cd nitter/
./start.sh
```

Script sẽ:
1. Kéo và chạy Nitter + Redis qua Docker
2. Mở Cloudflare Tunnel (không cần login Cloudflare)
3. In ra public URL dạng `https://xxx.trycloudflare.com`

## Cập nhật source trong Admin UI

Sau khi chạy `./start.sh`, copy URL tunnel rồi:

1. Vào `/admin/sources` → Edit source X/Nitter
2. Cập nhật config:
```json
{
  "nitter_instance": "https://xxx.trycloudflare.com",
  "include_retweets": false,
  "lookback_days": 7
}
```
3. Enable source → click **▶ Run**

## Lưu ý

- Tunnel URL thay đổi **mỗi lần restart** `start.sh` → cần cập nhật config lại
- Nitter chỉ hoạt động khi `start.sh` đang chạy trên máy
- Để URL cố định: dùng `cloudflared tunnel create` (cần Cloudflare account)

## URL cố định (optional)

```bash
# Login Cloudflare một lần
cloudflared tunnel login

# Tạo tunnel có tên cố định
cloudflared tunnel create nitter-local

# Sửa start.sh: thay dòng cloudflared tunnel --url ... thành:
# cloudflared tunnel run nitter-local
```
