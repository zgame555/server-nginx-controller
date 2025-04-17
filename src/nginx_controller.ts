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
const CERTBOT_HOST = process.env.CERTBOT_HOST || 'certbot'
const LETSENCRYPT_DIR = process.env.LETSENCRYPT_DIR || '/etc/letsencrypt'
const CERTBOT_WEBROOT = process.env.CERTBOT_WEBROOT || '/var/www/certbot'

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
  force_https?: boolean
  email?: string  // สำหรับการแจ้งเตือน Let's Encrypt
}

type subdomain_info = {
  name: string
  domain: string
  config_path: string
  port: number
  ssl_enabled: boolean
  https_redirect: boolean
  has_lets_encrypt?: boolean
}

// เพิ่ม type definitions สำหรับ Let's Encrypt
type letsencrypt_cert_info = {
  domain: string
  cert_path: string
  fullchain_path: string
  chain_path: string
  privkey_path: string
  valid_until?: Date
  issuer?: string
}

type lets_encrypt_status = {
  enabled: boolean
  certificates: letsencrypt_cert_info[]
  error?: string
}

class nginx_controller {
  private config_path: string
  private conf_dir: string
  private letsencrypt_dir: string
  private certbot_webroot: string
  private docker_command_prefix: string
  private certbot_command_prefix: string

