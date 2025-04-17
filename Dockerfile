# ใช้ Bun image ล่าสุด
FROM oven/bun:latest

# สร้างโฟลเดอร์สำหรับแอพพลิเคชัน
WORKDIR /app

# คัดลอกไฟล์ package.json และ lockfile
COPY package.json bun.lockb* ./

# ติดตั้ง dependencies
RUN bun install --frozen-lockfile

# คัดลอกโค้ดแอพพลิเคชัน
COPY . .

# เปิด port ที่ใช้โดยแอพพลิเคชัน
EXPOSE 3000

# รันแอพพลิเคชัน
CMD ["bun", "start"]
