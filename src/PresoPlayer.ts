import { AvatarController } from './AvatarController'
import { SlidePlayer } from './SlidePlayer'
import { fetchVoiceFromVOICEVOX } from './voicevox'
import type { ScriptData, Cue, TTSParams } from './types'

type InlineAction =
  | 'nod'
  | 'wave' | 'waveL' | 'waveR'
  | 'pointL' | 'pointR'
  | 'bow'
  | 'lookSlide' | 'lookAudience'
  | 'happy' | 'angry' | 'surprised' | 'neutral' | 'sad'
  | 'wait' | 'present' | 'openArms' | 'emphasize' | 'agree' | 'disagree' | 'think'
export class PresoPlayer {
  private audio: HTMLAudioElement
  private isPlaying = false
  private isPaused = false
  private abort?: AbortController
  private pausedGate?: Promise<void>
  private resumeGateResolver?: () => void
  public currentCueIndex = 0

  constructor(
    private avatar: AvatarController,
    private slides: SlidePlayer,
    private subtitleEl: HTMLDivElement
  ) {
    this.audio = new Audio()

    // === ここが重要：音声イベントで口パク状態を同期 ===
    this.audio.addEventListener('play',    () => this.avatar.setSpeaking(true))
    this.audio.addEventListener('playing', () => this.avatar.setSpeaking(true))
    this.audio.addEventListener('pause',   () => this.avatar.setSpeaking(false))
    this.audio.addEventListener('ended',   () => this.avatar.setSpeaking(false))
  }

  async play(script: ScriptData, defaultSpeakerId: number, startIndex = 0) {
    if (this.isPlaying) await this.stop()
    this.isPlaying = true
    this.isPaused = false
    this.abort = new AbortController()
    this.currentCueIndex = startIndex

    try {
      for (let i = this.currentCueIndex; i < script.cues.length; i++) {
        this.currentCueIndex = i
        if (this.abort.signal.aborted) break
        await this.waitIfPaused()
        await this.playCue(script.cues[i], script.defaults, defaultSpeakerId)
      }
    } finally {
      this.isPlaying = false
      this.isPaused = false
      this.abort = undefined
      this.currentCueIndex = 0
      // 念のため停止時は喋ってない扱いに
      this.avatar.setSpeaking(false)
      this.avatar.setMouthWeight(0)
    }
  }

  async restart(script: ScriptData, defaultSpeakerId: number) {
    await this.stop()
    return this.play(script, defaultSpeakerId, 0)
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return
    this.isPaused = true
    try { this.audio.pause() } catch {}
    // 明示的に false（イベント来ないケースの保険）
    this.avatar.setSpeaking(false)
  }

  resume() {
    if (!this.isPlaying || !this.isPaused) return
    this.isPaused = false
    this.audio.play().then(() => {
      // play/playing イベントも来るが、保険で true を立ててもOK
      this.avatar.setSpeaking(true)
    }).catch(()=>{})
    this.resumeGateResolver?.()
    this.resumeGateResolver = undefined
    this.pausedGate = undefined
  }

  async stop() {
    if (!this.isPlaying && !this.isPaused) return
    this.abort?.abort()
    this.isPaused = false
    this.resumeGateResolver?.()
    this.resumeGateResolver = undefined
    this.pausedGate = undefined
    try { this.audio.pause() } catch {}
    this.avatar.setMouthWeight(0)
    this.avatar.setSpeaking(false) // ← ここ大事
    this.isPlaying = false
    this.currentCueIndex = 0
  }

  private waitIfPaused(): Promise<void> {
    if (!this.isPaused) return Promise.resolve()
    if (!this.pausedGate) {
      this.pausedGate = new Promise<void>((resolve) => { this.resumeGateResolver = resolve })
    }
    return this.pausedGate
  }