  constructor(
    config_path: string = NGINX_CONFIG_PATH, 
    conf_dir: string = NGINX_CONF_DIR,
    letsencrypt_dir: string = LETSENCRYPT_DIR,
    certbot_webroot: string = CERTBOT_WEBROOT
  ) {
    this.config_path = config_path
    this.conf_dir = conf_dir
    this.letsencrypt_dir = letsencrypt_dir
    this.certbot_webroot = certbot_webroot
    // สร้าง prefix สำหรับคำสั่ง docker exec
    this.docker_command_prefix = `docker exec ${NGINX_HOST}`
    this.certbot_command_prefix = `docker exec ${CERTBOT_HOST}`
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
      } catch (containerError) {
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
      } catch (containerError) {
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
      } catch (containerError) {
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
    } catch (error) {
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
      } catch (dockerError) {
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
    } catch (error) {
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
    } catch (error) {
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
      const subdomain_files = files.filter(file => file.endsWith('.conf'))
      
      const subdomains: subdomain_info[] = []
      
      for (const file of subdomain_files) {
        try {
          if (file === 'certbot.conf' || file === 'default.conf' || file === 'default-https.conf') {
            continue;  // ข้ามไฟล์ที่เป็น config พื้นฐาน
          }

          const content = await fs.readFile(path.join(this.conf_dir, file), 'utf8')
          
          // ดึงข้อมูลจากไฟล์ config
          const subdomain_name = file.replace('.conf', '')
          const server_name_match = content.match(/server_name\s+([^;]+);/)
          const listen_match = content.match(/listen\s+(\d+)/)
          const ssl_match = content.includes('ssl_certificate')
          const https_redirect = content.includes('return 301 https://')
          const letsencrypt_match = content.includes('/etc/letsencrypt/live/')
          
          if (server_name_match && listen_match) {
            const domain = server_name_match[1].trim()
            const port = parseInt(listen_match[1])
            
            subdomains.push({
              name: subdomain_name,
              domain: domain,
              config_path: path.join(this.conf_dir, file),
              port: port,
              ssl_enabled: ssl_match,
              https_redirect: https_redirect,
              has_lets_encrypt: letsencrypt_match
            })
          }
        } catch (error) {
          console.error(`Error reading subdomain file ${file}:`, error)
        }
      }
      
      return subdomains
      
    } catch (error) {
      return {
        error: `Failed to list subdomains: ${error.message}`
      }
    }
  }
  
  async get_subdomain(subdomain: string): Promise<nginx_config | { error: string }> {
    const config_path = path.join(this.conf_dir, `${subdomain}.conf`)
    
    try {
      const content = await fs.readFile(config_path, 'utf8')
      return {
        config_path: config_path,
        content: content
      }
    } catch (error) {
      return {
        error: `Subdomain not found or could not be read: ${error.message}`
      }
    }
  }
  
  async create_subdomain(config: subdomain_config): Promise<{ success: boolean, message: string, config_path?: string }> {
    const subdomain_file = path.join(this.conf_dir, `${config.subdomain}.conf`)
    
    try {
      // ตรวจสอบว่ามีไฟล์อยู่แล้วหรือไม่
      try {
        await fs.access(subdomain_file)
        return {
          success: false,
          message: `Subdomain ${config.subdomain} already exists`
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
        const root_path = config.root_path || '/usr/share/nginx/html';
        const domain = `${config.subdomain}.${config.domain}`;

        // ถ้า force_https เป็น true จะสร้าง config สำหรับ redirect HTTP ไปยัง HTTPS
        if (config.force_https) {
          server_config = `# HTTP configuration - Redirect to HTTPS
server {
    listen 80;
    server_name ${domain};
    
    # For Let's Encrypt HTTP challenge
    location /.well-known/acme-challenge/ {
        root ${this.certbot_webroot};
    }
    
    # Redirect HTTP to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

`;
        } else {
          // ถ้าไม่ได้ force HTTPS แต่ต้องมี location สำหรับ Let's Encrypt
          server_config = `# HTTP configuration
server {
    listen 80;
    server_name ${domain};
    
    # For Let's Encrypt HTTP challenge
    location /.well-known/acme-challenge/ {
        root ${this.certbot_webroot};
    }
    
    root ${root_path};
    index index.html index.htm;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}

`;
        }
        
        // ถ้า ssl_enabled เป็น true จะสร้าง config สำหรับ HTTPS
        if (config.ssl_enabled) {
          // ตรวจสอบว่ามีใบรับรองจาก Let's Encrypt หรือไม่
          const live_dir = path.join(this.letsencrypt_dir, 'live', domain);
          let ssl_cert_path = path.join(live_dir, 'fullchain.pem');
          let ssl_key_path = path.join(live_dir, 'privkey.pem');
          
          try {
            await fs.access(ssl_cert_path);
            await fs.access(ssl_key_path);
          } catch (error) {
            // ถ้าไม่มีใบรับรองจาก Let's Encrypt ต้องใช้ self-signed certificate ชั่วคราว
            ssl_cert_path = '/etc/letsencrypt/self-signed/cert.pem';
            ssl_key_path = '/etc/letsencrypt/self-signed/key.pem';
            
            try {
              // สร้างโฟลเดอร์สำหรับ self-signed certificate
              await fs.mkdir('/etc/letsencrypt/self-signed', { recursive: true });
            } catch (err) {
              // ข้ามไปหากโฟลเดอร์มีอยู่แล้ว
            }
            
            // สร้าง self-signed certificate ชั่วคราว
            await exec_async(`openssl req -x509 -nodes -days 30 -newkey rsa:2048 -keyout ${ssl_key_path} -out ${ssl_cert_path} -subj "/CN=${domain}" -addext "subjectAltName = DNS:${domain}"`);
          }
          
          server_config += `# HTTPS configuration
server {
    listen ${config.port} ssl;
    server_name ${domain};
    
    # SSL configuration
    ssl_certificate ${ssl_cert_path};
    ssl_certificate_key ${ssl_key_path};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    root ${root_path};
    index index.html index.htm;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}`;
        }
      }
      
      // เขียนไฟล์ config
      await fs.writeFile(subdomain_file, server_config, 'utf8')
      
      // รีโหลด NGINX เพื่อใช้งาน config ใหม่
      await this.reload_nginx()
      
      return {
        success: true,
        message: `Subdomain ${config.subdomain}.${config.domain} created successfully`,
        config_path: subdomain_file
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to create subdomain: ${error.message}`
      }
    }
  }
  
  async update_subdomain(subdomain: string, config: Partial<subdomain_config>): Promise<{ success: boolean, message: string }> {
    try {
      // ตรวจสอบว่ามี subdomain นี้อยู่หรือไม่
      const subdomain_file = path.join(this.conf_dir, `${subdomain}.conf`)
      
      try {
        await fs.access(subdomain_file)
      } catch (error) {
        return {
          success: false,
          message: `Subdomain ${subdomain} does not exist`
        }
      }
      
      // อ่าน config ปัจจุบัน
      const current_config = await fs.readFile(subdomain_file, 'utf8')
      
      // ถ้าต้องการเปลี่ยนเป็น HTTPS หรือเปลี่ยนการ redirect ควรสร้าง config ใหม่ทั้งหมด
      if (config.ssl_enabled !== undefined || config.force_https !== undefined || config.custom_config) {
        // สร้าง config ใหม่ทั้งหมด
        const full_config: subdomain_config = {
          subdomain: subdomain,
          domain: '', // จะถูกดึงจาก current_config ด้านล่าง
          port: 443,   // default port สำหรับ HTTPS
          ...config   // ใช้ค่าที่ได้รับมาทับค่าเริ่มต้น
        };
        
        // ดึงข้อมูลจาก current_config
        const server_name_match = current_config.match(/server_name\s+([^.]+)\.([^;]+);/)
        const listen_match = current_config.match(/listen\s+(\d+)/)
        const root_match = current_config.match(/root\s+([^;]+);/)
        
        if (server_name_match) {
          const current_subdomain = server_name_match[1]
          const current_domain = server_name_match[2]
          full_config.domain = full_config.domain || current_domain
        }
        
        if (listen_match) {
          full_config.port = full_config.port || parseInt(listen_match[1])
        }
        
        if (root_match) {
          full_config.root_path = full_config.root_path || root_match[1].trim()
        }
        
        // สร้าง subdomain ใหม่ (จะเขียนทับไฟล์เดิม)
        return await this.create_subdomain(full_config)
      }
      
      // อัปเดต config ตามพารามิเตอร์ที่ได้รับ
      let updated_config = current_config
      
      if (config.domain) {
        // ดึงชื่อ subdomain จากไฟล์
        const server_name_match = current_config.match(/server_name\s+([^.]+)\.([^;]+);/)
        if (server_name_match) {
          const current_subdomain = server_name_match[1]
          updated_config = updated_config.replace(
            /server_name\s+[^;]+;/g,
            `server_name ${current_subdomain}.${config.domain};`
          )
        }
      }
      
      if (config.subdomain && config.domain) {
        updated_config = updated_config.replace(
          /server_name\s+[^;]+;/g,
          `server_name ${config.subdomain}.${config.domain};`
        )
      }
      
      if (config.port) {
        updated_config = updated_config.replace(
          /listen\s+\d+(\s+ssl)?;/g,
          `listen ${config.port}${updated_config.includes('ssl') ? ' ssl' : ''};`
        )
      }
      
      if (config.root_path) {
        if (updated_config.includes('root ')) {
          updated_config = updated_config.replace(
            /root\s+[^;]+;/g,
            `root ${config.root_path};`
          )
        } else {
          // เพิ่ม root directive หากไม่มี
          updated_config = updated_config.replace(
            /server {/g,
            `server {\n    root ${config.root_path};`
          )
        }
      }
      
      // เขียนไฟล์ config ใหม่
      await fs.writeFile(subdomain_file, updated_config, 'utf8')
      
      // รีโหลด NGINX
      await this.reload_nginx()
      
      return {
        success: true,
        message: `Subdomain ${subdomain} updated successfully`
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to update subdomain: ${error.message}`
      }
    }
  }
  
  async delete_subdomain(subdomain: string): Promise<{ success: boolean, message: string }> {
    try {
      const subdomain_file = path.join(this.conf_dir, `${subdomain}.conf`)
      
      // ตรวจสอบว่ามีไฟล์อยู่หรือไม่
      try {
        await fs.access(subdomain_file)
      } catch (error) {
        return {
          success: false,
          message: `Subdomain ${subdomain} does not exist`
        }
      }
      
      // อ่าน content ของไฟล์เพื่อดึงข้อมูลโดเมน
      const content = await fs.readFile(subdomain_file, 'utf8');
      const server_name_match = content.match(/server_name\s+([^;]+);/);
      let domain_name = '';
      
      if (server_name_match && server_name_match[1]) {
        domain_name = server_name_match[1].trim();
      }
      
      // ลบไฟล์
      await fs.unlink(subdomain_file)
      
      // รีโหลด NGINX
      await this.reload_nginx()
      
      return {
        success: true,
        message: `Subdomain ${subdomain} deleted successfully`
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete subdomain: ${error.message}`
      }
    }
  }

  // ฟังก์ชันสำหรับจัดการ Let's Encrypt
  async get_lets_encrypt_status(): Promise<lets_encrypt_status> {
    try {
      // ตรวจสอบว่ามีใบรับรองจาก Let's Encrypt หรือไม่
      const certificates: letsencrypt_cert_info[] = []
      
      try {
        // ตรวจสอบว่ามีโฟลเดอร์ live หรือไม่
        const live_dir = path.join(this.letsencrypt_dir, 'live')
        await fs.access(live_dir)
        
        // อ่านรายการโฟลเดอร์ใน live (แต่ละโฟลเดอร์คือหนึ่งโดเมน)
        const domains = await fs.readdir(live_dir)
        
        for (const domain of domains) {
          const domain_dir = path.join(live_dir, domain)
          const fullchain_path = path.join(domain_dir, 'fullchain.pem')
          const cert_path = path.join(domain_dir, 'cert.pem')
          const chain_path = path.join(domain_dir, 'chain.pem')
          const privkey_path = path.join(domain_dir, 'privkey.pem')
          
          try {
            // ตรวจสอบว่ามีไฟล์ใบรับรองทั้งหมดหรือไม่
            await fs.access(fullchain_path)
            await fs.access(cert_path)
            await fs.access(chain_path)
            await fs.access(privkey_path)
            
            // ตรวจสอบวันหมดอายุของใบรับรอง
            let valid_until: Date | undefined = undefined
            try {
              const { stdout } = await exec_async(`openssl x509 -in ${cert_path} -noout -enddate`)
              const date_match = stdout.match(/notAfter=(.+)/)
              if (date_match && date_match[1]) {
                valid_until = new Date(date_match[1])
              }
            } catch (err) {
              // ข้ามไปหากไม่สามารถตรวจสอบวันหมดอายุได้
            }
            
            // ตรวจสอบผู้ออกใบรับรอง (Let's Encrypt)
            let issuer: string | undefined = undefined
            try {
              const { stdout } = await exec_async(`openssl x509 -in ${cert_path} -noout -issuer`)
              const issuer_match = stdout.match(/issuer=(.+)/)
              if (issuer_match && issuer_match[1]) {
                issuer = issuer_match[1]
              }
            } catch (err) {
              // ข้ามไปหากไม่สามารถตรวจสอบผู้ออกใบรับรองได้
            }
            
            certificates.push({
              domain: domain,
              cert_path: cert_path,
              fullchain_path: fullchain_path,
              chain_path: chain_path,
              privkey_path: privkey_path,
              valid_until: valid_until,
              issuer: issuer
            })
            
          } catch (err) {
            // ข้ามไปหากไม่มีไฟล์ใบรับรองทั้งหมด
          }
        }
      } catch (err) {
        // ข้ามไปหากไม่มีโฟลเดอร์ live
      }
      
      // ตรวจสอบว่า NGINX ถูกกำหนดค่าให้ใช้ Let's Encrypt หรือไม่
      let letsencrypt_configured = false
      try {
        const { stdout } = await exec_async(`${this.docker_command_prefix} nginx -T | grep -i "/etc/letsencrypt/live/"`)
        letsencrypt_configured = stdout.length > 0
      } catch (err) {
        // ถ้า grep ไม่พบ จะ return non-zero status
        letsencrypt_configured = false
      }
      
      return {
        enabled: certificates.length > 0 && letsencrypt_configured,
        certificates: certificates
      }
      
    } catch (error) {
      return {
        enabled: false,
        certificates: [],
        error: `Failed to get Let's Encrypt status: ${error.message}`
      }
    }
  }

  async issue_certificate(
    domains: string[], 
    email: string,
    staging: boolean = false
  ): Promise<{ success: boolean, message: string }> {
    try {
      // ตรวจสอบว่า Certbot container ทำงานอยู่หรือไม่
      try {
        await exec_async(`docker ps --filter "name=${CERTBOT_HOST}" --format "{{.Names}}"`)
      } catch (error) {
        return {
          success: false,
          message: 'Certbot container is not running'
        }
      }

      // สร้าง command สำหรับ Certbot 
      const domains_arg = domains.map(domain => `-d ${domain}`).join(' ')
      const staging_arg = staging ? '--staging' : ''
      const certbot_cmd = `certbot certonly --webroot -w ${this.certbot_webroot} ${domains_arg} --email ${email} ${staging_arg} --agree-tos --non-interactive`
      
      // รัน Certbot
      const { stdout, stderr } = await exec_async(`docker exec ${CERTBOT_HOST} ${certbot_cmd}`)
      
      // ตรวจสอบ output ว่าสำเร็จหรือไม่
      if (stdout.includes('Congratulations!') || stdout.includes('Successfully received certificate')) {
        // ปรับแต่ง NGINX config สำหรับทุก domain
        for (const domain of domains) {
          // หาไฟล์ config ของ domain นี้
          try {
            const files = await fs.readdir(this.conf_dir)
            for (const file of files) {
              if (!file.endsWith('.conf')) continue
              
              const content = await fs.readFile(path.join(this.conf_dir, file), 'utf8')
              if (content.includes(`server_name ${domain};`) || content.includes(`server_name ${domain} `)) {
                // อัปเดต SSL config
                let updated_content = content
                
                // ถ้ามี HTTPS server block อยู่แล้ว
                if (content.includes('listen 443 ssl') || content.includes('listen [::]:443 ssl')) {
                  // อัปเดต SSL certificate path
                  updated_content = updated_content.replace(
                    /ssl_certificate\s+[^;]+;/g,
                    `ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;`
                  )
                  updated_content = updated_content.replace(
                    /ssl_certificate_key\s+[^;]+;/g,
                    `ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;`
                  )
                } else {
                  // ถ้าไม่มี HTTPS server block ต้องสร้างใหม่
                  const server_name_match = content.match(/server_name\s+([^;]+);/)
                  const root_match = content.match(/root\s+([^;]+);/)
                  
                  if (server_name_match && root_match) {
                    const server_name = server_name_match[1].trim()
                    const root_path = root_match[1].trim()
                    
                    // สร้าง HTTPS server block
                    updated_content += `

server {
    listen 443 ssl;
    server_name ${server_name};
    
    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
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
                }
                
                // เขียนไฟล์ config ใหม่
                await fs.writeFile(path.join(this.conf_dir, file), updated_content, 'utf8')
              }
            }
          } catch (err) {
            console.error(`Failed to update NGINX config for domain ${domain}:`, err)
          }
        }
        
        // รีโหลด NGINX
        await this.reload_nginx()
        
        return {
          success: true,
          message: 'Certificate issued successfully'
        }
      } else {
        return {
          success: false,
          message: `Failed to issue certificate: ${stderr}`
        }
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to issue certificate: ${error.message}`
      }
    }
  }

  async renew_certificates(): Promise<{ success: boolean, message: string, details?: string }> {
    try {
      // ตรวจสอบว่า Certbot container ทำงานอยู่หรือไม่
      try {
        await exec_async(`docker ps --filter "name=${CERTBOT_HOST}" --format "{{.Names}}"`)
      } catch (error) {
        return {
          success: false,
          message: 'Certbot container is not running'
        }
      }
      
      // รัน Certbot renew
      const { stdout, stderr } = await exec_async(`docker exec ${CERTBOT_HOST} certbot renew --non-interactive`)
      
      // รีโหลด NGINX
      await this.reload_nginx()
      
      return {
        success: true,
        message: 'Certificate renewal process completed',
        details: stdout
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to renew certificates: ${error.message}`
      }
    }
  }

  async revoke_certificate(domain: string): Promise<{ success: boolean, message: string }> {
    try {
      // ตรวจสอบว่า Certbot container ทำงานอยู่หรือไม่
      try {
        await exec_async(`docker ps --filter "name=${CERTBOT_HOST}" --format "{{.Names}}"`)
      } catch (error) {
        return {
          success: false,
          message: 'Certbot container is not running'
        }
      }
      
      // รัน Certbot revoke
      const { stdout, stderr } = await exec_async(`docker exec ${CERTBOT_HOST} certbot revoke --cert-name ${domain} --non-interactive`)
      
      // ลบใบรับรอง
      await exec_async(`docker exec ${CERTBOT_HOST} certbot delete --cert-name ${domain} --non-interactive`)
      
      // อัปเดต NGINX config
      try {
        const files = await fs.readdir(this.conf_dir)
        for (const file of files) {
          if (!file.endsWith('.conf')) continue
          
          const content = await fs.readFile(path.join(this.conf_dir, file), 'utf8')
          if (content.includes(`server_name ${domain};`) || content.includes(`server_name ${domain} `)) {
            // อัปเดตหรือลบ SSL config
            let updated_content = content
            
            // ถ้ามี HTTPS server block
            if (content.includes('listen 443 ssl') || content.includes('listen [::]:443 ssl')) {
              // ลบหรือแทนที่ SSL certificate path ด้วย self-signed certificate
              updated_content = updated_content.replace(
                /ssl_certificate\s+\/etc\/letsencrypt\/live\/[^;]+;/g,
                `ssl_certificate /etc/letsencrypt/self-signed/cert.pem;`
              )
              updated_content = updated_content.replace(
                /ssl_certificate_key\s+\/etc\/letsencrypt\/live\/[^;]+;/g,
                `ssl_certificate_key /etc/letsencrypt/self-signed/key.pem;`
              )
            }
            
            // เขียนไฟล์ config ใหม่
            await fs.writeFile(path.join(this.conf_dir, file), updated_content, 'utf8')
          }
        }
      } catch (err) {
        console.error(`Failed to update NGINX config after revoking certificate:`, err)
      }
      
      // รีโหลด NGINX
      await this.reload_nginx()
      
      return {
        success: true,
        message: `Certificate for ${domain} revoked successfully`
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to revoke certificate: ${error.message}`
      }
    }
  }

  async enable_certbot_config(): Promise<{ success: boolean, message: string }> {
    try {
      // สร้างไฟล์ certbot.conf สำหรับ Let's Encrypt HTTP challenge
      const certbot_config = `# Wellknown location for Let's Encrypt HTTP challenge
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Allow Let's Encrypt HTTP challenge
    location /.well-known/acme-challenge/ {
        root ${this.certbot_webroot};
    }

    # Redirect all other HTTP requests to HTTPS if SSL is enabled
    location / {
        return 301 https://$host$request_uri;
    }
}`;

      // เขียนไฟล์ config
      await fs.writeFile(path.join(this.conf_dir, 'certbot.conf'), certbot_config, 'utf8')
      
      // รีโหลด NGINX
      await this.reload_nginx()
      
      return {
        success: true,
        message: 'Certbot configuration enabled successfully'
      }
      
    } catch (error) {
      return {
        success: false,
        message: `Failed to enable Certbot configuration: ${error.message}`
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

// Let's Encrypt Management Routes
app.get('/letsencrypt', async () => {
  return await nginx.get_lets_encrypt_status()
})

app.post('/letsencrypt/issue', async ({ body }) => {
  const { domains, email, staging } = body as { domains: string[], email: string, staging?: boolean }
  return await nginx.issue_certificate(domains, email, staging)
})

app.post('/letsencrypt/renew', async () => {
  return await nginx.renew_certificates()
})

app.post('/letsencrypt/revoke', async ({ body }) => {
  const { domain } = body as { domain: string }
  return await nginx.revoke_certificate(domain)
})

app.post('/letsencrypt/enable', async () => {
  return await nginx.enable_certbot_config()
})

// Start the server
app.listen(3000, () => {
  console.log('🦊 NGINX Controller running at http://localhost:3000')
})
