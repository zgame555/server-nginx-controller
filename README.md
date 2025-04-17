# API การจัดการ Subdomain สำหรับ NGINX

## การใช้งาน API สำหรับ Subdomain

API นี้ช่วยให้คุณสามารถสร้าง แสดงรายการ อัปเดต และลบ subdomain สำหรับเซิร์ฟเวอร์ NGINX ได้ผ่าน HTTP requests

## Endpoints

### แสดงรายการ Subdomain ทั้งหมด

```
GET /subdomains
```

**ตัวอย่างการใช้งาน:**

```bash
curl http://localhost:3000/subdomains
```

**ตัวอย่างการตอบกลับ:**

```json
[
  {
    "name": "blog",
    "domain": "example.com",
    "config_path": "/etc/nginx/conf.d/blog.conf",
    "port": 80,
    "ssl_enabled": false
  },
  {
    "name": "shop",
    "domain": "example.com",
    "config_path": "/etc/nginx/conf.d/shop.conf",
    "port": 443,
    "ssl_enabled": true
  }
]
```

### ดูรายละเอียดของ Subdomain

```
GET /subdomains/:name
```

**พารามิเตอร์:**

- `name`: ชื่อ subdomain

**ตัวอย่างการใช้งาน:**

```bash
curl http://localhost:3000/subdomains/blog
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "config_path": "/etc/nginx/conf.d/blog.conf",
  "content": "server {\n    listen 80;\n    server_name blog.example.com;\n    root /usr/share/nginx/html;\n    index index.html index.htm;\n    location / {\n        try_files $uri $uri/ =404;\n    }\n}"
}
```

### สร้าง Subdomain ใหม่

```
POST /subdomains
```

**Request Body:**

```json
{
  "subdomain": "blog",
  "domain": "example.com",
  "port": 80,
  "root_path": "/usr/share/nginx/html/blog",
  "ssl_enabled": false,
  "custom_config": "..." // ไม่จำเป็น สามารถกำหนด config เองทั้งหมด
}
```

**พารามิเตอร์:**

- `subdomain`: (จำเป็น) ชื่อ subdomain
- `domain`: (จำเป็น) ชื่อโดเมนหลัก
- `port`: (จำเป็น) พอร์ตที่จะใช้งาน
- `root_path`: (ไม่จำเป็น) เส้นทางของไฟล์ root
- `ssl_enabled`: (ไม่จำเป็น) เปิดใช้งาน SSL หรือไม่
- `custom_config`: (ไม่จำเป็น) กำหนด config เองทั้งหมด

**ตัวอย่างการใช้งาน:**

```bash
curl -X POST http://localhost:3000/subdomains \
  -H "Content-Type: application/json" \
  -d '{"subdomain":"blog","domain":"example.com","port":80,"root_path":"/usr/share/nginx/html/blog"}'
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Subdomain blog.example.com created successfully",
  "config_path": "/etc/nginx/conf.d/blog.conf"
}
```

### อัปเดต Subdomain

```
PUT /subdomains/:name
```

**พารามิเตอร์:**

- `name`: ชื่อ subdomain

**Request Body:**

```json
{
  "subdomain": "blog",
  "domain": "newdomain.com",
  "port": 443,
  "root_path": "/usr/share/nginx/html/blog",
  "ssl_enabled": true
}
```

สามารถกำหนดเฉพาะพารามิเตอร์ที่ต้องการเปลี่ยนแปลงได้

**ตัวอย่างการใช้งาน:**

```bash
curl -X PUT http://localhost:3000/subdomains/blog \
  -H "Content-Type: application/json" \
  -d '{"domain":"newdomain.com","ssl_enabled":true,"port":443}'
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Subdomain blog updated successfully"
}
```

### ลบ Subdomain

```
DELETE /subdomains/:name
```

**พารามิเตอร์:**

- `name`: ชื่อ subdomain

**ตัวอย่างการใช้งาน:**

```bash
curl -X DELETE http://localhost:3000/subdomains/blog
```

**ตัวอย่างการตอบกลับ:**

```json
{
  "success": true,
  "message": "Subdomain blog deleted successfully"
}
```

## ตัวอย่างการสร้าง Subdomain ด้วย Custom Config

หากต้องการกำหนด config เองทั้งหมด สามารถใช้พารามิเตอร์ `custom_config` ได้:

```bash
curl -X POST http://localhost:3000/subdomains \
  -H "Content-Type: application/json" \
  -d '{
    "subdomain": "api",
    "domain": "example.com",
    "port": 80,
    "custom_config": "server {\n    listen 80;\n    server_name api.example.com;\n    \n    location / {\n        proxy_pass http://backend:3000;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n    }\n}"
  }'
```

## หมายเหตุ

- เมื่อทำการสร้างหรืออัปเดต subdomain NGINX จะถูกรีโหลดโดยอัตโนมัติ
- SSL configuration จะใช้ไฟล์ cert.pem และ key.pem ที่อยู่ใน `/etc/nginx/ssl/`
- ควรแน่ใจว่ามีการตั้งค่าการชี้โดเมนที่ถูกต้อง (DNS records) สำหรับ subdomain ที่สร้างขึ้น