  private async playCue(
    cue: Cue,
    defaults: ScriptData['defaults'] = {} as any,
    defaultSpeakerId: number
  ) {
    const media = await this.tryShowSlide(cue).catch(() => ({ isVideo:false, waited:false } as any))

    if (cue.emotion) this.avatar.setEmotion(cue.emotion)
    this.subtitleEl.textContent = cue.subtitle ?? ''

    const baseSpeaker = cue.speakerId ?? defaults?.speakerId ?? defaultSpeakerId
    const baseTts: TTSParams = { ...(defaults?.tts || {}), ...(cue.tts || {}) }

    if (Array.isArray(cue.narration) && cue.narration.length > 0) {
      const narrs = [...cue.narration].sort((a,b)=>(a.at ?? 0) - (b.at ?? 0))
      for (const n of narrs) {
        await this.waitIfPaused()
        if (this.abort?.signal.aborted) break
        const at = Math.max(0, n.at ?? 0)
        await this.slides.waitVideoTime(at)
        if (n.emotion) this.avatar.setEmotion(n.emotion)

        let restoreVol: number | null = null
        if (cue.duckVideo && this.slides.isVideoActive()) {
          // @ts-ignore
          const cur = (this.slides as any).video?.volume ?? 1
          restoreVol = cur
          this.slides.setVideoVolume(Math.min(0.25, cur))
        }

        await this.speakSegments(n.text, n.speakerId ?? baseSpeaker, { ...baseTts, ...(n.tts || {}) })

        if (restoreVol != null) this.slides.setVideoVolume(restoreVol)
      }
      return
    }

    if (media.isVideo && (cue.videoWait === 'end' || (media as any).waited)) {
      if (cue.subtitle?.trim()) await this.speakSegments(cue.subtitle, baseSpeaker, baseTts)
      return
    }

    const text = cue.subtitle || ''
    if (text.trim()) await this.speakSegments(text, baseSpeaker, baseTts)
  }

  // ---- スライド解決 ----
  private async tryShowSlide(cue: Cue) {
    const vq = `?v=${Date.now()}`
    const p = (name: string) => `/slides/${encodeURI(name)}${vq}`

    if (cue.video) {
      const wait = (cue.videoWait ?? 'none') === 'end'
      await this.slides.show(p(cue.video), { waitVideoEnd: wait })
      return { isVideo: true, waited: wait }
    }

    if (cue.image && /\.(mp4|webm|mov)$/i.test(cue.image)) {
      const wait = (cue.videoWait ?? 'none') === 'end'
      await this.slides.show(p(cue.image), { waitVideoEnd: wait })
      return { isVideo: true, waited: wait }
    }

    const n = cue.slide
    const given = (cue.image ?? '').trim()
    const baseCandidates: string[] = []
    const fullCandidates: string[] = []

    if (given) {
      if (/\.(png|jpe?g)$/i.test(given)) fullCandidates.push(given)
      else baseCandidates.push(given)
    } else {
      baseCandidates.push(String(n), String(n).padStart(2, '0'), `スライド${n}`)
    }

    const exts = ['.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG']

    for (const name of fullCandidates) {
      await this.slides.show(p(name))
      return { isVideo: false, waited: false }
    }
    for (const base of baseCandidates) {
      for (const ext of exts) {
        try { await this.slides.show(p(base + ext)); return { isVideo: false, waited: false } } catch {}
      }
    }
    console.error('スライドが見つかりません:', { cue })
    throw new Error('slide not found')
  }

  // ---- 音声再生（インラインアクション対応）----
  private async speakSegments(rawText: string, speaker: number, tts: TTSParams) {
    const segments = this.splitTextWithInlineActions(rawText)

    for (const seg of segments) {
      await this.waitIfPaused()
      if (this.abort?.signal.aborted) break

      if (seg.type === 'action') {
        if (seg.name === 'wait') {
          // ms 指定があれば待機
          if (seg.ms && seg.ms > 0) {
            await new Promise(r => setTimeout(r, seg.ms))
          }
          continue // 待機後に続行
        }

        await this.fireInlineAction(seg.name, seg.ms)
        continue
      }

      const safe = seg.text.replace(/\{[^{}\n]{1,50}\}/g, '').trim()
      if (!safe) continue
      await this.speakOnce(safe, speaker, tts)
    }
  }


