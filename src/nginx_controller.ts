// nginx_controller.ts
import { Elysia } from 'elysia'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'

const exec_async = promisify(exec)

// สำหรับการใช้งานใน Docker
const NGINX_HOST = process.env.NGINX_HOST || 'nginx'
const NGINX_CONFIG_PATH = process.env.NGINX_CONFIG_PATH || '/etc/nginx/nginx.conf'
const NGINX_CONF_DIR = process.env.NGINX_CONF_DIR || '/etc/nginx/conf.d'

type nginx_status = {
  is_running: boolean
  version?: string
  error?: string
}

type nginx_config = {
  config_path: string
  content: string
}

// เพิ่ม type definitions สำหรับ subdomain management
type subdomain_config = {
  subdomain: string
  domain: string
  port: number
  root_path?: string
  ssl_enabled?: boolean
  custom_config?: string
}

type subdomain_info = {
  name: string
  domain: string
  config_path: string
  port: number
  ssl_enabled: boolean
}

class nginx_controller {
  private config_path: string
  private conf_dir: string
  private docker_command_prefix: string

  constructor(config_path: string = NGINX_CONFIG_PATH, conf_dir: string = NGINX_CONF_DIR) {
    this.config_path = config_path
    this.conf_dir = conf_dir
    // สร้าง prefix สำหรับคำสั่ง docker exec
    this.docker_command_prefix = `docker exec ${NGINX_HOST}`
  }

  async get_status(): Promise<nginx_status> {
    try {
      const { stdout } = await exec_async(`${this.docker_command_prefix} nginx -v 2>&1`)
      return {
        is_running: true,
        version: stdout.trim(),
      }
    } catch (error) {
      try {
        // ทดสอบว่า container ทำงานอยู่หรือไม่
        await exec_async(`docker ps --filter "name=${NGINX_HOST}" --format "{{.Names}}"`)
        return {
          is_running: true,
          version: "NGINX is running in container but couldn't get version",
        }
      } catch (containerError: any) {
        return {
          is_running: false,
          error: `NGINX container not running: ${containerError.message}`,
        }
      }
    }
  }

  async start_nginx(): Promise<{ success: boolean; message: string }> {
    try {
      await exec_async(`${this.docker_command_prefix} nginx`)
      return {
        success: true,
        message: 'NGINX started successfully',
      }
    } catch (error) {
      // ถ้าเกิดข้อผิดพลาด ลองเริ่มต้น container
      try {
        await exec_async(`docker start ${NGINX_HOST}`)
        return {
          success: true,
          message: 'NGINX container started successfully',
        }
      } catch (containerError: any) {
        return {
          success: false,
          message: `Failed to start NGINX: ${containerError.message}`,
        }
      }
    }
  }

  async stop_nginx(): Promise<{ success: boolean; message: string }> {
    try {
      await exec_async(`${this.docker_command_prefix} nginx -s stop`)
      return {
        success: true,
        message: 'NGINX stopped successfully',
      }
    } catch (error) {
      // ถ้าไม่สามารถหยุด service ได้ ลองหยุด container
      try {
        await exec_async(`docker stop ${NGINX_HOST}`)
        return {
          success: true,
          message: 'NGINX container stopped successfully',
        }
      } catch (containerError: any) {
        return {
          success: false,
          message: `Failed to stop NGINX: ${containerError.message}`,
        }
      }
    }
  }

  async reload_nginx(): Promise<{ success: boolean; message: string }> {
    try {
      await exec_async(`${this.docker_command_prefix} nginx -s reload`)
      return {
        success: true,
        message: 'NGINX configuration reloaded successfully',
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to reload NGINX: ${error.message}`,
      }
    }
  }

  async get_config(): Promise<nginx_config | { error: string }> {
    try {
      // อ่านไฟล์ config โดยตรงจาก volume ที่ mount ไว้
      const content = await fs.readFile(this.config_path, 'utf8')
      return {
        config_path: this.config_path,
        content: content,
      }
    } catch (error) {
      // ถ้าไม่สามารถอ่านไฟล์โดยตรงได้ ลองใช้ docker exec
      try {
        const { stdout } = await exec_async(`${this.docker_command_prefix} cat ${this.config_path}`)
        return {
          config_path: this.config_path,
          content: stdout,
        }
      } catch (dockerError: any) {
        return {
          error: `Failed to read NGINX config: ${dockerError.message}`,
        }
      }
    }
  }

  async update_config(new_content: string): Promise<{ success: boolean; message: string }> {
    try {
      // เขียนไฟล์ config โดยตรงไปยัง volume ที่ mount ไว้
      await fs.writeFile(this.config_path, new_content, 'utf8')
      return {
        success: true,
        message: 'NGINX configuration updated successfully',
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to update NGINX config: ${error.message}`,
      }
    }
  }

