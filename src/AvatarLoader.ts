// 必要なモジュールをインポート
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js' // GLTF形式3Dモデルの読み込み用
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm' // VRMモデル読み込み・操作用
import * as THREE from 'three' // Three.js本体

// アバター（VRMモデル）を読み込んで表示するクラス
export class AvatarLoader {
  scene: THREE.Scene            // 3Dシーン
  camera: THREE.PerspectiveCamera // 視点カメラ
  renderer: THREE.WebGLRenderer // 描画レンダラー
  vrm?: VRM                      // 読み込んだVRMモデル（オプション）

  // コンストラクタ（HTML要素を渡すとcanvasを追加）
  constructor(container?: HTMLElement) {
    // シーンの作成
    this.scene = new THREE.Scene()

    // カメラの設定（視野角35°, アスペクト比は画面サイズ, 近クリップ0.1, 遠クリップ1000）
    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.camera.position.set(0, 1.4, 2) // カメラ位置を少し上から正面に

    // レンダラー（アンチエイリアス有効）作成
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight) // 描画サイズを画面に合わせる
    container?.appendChild(this.renderer.domElement) // コンテナにcanvasを追加

    // 平行光源（白色, 強度1）を追加
    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(0, 1, 1) // 光源位置を前上方に
    this.scene.add(light)

    // ウィンドウリサイズ時にカメラ・レンダラーを更新
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  // VRMモデルを読み込む
  async loadVRM(url: string) {
    const loader = new GLTFLoader()
    loader.register(parser => new VRMLoaderPlugin(parser)) // VRM対応プラグインを登録

    // モデルを非同期で読み込み
    const gltf = await loader.loadAsync(url)
    const vrm = gltf.userData.vrm as VRM // 読み込んだVRMモデルを取得

    VRMUtils.rotateVRM0(vrm) // 正面方向を補正（VRM標準化）
    this.scene.add(vrm.scene) // シーンにモデルを追加
    this.vrm = vrm // メンバ変数に保存
  }

  // アニメーションループ
  animate() {
    requestAnimationFrame(() => this.animate()) // 毎フレーム呼び出し
    if (this.vrm) this.vrm.update(1 / 60) // VRMのアニメーション更新（1/60秒分）
    this.renderer.render(this.scene, this.camera) // シーンをカメラ視点で描画
  }
}
