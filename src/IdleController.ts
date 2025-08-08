// IdleController.ts
import { VRM, VRMHumanBoneName } from '@pixiv/three-vrm'
import * as THREE from 'three'

export type IdleOptions = {
  enabled?: boolean
  intensity?: number // 0..1 全体スケール
  blink?: boolean
}

export class IdleController {
  private vrm: VRM
  private t = Math.random() * 10
  private rng = () => (Math.random() * 2 - 1)
  private tmpQ = new THREE.Quaternion()
  private base: Record<string, THREE.Quaternion> = {}
  public opts: IdleOptions = { enabled: true, intensity: 1, blink: true }

  // ブリンク
  private nextBlink = 0
  private blinkT = 0
  private blinking = false

  constructor(vrm: VRM) {
    this.vrm = vrm
    // ベース姿勢のクォータニオンを保存（相対回転の基準）
    const bones: VRMHumanBoneName[] = [
      VRMHumanBoneName.Chest, VRMHumanBoneName.Spine,
      VRMHumanBoneName.Hips, VRMHumanBoneName.Neck, VRMHumanBoneName.Head
    ]
    bones.forEach(b => {
      const n = vrm.humanoid?.getNormalizedBoneNode(b)
      if (n) this.base[b] = n.quaternion.clone()
    })
    this.scheduleNextBlink()
  }

  update(dt: number, speaking = false) {
    if (!this.opts.enabled) return
    const k = (this.opts.intensity ?? 1)

    this.t += dt

    // —— 呼吸（胸・肩相当）——
    const chest = this.vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Chest)
    if (chest) {
      const amp = THREE.MathUtils.degToRad(3 * k) * (speaking ? 0.4 : 1)
      const slow = 0.25  // 4秒周期
      const y = Math.sin(this.t * Math.PI * slow + 1.7) * 0.2  // 微妙なゆらぎ
      const e = new THREE.Euler( -amp * (0.6 + y), 0, 0)
      chest.quaternion.copy(this.base[VRMHumanBoneName.Chest]).multiply(this.tmpQ.setFromEuler(e))
    }

    // —— 体重移動（腰 sway）——
    const hips = this.vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Hips)
    if (hips) {
      const rotAmp = THREE.MathUtils.degToRad(1.5 * k)
      const rot = Math.sin(this.t * 0.6) * rotAmp
      const e = new THREE.Euler(0, 0, rot) // Z軸に傾ける
      hips.quaternion.copy(this.base[VRMHumanBoneName.Hips]).multiply(this.tmpQ.setFromEuler(e))
      // 位置は大きく動かさない（回転だけで“重心移動感”を出す）
    }

    // —— 頭の微スway —— 
    const head = this.vrm.humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head)
    if (head) {
      const yaw  = THREE.MathUtils.degToRad(2 * k) * Math.sin(this.t * 0.9)
      const pitch= THREE.MathUtils.degToRad(1 * k) * Math.sin(this.t * 1.3 + 0.5)
      head.quaternion.copy(this.base[VRMHumanBoneName.Head])
        .multiply(this.tmpQ.setFromEuler(new THREE.Euler(pitch, yaw, 0)))
    }

    // —— たまの小ノッド —— 
    // 20秒に一回程度、300msで -3° → 戻し
    // （簡略：サイン波に微小パルスを混ぜるだけでもOK）

    // —— 瞬き —— 
    if (this.opts.blink && this.vrm.expressionManager) {
      this.nextBlink -= dt
      if (this.nextBlink <= 0 && !this.blinking) {
        this.blinking = true
        this.blinkT = 0
      }
      if (this.blinking) {
        this.blinkT += dt
        const dur = 0.14
        const p = Math.min(1, this.blinkT / dur)
        const v = p < 0.5 ? (p * 2) : (2 - p * 2) // 上がる→下がる
        this.vrm.expressionManager.setValue('blink', v)
        if (p >= 1) { this.blinking = false; this.vrm.expressionManager.setValue('blink', 0); this.scheduleNextBlink() }
      }
    }
  }

  private scheduleNextBlink() {
    // 2.5〜6秒、たまに二連（10%）
    const base = 2.5 + Math.random() * 3.5
    this.nextBlink = base
    if (Math.random() < 0.1) this.nextBlink *= 0.4
  }

  setEnabled(on: boolean){ this.opts.enabled = on }
  setIntensity(x: number){ this.opts.intensity = THREE.MathUtils.clamp(x, 0, 1.5) }
}
