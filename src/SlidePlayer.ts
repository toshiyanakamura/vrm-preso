// src/SlidePlayer.ts
export type ShowOptions = {
  waitVideoEnd?: boolean // true なら動画終了まで待つ
}

export class SlidePlayer {
  private img: HTMLImageElement
  private video: HTMLVideoElement

  constructor() {
    this.img = document.getElementById('slide') as HTMLImageElement
    this.video = document.getElementById('slideVideo') as HTMLVideoElement

    // autoplay 安定化
    this.video.muted = true
    ;(this.video as any).playsInline = true
  }

  // 画像 or 動画を出す（拡張子判定はクエリ/ハッシュを無視）
  async show(src: string, opts: ShowOptions = {}) {
    const clean = src.split('#')[0].split('?')[0]
    const isVideo = /\.(mp4|webm|mov)$/i.test(clean)

    if (isVideo) {
      await this.showVideo(src, opts.waitVideoEnd === true)
    } else {
      await this.showImage(src)
    }
  }

  async showImage(src: string) {
    // 画像を表示、動画は止めて隠す
    this.hideVideo()
    await new Promise<void>((resolve, reject) => {
      this.img.onload = () => resolve()
      this.img.onerror = () => reject(new Error('image load error: ' + src))
      this.img.src = src
    })
    this.img.style.display = 'block'
  }

  async showVideo(src: string, waitEnd: boolean) {
    // 画像は隠す、動画をロードして表示
    this.img.style.display = 'none'

    // いったん停止してから差し替え
    try { this.video.pause() } catch {}
    this.video.currentTime = 0
    this.video.src = src

    // load() は同期APIだが、レイアウト更新を1フレーム待つ
    this.video.load()
    await new Promise(r => requestAnimationFrame(() => r(null)))

    this.video.style.display = 'block'
    const playPromise = this.video.play().catch((e) => {
      console.warn('video.play blocked?', e)
    })
    await playPromise

    if (waitEnd) {
      await new Promise<void>((resolve) => {
        this.video.onended = () => resolve()
      })
    }
  }

  hideVideo() {
    try { this.video.pause() } catch {}
    this.video.currentTime = 0
    this.video.style.display = 'none'
  }

  // --- PresoPlayer から使う補助 ---

  /** 動画が表示中か？ */
  isVideoActive(): boolean {
    return this.video.style.display !== 'none'
  }

  /** 再生位置が at 秒以上になるまで待つ（動画表示中のみ有効） */
  async waitVideoTime(atSec: number): Promise<void> {
    if (!this.isVideoActive()) return
    const tgt = Math.max(0, atSec)
    // すでに到達していれば即帰る
    if (this.video.currentTime >= tgt) return

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (this.video.currentTime >= tgt || this.video.ended) return resolve()
        requestAnimationFrame(tick)
      }
      tick()
    })
  }

  /** ダッキング等で動画の音量を一時的に変更（0〜1） */
  setVideoVolume(v: number) {
    this.video.volume = Math.min(1, Math.max(0, v))
  }

  // --- （オプション）スライド設定UIのドラッグ＆ドロップを簡単に付ける ---
  attachGUI(container: HTMLElement) {
    const dropArea = document.createElement('div')
    dropArea.className = 'drop-area'
    dropArea.textContent = 'ここに画像や動画をドロップ'
    dropArea.style.cssText = 'border:1px dashed #888;padding:8px;border-radius:6px;'
    container.appendChild(dropArea)

    dropArea.addEventListener('dragover', e => {
      e.preventDefault()
      dropArea.classList.add('over')
    })
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('over'))
    dropArea.addEventListener('drop', e => {
      e.preventDefault()
      dropArea.classList.remove('over')
      const files = e.dataTransfer?.files
      if (files && files.length) {
        // ここは任意：既存のアップロードAPIに渡すなど
        console.log('[SlidePlayer] dropped files:', Array.from(files).map(f => f.name))
      }
    })
  }
}
