// src/main.ts
import { AvatarController } from './AvatarController'
import { SlidePlayer } from './SlidePlayer'
import { PresoPlayer } from './PresoPlayer'
import type { ScriptData } from './types'
import ScriptEditor from './ScriptEditor'

// ---------- DOM ----------
const appRoot = document.getElementById('app') as HTMLElement
const subtitleEl = document.getElementById('subtitle') as HTMLDivElement

const vrmFile = document.getElementById('vrmFile') as HTMLInputElement
const openSettingsBtn = document.getElementById('openSettingsBtn') as HTMLButtonElement
const settingsPanel = document.getElementById('settings') as HTMLDivElement
const modelSettings = document.getElementById('model-settings') as HTMLDivElement
const slideSettings = document.getElementById('slide-settings') as HTMLDivElement

const startBtn  = document.getElementById('startBtn')  as HTMLButtonElement
const pauseBtn  = document.getElementById('pauseBtn')  as HTMLButtonElement
const resumeBtn = document.getElementById('resumeBtn') as HTMLButtonElement
const stopBtn   = document.getElementById('stopBtn')   as HTMLButtonElement

const slidesUploadBtn = document.getElementById('slidesUploadBtn') as HTMLButtonElement
const slidesFileInput = document.getElementById('slidesFileInput') as HTMLInputElement
const slidesDropzone  = document.getElementById('slidesDropzone')  as HTMLDivElement

const speakerSelect = document.getElementById('speakerSelect') as HTMLSelectElement

const openEditorBtn      = document.getElementById('openEditorBtn')      as HTMLButtonElement
const editorModal        = document.getElementById('editorModal')        as HTMLDivElement
const editorPanel        = document.getElementById('editorPanel')        as HTMLDivElement
const editorCloseBtn     = document.getElementById('editorCloseBtn')     as HTMLButtonElement
const editorLoadBtn      = document.getElementById('editorLoadBtn')      as HTMLButtonElement
const editorDownloadBtn  = document.getElementById('editorDownloadBtn')  as HTMLButtonElement
const editorSaveBtn      = document.getElementById('editorSaveBtn')      as HTMLButtonElement
const editorApplyBtn     = document.getElementById('editorApplyBtn')     as HTMLButtonElement
const scriptEditorRoot   = document.getElementById('scriptEditorRoot')   as HTMLDivElement

// スライド要素（画像と動画を同じレイアウトで同期）
const slideImg = document.getElementById('slide') as HTMLImageElement
const slideVid = document.getElementById('slideVideo') as HTMLVideoElement

// ---------- インスタンス ----------
const avatar = new AvatarController(appRoot)
const slides = new SlidePlayer()
const player = new PresoPlayer(avatar, slides, subtitleEl)

// ---------- 状態 ----------
let currentScript: ScriptData | null = null
let lastGoodScript: ScriptData | null = null
let selectedSpeakerId = 1
let slideGuiAttached = false
let armUiAttached = false   // ← 追加：腕スライダーを1回だけ挿す
let vrmReady = false
let scriptEditor: ScriptEditor | null = null

// スライドレイアウト（左/下はpx、幅はvw）
let slideLeftPx = 20
let slideBottomPx = 20
let slideWidthVw = 40

// ---------- 初期化 ----------
init().catch(console.error)

