// src/ScriptEditor.ts

// --- types（必要なら your types.ts に合わせてOK） ---
type Emotion = 'neutral'|'happy'|'angry'|'sad'|'surprised'
type VideoWait = 'none'|'end'
type TTSParams = { speedScale?:number; pitchScale?:number; intonationScale?:number; volumeScale?:number }
type NarrationItem = { at?:number; text:string; emotion?:Emotion; speakerId?:number; tts?:TTSParams }
type Cue = {
  slide: number
  image?: string
  video?: string
  videoWait?: VideoWait
  subtitle?: string
  emotion?: Emotion
  speakerId?: number
  tts?: TTSParams
  narration?: NarrationItem[]
  duckVideo?: boolean
}
type ScriptData = { title:string; defaults:{ speakerId:number; tts:TTSParams }; cues:Cue[] }

const EMOTIONS: Emotion[] = ['neutral','happy','angry','sad','surprised']
const VIDEO_WAIT_OPTS: VideoWait[] = ['none','end']

export default class ScriptEditor {
  private root: HTMLElement
  private state: ScriptData

  constructor(root: HTMLElement, initial?: ScriptData) {
    this.root = root
    this.state = this.normalize(initial)
    this.render()
  }

  // 外から台本をセット（差し替え）
  setScript(s?: Partial<ScriptData>) {
    this.state = this.normalize({
      title: s?.title ?? this.state?.title,
      defaults: {
        speakerId: s?.defaults?.speakerId ?? this.state?.defaults?.speakerId,
        tts: {
          speedScale:      s?.defaults?.tts?.speedScale      ?? this.state?.defaults?.tts?.speedScale,
          pitchScale:      s?.defaults?.tts?.pitchScale      ?? this.state?.defaults?.tts?.pitchScale,
          intonationScale: s?.defaults?.tts?.intonationScale ?? this.state?.defaults?.tts?.intonationScale,
          volumeScale:     s?.defaults?.tts?.volumeScale     ?? this.state?.defaults?.tts?.volumeScale,
        }
      },
      cues: s?.cues ?? this.state.cues
    })
    this.render()
  }

  // ✅ 保存は常にこれを呼ぶ（DOMを見ない）
  public commit(): ScriptData {
    return JSON.parse(JSON.stringify(this.state))
  }

