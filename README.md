# API การจัดการ HTTPS สำหรับ NGINX

## การใช้งาน API สำหรับ HTTPS และ SSL

API นี้ช่วยให้คุณสามารถจัดการการทำงานของ HTTPS และใบรับรอง SSL สำหรับเซิร์ฟเวอร์ NGINX ผ่าน HTTP requests

## Endpoints

### ข้อมูลสถานะของ SSL

```
GET /ssl
```

**ตัวอย่างการใช้งาน:**

```bash
curl http://localhost:3000/ssl
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "enabled": true,
  "certificates": [
    {
      "cert_path": "/etc/nginx/ssl/cert.pem",
      "key_path": "/etc/nginx/ssl/key.pem",
      "exists": true,
      "valid_until": "2024-04-17T07:42:41.000Z"
    }
  ]
}
```

### สร้างใบรับรอง SSL แบบ Self-Signed

```
POST /ssl/generate
```

**Request Body:**

```json
{
  "common_name": "example.com"
}
```

**พารามิเตอร์:**

- `common_name`: (จำเป็น) ชื่อโดเมนที่จะใช้ในใบรับรอง

**ตัวอย่างการใช้งาน:**

```bash
curl -X POST http://localhost:3000/ssl/generate \
  -H "Content-Type: application/json" \
  -d '{"common_name":"example.com"}'
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Self-signed certificate generated successfully for example.com"
}
```

### เปิดใช้งาน HTTPS ทั่วทั้งระบบ

```
POST /ssl/enable
```

**ตัวอย่างการใช้งาน:**

```bash
curl -X POST http://localhost:3000/ssl/enable
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Global HTTPS enabled successfully"
}
```

### ปิดใช้งาน HTTPS ทั่วทั้งระบบ

```
POST /ssl/disable
```

**ตัวอย่างการใช้งาน:**

```bash
curl -X POST http://localhost:3000/ssl/disable
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Global HTTPS disabled successfully"
}
```

## การสร้าง Subdomain พร้อม HTTPS

คุณสามารถสร้าง subdomain พร้อมเปิดใช้งาน HTTPS ได้โดยระบุพารามิเตอร์ `ssl_enabled` และ `force_https` เมื่อสร้าง subdomain ใหม่

### สร้าง Subdomain พร้อม HTTPS

```
POST /subdomains
```

**Request Body:**

```json
{
  "subdomain": "secure",
  "domain": "example.com",
  "port": 443,
  "ssl_enabled": true,
  "force_https": true
}
```

**พารามิเตอร์เพิ่มเติมสำหรับ HTTPS:**

- `ssl_enabled`: (boolean) เปิดใช้งาน SSL/TLS บน subdomain นี้
- `force_https`: (boolean) สร้างกฎการ redirect จาก HTTP ไปยัง HTTPS

**ตัวอย่างการใช้งาน:**

```bash
curl -X POST http://localhost:3000/subdomains \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "secure",
    "domain": "example.com",
    "port": 443,
    "ssl_enabled": true,
    "force_https": true
  }'
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Subdomain secure.example.com created successfully",
  "config_path": "/etc/nginx/conf.d/secure.conf"
}
```

### อัปเดต Subdomain ให้รองรับ HTTPS

```
PUT /subdomains/:name
```

**Request Body:**

```json
{
  "ssl_enabled": true,
  "force_https": true
}
```

**ตัวอย่างการใช้งาน:**

```bash
curl -X PUT http://localhost:3000/subdomains/blog \
  -H "Content-Type: application/json" \
  -d '{
    "ssl_enabled": true,
    "force_https": true
  }'
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Subdomain blog updated successfully"
}
```

## หมายเหตุ

- ระบบจะใช้ใบรับรอง SSL ที่อยู่ใน `/etc/nginx/ssl/cert.pem` และ `/etc/nginx/ssl/key.pem`
- สำหรับการใช้งานจริง ควรใช้ใบรับรองที่ออกโดย Certificate Authority ที่เชื่อถือได้ (เช่น Let's Encrypt)
- เมื่อเปิดใช้งาน HTTPS ทั่วทั้งระบบ ทุกการเข้าถึง HTTP จะถูก redirect ไปยัง HTTPS โดยอัตโนมัติ
- หากพบว่า browser แสดงข้อความเตือนเกี่ยวกับความปลอดภัย นั่นคือปกติสำหรับใบรับรองแบบ self-signed

https://prudchayapalee.medium.com/%E0%B8%97%E0%B8%B3-ssl-https-%E0%B9%82%E0%B8%94%E0%B8%A2%E0%B9%83%E0%B8%8A%E0%B9%89-lets-encrypt-cert-bot-%E0%B8%9A%E0%B8%99-nginx-%E0%B9%83%E0%B8%99%E0%B9%81%E0%B8%9A%E0%B8%9A%E0%B8%89%E0%B8%9A%E0%B8%B1%E0%B8%9A-docker-auto-renew-certificate-bc573e127f28