  private async speakOnce(text: string, speaker: number, tts: TTSParams) {
    try {
      const blob = await fetchVoiceFromVOICEVOX(text, speaker, tts)
      const url = URL.createObjectURL(blob)
      await this.setupAudio(url)

      let playErr: any = null
      await this.audio.play().catch(e => (playErr = e))
      if (playErr) { console.error('audio.play()失敗:', playErr); return }

      // イベントで拾うが、保険で true
      this.avatar.setSpeaking(true)

      this.trackMouthUntilEnd()
      await new Promise<void>((resolve) => {
        this.audio.onended = () => { 
          this.avatar.setMouthWeight(0)
          this.avatar.setSpeaking(false)
          resolve()
        }
      })
    } catch (err) {
      console.error('音声生成失敗:', err)
      this.avatar.setSpeaking(false)
    }
  }

  private async setupAudio(url: string) {
    try { this.audio.pause() } catch {}
    this.audio.src = url
    this.audio.load()
    await new Promise(r => requestAnimationFrame(() => r(null)))
  }

  private trackMouthUntilEnd() {
    const tick = () => {
      if (this.audio.paused || this.audio.ended) { this.avatar.setMouthWeight(0); return }
      this.avatar.setMouthWeight(0.4 + Math.random() * 0.6)
      requestAnimationFrame(tick)
    }
    tick()
  }

  private splitTextWithInlineActions(input: string): Array<
    | { type: 'text'; text: string }
    | { type: 'action'; name: InlineAction; ms?: number }
  > {
    if (!input) return []
    const s = input
      .replace(/\uFF5B/g, '{')
      .replace(/\uFF5D/g, '}')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')

    // splitTextWithInlineActions 内の正規表現
    // splitTextWithInlineActions の re を置き換え
    const re = /\{\s*(nod|wave|waveL|waveR|pointL|pointR|bow|lookSlide|lookAudience|happy|angry|surprised|neutral|sad|wait|present|openArms|emphasize|agree|disagree|think)\s*(?::\s*(\d{2,5}))?\s*\}/g



    const out: Array<{ type: 'text' | 'action'; text?: string; name?: InlineAction; ms?: number }> = []
    let last = 0, m: RegExpExecArray | null

    while ((m = re.exec(s))) {
      const text = s.slice(last, m.index)
      if (text) out.push({ type: 'text', text })
      out.push({ type: 'action', name: m[1] as InlineAction, ms: m[2] ? Number(m[2]) : undefined })
      last = re.lastIndex
    }
    const tail = s.slice(last)
    if (tail) out.push({ type: 'text', text: tail })
    return out as any
  }

  private async fireInlineAction(act?: InlineAction, ms?: number) {
    if (!act) return
    try {
      switch (act) {
        case 'nop': break // ← 何もしない
        case 'nod': this.avatar?.['nod']?.(ms ?? 400); break
        case 'wave': this.avatar?.['waveR']?.(ms ?? 900); break
        case 'waveR': this.avatar?.['waveR']?.(ms ?? 900); break
        case 'waveL': this.avatar?.['waveL']?.(ms ?? 900); break
        case 'pointR': this.avatar?.['pointR']?.(ms ?? 800); break
        case 'pointL': this.avatar?.['pointL']?.(ms ?? 800); break
        case 'bow': this.avatar?.['bow']?.(ms ?? 600); break
        case 'lookSlide': this.avatar?.['lookSlide']?.(ms ?? 1000); break
        case 'lookAudience': this.avatar?.['lookAudience']?.(); break
        case 'happy': this.avatar.setEmotion('happy'); break
        case 'angry': this.avatar.setEmotion('angry'); break
        case 'surprised': this.avatar.setEmotion('surprised'); break
        case 'neutral': this.avatar.setEmotion('neutral'); break
        case 'sad': this.avatar.setEmotion('sad'); break
        case 'present':    await (this.avatar as any)['present']?.(ms ?? 1200); break;
        case 'openArms':   await (this.avatar as any)['openArms']?.(ms ?? 900); break;
        case 'emphasize':  await (this.avatar as any)['emphasize']?.(ms ?? 600); break;
        case 'agree':      await (this.avatar as any)['agree']?.(ms ?? 800); break;
        case 'disagree':   await (this.avatar as any)['disagree']?.(ms ?? 800); break;
        case 'think':      await (this.avatar as any)['think']?.(ms ?? 800); break;
      }
    } catch (e) {
      console.warn('inline action error:', act, e)
    }
  }
}
