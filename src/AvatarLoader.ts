import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import * as THREE from 'three'

export class AvatarLoader {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  vrm?: VRM

  constructor(container?: HTMLElement) {
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.camera.position.set(0, 1.4, 2)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    container?.appendChild(this.renderer.domElement)

    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(0, 1, 1)
    this.scene.add(light)

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  async loadVRM(url: string) {
    const loader = new GLTFLoader()
    loader.register(parser => new VRMLoaderPlugin(parser))

    const gltf = await loader.loadAsync(url)
    const vrm = gltf.userData.vrm as VRM
    VRMUtils.rotateVRM0(vrm) // 正面向き補正
    this.scene.add(vrm.scene)
    this.vrm = vrm
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    if (this.vrm) this.vrm.update(1 / 60)
    this.renderer.render(this.scene, this.camera)
  }
}
