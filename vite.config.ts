import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

function readBody(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

// ★ この vite.config.ts が置かれているプロジェクトルートを基準にする
const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const publicDir   = path.join(projectRoot, 'public')
const slidesDir   = path.join(publicDir, 'slides')
const scriptPath  = path.join(publicDir, 'script.json')

export default defineConfig({
  plugins: [
    {
      name: 'local-api',
      configureServer(server) {
        // 保存
        server.middlewares.use('/api/save-script', async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
          try {
            const raw = await readBody(req)
            const text = raw.toString('utf8')
            const data = JSON.parse(text)

            if (!data || !Array.isArray(data.cues)) {
              res.statusCode = 400
              return res.end('Invalid body: "cues" missing')
            }

            fs.mkdirSync(publicDir, { recursive: true })
            fs.writeFileSync(scriptPath, JSON.stringify(data, null, 2), 'utf8')

            // ★ ログ（Windows でパス確認しやすく）
            console.log(`[save-script] wrote ${data.cues.length} cues ->`, scriptPath)

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e: any) {
            console.error('[save-script] error:', e?.message)
            res.statusCode = 500
            res.end('save failed: ' + e?.message)
          }
        })

        // スライド一覧
        server.middlewares.use('/api/list-slides', (req, res) => {
          try {
            fs.mkdirSync(slidesDir, { recursive: true })
            const files = fs.readdirSync(slidesDir)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ files }))
          } catch (e: any) {
            console.warn('[list-slides] error:', e?.message)
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ files: [] }))
          }
        })

        // スライドアップロード（ボディ生バイト）
        server.middlewares.use('/api/upload-slide', async (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
          try {
            const url = new URL(req.url!, 'http://localhost')
            const name = url.searchParams.get('name') || 'upload.bin'
            const out = path.join(slidesDir, name)
            fs.mkdirSync(slidesDir, { recursive: true })
            const buf = await readBody(req)
            fs.writeFileSync(out, buf)
            console.log('[upload-slide] ->', out)
            res.statusCode = 200
            res.end('ok')
          } catch (e: any) {
            console.error('[upload-slide] error:', e?.message)
            res.statusCode = 500
            res.end('upload failed: ' + e?.message)
          }
        })
      },
    },
  ],
})
