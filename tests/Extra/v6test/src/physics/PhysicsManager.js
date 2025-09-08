import RAPIER from '@dimforge/rapier3d-compat'
import { gameState } from '../stores/gameState.svelte.js'

export class PhysicsManager {
  constructor() {
    this.rapier = null
    this.realWorldWorld = null
    this.proxyWorld = null
    this.initialized = false
  }

  async init() {
    try {
      console.log('Starting Rapier initialization...')
      await RAPIER.init()
      console.log('Rapier loaded successfully')
      
      this.rapier = RAPIER
      
      const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0)
      this.realWorldWorld = new RAPIER.World(gravity)
      this.proxyWorld = new RAPIER.World(gravity)
      
      console.log('Physics worlds created')
      
      gameState.physics.realWorld = this.realWorldWorld
      gameState.physics.proxy = this.proxyWorld
      gameState.physics.initialized = true
      
      this.initialized = true
      
      console.log('Creating player rigid bodies...')
      this.createPlayerRigidBodies()
      
      console.log('Creating environment bodies...')
      this.createEnvironmentBodies()
      
      console.log('Physics initialized successfully')
    } catch (error) {
      console.error('Failed to initialize physics:', error)
      throw error
    }
  }

  createPlayerRigidBodies() {
    if (!this.initialized) return

    const playerBodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
      .setCanSleep(false)
    
    const playerColliderDesc = this.rapier.ColliderDesc.ball(0.5)
      .setRestitution(0.2)
      .setFriction(0.8)

    gameState.player.realWorldRigidBody = this.realWorldWorld.createRigidBody(playerBodyDesc)
    this.realWorldWorld.createCollider(playerColliderDesc, gameState.player.realWorldRigidBody)

    const proxyBodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
      .setCanSleep(false)
    
    gameState.player.proxyRigidBody = this.proxyWorld.createRigidBody(proxyBodyDesc)
    this.proxyWorld.createCollider(playerColliderDesc, gameState.player.proxyRigidBody)
  }

  createEnvironmentBodies() {
    if (!this.initialized) return

    const groundDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(0, -1, 0)
    const groundColliderDesc = this.rapier.ColliderDesc.cuboid(50, 0.5, 50)
      .setFriction(1.0)

    const realWorldGround = this.realWorldWorld.createRigidBody(groundDesc)
    this.realWorldWorld.createCollider(groundColliderDesc, realWorldGround)

    const proxyGround = this.proxyWorld.createRigidBody(groundDesc)
    this.proxyWorld.createCollider(groundColliderDesc, proxyGround)

    this.createShipBodies()
    this.createStationBodies()
  }

  createShipBodies() {
    for (const [id, ship] of gameState.ships) {
      const shipBodyDesc = this.rapier.RigidBodyDesc.fixed()
        .setTranslation(ship.position.x, ship.position.y, ship.position.z)
      
      const shipColliderDesc = this.rapier.ColliderDesc.cuboid(2, 1, 4)

      const shipBody = this.realWorldWorld.createRigidBody(shipBodyDesc)
      this.realWorldWorld.createCollider(shipColliderDesc, shipBody)
      
      ship.rigidBody = shipBody
    }
  }

  createStationBodies() {
    for (const [id, station] of gameState.dockingStations) {
      const stationBodyDesc = this.rapier.RigidBodyDesc.fixed()
        .setTranslation(station.position.x, station.position.y, station.position.z)
      
      const stationColliderDesc = this.rapier.ColliderDesc.cylinder(2, 3)

      const stationBody = this.realWorldWorld.createRigidBody(stationBodyDesc)
      this.realWorldWorld.createCollider(stationColliderDesc, stationBody)
      
      station.rigidBody = stationBody
    }
  }

  switchPlayerToKinematic() {
    if (!gameState.player.realWorldRigidBody) return
    
    gameState.player.realWorldRigidBody.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased)
    gameState.player.isKinematic = true
    
    console.log('Player switched to kinematic mode')
  }

  switchPlayerToDynamic() {
    if (!gameState.player.realWorldRigidBody) return
    
    gameState.player.realWorldRigidBody.setBodyType(this.rapier.RigidBodyType.Dynamic)
    gameState.player.isKinematic = false
    
    console.log('Player switched to dynamic mode')
  }

  updatePlayerFromProxy() {
    if (!gameState.player.proxyRigidBody || !gameState.player.realWorldRigidBody) return
    if (!gameState.player.currentContainer) return

    const proxyTranslation = gameState.player.proxyRigidBody.translation()
    gameState.player.proxyPosition = {
      x: proxyTranslation.x,
      y: proxyTranslation.y,
      z: proxyTranslation.z
    }

    const container = gameState.player.currentContainer.type === 'ship'
      ? gameState.ships.get(gameState.player.currentContainer.id)
      : gameState.dockingStations.get(gameState.player.currentContainer.id)

    if (container) {
      const realWorldPos = {
        x: container.position.x + proxyTranslation.x,
        y: container.position.y + proxyTranslation.y,
        z: container.position.z + proxyTranslation.z
      }

      gameState.player.realWorldRigidBody.setTranslation(realWorldPos, true)
      gameState.player.position = realWorldPos
    }
  }

  applyPlayerForce(force) {
    if (!this.initialized) return

    if (gameState.player.currentContainer && gameState.player.proxyRigidBody) {
      const proxyForce = new this.rapier.Vector3(force.x, force.y, force.z)
      gameState.player.proxyRigidBody.addForce(proxyForce, true)
    } else if (gameState.player.realWorldRigidBody) {
      const realForce = new this.rapier.Vector3(force.x, force.y, force.z)
      gameState.player.realWorldRigidBody.addForce(realForce, true)
    }
  }

  applyPlayerImpulse(impulse) {
    if (!this.initialized) return

    if (gameState.player.currentContainer && gameState.player.proxyRigidBody) {
      const proxyImpulse = new this.rapier.Vector3(impulse.x, impulse.y, impulse.z)
      gameState.player.proxyRigidBody.addImpulse(proxyImpulse, true)
    } else if (gameState.player.realWorldRigidBody) {
      const realImpulse = new this.rapier.Vector3(impulse.x, impulse.y, impulse.z)
      gameState.player.realWorldRigidBody.addImpulse(realImpulse, true)
    }
  }

  resetProxyPlayerPosition() {
    if (!gameState.player.proxyRigidBody) return
    
    gameState.player.proxyRigidBody.setTranslation({ x: 0, y: 2, z: 0 }, true)
    gameState.player.proxyRigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    gameState.player.proxyRigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    
    gameState.player.proxyPosition = { x: 0, y: 2, z: 0 }
  }

  step(deltaTime) {
    if (!this.initialized) return

    this.realWorldWorld.step()
    this.proxyWorld.step()

    if (!gameState.player.currentContainer && gameState.player.realWorldRigidBody) {
      const translation = gameState.player.realWorldRigidBody.translation()
      gameState.player.position = {
        x: translation.x,
        y: translation.y,
        z: translation.z
      }
    } else if (gameState.player.currentContainer) {
      this.updatePlayerFromProxy()
    }
  }

  createInteriorColliders(interiorType) {
    if (!this.initialized) return

    this.proxyWorld.colliders.forEach(collider => {
      if (collider.userData === 'interior') {
        this.proxyWorld.removeCollider(collider, true)
      }
    })

    if (interiorType === 'ship') {
      this.createShipInteriorColliders()
    } else if (interiorType === 'station') {
      this.createStationInteriorColliders()
    }
  }

  createShipInteriorColliders() {
    const walls = [
      { pos: [0, 2, -4], size: [4, 2, 0.1] },
      { pos: [0, 2, 4], size: [4, 2, 0.1] },
      { pos: [-4, 2, 0], size: [0.1, 2, 4] },
      { pos: [4, 2, 0], size: [0.1, 2, 4] },
      { pos: [0, 0, 0], size: [4, 0.1, 4] }
    ]

    walls.forEach((wall, index) => {
      const wallBodyDesc = this.rapier.RigidBodyDesc.fixed()
        .setTranslation(...wall.pos)
      
      const wallColliderDesc = this.rapier.ColliderDesc.cuboid(...wall.size)
        .setFriction(1.0)

      const wallBody = this.proxyWorld.createRigidBody(wallBodyDesc)
      const wallCollider = this.proxyWorld.createCollider(wallColliderDesc, wallBody)
      wallCollider.userData = 'interior'
    })
  }

  createStationInteriorColliders() {
    const floorBodyDesc = this.rapier.RigidBodyDesc.fixed()
      .setTranslation(0, 0, 0)
    const floorColliderDesc = this.rapier.ColliderDesc.cylinder(0.1, 5)
      .setFriction(1.0)

    const floorBody = this.proxyWorld.createRigidBody(floorBodyDesc)
    const floorCollider = this.proxyWorld.createCollider(floorColliderDesc, floorBody)
    floorCollider.userData = 'interior'

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const x = Math.cos(angle) * 4.5
      const z = Math.sin(angle) * 4.5
      
      const wallBodyDesc = this.rapier.RigidBodyDesc.fixed()
        .setTranslation(x, 2, z)
      const wallColliderDesc = this.rapier.ColliderDesc.cuboid(0.1, 2, 0.5)
        .setFriction(1.0)

      const wallBody = this.proxyWorld.createRigidBody(wallBodyDesc)
      const wallCollider = this.proxyWorld.createCollider(wallColliderDesc, wallBody)
      wallCollider.userData = 'interior'
    }
  }

  dispose() {
    if (this.realWorldWorld) {
      this.realWorldWorld.free()
    }
    if (this.proxyWorld) {
      this.proxyWorld.free()
    }
  }
}

export const physicsManager = new PhysicsManager()