async function init() {
  currentScript = await loadScriptOrDemo()
  if (currentScript?.cues?.length) lastGoodScript = currentScript
  await populateSpeakers()
  applyScriptSpeakerToUI()

  setControls('idle')

  // VRM読み込み
  vrmFile.onchange = async () => {
    const f = vrmFile.files?.[0]
    if (!f) return
    try {
      await avatar.loadVRM(f, modelSettings)
      avatar.animate()
      openSettingsBtn.disabled = false
      vrmReady = true
      setControls('idle')

      // 設定パネルが開いていたら、腕スライダーとスライドGUIを一緒に取り付け
      if (settingsPanel.style.display !== 'none') {
        attachArmsUIOnce()
        attachSlideGuiOnce()
      }
    } catch (e) {
      console.error('VRM load error', e)
      alert('VRM の読み込みに失敗しました')
    }
  }

  openSettingsBtn.onclick = () => {
    const wantOpen = settingsPanel.style.display === 'none'
    showSettings(wantOpen)
    if (wantOpen) {
      // 開いたタイミングで取り付け（VRM読み込み済みなら腕UIも）
      if (vrmReady) attachArmsUIOnce()
      attachSlideGuiOnce()
      mountSlideLayoutControls()
    }
  }

  // 発表開始
  startBtn.onclick = async () => {
    syncScriptFromEditorIfAny({ allowEmpty: false })
    if (!currentScript?.cues?.length && lastGoodScript?.cues?.length) {
      console.warn('use lastGoodScript fallback')
      currentScript = lastGoodScript
    }

    const err = validateScript(currentScript)
    if (err) { alert(err); console.warn('SCRIPT_INVALID', currentScript); return }
    if (!vrmReady) { alert('VRM を読み込んでください'); return }

    setControls('playing')
    try {
      selectedSpeakerId = Number(speakerSelect.value || 1)
      await player.stop()
      await player.play(currentScript!, selectedSpeakerId, 0)
    } catch (e) {
      console.error('play failed', e)
      alert('再生中にエラーが発生しました。Console を確認してください。')
    } finally {
      setControls('idle')
    }
  }

  pauseBtn.onclick  = () => { player.pause();  setControls('paused') }
  resumeBtn.onclick = () => { player.resume(); setControls('playing') }
  stopBtn.onclick   = async () => { await player.stop(); setControls('idle') }

  // スライド追加UI
  slidesUploadBtn.onclick = () => slidesFileInput.click()
  slidesFileInput.onchange = async () => {
    const files = Array.from(slidesFileInput.files || [])
    if (files.length) await uploadSlidesAndAppendToScript(files)
    slidesFileInput.value = ''
  }
  ;['dragenter','dragover'].forEach(ev =>
    slidesDropzone.addEventListener(ev, (e) => { e.preventDefault(); slidesDropzone.classList.add('dragover') })
  )
  ;['dragleave','drop'].forEach(ev =>
    slidesDropzone.addEventListener(ev, (e) => { e.preventDefault(); slidesDropzone.classList.remove('dragover') })
  )
  slidesDropzone.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer
    if (!dt) return
    const files = Array.from(dt.files).filter(f => /(\.png|\.jpg|\.jpeg|\.mp4|\.webm|\.mov)$/i.test(f.name))
    if (files.length) await uploadSlidesAndAppendToScript(files)
  })

  // エディタ
  wireScriptEditor()

  // Rキー：リスタート
  window.addEventListener('keydown', async (e) => {
    if (e.key.toLowerCase() !== 'r' || !vrmReady) return
    syncScriptFromEditorIfAny({ allowEmpty: false })
    if (!currentScript?.cues?.length && lastGoodScript?.cues?.length) {
      currentScript = lastGoodScript
    }
    if (!currentScript?.cues?.length) { alert('台本に cue がありません'); return }
    setControls('playing')
    try {
      await player.stop()
      await player.play(currentScript, selectedSpeakerId, 0)
    } finally {
      setControls('idle')
    }
  })

  // スライドのドラッグ＆リサイズ
  enableSlideDragResize()
  applySlideLayout()

  // 話者セレクト→台本に反映
  speakerSelect.onchange = () => {
    const id = Number(speakerSelect.value || 1)
    if (!currentScript) currentScript = { title:'', defaults:{ speakerId:id, tts:{} }, cues:[] } as any
    currentScript.defaults = currentScript.defaults || { speakerId:id, tts:{} }
    currentScript.defaults.speakerId = id

    const se = (window as any).__ScriptEditor as ScriptEditor | undefined
    const headerInput = document.querySelector<HTMLInputElement>('#se_def_speaker')
    if (headerInput) headerInput.value = String(id)
    if (se) {
      const s = se.commit()
      s.defaults.speakerId = id
      se.setScript(s)
    }
  }
}

function attachArmsUIOnce() {
  if (armUiAttached) return
  try {
    // AvatarController 側で用意した簡易スライダーUIを modelSettings に挿入
    (avatar as any).attachArmTweakUI?.(modelSettings)
    armUiAttached = true
  } catch (e) {
    console.warn('attachArmTweakUI failed or not available', e)
  }
}