  async test_config(): Promise<{ success: boolean; message: string }> {
    try {
      await exec_async(`${this.docker_command_prefix} nginx -t`)
      return {
        success: true,
        message: 'NGINX configuration test passed',
      }
    } catch (error: any) {
      return {
        success: false,
        message: `NGINX configuration test failed: ${error.message}`,
      }
    }
  }

  // เพิ่มฟังก์ชันสำหรับจัดการ subdomain
  async list_subdomains(): Promise<subdomain_info[] | { error: string }> {
    try {
      // ดึงรายการไฟล์ในโฟลเดอร์ conf.d
      const files = await fs.readdir(this.conf_dir)
      const subdomain_files = files.filter((file) => file.endsWith('.conf'))

      const subdomains: subdomain_info[] = []

      for (const file of subdomain_files) {
        try {
          const content = await fs.readFile(path.join(this.conf_dir, file), 'utf8')

          // ดึงข้อมูลจากไฟล์ config
          const subdomain_name = file.replace('.conf', '')
          const server_name_match = content.match(/server_name\s+([^;]+);/)
          const listen_match = content.match(/listen\s+(\d+)/)
          const ssl_match = content.includes('ssl')

          if (server_name_match && listen_match) {
            const domain = server_name_match[1].trim()
            const port = parseInt(listen_match[1])

            subdomains.push({
              name: subdomain_name,
              domain: domain,
              config_path: path.join(this.conf_dir, file),
              port: port,
              ssl_enabled: ssl_match,
            })
          }
        } catch (error) {
          console.error(`Error reading subdomain file ${file}:`, error)
        }
      }

      return subdomains
    } catch (error: any) {
      return {
        error: `Failed to list subdomains: ${error.message}`,
      }
    }
  }

  async get_subdomain(subdomain: string): Promise<nginx_config | { error: string }> {
    const config_path = path.join(this.conf_dir, `${subdomain}.conf`)

    try {
      const content = await fs.readFile(config_path, 'utf8')
      return {
        config_path: config_path,
        content: content,
      }
    } catch (error: any) {
      return {
        error: `Subdomain not found or could not be read: ${error.message}`,
      }
    }
  }

