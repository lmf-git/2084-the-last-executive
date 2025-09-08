import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'

export class NestedPhysicsWorld {
  constructor() {
    this.rapier = null
    this.worldPhysics = null
    this.localPhysics = null
    this.initialized = false
    
    this.player = {
      worldBody: null,
      localBody: null,
      isInVehicle: false,
      currentVehicle: null,
      worldPosition: new THREE.Vector3(0, 2, 0),
      worldVelocity: new THREE.Vector3(),
      localPosition: new THREE.Vector3(),
      localVelocity: new THREE.Vector3()
    }
    
    this.vehicles = new Map()
  }

  async init() {
    try {
      console.log('Starting Rapier initialization...')
      await RAPIER.init()
      console.log('Rapier loaded successfully')
      
      this.rapier = RAPIER
      console.log('Rapier object assigned')
      
      console.log('Creating gravity vector...')
      const gravity = new RAPIER.Vector3(0, -9.81, 0)
      console.log('Gravity created')
      
      console.log('Creating world physics...')
      this.worldPhysics = new RAPIER.World(gravity)
      console.log('World physics created')
      
      console.log('Creating local physics...')
      this.localPhysics = new RAPIER.World(gravity)
      console.log('Local physics created')
      
      console.log('Creating player...')
      this.createPlayer()
      console.log('Player created')
      
      console.log('Creating test vehicle...')
      this.createTestVehicle()
      console.log('Test vehicle created')
      
      console.log('Creating docking station...')
      this.createDockingStation()
      console.log('Docking station created')
      
      this.initialized = true
      console.log('Nested physics initialized successfully')
    } catch (error) {
      console.error('Failed to initialize nested physics:', error)
      console.error('Error stack:', error.stack)
      throw error
    }
  }

  createPlayer() {
    // World-space dynamic body
    const worldBodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
    const colliderDesc = this.rapier.ColliderDesc.ball(0.5)
    
    this.player.worldBody = this.worldPhysics.createRigidBody(worldBodyDesc)
    this.worldPhysics.createCollider(colliderDesc, this.player.worldBody)
    
    // Local proxy body (inactive initially)
    const localBodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(0, 2, 0)
    
    this.player.localBody = this.localPhysics.createRigidBody(localBodyDesc)
    this.localPhysics.createCollider(colliderDesc, this.player.localBody)
  }

  createTestVehicle() {
    const vehicleId = 'ship1'
    const position = new THREE.Vector3(15, 0, 0)  // Move ship further out
    
    // Vehicle body in world
    const vehicleBodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z)
    const vehicleCollider = this.rapier.ColliderDesc.cuboid(4, 2, 6)
    
    const vehicleBody = this.worldPhysics.createRigidBody(vehicleBodyDesc)
    this.worldPhysics.createCollider(vehicleCollider, vehicleBody)
    
    // Trigger volume for entry/exit
    const triggerDesc = this.rapier.ColliderDesc.cuboid(5, 3, 7)
      .setSensor(true)
    const trigger = this.worldPhysics.createCollider(triggerDesc, vehicleBody)
    
    // Vehicle interior colliders in local space
    this.createVehicleInterior()
    