function attachSlideGuiOnce() {
  if (!slideGuiAttached && (slides as any).attachGUI) {
    try { (slides as any).attachGUI(slideSettings); slideGuiAttached = true } catch {}
  }
}

function applyScriptSpeakerToUI() {
  const id = currentScript?.defaults?.speakerId
  if (id != null) {
    const opt = Array.from(speakerSelect.options).find(o => Number(o.value) === Number(id))
    if (opt) speakerSelect.value = String(id)
  }
}

// ---------- UI補助 ----------
function setControls(state: 'idle'|'playing'|'paused') {
  if (state === 'idle') {
    startBtn.style.display  = vrmReady ? 'inline-block' : 'none'
    pauseBtn.style.display  = 'none'
    resumeBtn.style.display = 'none'
    stopBtn.style.display   = 'none'
  } else if (state === 'playing') {
    startBtn.style.display  = 'none'
    pauseBtn.style.display  = 'inline-block'
    resumeBtn.style.display = 'none'
    stopBtn.style.display   = 'inline-block'
  } else {
    startBtn.style.display  = 'none'
    pauseBtn.style.display  = 'none'
    resumeBtn.style.display = 'inline-block'
    stopBtn.style.display   = 'inline-block'
  }
}

function showSettings(open: boolean) {
  if (open) editorModal.style.display = 'none'
  settingsPanel.style.display = open ? 'block' : 'none'
}

// ---------- スライド配置（ドラッグ＆リサイズ + 数値UI） ----------
function applySlideLayout() {
  const apply = (el: HTMLElement) => {
    el.style.left = `${slideLeftPx}px`
    el.style.bottom = `${slideBottomPx}px`
    el.style.width = `${slideWidthVw}vw`
  }
  apply(slideImg)
  apply(slideVid)
}

function mountSlideLayoutControls() {
  if (!slideSettings) return
  slideSettings.innerHTML = `
    <div style="display:grid;gap:8px;grid-template-columns:repeat(3,1fr);align-items:end;">
      <label>左(px)<br><input id="sl-x" type="number" step="1"></label>
      <label>下(px)<br><input id="sl-y" type="number" step="1"></label>
      <label>幅(vw)<br><input id="sl-w" type="number" step="0.5" min="5" max="100"></label>
    </div>
    <div style="margin-top:6px;display:flex;gap:8px;">
      <button id="sl-reset" type="button">リセット</button>
      <span style="opacity:.7;">ヒント：スライドをドラッグで移動、ホイールで拡大縮小（Ctrlで微調整）</span>
    </div>
  `
  const x = document.getElementById('sl-x') as HTMLInputElement
  const y = document.getElementById('sl-y') as HTMLInputElement
  const w = document.getElementById('sl-w') as HTMLInputElement
  const reset = document.getElementById('sl-reset') as HTMLButtonElement

  const syncInputs = () => { x.value = String(slideLeftPx); y.value = String(slideBottomPx); w.value = String(slideWidthVw) }
  syncInputs()

  x.oninput = () => { slideLeftPx = Number(x.value || 0); applySlideLayout() }
  y.oninput = () => { slideBottomPx = Number(y.value || 0); applySlideLayout() }
  w.oninput = () => { slideWidthVw = clamp(Number(w.value || 40), 5, 100); applySlideLayout() }
  reset.onclick = () => { slideLeftPx = 20; slideBottomPx = 20; slideWidthVw = 40; syncInputs(); applySlideLayout() }
}

