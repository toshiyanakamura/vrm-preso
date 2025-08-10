// AvatarController.ts
// VRMアバターを読み込み、表示、操作、モーション制御するクラス。
// マウスドラッグによる位置調整、表情や口パク制御、腕の調整UI、ジェスチャー動作など多機能を持つ。
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'
import GUI from 'lil-gui'
import { IdleController } from './IdleController'

export class AvatarController {
  // ===== Three.jsの基本構成要素 =====
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  vrm?: VRM
  mouthWeight = 0
  gui?: GUI

  // ===== ドラッグ操作に必要な変数 =====
  private raycaster = new THREE.Raycaster()
  private dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private isDragging = false
  private dragOffset = new THREE.Vector3()
  private lastMouse = new THREE.Vector2()
  private dom!: HTMLCanvasElement

  // ===== アイドル（自然揺れ）管理 ====
  private idle?: IdleController
  private speaking = false

  // ===== 腕ニュートラル位置調整用 =====
  private armNeutral = { L: { x: 0, y: 0, z: 0 }, R: { x: 0, y: 0, z: 0 } } // degree
  private armBaseQuatL?: THREE.Quaternion
  private armBaseQuatR?: THREE.Quaternion
  private armUi?: HTMLElement

  constructor(container: HTMLElement) {
    // シーンとカメラの初期化
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.camera.position.set(0, 1.4, 2)

    // アルファ対応のWebGLレンダラーを生成
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    container.appendChild(this.renderer.domElement)
    this.dom = this.renderer.domElement

    // ライティング設定（平行光＋環境光）
    const light = new THREE.DirectionalLight(0xffffff, 1.2)
    light.position.set(1, 1.75, 2)
    this.scene.add(light)
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    // ウィンドウリサイズ対応
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })

    // マウス・ポインターイベントのバインド
    this.bindPointerEvents()

    // ローカルストレージから腕ニュートラル値を復元
    try {
      const saved = localStorage.getItem('armNeutralOffsets')
      if (saved) this.armNeutral = JSON.parse(saved)
    } catch {}
  }

  // ===== VRMモデル読み込み処理 =====
  async loadVRM(fileOrUrl: File | string, guiContainer?: HTMLElement) {
    if (this.vrm) {
      this.scene.remove(this.vrm.scene)
      this.vrm.dispose()
      this.vrm = undefined
    }
    if (this.gui) {
      this.gui.destroy()
      this.gui = undefined
    }

    // VRM対応GLTFローダーを準備
    const loader = new GLTFLoader()
    loader.register(parser => new VRMLoaderPlugin(parser))


    // VRM対応GLTFローダーを準備
    const url = fileOrUrl instanceof File ? URL.createObjectURL(fileOrUrl) : fileOrUrl
    const gltf = await loader.loadAsync(url)
    const vrm = gltf.userData.vrm as VRM

    // VRMモデルの向きを補正してシーンに追加
    VRMUtils.rotateVRM0(vrm)
    this.scene.add(vrm.scene)
    this.vrm = vrm

    // 初期“万歳”防止
    this.autoLowerArms()

    // 腕の基準回転を記録＆オフセット適用
    this.cacheArmBaseQuats()
    this.applyArmNeutral()

    // アイドル揺れセット
    this.idle = new IdleController(this.vrm)

    if (guiContainer) {
      this.setupGUI(vrm.scene, guiContainer)
      // ★ 設定パネルに腕スライダーを設置
      this.attachArmTweakUI(guiContainer)
    }
  }

  // ===== GUIのセットアップ =====
  private setupGUI(model: THREE.Object3D, container: HTMLElement) {
    this.gui = new GUI({ container })
    const pos = this.gui.addFolder('Position')
    pos.add(model.position, 'x', -2, 200, 0.01)
    pos.add(model.position, 'y', -2, 2, 0.01)
    pos.add(model.position, 'z', -2, 2, 0.01)
    const rot = this.gui.addFolder('Rotation')
    rot.add(model.rotation, 'y', -Math.PI, Math.PI, 0.01).name('Yaw')
    const scale = this.gui.addFolder('Scale')
    const s = { uniform: model.scale.x || 1 }
    scale.add(s, 'uniform', 0.1, 3, 0.01).onChange((v: number) => model.scale.set(v, v, v))

    const fArm = this.gui.addFolder('Arms')
    fArm.add({ lowerArms: () => this.autoLowerArms() }, 'lowerArms').name('腕を下げる（自動）')
  }

  setMouthWeight(w: number) {
    this.mouthWeight = Math.max(0, Math.min(1, w))
  }

  setEmotion(name: 'neutral' | 'happy' | 'angry' | 'surprised' = 'neutral') {
    if (!this.vrm?.expressionManager) return
    const em = this.vrm.expressionManager
    em.setValue('happy', name === 'happy' ? 1 : 0)
    em.setValue('angry', name === 'angry' ? 1 : 0)
    em.setValue('surprised', name === 'surprised' ? 1 : 0)
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    const dt = 1/60

    // ← 先に体の揺れ（ここで表情が触られてもOK）
    this.idle?.update(dt, this.speaking)

    // ← その後で口パクを上書き
    this.applyMouth(dt)

    // ← 最後に VRM をアップデート（表情値が反映される）
    this.vrm?.update(dt)
    this.renderer.render(this.scene, this.camera)
  }


  setSpeaking(on: boolean) {   
    console.log('[setSpeaking]', on, 'at', performance.now().toFixed(0), 'ms')
    this.speaking = on 
  }

  // ========= マウス操作 =========

  private bindPointerEvents() {
    this.dom.addEventListener('pointerdown', (e) => {
      if (!this.vrm || e.button !== 0) return
      this.dom.setPointerCapture(e.pointerId)
      this.isDragging = true
      this.lastMouse.set(e.clientX, e.clientY)

      const y0 = this.vrm.scene.position.y
      this.dragPlane.set(new THREE.Vector3(0, 1, 0), -y0)

      const intersect = this.screenToPlane(e.clientX, e.clientY, this.dragPlane)
      if (intersect) {
        this.dragOffset.copy(this.vrm.scene.position).sub(intersect)
      } else {
        this.dragOffset.set(0, 0, 0)
      }
      e.preventDefault()
    })

    this.dom.addEventListener('pointermove', (e) => {
      if (!this.vrm || !this.isDragging) return
      if (e.shiftKey) {
        const dy = (e.clientY - this.lastMouse.y)
        const sensitivity = 0.005
        this.vrm.scene.position.y -= dy * sensitivity
        this.lastMouse.set(e.clientX, e.clientY)
      } else {
        const intersect = this.screenToPlane(e.clientX, e.clientY, this.dragPlane)
        if (intersect) this.vrm.scene.position.copy(intersect).add(this.dragOffset)
      }
      e.preventDefault()
    })

    this.dom.addEventListener('pointerup', (e) => {
      if (!this.isDragging) return
      this.isDragging = false
      this.dom.releasePointerCapture(e.pointerId)
      e.preventDefault()
    })

    this.dom.addEventListener('wheel', (e) => {
      if (!this.vrm) return

      if (e.ctrlKey) {
        // === 回転（頭-足のY軸） ===
        const rotStep = -e.deltaY * 0.002 // 回転感度
        this.vrm.scene.rotateY(rotStep)
      } else {
        // === ズーム（等倍スケール） ===
        const k = Math.exp(-e.deltaY * 0.001) // ズーム感度
        const s = this.vrm.scene.scale.x * k
        const clamped = Math.min(3, Math.max(0.1, s)) // 0.1〜3に制限
        this.vrm.scene.scale.set(clamped, clamped, clamped)
      }

      this.vrm.update(0)
      e.preventDefault() // ブラウザのデフォルト（ページズーム等）を抑止
    }, { passive: false })
  }

  private screenToPlane(clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = new THREE.Vector3()
    const ok = this.raycaster.ray.intersectPlane(plane, hit)
    return ok ? hit : null
  }

  // ========= 腕を自動で下げる =========

  private autoLowerArms() {
    const h = this.vrm?.humanoid
    if (!h) return

    const LUpper = h.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
    const RUpper = h.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
    const LHand = h.getNormalizedBoneNode(VRMHumanBoneName.LeftHand)
    const RHand = h.getNormalizedBoneNode(VRMHumanBoneName.RightHand)
    if (!LUpper || !RUpper || !LHand || !RHand) return

    const tryLower = (upper: THREE.Object3D, hand: THREE.Object3D) => {
      const step = THREE.MathUtils.degToRad(10)
      const candidates: Array<{ axis: 'x' | 'z'; sign: 1 | -1; newY: number }> = []
      for (const axis of ['x', 'z'] as const) {
        for (const sign of [1, -1] as const) {
          const backup = upper.quaternion.clone()
          this.rotateLocal(upper, axis, sign * step)
          this.vrm?.update(0)
          const y = this.getWorldY(hand)
          candidates.push({ axis, sign, newY: y })
          upper.quaternion.copy(backup)
        }
      }
      candidates.sort((a, b) => a.newY - b.newY)
      const best = candidates[0]
      if (!best) return
      const target = THREE.MathUtils.degToRad(60)
      this.rotateLocal(upper, best.axis, best.sign * target)
      this.vrm?.update(0)
    }

    tryLower(LUpper, LHand)
    tryLower(RUpper, RHand)

    // 自動調整後に基準回転を取り直す
    this.cacheArmBaseQuats()
  }

  private rotateLocal(node: THREE.Object3D, axis: 'x' | 'z', rad: number) {
    const q = new THREE.Quaternion()
    const v = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)
    q.setFromAxisAngle(v, rad)
    node.quaternion.multiply(q)
  }

  private getWorldY(node: THREE.Object3D) {
    const v = new THREE.Vector3()
    node.getWorldPosition(v)
    return v.y
  }

  // ========= 腕ニュートラル適用関連 =========

  private cacheArmBaseQuats() {
    const h = this.vrm?.humanoid
    if (!h) return
    this.armBaseQuatL = h.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)?.quaternion.clone()
    this.armBaseQuatR = h.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)?.quaternion.clone()
  }

  /** 現在のニュートラル値を取得（深いコピー） */
  public getArmNeutral() {
    return JSON.parse(JSON.stringify(this.armNeutral))
  }

  /** ニュートラルを設定（部分更新OK）し、即適用＋保存 */
  public setArmNeutral(next: { L?: Partial<{ x: number; y: number; z: number }>, R?: Partial<{ x: number; y: number; z: number }> }) {
    if (next.L) Object.assign(this.armNeutral.L, next.L)
    if (next.R) Object.assign(this.armNeutral.R, next.R)
    try { localStorage.setItem('armNeutralOffsets', JSON.stringify(this.armNeutral)) } catch {}
    this.applyArmNeutral()
  }

  /** 腕ニュートラルを実際の骨に反映 */
  private applyArmNeutral() {
    if (!this.vrm?.humanoid || !this.armBaseQuatL || !this.armBaseQuatR) return
    const h = this.vrm.humanoid
    const L = h.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
    const R = h.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
    if (!L || !R) return

    const qFromDeg = (o: { x: number; y: number; z: number }) =>
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(o.x),
        THREE.MathUtils.degToRad(o.y),
        THREE.MathUtils.degToRad(o.z)
      ))

    L.quaternion.copy(this.armBaseQuatL).multiply(qFromDeg(this.armNeutral.L))
    R.quaternion.copy(this.armBaseQuatR).multiply(qFromDeg(this.armNeutral.R))
    this.vrm.update(0)
  }

  // ========= 設定パネルに腕スライダーを追加 =========
  public attachArmTweakUI(container: HTMLElement) {
    if (!this.vrm) return
    if (!this.armBaseQuatL || !this.armBaseQuatR) this.cacheArmBaseQuats()

    // すでに作ってあれば付け替えるだけ
    if (this.armUi) {
      if (!container.contains(this.armUi)) container.appendChild(this.armUi)
      return
    }

    const wrap = document.createElement('div')
    wrap.style.cssText = 'border:1px solid #444;padding:8px;border-radius:8px;margin-top:8px;'
    wrap.innerHTML = `
      <h4 style="margin:0 0 6px;">腕の微調整</h4>
      <div style="display:grid;gap:6px;">
        <label>左腕：下げる/上げる(Z)
          <input type="range" data-k="Lz" min="-60" max="60" step="1" value="${this.armNeutral.L.z}">
        </label>
        <label>左腕：開く/閉じる(Y)
          <input type="range" data-k="Ly" min="-60" max="60" step="1" value="${this.armNeutral.L.y}">
        </label>
        <label>右腕：下げる/上げる(Z)
          <input type="range" data-k="Rz" min="-60" max="60" step="1" value="${this.armNeutral.R.z}">
        </label>
        <label>右腕：開く/閉じる(Y)
          <input type="range" data-k="Ry" min="-60" max="60" step="1" value="${this.armNeutral.R.y}">
        </label>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button data-act="reset">リセット</button>
          <button data-act="rebase" title="現在角度を基準姿勢として記録">今の角度を基準にする</button>
        </div>
      </div>
    `
    wrap.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(r => {
      r.addEventListener('input', () => {
        const k = r.dataset.k as 'Lz'|'Ly'|'Rz'|'Ry'
        const v = Number(r.value)
        if (k === 'Lz') this.armNeutral.L.z = v
        if (k === 'Ly') this.armNeutral.L.y = v
        if (k === 'Rz') this.armNeutral.R.z = v
        if (k === 'Ry') this.armNeutral.R.y = v
        try { localStorage.setItem('armNeutralOffsets', JSON.stringify(this.armNeutral)) } catch {}
        this.applyArmNeutral()
      })
    })
    wrap.querySelector<HTMLButtonElement>('button[data-act="reset"]')!.onclick = () => {
      this.armNeutral = { L:{x:0,y:0,z:0}, R:{x:0,y:0,z:0} }
      wrap.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(r=> r.value='0')
      try { localStorage.setItem('armNeutralOffsets', JSON.stringify(this.armNeutral)) } catch {}
      this.applyArmNeutral()
    }
    wrap.querySelector<HTMLButtonElement>('button[data-act="rebase"]')!.onclick = () => {
      // 現在の結果姿勢を新しい基準として記録
      this.cacheArmBaseQuats()
      this.armNeutral = { L:{x:0,y:0,z:0}, R:{x:0,y:0,z:0} }
      wrap.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(r=> r.value='0')
      try { localStorage.setItem('armNeutralOffsets', JSON.stringify(this.armNeutral)) } catch {}
      this.applyArmNeutral()
    }

    container.appendChild(wrap)
    this.armUi = wrap
    // 念のため現オフセットを反映
    this.applyArmNeutral()
  }

  // ========= クォータニオン補間 =========

  private tweenQuat(
    node: THREE.Object3D,
    toEuler: THREE.Euler,
    durationMs: number,
    onUpdate?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      const from = node.quaternion.clone()
      const to = new THREE.Quaternion().setFromEuler(toEuler)
      const start = performance.now()

      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / durationMs)
        node.quaternion.copy(from).slerp(to, p)
        onUpdate?.()
        if (p < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  private tweenQuatTo(
    node: THREE.Object3D,
    toQuat: THREE.Quaternion,
    durationMs: number,
    onUpdate?: () => void
  ): Promise<void> {
    return new Promise((resolve) => {
      const from = node.quaternion.clone()
      const start = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / durationMs)
        node.quaternion.copy(from).slerp(toQuat, p)
        onUpdate?.()
        if (p < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  // ========= ジェスチャ =========

  // 口
  // AvatarController.ts 内

  // 口パク用の状態
  private mouthPhase = 0
  private mouthShape: 'aa'|'ih'|'ou' = 'aa'
  private mouthChangeT = 0

  private applyMouth(dt: number) {
    const em = this.vrm?.expressionManager
    if (!em) return

    // まず全部ゼロクリア（VRM0系モデル対策で A/I/U/E/O も落としておく）
    em.setValue('aa', 0); em.setValue('ih', 0); em.setValue('ou', 0)
    em.setValue('A', 0);  em.setValue('I', 0);  em.setValue('U', 0); em.setValue('E', 0); em.setValue('O', 0)

    if (!this.speaking) return

    // 0.15〜0.3秒ごとに母音を変える
    this.mouthChangeT -= dt
    if (this.mouthChangeT <= 0) {
      const shapes: Array<'aa'|'ih'|'ou'> = ['aa','ih','ou']
      this.mouthShape = shapes[(Math.random()*shapes.length)|0]
      this.mouthChangeT = 0.15 + Math.random() * 0.15
    }

    // サイン波で開閉
    this.mouthPhase += dt * 6
    const w = 0.15 + 0.55 * (0.5 + 0.5 * Math.sin(this.mouthPhase))

    // VRM1系(aa/ih/ou) と VRM0系(A/I/U/E/O) の両対応で入れる
    if (this.mouthShape === 'aa') { em.setValue('aa', w); em.setValue('A', w) }
    else if (this.mouthShape === 'ih') { em.setValue('ih', w); em.setValue('I', w) }
    else { em.setValue('ou', w); em.setValue('U', w) }
  }



  nod(durationMs = 400) {
    const neck = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck)
    if (!neck) return
    const neck0 = neck.quaternion.clone()
    const start = performance.now()
    const amp = THREE.MathUtils.degToRad(12)
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / durationMs)
      const e = new THREE.Euler(-Math.sin(p * Math.PI) * amp, 0, 0)
      neck.quaternion.copy(neck0).multiply(new THREE.Quaternion().setFromEuler(e))
      this.vrm?.update(0)
      if (p < 1) requestAnimationFrame(tick)
      else {
        neck.quaternion.copy(neck0)
        this.vrm?.update(0)
      }
    }
    requestAnimationFrame(tick)
  }

  wave(durationMs = 900) { this.waveR(durationMs) }
  async waveR(durationMs = 900) { await this.waveArm('R', durationMs) }
  async waveL(durationMs = 900) { await this.waveArm('L', durationMs) }

  private async waveArm(side: 'L' | 'R', durationMs: number) {
    const h = this.vrm?.humanoid
    const ua = h?.getNormalizedBoneNode(side === 'R' ? VRMHumanBoneName.RightUpperArm : VRMHumanBoneName.LeftUpperArm)
    const la = h?.getNormalizedBoneNode(side === 'R' ? VRMHumanBoneName.RightLowerArm : VRMHumanBoneName.LeftLowerArm)
    const hand = h?.getNormalizedBoneNode(side === 'R' ? VRMHumanBoneName.RightHand : VRMHumanBoneName.LeftHand)
    if (!ua || !la || !hand) return

    const ua0 = ua.quaternion.clone()
    const la0 = la.quaternion.clone()
    const hand0 = hand.quaternion.clone()

    try {
      const z = THREE.MathUtils.degToRad(side === 'R' ? +30 : -30)
      await this.tweenQuat(ua, new THREE.Euler(0, 0, z), 200, () => this.vrm?.update(0))

      const start = performance.now()
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / durationMs)
        const sway = Math.sin(p * Math.PI * 3)
        const laZ = THREE.MathUtils.degToRad(10 * (side === 'R' ? +1 : -1) * sway)
        const handZ = THREE.MathUtils.degToRad(5 * (side === 'R' ? +1 : -1) * sway)
        la.quaternion.copy(la0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, laZ)))
        hand.quaternion.copy(hand0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, handZ)))
        this.vrm?.update(0)
        if (p < 1) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      await new Promise(r => setTimeout(r, durationMs))
    } finally {
      ua.quaternion.copy(ua0)
      la.quaternion.copy(la0)
      hand.quaternion.copy(hand0)
      this.vrm?.update(0)
    }
  }

  async pointR(durationMs = 800) { await this.pointArm('R', durationMs) }
  async pointL(durationMs = 800) { await this.pointArm('L', durationMs) }

  private async pointArm(side: 'L' | 'R', durationMs: number) {
    const h = this.vrm?.humanoid
    const ua = h?.getNormalizedBoneNode(side === 'R' ? VRMHumanBoneName.RightUpperArm : VRMHumanBoneName.LeftUpperArm)
    const la = h?.getNormalizedBoneNode(side === 'R' ? VRMHumanBoneName.RightLowerArm : VRMHumanBoneName.LeftLowerArm)
    const hand = h?.getNormalizedBoneNode(side === 'R' ? VRMHumanBoneName.RightHand : VRMHumanBoneName.LeftHand)
    if (!ua || !la || !hand) return

    const ua0 = ua.quaternion.clone()
    const la0 = la.quaternion.clone()
    const hand0 = hand.quaternion.clone()

    try {
      const x = THREE.MathUtils.degToRad(-20)
      const z = THREE.MathUtils.degToRad(side === 'R' ? +20 : -20)
      await this.tweenQuat(ua, new THREE.Euler(x, 0, z), 200, () => this.vrm?.update(0))

      const laX = THREE.MathUtils.degToRad(-15)
      la.quaternion.copy(la0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(laX, 0, 0)))
      const handZ = THREE.MathUtils.degToRad(side === 'R' ? -10 : +10)
      hand.quaternion.copy(hand0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, handZ)))
      this.vrm?.update(0)

      await new Promise(r => setTimeout(r, durationMs))
    } finally {
      ua.quaternion.copy(ua0)
      la.quaternion.copy(la0)
      hand.quaternion.copy(hand0)
      this.vrm?.update(0)
    }
  }

  private async bow(durationMs = 800, depth = 1) {
    // depth: 0(浅い)〜1(深い) で調整
    const h = this.vrm?.humanoid
    const hips  = h?.getNormalizedBoneNode(VRMHumanBoneName.Hips)      // あれば少しだけ腰も前傾
    const chest = h?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) 
              || h?.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    const neck  = h?.getNormalizedBoneNode(VRMHumanBoneName.Neck)
    if (!chest || !neck) return

    // 元姿勢
    const hip0 = hips?.quaternion.clone()
    const c0   = chest.quaternion.clone()
    const n0   = neck.quaternion.clone()

    // 目標角度（度数）を depth で補間
    const lerp = (a:number,b:number,t:number)=> a+(b-a)*Math.min(Math.max(t,0),1)
    const hipDeg   = lerp( 0, 10, depth)   // 腰は控えめ
    const chestDeg = lerp(18, 35, depth)   // 胸をしっかり前傾
    const neckDeg  = lerp(12, 25, depth)   // 首もやや深めに

    // 目標クォータニオン（= 元 * オフセット）
    const qHip   = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-hipDeg),   0, 0))
    const qChest = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-chestDeg), 0, 0))
    const qNeck  = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-neckDeg),  0, 0))

    const hipTarget   = hip0 ? hip0.clone().multiply(qHip)   : undefined
    const chestTarget = c0.clone().multiply(qChest)
    const neckTarget  = n0.clone().multiply(qNeck)

    // 時間配分：下げ40% → キープ20% → 戻し40%
    const down = Math.max(80, durationMs * 0.4)
    const hold = Math.max(0,  durationMs * 0.2)
    const up   = Math.max(80, durationMs * 0.4)

    try {
      // 下げる
      if (hips && hipTarget)  await this.tweenQuatTo(hips,  hipTarget,   down, () => this.vrm?.update(0))
      await this.tweenQuatTo(chest, chestTarget, down, () => this.vrm?.update(0))
      await this.tweenQuatTo(neck,  neckTarget,  down, () => this.vrm?.update(0))

      // キープ
      if (hold > 0) await new Promise(r => setTimeout(r, hold))

      // 戻す（元姿勢へ）
      if (hips && hip0) await this.tweenQuatTo(hips,  hip0, up, () => this.vrm?.update(0))
      await this.tweenQuatTo(chest, c0,   up, () => this.vrm?.update(0))
      await this.tweenQuatTo(neck,  n0,   up, () => this.vrm?.update(0))
    } finally {
      // 念のため原状復帰
      if (hips && hip0) hips.quaternion.copy(hip0)
      chest.quaternion.copy(c0)
      neck.quaternion.copy(n0)
      this.vrm?.update(0)
    }
  }

  lookSlide(durationMs = 1000) {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
    if (!head) return
    const head0 = head.quaternion.clone()
    const target = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(THREE.MathUtils.degToRad(-5), THREE.MathUtils.degToRad(15), 0)
    )
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 150)
      head.quaternion.copy(head0).slerp(target, p) // ← ここを修正
      this.vrm?.update(0)
      if (p < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    setTimeout(() => { head.quaternion.copy(head0); this.vrm?.update(0) }, durationMs)
  }

  lookAudience() {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
    if (!head) return
    head.rotation.set(0, 0, 0)
    this.vrm?.update(0)
  }

  // ===== プレゼン用ジェスチャ（追加） =====

  // スライドを示す（右腕を上げて少し胸を前傾）
  async present(durationMs = 1200) {
    const h = this.vrm?.humanoid
    const uaR = h?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
    const laR = h?.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm)
    const handR = h?.getNormalizedBoneNode(VRMHumanBoneName.RightHand)
    const chest = h?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest) || h?.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    if (!uaR || !laR || !handR) return

    const ua0 = uaR.quaternion.clone()
    const la0 = laR.quaternion.clone()
    const hd0 = handR.quaternion.clone()
    const c0  = chest?.quaternion.clone()

    const up = Math.max(200, durationMs * 0.35)
    const hold = Math.max(100, durationMs * 0.3)
    const down = Math.max(200, durationMs * 0.35)

    try {
      // 上げ：上腕Z±、前腕Xわずか、手首Zで手のひらを上に
      await this.tweenQuat(uaR, new THREE.Euler(0, 0, THREE.MathUtils.degToRad(+35)), up, () => this.vrm?.update(0))
      await this.tweenQuat(laR, new THREE.Euler(THREE.MathUtils.degToRad(-10), 0, 0), up, () => this.vrm?.update(0))
      await this.tweenQuat(handR, new THREE.Euler(0, 0, THREE.MathUtils.degToRad(+12)), up, () => this.vrm?.update(0))
      if (chest) await this.tweenQuat(chest, new THREE.Euler(THREE.MathUtils.degToRad(-6), 0, 0), up, () => this.vrm?.update(0))

      if (hold > 0) await new Promise(r => setTimeout(r, hold))
    } finally {
      // 戻す
      uaR.quaternion.copy(ua0)
      laR.quaternion.copy(la0)
      handR.quaternion.copy(hd0)
      if (chest && c0) chest.quaternion.copy(c0)
      this.vrm?.update(0)
      if (down > 0) await new Promise(r => setTimeout(r, down))
    }
  }

  // 両腕を広げる（歓迎・強調）
  async openArms(durationMs = 900) {
    const h = this.vrm?.humanoid
    const L = h?.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm)
    const R = h?.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm)
    if (!L || !R) return
    const L0 = L.quaternion.clone(), R0 = R.quaternion.clone()

    try {
      await this.tweenQuat(L, new THREE.Euler(0, 0, THREE.MathUtils.degToRad(-25)), durationMs * 0.5, () => this.vrm?.update(0))
      await this.tweenQuat(R, new THREE.Euler(0, 0, THREE.MathUtils.degToRad(+25)), durationMs * 0.5, () => this.vrm?.update(0))
      await new Promise(r => setTimeout(r, durationMs * 0.2))
    } finally {
      L.quaternion.copy(L0); R.quaternion.copy(R0); this.vrm?.update(0)
      await new Promise(r => setTimeout(r, durationMs * 0.3))
    }
  }

  // 強調（胸を少し前→戻す）
  async emphasize(durationMs = 600) {
    const chest = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.UpperChest)
              || this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    if (!chest) return
    const c0 = chest.quaternion.clone()
    try {
      await this.tweenQuat(chest, new THREE.Euler(THREE.MathUtils.degToRad(-8), 0, 0), durationMs * 0.4, () => this.vrm?.update(0))
      await this.tweenQuat(chest, new THREE.Euler(0, 0, 0), durationMs * 0.6, () => {
        chest.quaternion.copy(c0); this.vrm?.update(0)
      })
    } finally {
      chest.quaternion.copy(c0); this.vrm?.update(0)
    }
  }

  // ゆっくり二回うなずく（同意）
  async agree(durationMs = 800) {
    const neck = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Neck)
    if (!neck) return
    const n0 = neck.quaternion.clone()
    const one = async () => {
      await this.tweenQuat(neck, new THREE.Euler(THREE.MathUtils.degToRad(-10), 0, 0), durationMs * 0.35, () => this.vrm?.update(0))
      await this.tweenQuat(neck, new THREE.Euler(0, 0, 0), durationMs * 0.15, () => { neck.quaternion.copy(n0); this.vrm?.update(0) })
    }
    try {
      await one(); await one()
    } finally {
      neck.quaternion.copy(n0); this.vrm?.update(0)
    }
  }

  // 二回首を横に振る（否定）
  async disagree(durationMs = 800) {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
    if (!head) return
    const h0 = head.quaternion.clone()
    const yaw = THREE.MathUtils.degToRad(12)
    const one = async (sign: 1|-1) => {
      await this.tweenQuat(head, new THREE.Euler(0, sign * yaw, 0), durationMs * 0.3, () => this.vrm?.update(0))
      await this.tweenQuat(head, new THREE.Euler(0, 0, 0), durationMs * 0.2, () => { head.quaternion.copy(h0); this.vrm?.update(0) })
    }
    try {
      await one(+1); await one(-1)
    } finally {
      head.quaternion.copy(h0); this.vrm?.update(0)
    }
  }

  // 首を軽く傾ける（考える）
  async think(durationMs = 800) {
    const head = this.vrm?.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
    if (!head) return
    const h0 = head.quaternion.clone()
    try {
      await this.tweenQuat(head, new THREE.Euler(0, THREE.MathUtils.degToRad(6), THREE.MathUtils.degToRad(10)), durationMs * 0.5, () => this.vrm?.update(0))
      await new Promise(r => setTimeout(r, durationMs * 0.2))
    } finally {
      head.quaternion.copy(h0); this.vrm?.update(0)
    }
  }


  
}