    this.vehicles.set(vehicleId, {
      id: vehicleId,
      worldBody: vehicleBody,
      trigger,
      position: position.clone(),
      rotation: new THREE.Quaternion(),
      velocity: new THREE.Vector3()
    })
  }

  createDockingStation() {
    const stationId = 'station1'
    const position = new THREE.Vector3(-20, 0, 0)  // Opposite side from ship
    
    // Station body in world
    const stationBodyDesc = this.rapier.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z)
    const stationCollider = this.rapier.ColliderDesc.cylinder(3, 6)  // radius=3, height=6
    
    const stationBody = this.worldPhysics.createRigidBody(stationBodyDesc)
    this.worldPhysics.createCollider(stationCollider, stationBody)
    
    // Trigger volume for entry/exit
    const triggerDesc = this.rapier.ColliderDesc.cylinder(4, 7)  // Slightly larger trigger
      .setSensor(true)
    const trigger = this.worldPhysics.createCollider(triggerDesc, stationBody)
    
    this.vehicles.set(stationId, {
      id: stationId,
      worldBody: stationBody,
      trigger,
      position: position.clone(),
      rotation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      type: 'station'
    })
  }

  createVehicleInterior() {
    // Interior walls in local physics world (with door opening on left side)
    const walls = [
      { pos: [0, 0, -0.1], size: [4, 2, 0.1] },  // Back wall
      { pos: [0, 0, 6.1], size: [4, 2, 0.1] },   // Front wall
      { pos: [-4.1, 0, 1], size: [0.1, 2, 1] },  // Left wall (partial - door opening)
      { pos: [-4.1, 0, 5], size: [0.1, 2, 1] },  // Left wall (partial - door opening)
      { pos: [4.1, 0, 3], size: [0.1, 2, 3] },   // Right wall (full)
      { pos: [0, -0.1, 3], size: [4, 0.1, 3] }   // Floor
    ]
    
    walls.forEach(wall => {
      const wallBody = this.localPhysics.createRigidBody(
        this.rapier.RigidBodyDesc.fixed().setTranslation(...wall.pos)
      )
      this.localPhysics.createCollider(
        this.rapier.ColliderDesc.cuboid(...wall.size),
        wallBody
      )
    })
  }

  // Core transform switching logic
  enterVehicle(vehicleId) {
    const vehicle = this.vehicles.get(vehicleId)
    if (!vehicle || this.player.isInVehicle) return false
    
    console.log('Entering vehicle:', vehicleId)
    
    // Get current world state
    const worldPos = this.player.worldBody.translation()
    const worldVel = this.player.worldBody.linvel()
    
    // Transform world position to local coordinates
    const vehiclePos = vehicle.worldBody.translation()
    const vehicleRot = vehicle.worldBody.rotation()
    
    // World to local transform
    const localPos = new THREE.Vector3(
      worldPos.x - vehiclePos.x,
      worldPos.y - vehiclePos.y,
      worldPos.z - vehiclePos.z
    )
    
    // Rotate velocity to local frame (simplified - not accounting for vehicle rotation)
    const localVel = new THREE.Vector3(worldVel.x, worldVel.y, worldVel.z)
    
    // Switch physics contexts
    this.player.worldBody.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true)
    this.player.localBody.setTranslation(localPos, true)
    this.player.localBody.setLinvel(localVel, true)
    
    this.player.isInVehicle = true
    this.player.currentVehicle = vehicleId
    this.player.localPosition.copy(localPos)
    this.player.localVelocity.copy(localVel)
    
    return true
  }

  exitVehicle() {
    if (!this.player.isInVehicle) return false
    
    const vehicle = this.vehicles.get(this.player.currentVehicle)
    if (!vehicle) return false
    
    console.log('Exiting vehicle:', this.player.currentVehicle)
    
    // Get current local state
    const localPos = this.player.localBody.translation()
    const localVel = this.player.localBody.linvel()
    
    // Transform local position back to world coordinates
    const vehiclePos = vehicle.worldBody.translation()
    const vehicleVel = vehicle.worldBody.linvel()
    
    // Local to world transform
    const worldPos = new THREE.Vector3(
      localPos.x + vehiclePos.x,
      localPos.y + vehiclePos.y,
      localPos.z + vehiclePos.z
    )
    
    // Add vehicle velocity to preserve momentum
    const worldVel = new THREE.Vector3(
      localVel.x + vehicleVel.x,
      localVel.y + vehicleVel.y,
      localVel.z + vehicleVel.z
    )
    
    // Switch back to dynamic world body
    this.player.worldBody.setBodyType(this.rapier.RigidBodyType.Dynamic, true)
    this.player.worldBody.setTranslation(worldPos, true)
    this.player.worldBody.setLinvel(worldVel, true)
    
    this.player.isInVehicle = false
    this.player.currentVehicle = null
    
    return true
  }

  // Apply movement forces
  applyPlayerForce(force) {
    if (this.player.isInVehicle) {
      // Apply force to local body
      this.player.localBody.addForce(
        new this.rapier.Vector3(force.x, force.y, force.z),
        true
      )
    } else {
      // Apply force to world body
      this.player.worldBody.addForce(
        new this.rapier.Vector3(force.x, force.y, force.z),
        true
      )
    }
  }

  // Check trigger volumes for automatic entry/exit
  checkTriggers() {
    if (this.player.isInVehicle) return
    
    const playerPos = this.player.worldBody.translation()
    
    for (const [vehicleId, vehicle] of this.vehicles) {
      const vehiclePos = vehicle.worldBody.translation()
      const distance = Math.sqrt(
        Math.pow(playerPos.x - vehiclePos.x, 2) +
        Math.pow(playerPos.y - vehiclePos.y, 2) +
        Math.pow(playerPos.z - vehiclePos.z, 2)
      )
      
      // Auto-enter when close enough
      if (distance < 6) {
        this.enterVehicle(vehicleId)
        break
      }
    }
  }

  step() {
    if (!this.initialized) return
    
    this.checkTriggers()
    
    // Step both physics worlds
    this.worldPhysics.step()
    this.localPhysics.step()
    
    // Update player position tracking
    if (this.player.isInVehicle) {
      // Update local position for rendering
      const localTrans = this.player.localBody.translation()
      this.player.localPosition.set(localTrans.x, localTrans.y, localTrans.z)
      
      // Update world body to follow local movement
      const vehicle = this.vehicles.get(this.player.currentVehicle)
      if (vehicle) {
        const vehiclePos = vehicle.worldBody.translation()
        const worldPos = new THREE.Vector3(
          localTrans.x + vehiclePos.x,
          localTrans.y + vehiclePos.y,
          localTrans.z + vehiclePos.z
        )
        this.player.worldBody.setTranslation(worldPos, true)
        this.player.worldPosition.copy(worldPos)
      }
    } else {
      // Update world position for rendering
      const worldTrans = this.player.worldBody.translation()
      this.player.worldPosition.set(worldTrans.x, worldTrans.y, worldTrans.z)
    }
  }

  // Get current effective player position for rendering
  getPlayerWorldPosition() {
    return this.player.worldPosition.clone()
  }

  getPlayerLocalPosition() {
    return this.player.localPosition.clone()
  }

  dispose() {
    if (this.worldPhysics) this.worldPhysics.free()
    if (this.localPhysics) this.localPhysics.free()
  }
}

export const nestedPhysics = new NestedPhysicsWorld()