function enableSlideDragResize() {
  const targets: HTMLElement[] = [slideImg, slideVid]
  let dragging = false
  let startX = 0, startY = 0
  let baseLeft = 0, baseBottom = 0

  const onDown = (e: MouseEvent) => {
    dragging = true
    startX = e.clientX
    startY = e.clientY
    baseLeft = slideLeftPx
    baseBottom = slideBottomPx
    document.body.style.userSelect = 'none'
  }
  const onMove = (e: MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    slideLeftPx = baseLeft + dx
    slideBottomPx = baseBottom - dy
    applySlideLayout()
    const x = document.getElementById('sl-x') as HTMLInputElement
    const y = document.getElementById('sl-y') as HTMLInputElement
    if (x) x.value = String(slideLeftPx)
    if (y) y.value = String(slideBottomPx)
  }
  const onUp = () => {
    dragging = false
    document.body.style.userSelect = ''
  }
  const onWheel = (e: WheelEvent) => {
    const step = e.ctrlKey ? 0.5 : 2
    slideWidthVw = clamp(slideWidthVw + (e.deltaY > 0 ? -step : step), 5, 100)
    applySlideLayout()
    const w = document.getElementById('sl-w') as HTMLInputElement
    if (w) w.value = String(Math.round(slideWidthVw * 10) / 10)
    e.preventDefault()
  }

  targets.forEach(t => {
    t.style.cursor = 'move'
    t.addEventListener('mousedown', onDown)
    t.addEventListener('wheel', onWheel, { passive: false })
  })
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// ---------- 台本エディタ ----------
function wireScriptEditor() {
  openEditorBtn.onclick = () => {
    settingsPanel.style.display = 'none'
    editorModal.style.display = 'block'
    if (!scriptEditor) {
      scriptEditor = new ScriptEditor(scriptEditorRoot, currentScript ?? demoScript())
    } else if (currentScript) {
      scriptEditor.setScript(currentScript)
    }
    ;(window as any).__ScriptEditor = scriptEditor
  }

  editorCloseBtn.onclick = () => { syncScriptFromEditorIfAny({ allowEmpty: false }); editorModal.style.display = 'none' }

  editorModal.addEventListener('click', (e) => {
    if (e.target === editorModal) editorModal.style.display = 'none'
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editorModal.style.display !== 'none') {
      editorModal.style.display = 'none'
    }
  })

  // 読み込み（no-cache）
  editorLoadBtn.onclick = async () => {
    try {
      const res = await fetch('/script.json?ts=' + Date.now(), { cache: 'no-cache' })
      if (!(res.status === 304 || res.ok)) throw new Error('not ok')
      currentScript = await res.json()
      if (currentScript?.cues?.length) lastGoodScript = currentScript
      scriptEditor?.setScript(currentScript)
      applyScriptSpeakerToUI()
      alert('script.json を読み込みました')
    } catch {
      alert('script.json が見つかりません')
    }
  }

  // JSON ダウンロード
  editorDownloadBtn.onclick = () => {
    const data = scriptEditor ? scriptEditor.getScript() : currentScript
    if (!data) return alert('台本がありません')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'script.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // 上書き保存（UI→state→保存）
  editorSaveBtn.onclick = async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise(r => setTimeout(r, 0));
    const data = scriptEditor!.commit()
    console.log('[SAVE] cuesLen=', data.cues?.length, data)
    try {
      const res = await fetch('/api/save-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      if (!res.ok) throw new Error('save failed')
      alert('script.json を上書き保存しました')
    } catch (e) {
      console.warn('save-script API 失敗 → ダウンロードへ切替', e)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'script.json'
      a.click()
      URL.revokeObjectURL(a.href)
    }
  }

  // この台本でプレビュー再生（先頭から）
  editorApplyBtn.onclick = async () => {
    if (!scriptEditor) return
    const script = scriptEditor.getScript()
    if (!script?.cues?.length) { alert('台本に cue がありません'); return }
    currentScript = script
    if (currentScript?.cues?.length) lastGoodScript = currentScript

    editorModal.style.display = 'none'
    setControls('playing')
    try {
      const speaker = Number(speakerSelect.value || 1)
      await player.stop()
      await player.play(currentScript, speaker, 0)
    } catch (e) {
      console.error(e)
    } finally {
      setControls('idle')
    }
  }

  // Ctrl+Enter で即プレビュー
  editorPanel.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      await (editorApplyBtn.onclick as any)?.(new Event('click'))
    }
  })
}