  async create_subdomain(config: subdomain_config): Promise<{ success: boolean; message: string; config_path?: string }> {
    const subdomain_file = path.join(this.conf_dir, `${config.subdomain}.conf`)

    try {
      // ตรวจสอบว่ามีไฟล์อยู่แล้วหรือไม่
      try {
        await fs.access(subdomain_file)
        return {
          success: false,
          message: `Subdomain ${config.subdomain} already exists`,
        }
      } catch (error) {
        // ไฟล์ไม่มีอยู่ ดำเนินการต่อ
      }

      // สร้าง server block สำหรับ subdomain
      let server_config = ''

      if (config.custom_config) {
        // ใช้ custom config ที่ผู้ใช้กำหนด
        server_config = config.custom_config
      } else {
        // สร้าง config จากข้อมูลที่ได้รับ
        const ssl_config = config.ssl_enabled
          ? `
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;`
          : ''

        const root_path = config.root_path || '/usr/share/nginx/html'

        server_config = `server {
    listen ${config.port}${config.ssl_enabled ? ' ssl' : ''};
    server_name ${config.subdomain}.${config.domain};${ssl_config}
    
    root ${root_path};
    index index.html index.htm;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}`
      }

      // เขียนไฟล์ config
      await fs.writeFile(subdomain_file, server_config, 'utf8')

      // รีโหลด NGINX เพื่อใช้งาน config ใหม่
      await this.reload_nginx()

      return {
        success: true,
        message: `Subdomain ${config.subdomain}.${config.domain} created successfully`,
        config_path: subdomain_file,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to create subdomain: ${error.message}`,
      }
    }
  }

  async update_subdomain(subdomain: string, config: Partial<subdomain_config>): Promise<{ success: boolean; message: string }> {
    try {
      // ตรวจสอบว่ามี subdomain นี้อยู่หรือไม่
      const subdomain_file = path.join(this.conf_dir, `${subdomain}.conf`)

      try {
        await fs.access(subdomain_file)
      } catch (error: any) {
        return {
          success: false,
          message: `Subdomain ${subdomain} does not exist`,
        }
      }

      // อ่าน config ปัจจุบัน
      const current_config = await fs.readFile(subdomain_file, 'utf8')

      // อัปเดต config ตามพารามิเตอร์ที่ได้รับ
      let updated_config = current_config

      if (config.custom_config) {
        // ใช้ custom config แทนที่ทั้งหมด
        updated_config = config.custom_config
      } else {
        // อัปเดตเฉพาะส่วนที่กำหนด
        if (config.port) {
          updated_config = updated_config.replace(/listen\s+\d+(\s+ssl)?;/, `listen ${config.port}${config.ssl_enabled ? ' ssl' : ''};`)
        }

        if (config.domain) {
          // ดึงชื่อ subdomain จากไฟล์
          const server_name_match = current_config.match(/server_name\s+([^.]+)\.([^;]+);/)
          if (server_name_match) {
            const current_subdomain = server_name_match[1]
            updated_config = updated_config.replace(/server_name\s+[^;]+;/, `server_name ${current_subdomain}.${config.domain};`)
          }
        }

        if (config.subdomain && config.domain) {
          updated_config = updated_config.replace(/server_name\s+[^;]+;/, `server_name ${config.subdomain}.${config.domain};`)
        }

        if (config.root_path) {
          if (updated_config.includes('root ')) {
            updated_config = updated_config.replace(/root\s+[^;]+;/, `root ${config.root_path};`)
          } else {
            // เพิ่ม root directive หากไม่มี
            updated_config = updated_config.replace(/server {/, `server {\n    root ${config.root_path};`)
          }
        }

        // จัดการ SSL
        if (config.ssl_enabled !== undefined) {
          if (config.ssl_enabled) {
            // เพิ่ม SSL หากไม่มี
            if (!updated_config.includes('ssl_certificate')) {
              updated_config = updated_config.replace(
                /server {[^\{]*{/,
                `server {\n    ssl_certificate /etc/nginx/ssl/cert.pem;\n    ssl_certificate_key /etc/nginx/ssl/key.pem;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    ssl_ciphers HIGH:!aNULL:!MD5;`
              )
            }
            // เพิ่ม ssl ให้กับ listen directive
            if (!updated_config.includes('listen') || !updated_config.includes('ssl')) {
              updated_config = updated_config.replace(/listen\s+(\d+);/, 'listen $1 ssl;')
            }
          } else {
            // ลบ SSL ออก
            updated_config = updated_config
              .replace(/\s*ssl_certificate[^;]*;/g, '')
              .replace(/\s*ssl_certificate_key[^;]*;/g, '')
              .replace(/\s*ssl_protocols[^;]*;/g, '')
              .replace(/\s*ssl_ciphers[^;]*;/g, '')
              .replace(/listen\s+(\d+)\s+ssl;/, 'listen $1;')
          }
        }
      }

      // เขียนไฟล์ config ใหม่
      await fs.writeFile(subdomain_file, updated_config, 'utf8')

      // รีโหลด NGINX
      await this.reload_nginx()

      return {
        success: true,
        message: `Subdomain ${subdomain} updated successfully`,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to update subdomain: ${error.message}`,
      }
    }
  }

  async delete_subdomain(subdomain: string): Promise<{ success: boolean; message: string }> {
    try {
      const subdomain_file = path.join(this.conf_dir, `${subdomain}.conf`)

      // ตรวจสอบว่ามีไฟล์อยู่หรือไม่
      try {
        await fs.access(subdomain_file)
      } catch (error) {
        return {
          success: false,
          message: `Subdomain ${subdomain} does not exist`,
        }
      }

      // ลบไฟล์
      await fs.unlink(subdomain_file)

      // รีโหลด NGINX
      await this.reload_nginx()

      return {
        success: true,
        message: `Subdomain ${subdomain} deleted successfully`,
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to delete subdomain: ${error.message}`,
      }
    }
  }
}

// Create Elysia app with routes to manage NGINX
const app = new Elysia()
const nginx = new nginx_controller()

// NGINX Server Management Routes
app.get('/status', async () => {
  return await nginx.get_status()
})

app.post('/start', async () => {
  return await nginx.start_nginx()
})

app.post('/stop', async () => {
  return await nginx.stop_nginx()
})

app.post('/reload', async () => {
  return await nginx.reload_nginx()
})

app.get('/config', async () => {
  return await nginx.get_config()
})

app.post('/config', async ({ body }) => {
  const { content } = body as { content: string }
  return await nginx.update_config(content)
})

app.post('/test-config', async () => {
  return await nginx.test_config()
})

// Subdomain Management Routes
app.get('/subdomains', async () => {
  return await nginx.list_subdomains()
})

app.get('/subdomains/:name', async ({ params }) => {
  return await nginx.get_subdomain(params.name)
})

app.post('/subdomains', async ({ body }) => {
  const config = body as subdomain_config
  return await nginx.create_subdomain(config)
})

app.put('/subdomains/:name', async ({ params, body }) => {
  const config = body as Partial<subdomain_config>
  return await nginx.update_subdomain(params.name, config)
})

app.delete('/subdomains/:name', async ({ params }) => {
  return await nginx.delete_subdomain(params.name)
})

// Start the server
app.listen(3000, () => {
  console.log('🦊 NGINX Controller running at http://localhost:3000')
})