  // ====== UI ======
  private render() {
    this.root.innerHTML = ''
    const wrap = el('div', { style: 'display:grid;gap:12px;' })

    // --- ヘッダ ---
    const head = el('div')
    head.innerHTML = `
      <div style="display:grid;gap:8px;grid-template-columns:1fr;">
        <label>タイトル
          <input id="se_title" type="text" style="width:100%;" />
        </label>
        <fieldset style="border:1px solid #444;padding:8px;border-radius:6px;">
          <legend>デフォルト設定</legend>
          <div style="display:grid;gap:8px;grid-template-columns:repeat(5,1fr);align-items:end;">
            <label>話者ID<br><input id="se_def_speaker" type="number" min="1"></label>
            <label>速度<br><input id="se_tts_speed" type="number" step="0.1"></label>
            <label>ピッチ<br><input id="se_tts_pitch" type="number" step="0.1"></label>
            <label>抑揚<br><input id="se_tts_into"  type="number" step="0.1"></label>
            <label>音量<br><input id="se_tts_vol" type="number" step="0.1"></label>
          </div>
        </fieldset>
      </div>
    `
    const title = head.querySelector<HTMLInputElement>('#se_title')!
    const defSp = head.querySelector<HTMLInputElement>('#se_def_speaker')!
    const ssp   = head.querySelector<HTMLInputElement>('#se_tts_speed')!
    const spt   = head.querySelector<HTMLInputElement>('#se_tts_pitch')!
    const sint  = head.querySelector<HTMLInputElement>('#se_tts_into')!
    const svol  = head.querySelector<HTMLInputElement>('#se_tts_vol')!

    title.value = this.state.title
    defSp.value = String(this.state.defaults.speakerId ?? 1)
    ssp.value   = String(this.state.defaults.tts.speedScale ?? 1)
    spt.value   = String(this.state.defaults.tts.pitchScale ?? 0)
    sint.value  = String(this.state.defaults.tts.intonationScale ?? 1)
    svol.value  = String(this.state.defaults.tts.volumeScale ?? 1)

    const syncHeader = () => {
      this.state.title = title.value.trim() || 'プレゼン'
      this.state.defaults.speakerId = num(defSp.value, 1)
      this.state.defaults.tts.speedScale      = num(ssp.value, 1)
      this.state.defaults.tts.pitchScale      = num(spt.value, 0)
      this.state.defaults.tts.intonationScale = num(sint.value, 1)
      this.state.defaults.tts.volumeScale     = num(svol.value, 1)
    }
    ;[title,defSp,ssp,spt,sint,svol].forEach(i => i.addEventListener('input', syncHeader))
    wrap.appendChild(head)

    // --- キュー一覧 ---
    const cueBox = el('div')
    cueBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:6px 0;">キュー</h3>
        <div style="display:flex;gap:8px;">
          <button class="se-add" type="button">+ 追加</button>
          <button class="se-import" type="button">ファイル読込</button>
          <button class="se-export" type="button">JSON保存</button>
        </div>
      </div>
      <div class="se-list" style="display:grid;gap:10px;"></div>
    `
    const list = cueBox.querySelector('.se-list') as HTMLDivElement
    const renderAll = () => {
      list.innerHTML = ''
      this.state.cues.forEach((c, i) => list.appendChild(this.renderCueRow(c, i, renderAll)))
    }
    renderAll()

    cueBox.querySelector<HTMLButtonElement>('.se-add')!.onclick = () => {
      this.state.cues.push({ slide: this.state.cues.length + 1, emotion: 'neutral', videoWait: 'none', subtitle: '' })
      renderAll()
    }
    cueBox.querySelector<HTMLButtonElement>('.se-export')!.onclick = () => {
      const blob = new Blob([JSON.stringify(this.commit(), null, 2)], { type:'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'script.json'; a.click(); URL.revokeObjectURL(a.href)
    }
    cueBox.querySelector<HTMLButtonElement>('.se-import')!.onclick = async () => {
      const file = await pickFile('.json,application/json'); if (!file) return
      try { const txt = await file.text(); this.setScript(JSON.parse(txt)) } catch { alert('JSON の読み込みに失敗しました') }
    }

    wrap.appendChild(cueBox)
    this.root.appendChild(wrap)
  }

  private renderCueRow(cue: Cue, idx: number, rerenderAll: () => void): HTMLElement {
    const row = el('div', { class: 'se-cue', style: 'border:1px solid #333;padding:10px;border-radius:8px;' })
    row.innerHTML = `
      <div style="display:grid;gap:8px;grid-template-columns: 80px 1fr 1fr 120px 120px 120px;align-items:end;">
        <label>スライド<br><input class="se-slide" type="number" min="0"></label>
        <label>画像ファイル名<br><input class="se-image" type="text" placeholder="01.png 等"></label>
        <label>動画ファイル名<br><input class="se-video" type="text" placeholder="intro.mp4 等"></label>
        <label>動画待機<br><select class="se-vwait">${VIDEO_WAIT_OPTS.map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label>
        <label>表情<br><select class="se-emotion">${EMOTIONS.map(e=>`<option value="${e}">${e}</option>`).join('')}</select></label>
        <label>話者ID(任意)<br><input class="se-speaker" type="number" placeholder="空欄=デフォルト"></label>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
        <label><input type="checkbox" class="se-duck"> ダッキング（喋る間だけ動画音量を下げる）</label>
      </div>
      <div style="margin-top:8px;">
        <label>字幕（インライン指示OK）<br><textarea class="se-subtitle" rows="3" style="width:100%;"></textarea></label>
      </div>
      <details class="se-narr" style="margin-top:8px;">
        <summary>🎤 動画ナレーション</summary>
        <div class="se-narr-list" style="display:grid;gap:8px;margin-top:8px;"></div>
        <div style="margin-top:6px;">
          <button class="se-narr-add" type="button">+ ナレーション追加</button>
        </div>
      </details>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="se-up" type="button">↑</button>
        <button class="se-down" type="button">↓</button>
        <button class="se-dup" type="button">複製</button>
        <button class="se-del" type="button" style="margin-left:auto;color:#f66;">削除</button>
      </div>
    `

    const $ = <T extends Element>(sel:string)=>row.querySelector(sel) as T

    // 値反映（← 括弧の位置に注意！）
    ;(($('.se-slide') as any)).value = String(cue.slide ?? 0)
    ;(($('.se-image') as any)).value = cue.image ?? ''
    ;(($('.se-video') as any)).value = cue.video ?? ''
    ;($('.se-vwait') as HTMLSelectElement).value = cue.videoWait ?? 'none'
    ;($('.se-emotion') as HTMLSelectElement).value = cue.emotion ?? 'neutral'
    ;(($('.se-speaker') as any)).value = cue.speakerId?.toString() ?? ''
    ;($('.se-subtitle') as HTMLTextAreaElement).value = cue.subtitle ?? ''
    ;($('.se-duck') as HTMLInputElement).checked = !!cue.duckVideo

    // 相互排他（画像/動画）
    const imgEl = $('.se-image') as HTMLInputElement
    const vidEl = $('.se-video') as HTMLInputElement
    imgEl.addEventListener('input', () => {
      if (imgEl.value){
        vidEl.value=''
        cue.video = undefined
        cue.image = imgEl.value
        this.state.cues[idx] = cue
      }
    })
    vidEl.addEventListener('input', () => {
      if (vidEl.value){
        imgEl.value=''
        cue.image = undefined
        cue.video = vidEl.value
        this.state.cues[idx] = cue
      }
    })

    // 入力 -> state 反映
    const bindInput = (sel:string, fn:()=>void) =>
      ($(sel) as any).addEventListener('input', ()=>{ fn(); this.state.cues[idx]=cue })

    bindInput('.se-slide',   ()=> cue.slide     = num((($('.se-slide') as any)).value, cue.slide||0))
    bindInput('.se-vwait',   ()=> cue.videoWait = (($('.se-vwait') as HTMLSelectElement)).value as VideoWait)
    bindInput('.se-emotion', ()=> cue.emotion   = (($('.se-emotion') as HTMLSelectElement)).value as Emotion)
    bindInput('.se-speaker', ()=> {
      const v = (($('.se-speaker') as HTMLInputElement)).value
      cue.speakerId = v===''? undefined : Number(v)
    })
    bindInput('.se-subtitle',()=> cue.subtitle = (($('.se-subtitle') as HTMLTextAreaElement)).value)
    ;($('.se-duck') as HTMLInputElement).addEventListener('change', ()=>{
      cue.duckVideo = (($('.se-duck') as HTMLInputElement)).checked
      this.state.cues[idx]=cue
    })

    // narr
    const list = $('.se-narr-list') as HTMLDivElement
    const renderNarrAll = () => {
      list.innerHTML = ''
      ;(cue.narration ??= []).forEach((n, i)=> list.appendChild(this.renderNarrRow(n, i, cue, idx, renderNarrAll)))
      this.state.cues[idx]=cue
    }
    renderNarrAll()
    ;($('.se-narr-add') as HTMLButtonElement).onclick = () => {
      (cue.narration ??= []).push({ at:0, text:'', emotion:'neutral' })
      renderNarrAll()
    }

    // 並び替え・複製・削除
    ;($('.se-up') as HTMLButtonElement).onclick = () => {
      if (idx>0){ const a=this.state.cues; [a[idx-1],a[idx]]=[a[idx],a[idx-1]]; rerenderAll() }
    }
    ;($('.se-down') as HTMLButtonElement).onclick = () => {
      if (idx<this.state.cues.length-1){ const a=this.state.cues; [a[idx+1],a[idx]]=[a[idx],a[idx+1]]; rerenderAll() }
    }
    ;($('.se-dup') as HTMLButtonElement).onclick = () => {
      this.state.cues.splice(idx+1,0, JSON.parse(JSON.stringify(cue)))
      rerenderAll()
    }
    ;($('.se-del') as HTMLButtonElement).onclick = () => {
      this.state.cues.splice(idx,1)
      rerenderAll()
    }

    return row
  }

  private renderNarrRow(n: NarrationItem, i:number, cue:Cue, cueIdx:number, rerenderAll:()=>void): HTMLElement {
    const nr = el('div', { class: 'se-narr-item', style: 'border:1px dashed #444;padding:8px;border-radius:6px;' })
    nr.innerHTML = `
      <div style="display:grid;gap:6px;grid-template-columns:100px 1fr 120px 120px;">
        <label>時刻(秒)<br><input class="se-n-at" type="number" step="0.1" min="0"></label>
        <label>テキスト（インライン指示OK）<br><textarea class="se-n-text" rows="2" style="width:100%;"></textarea></label>
        <label>表情<br><select class="se-n-emo">${EMOTIONS.map(e=>`<option value="${e}">${e}</option>`).join('')}</select></label>
        <label>話者ID<br><input class="se-n-sp" type="number" placeholder="空=デフォ"></label>
      </div>
      <div style="display:grid;gap:6px;grid-template-columns:repeat(4,1fr);align-items:end;margin-top:6px;">
        <label>速度<br><input class="se-nt-speed" type="number" step="0.1" placeholder="空=継承"></label>
        <label>ピッチ<br><input class="se-nt-pitch" type="number" step="0.1" placeholder="空=継承"></label>
        <label>抑揚<br><input class="se-nt-into"  type="number" step="0.1" placeholder="空=継承"></label>
        <label>音量<br><input class="se-nt-vol"   type="number" step="0.1" placeholder="空=継承"></label>
      </div>
      <div style="display:flex;gap:8px;margin-top:6px;">
        <button class="se-n-up" type="button">↑</button>
        <button class="se-n-down" type="button">↓</button>
        <button class="se-n-del" type="button" style="margin-left:auto;color:#f66;">削除</button>
      </div>
    `
    const $ = <T extends Element>(sel:string)=>nr.querySelector(sel) as T
    ;(($('.se-n-at') as any)).value    = n.at?.toString() ?? ''
    ;(($('.se-n-text') as any)).value  = n.text ?? ''
    ;($('.se-n-emo') as HTMLSelectElement).value = n.emotion ?? 'neutral'
    ;(($('.se-n-sp') as any)).value    = n.speakerId?.toString() ?? ''
    ;(($('.se-nt-speed') as any)).value = n.tts?.speedScale?.toString() ?? ''
    ;(($('.se-nt-pitch') as any)).value = n.tts?.pitchScale?.toString() ?? ''
    ;(($('.se-nt-into')  as any)).value = n.tts?.intonationScale?.toString() ?? ''
    ;(($('.se-nt-vol')   as any)).value = n.tts?.volumeScale?.toString() ?? ''

    const commit = ()=>{ (cue.narration ??= [])[i]=n; this.state.cues[cueIdx]=cue }

    const bind = (sel:string, fn:()=>void) =>
      ($(sel) as any).addEventListener('input', ()=>{ fn(); commit() })

    bind('.se-n-at',   ()=> n.at = num((($('.se-n-at') as any)).value, 0))
    bind('.se-n-text', ()=> n.text = (($('.se-n-text') as HTMLTextAreaElement)).value)
    bind('.se-n-emo',  ()=> n.emotion = (($('.se-n-emo') as HTMLSelectElement)).value as Emotion)
    bind('.se-n-sp',   ()=> {
      const v = (($('.se-n-sp') as HTMLInputElement)).value
      n.speakerId = v===''? undefined : Number(v)
    })

    const ensureTTS = ()=> (n.tts ??= {})
    bind('.se-nt-speed',()=> ensureTTS().speedScale      = num((($('.se-nt-speed') as any)).value, NaN))
    bind('.se-nt-pitch',()=> ensureTTS().pitchScale      = num((($('.se-nt-pitch') as any)).value, NaN))
    bind('.se-nt-into', ()=> ensureTTS().intonationScale = num((($('.se-nt-into')  as any)).value, NaN))
    bind('.se-nt-vol',  ()=> ensureTTS().volumeScale     = num((($('.se-nt-vol')   as any)).value, NaN))

    ;($('.se-n-up') as HTMLButtonElement).onclick   = () => {
      if (i>0){ const arr=cue.narration!; [arr[i-1],arr[i]]=[arr[i],arr[i-1]]; rerenderAll() }
    }
    ;($('.se-n-down') as HTMLButtonElement).onclick = () => {
      const arr=cue.narration!
      if (i<arr.length-1){ [arr[i+1],arr[i]]=[arr[i],arr[i+1]]; rerenderAll() }
    }
    ;($('.se-n-del') as HTMLButtonElement).onclick  = () => {
      cue.narration!.splice(i,1); rerenderAll()
    }

    return nr
  }

  // ====== helpers ======
  private normalize(s?: Partial<ScriptData>): ScriptData {
    return {
      title: s?.title ?? 'プレゼン',
      defaults: {
        speakerId: s?.defaults?.speakerId ?? 1,
        tts: {
          speedScale: s?.defaults?.tts?.speedScale ?? 1,
          pitchScale: s?.defaults?.tts?.pitchScale ?? 0,
          intonationScale: s?.defaults?.tts?.intonationScale ?? 1,
          volumeScale: s?.defaults?.tts?.volumeScale ?? 1,
        }
      },
      cues: (s?.cues ?? []).map(c => ({
        slide: Number(c.slide ?? 0),
        image: c.image,
        video: c.video,
        videoWait: (c as any).videoWait ?? 'none',
        subtitle: c.subtitle ?? '',
        emotion: (c.emotion as Emotion) ?? 'neutral',
        speakerId: c.speakerId,
        tts: c.tts,
        narration: (c as any).narration as NarrationItem[] | undefined,
        duckVideo: !!(c as any).duckVideo
      }))
    }
  }
}

// ---- helpers ----
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, children: (HTMLElement|string)[]=[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.entries(attrs).forEach(([k,v]) => (node as any)[k] = v)
  children.forEach(ch => node.append(ch))
  return node
}
function num(v:any, def:number){ if(v===''||v==null)return def; const n=Number(v); return Number.isFinite(n)?n:def }
async function pickFile(accept:string){ return new Promise<File|null>(res=>{ const i=document.createElement('input'); i.type='file'; i.accept=accept; i.onchange=()=>res(i.files?.[0]??null); i.click() }) }