// ---------- VOICEVOX 話者 ----------
async function populateSpeakers() {
  const fallback = [
    { id: 1, name: '四国めたん(ノーマル)' },
    { id: 3, name: 'ずんだもん(ノーマル)' },
    { id: 46, name: '春日部つむぎ' }
  ]
  try {
    const res = await fetch('http://localhost:50021/speakers')
    if (!res.ok) throw new Error('not ok')
    const speakers = await res.json()
    speakerSelect.innerHTML = ''
    for (const sp of speakers) {
      for (const st of (sp.styles || [])) {
        const opt = document.createElement('option')
        opt.value = String(st.id)
        opt.textContent = `${sp.name} (${st.name})`
        speakerSelect.appendChild(opt)
      }
    }
  } catch {
    speakerSelect.innerHTML = ''
    for (const s of fallback) {
      const opt = document.createElement('option')
      opt.value = String(s.id)
      opt.textContent = s.name
      speakerSelect.appendChild(opt)
    }
  }
}

// ---------- 台本ロード or デモ（no-cache） ----------
async function loadScriptOrDemo(): Promise<ScriptData> {
  try {
    const res = await fetch('/script.json?ts=' + Date.now(), { cache: 'no-cache' })
    if (res.status === 304 || res.ok) return await res.json()
  } catch {}
  return demoScript()
}

// ---------- スライドアップロード ----------
async function uploadSlidesAndAppendToScript(files: File[]) {
  const existing = await (await fetch('/api/list-slides')).json().catch(()=>({files:[]}))
  const existsSet = new Set<string>(existing.files || [])

  const savedNames: string[] = []
  for (const f of files) {
    let name = f.name.replace(/\s+/g, '_')
    const base = name.replace(/(\.[^.]*)$/, '')
    const ext = (name.match(/(\.[^.]+)$/)?.[1]) || ''
    let i = 1
    while (existsSet.has(name)) { name = `${base}(${i})${ext}`; i++ }
    const ok = await uploadOne(name, f)
    if (ok) { savedNames.push(name); existsSet.add(name) }
  }

  if (!savedNames.length) { alert('アップロードに失敗しました'); return }

  if (!currentScript) currentScript = demoScript()
  const s = currentScript
  const nextNo = (s.cues.length ? Math.max(...s.cues.map(c => Number(c.slide)||0)) : 0) + 1

  savedNames.forEach((fname, idx) => {
    if (/\.(mp4|webm|mov)$/i.test(fname)) {
      s.cues.push({ slide: nextNo + idx, video: fname, videoWait: 'end', subtitle: '' })
    } else {
      s.cues.push({ slide: nextNo + idx, image: fname, subtitle: '' })
    }
  })
  alert(`${savedNames.length}件のスライドを追加しました`)
}

async function uploadOne(name: string, file: File): Promise<boolean> {
  try {
    const res = await fetch(`/api/upload-slide?name=${encodeURIComponent(name)}`, {
      method: 'POST', body: file
    })
    return res.ok
  } catch (e) {
    console.error('upload error', name, e)
    return false
  }
}

// ---------- ユーティリティ ----------
function demoScript(): ScriptData {
  return {
    title: 'デモプレゼン',
    defaults: {
      speakerId: 1,
      tts: { speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1.6 }
    },
    cues: [
      { slide: 1, image: '01.png', subtitle: 'ようこそ。{bow}\n本日はよろしくお願いします。{nod}', emotion: 'neutral' },
      { slide: 2, image: '02.png', subtitle: '本日のアジェンダをご説明します。{pointR}', emotion: 'happy' },
      { slide: 3, video: 'intro.mp4', videoWait: 'end', subtitle: '動画が終わりましたので、続けます。{waveR}' }
    ]
  }
}

function syncScriptFromEditorIfAny(opts: {allowEmpty?: boolean} = {}) {
  if (!scriptEditor) return
  try {
    const data = scriptEditor.getScript()
    const hasCues = Array.isArray(data?.cues) && data.cues.length > 0
    if (hasCues || opts.allowEmpty) {
      currentScript = data
      if (hasCues) lastGoodScript = data
    } else {
      console.warn('editor sync skipped: empty cues (keep previous)')
    }
  } catch (e) {
    console.warn('editor sync failed', e)
  }
}

function validateScript(script: ScriptData | null): string | null {
  if (!script) return '台本が読み込まれていません'
  if (!Array.isArray(script.cues) || script.cues.length === 0) return '台本に cue がありません'
  const first = script.cues[0]
  if (!first.image && !first.video) return '最初のキューに image か video を指定してください'
  return null
}

function clamp(v:number, min:number, max:number){ return Math.min(max, Math.max(min, v)) }
