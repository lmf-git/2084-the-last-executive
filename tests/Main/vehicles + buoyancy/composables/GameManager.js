import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

export class GameManager {
  constructor() {
    this.scene = null
    this.camera = null
    this.renderer = null
    this.world = null
    this.playerController = null
    this.vehicleManager = null
    this.clock = new THREE.Clock()
    
    this.onPlayerMove = null
    this.onVehicleAttach = null
    this.onVehicleDetach = null
  }

  async init() {
    await RAPIER.init()
    
    this.setupRenderer()
    this.setupPhysics()
    this.setupScene()
    
    const { PlayerController } = await import('./PlayerController')
    this.playerController = new PlayerController(this.scene, this.world, this.camera)
    
    const { VehicleManager } = await import('./VehicleManager')
    this.vehicleManager = new VehicleManager(this.scene, this.world)
    
    this.setupEventListeners()
    this.animate()
  }

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0x87CEEB)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    document.getElementById('game-container').appendChild(this.renderer.domElement)
  }

  setupScene() {
    this.scene = new THREE.Scene()
    
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    this.camera.position.set(0, 2, 5)
    
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4)
    this.scene.add(ambientLight)
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(100, 100, 50)
    directionalLight.castShadow = true
    directionalLight.shadow.camera.left = -50
    directionalLight.shadow.camera.right = 50
    directionalLight.shadow.camera.top = 50
    directionalLight.shadow.camera.bottom = -50
    directionalLight.shadow.camera.near = 0.1
    directionalLight.shadow.camera.far = 200
    this.scene.add(directionalLight)
    
    this.createOcean()
    this.createTerrain()
  }

  createOcean() {
    const oceanGeometry = new THREE.PlaneGeometry(200, 200)
    const oceanMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x006994,
      transparent: true,
      opacity: 0.8
    })
    const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial)
    ocean.rotation.x = -Math.PI / 2
    ocean.position.y = 0
    this.scene.add(ocean)
    
    const spawnPlatformGeometry = new THREE.BoxGeometry(100, 0.5, 100)
    const spawnPlatformMaterial = new THREE.MeshLambertMaterial({ color: 0x8B7355 })
    const spawnPlatform = new THREE.Mesh(spawnPlatformGeometry, spawnPlatformMaterial)
    spawnPlatform.position.set(0, 0.25, 0)
    spawnPlatform.castShadow = true
    spawnPlatform.receiveShadow = true
    this.scene.add(spawnPlatform)
    
    const platformBodyDesc = RAPIER.RigidBodyDesc.fixed()
    platformBodyDesc.setTranslation(0, 0.25, 0)
    const platformBody = this.world.createRigidBody(platformBodyDesc)
    
    const platformColliderDesc = RAPIER.ColliderDesc.cuboid(50, 0.25, 50)
    platformColliderDesc.setCollisionGroups(0x00010006) // Ground group: collides with player and vehicles
    this.world.createCollider(platformColliderDesc, platformBody)
  }

  createTerrain() {
    const rampGeometry = new THREE.BoxGeometry(10, 2, 10)
    const rampMaterial = new THREE.MeshLambertMaterial({ color: 0x8B7355 })
    const ramp = new THREE.Mesh(rampGeometry, rampMaterial)
    ramp.position.set(5, 1, 20)
    ramp.rotation.z = Math.PI / 6
    ramp.castShadow = true
    ramp.receiveShadow = true
    this.scene.add(ramp)
    
    const rampBodyDesc = RAPIER.RigidBodyDesc.fixed()
    rampBodyDesc.setTranslation(5, 1, 20)
    rampBodyDesc.setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 12), w: Math.cos(Math.PI / 12) })
    const rampBody = this.world.createRigidBody(rampBodyDesc)
    
    const rampColliderDesc = RAPIER.ColliderDesc.cuboid(5, 1, 5)
    rampColliderDesc.setCollisionGroups(0x00010006)
    this.world.createCollider(rampColliderDesc, rampBody)
    
    const hillGeometry = new THREE.ConeGeometry(8, 5, 8)
    const hillMaterial = new THREE.MeshLambertMaterial({ color: 0x654321 })
    const hill = new THREE.Mesh(hillGeometry, hillMaterial)
    hill.position.set(-15, 2.5, 10)
    hill.castShadow = true
    hill.receiveShadow = true
    this.scene.add(hill)
    
    const hillBodyDesc = RAPIER.RigidBodyDesc.fixed()
    hillBodyDesc.setTranslation(-15, 2.5, 10)
    const hillBody = this.world.createRigidBody(hillBodyDesc)
    
    const hillColliderDesc = RAPIER.ColliderDesc.cone(2.5, 8)
    hillColliderDesc.setCollisionGroups(0x00010006)
    this.world.createCollider(hillColliderDesc, hillBody)
    
    const platformGeometry = new THREE.BoxGeometry(6, 0.5, 6)
    const platformMaterial = new THREE.MeshLambertMaterial({ color: 0x555555 })
    const platform = new THREE.Mesh(platformGeometry, platformMaterial)
    platform.position.set(0, 3, -10)
    platform.castShadow = true
    platform.receiveShadow = true
    this.scene.add(platform)
    
    const platformBodyDesc = RAPIER.RigidBodyDesc.fixed()
    platformBodyDesc.setTranslation(0, 3, -10)
    const platformBody = this.world.createRigidBody(platformBodyDesc)
    
    const platformColliderDesc = RAPIER.ColliderDesc.cuboid(3, 0.25, 3)
    platformColliderDesc.setCollisionGroups(0x00010006)
    this.world.createCollider(platformColliderDesc, platformBody)
  }

  setupPhysics() {
    const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0)
    this.world = new RAPIER.World(gravity)
  }

  setupEventListeners() {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })

    document.addEventListener('click', () => {
      document.body.requestPointerLock()
    })
  }

  animate() {
    requestAnimationFrame(() => this.animate())
    
    const deltaTime = this.clock.getDelta()
    
    if (this.vehicleManager && this.vehicleManager.eventQueue) {
      this.world.step(this.vehicleManager.eventQueue)
    } else {
      this.world.step()
    }
    
    if (this.playerController) {
      this.playerController.update(deltaTime)
      
      if (this.onPlayerMove) {
        this.onPlayerMove(this.playerController.position)
      }
      
      const vehicleAttachment = this.vehicleManager.checkVehicleAttachment(this.playerController.position)
      if (vehicleAttachment !== this.playerController.attachedVehicle) {
        if (vehicleAttachment) {
          console.log('Player detected inside vehicle:', vehicleAttachment.name)
          this.playerController.attachToVehicle(vehicleAttachment)
          if (this.onVehicleAttach) {
            this.onVehicleAttach(vehicleAttachment.name)
          }
        } else {
          if (this.playerController.attachedVehicle) {
            console.log('Player left vehicle:', this.playerController.attachedVehicle.name)
          }
          this.playerController.detachFromVehicle()
          if (this.onVehicleDetach) {
            this.onVehicleDetach()
          }
        }
      }
    }
    
    if (this.vehicleManager) {
      this.vehicleManager.update(deltaTime)
    }
    
    this.renderer.render(this.scene, this.camera)
  }
}