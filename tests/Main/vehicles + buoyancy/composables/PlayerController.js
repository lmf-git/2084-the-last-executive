import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

export class PlayerController {
  constructor(scene, world, camera) {
    this.scene = scene
    this.world = world
    this.camera = camera
    
    this.position = new THREE.Vector3(0, 3, 0)
    this.velocity = new THREE.Vector3()
    this.direction = new THREE.Vector3()
    this.rotation = new THREE.Euler()
    
    this.moveSpeed = 5
    this.jumpForce = 8
    this.mouseSensitivity = 0.002
    
    this.keys = {}
    this.canJump = false
    this.grounded = false
    this.hasJumped = false
    this.jumpCooldown = 0
    
    this.attachedVehicle = null
    this.vehicleOffset = new THREE.Vector3()
    
    this.groundNormal = new THREE.Vector3(0, 1, 0)
    this.gravityDirection = new THREE.Vector3(0, -1, 0)
    this.upDirection = new THREE.Vector3(0, 1, 0)
    
    this.setupControls()
    this.setupPhysics()
  }

  setupControls() {
    document.addEventListener('keydown', (event) => {
      this.keys[event.code] = true
      
      if (event.code === 'KeyO') {
        this.thirdPerson = !this.thirdPerson
        // Reset camera rotation to prevent conflicts between modes
        if (this.grounded) {
          // When grounded, ensure camera follows capsule orientation
          this.aimPitch = 0
        }
      }
      
      // Q/E for yaw when airborne
      if (event.code === 'KeyQ' && !this.grounded) {
        this.capsuleYaw -= 0.1
      }
      if (event.code === 'KeyE' && !this.grounded) {
        this.capsuleYaw += 0.1
      }
    })
    
    document.addEventListener('keyup', (event) => {
      this.keys[event.code] = false
    })
    
    document.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement) {
        if (!this.grounded) {
          // When NOT grounded (falling/airborne): mouse rotates entire capsule, full 6DOF
          this.capsuleYaw -= event.movementX * this.mouseSensitivity
          this.capsulePitch -= event.movementY * this.mouseSensitivity
          this.capsulePitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.capsulePitch))
        } else {
          // When grounded: left/right rotates capsule around feet, up/down is neck movement
          this.capsuleYaw -= event.movementX * this.mouseSensitivity
          this.aimPitch -= event.movementY * this.mouseSensitivity
          this.aimPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.aimPitch))
          // console.log('Grounded mouse: capsuleYaw =', this.capsuleYaw.toFixed(2), 'aimPitch =', this.aimPitch.toFixed(2))
        }
      }
    })
  }

  setupPhysics() {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    bodyDesc.setTranslation(0, 3, 0)
    bodyDesc.lockRotations()
    this.rigidBody = this.world.createRigidBody(bodyDesc)
    
    const colliderDesc = RAPIER.ColliderDesc.capsule(0.8, 0.4)
    colliderDesc.setCollisionGroups(0x00020017) // Player group: collides with ground, vehicle exterior, sensors, and interiors
    this.collider = this.world.createCollider(colliderDesc, this.rigidBody)
    
    this.rigidBody.setLinearDamping(0.9)
    
    this.capsuleOrientation = new THREE.Quaternion()
    this.aimYaw = 0
    this.aimPitch = 0
    this.capsuleYaw = 0 // Separate yaw for capsule when grounded
    this.capsulePitch = 0 // Separate pitch for capsule when grounded
    
    this.thirdPerson = false
    this.debugRayHelper = null
    this.capsuleMesh = null
    
    // Camera transition variables
    this.groundedTransition = 0 // 0 = airborne, 1 = grounded
    this.transitionSpeed = 8.0 // Faster transition to reduce glitchy period
    this.lastGroundNormal = new THREE.Vector3(0, 1, 0)
    this.targetGroundNormal = new THREE.Vector3(0, 1, 0)
    
    // Aim direction preservation
    this.lastAirborneCapsuleYaw = 0 // Store capsule yaw when becoming airborne
    this.lastGroundedAimYaw = 0 // Store aim yaw when becoming grounded
    this.wasGrounded = false // Track previous grounded state
    this.lastOrientation = new THREE.Quaternion() // Store orientation during transitions
    
    // Jump transition timing
    this.jumpStartTime = 0 // When jump began
    this.jumpDelay = 0.3 // Delay before capsule starts rotating after jump (seconds)
    this.isJumping = false // Currently in jump transition
    
    this.createCapsuleMesh()
  }


  createCapsuleMesh() {
    const geometry = new THREE.CapsuleGeometry(0.4, 1.6, 8, 16)
    const material = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00,
      wireframe: true
    })
    this.capsuleMesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.capsuleMesh)
  }

  update(deltaTime) {
    // Update jump cooldown
    if (this.jumpCooldown > 0) {
      this.jumpCooldown -= deltaTime
      if (this.jumpCooldown <= 0) {
        this.jumpCooldown = 0
      }
    }
    
    // Always detect ground
    this.detectGround()
    
    // Update camera transition
    this.updateCameraTransition(deltaTime)
    
    this.updateOrientation(deltaTime)
    this.handleInput(deltaTime)
    this.applyBuoyancy()
    this.updatePhysics()
    this.updateCamera()
  }

  updateCameraTransition(deltaTime) {
    // Check if jump delay period has passed
    const currentTime = performance.now() / 1000
    if (this.isJumping && (currentTime - this.jumpStartTime) > this.jumpDelay) {
      this.isJumping = false // Jump delay period is over
    }
    
    // Detect state changes and preserve aim direction
    if (this.grounded !== this.wasGrounded) {
      if (this.grounded && !this.wasGrounded) {
        // Just landed: instant transition to avoid weird rotation
        // capsuleYaw stays the same, reset capsulePitch
        this.capsulePitch = 0
        // Force immediate transition for landing
        this.groundedTransition = 1.0
        this.isJumping = false // Reset jump state when landing
        console.log('Landed: instant transition, capsuleYaw =', this.capsuleYaw.toFixed(2))
      } else if (!this.grounded && this.wasGrounded) {
        // Just became airborne: only start rotation transition if jump delay has passed
        if (!this.isJumping) {
          // capsuleYaw and capsulePitch continue from where they were
          this.groundedTransition = 0.0
          console.log('Became airborne: delayed transition, capsuleYaw =', this.capsuleYaw.toFixed(2), 'capsulePitch =', this.capsulePitch.toFixed(2))
        } else {
          // During jump delay: maintain grounded behavior
          console.log('Jump delay active - maintaining grounded state')
          return // Skip transition updates during jump delay
        }
      }
      this.wasGrounded = this.grounded
    }
    
    // Smoothly transition between grounded and airborne states
    const targetTransition = this.grounded ? 1 : 0
    const transitionDelta = this.transitionSpeed * deltaTime
    
    if (this.groundedTransition < targetTransition) {
      this.groundedTransition = Math.min(targetTransition, this.groundedTransition + transitionDelta)
    } else if (this.groundedTransition > targetTransition) {
      this.groundedTransition = Math.max(targetTransition, this.groundedTransition - transitionDelta)
    }
    
    // Smoothly interpolate ground normal
    if (this.grounded) {
      this.targetGroundNormal.copy(this.groundNormal)
    } else {
      this.targetGroundNormal.set(0, 1, 0) // Default up vector when airborne
    }
    
    // Slerp between last and target ground normal
    this.lastGroundNormal.lerp(this.targetGroundNormal, Math.min(1, this.transitionSpeed * deltaTime))
  }

  updateOrientation(deltaTime) {
    const transitionFactor = this.groundedTransition
    
    // Calculate airborne orientation (6DOF)
    const yawQuat = new THREE.Quaternion()
    const pitchQuat = new THREE.Quaternion()
    yawQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.capsuleYaw)
    pitchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.capsulePitch)
    const airborneOrientation = new THREE.Quaternion()
    airborneOrientation.multiplyQuaternions(yawQuat, pitchQuat)
    
    // Calculate grounded orientation (feet pivot, capsule only rotates around yaw)
    const gravityUp = new THREE.Vector3(0, 1, 0)
    const surfaceOrientation = new THREE.Quaternion()
    surfaceOrientation.setFromUnitVectors(gravityUp, this.groundNormal)
    
    // Apply yaw rotation around gravity vector (feet pivot)
    const yawRotation = new THREE.Quaternion()
    yawRotation.setFromAxisAngle(gravityUp, this.capsuleYaw)
    
    // Grounded capsule orientation: yaw around feet + surface alignment
    const groundedOrientation = new THREE.Quaternion()
    groundedOrientation.multiplyQuaternions(yawRotation, surfaceOrientation)
    
    // Use smooth interpolation - always interpolate between airborne and grounded
    this.capsuleOrientation.slerpQuaternions(airborneOrientation, groundedOrientation, transitionFactor)
    
    // Update stored orientation gradually during transitions for next time
    if (this.groundedTransition > 0.01 && this.groundedTransition < 0.99) {
      this.lastOrientation.slerp(this.capsuleOrientation, 0.1)
    }
  }

  applyBuoyancy() {
    const waterLevel = 0
    const currentPos = this.rigidBody.translation()
    
    if (currentPos.y < waterLevel && !this.grounded) {
      const submersion = waterLevel - currentPos.y
      const buoyancyForce = Math.min(submersion * 15, 20)
      
      const currentVel = this.rigidBody.linvel()
      this.rigidBody.setLinvel({
        x: currentVel.x * 0.95,
        y: currentVel.y + buoyancyForce * 0.016,
        z: currentVel.z * 0.95
      }, true)
    }
  }

  handleInput(deltaTime) {
    // Calculate movement speed based on environment
    const currentPos = this.rigidBody.translation()
    const waterLevel = 0
    let effectiveSpeed = this.moveSpeed
    
    if (currentPos.y < waterLevel) {
      // In water - significantly reduced speed
      effectiveSpeed = this.moveSpeed * 0.4
    } else if (!this.grounded) {
      // In air - reduced speed
      effectiveSpeed = this.moveSpeed * 0.6
    }
    
    if (this.grounded) {
      // Ground-based movement projected along the detected surface normal
      
      // Get camera's actual look direction (combines capsule yaw + aim pitch)
      const cameraForward = new THREE.Vector3(0, 0, -1)
      const cameraRight = new THREE.Vector3(1, 0, 0)
      cameraForward.applyQuaternion(this.camera.quaternion)
      cameraRight.applyQuaternion(this.camera.quaternion)
      
      // Project camera directions onto the ground plane
      const groundForward = this.projectVectorOntoPlane(cameraForward, this.groundNormal)
      const groundRight = this.projectVectorOntoPlane(cameraRight, this.groundNormal)
      
      // Ensure vectors are normalized after projection
      if (groundForward.length() > 0.01) groundForward.normalize()
      if (groundRight.length() > 0.01) groundRight.normalize()
      
      this.direction.set(0, 0, 0)
      
      if (this.keys['KeyW']) this.direction.add(groundForward)
      if (this.keys['KeyS']) this.direction.sub(groundForward)
      if (this.keys['KeyA']) this.direction.sub(groundRight)
      if (this.keys['KeyD']) this.direction.add(groundRight)
      
      if (this.direction.length() > 0) {
        this.direction.normalize()
        this.direction.multiplyScalar(effectiveSpeed)
        
        const currentVel = this.rigidBody.linvel()
        // Ground movement - movement stays on surface, preserve Y velocity
        this.rigidBody.setLinvel({
          x: this.direction.x,
          y: currentVel.y,
          z: this.direction.z
        }, true)
      }
    } else {
      // 6DOF movement when airborne using capsule direction
      const forward = new THREE.Vector3(0, 0, -1)
      const right = new THREE.Vector3(1, 0, 0)
      
      forward.applyQuaternion(this.capsuleOrientation)
      right.applyQuaternion(this.capsuleOrientation)
      
      this.direction.set(0, 0, 0)
      
      if (this.keys['KeyW']) this.direction.add(forward)
      if (this.keys['KeyS']) this.direction.sub(forward)
      if (this.keys['KeyA']) this.direction.sub(right)
      if (this.keys['KeyD']) this.direction.add(right)
      
      if (this.direction.length() > 0) {
        this.direction.normalize()
        this.direction.multiplyScalar(effectiveSpeed)
        
        // Apply horizontal movement only, preserve gravity's effect on Y
        const currentVel = this.rigidBody.linvel()
        this.rigidBody.setLinvel({
          x: this.direction.x,
          y: currentVel.y, // Preserve Y velocity so gravity continues to work
          z: this.direction.z
        }, true)
      }
    }
    
    if (this.keys['Space'] && this.canJump && this.grounded && this.jumpCooldown <= 0) {
      const currentVel = this.rigidBody.linvel()
      const jumpDirection = this.groundNormal.clone().multiplyScalar(this.jumpForce)
      
      this.rigidBody.setLinvel({
        x: currentVel.x + jumpDirection.x,
        y: currentVel.y + jumpDirection.y,
        z: currentVel.z + jumpDirection.z
      }, true)
      
      // Prevent immediate re-grounding
      this.canJump = false
      this.grounded = false
      this.jumpCooldown = 0.2
      
      // Start jump transition timing
      this.isJumping = true
      this.jumpStartTime = performance.now() / 1000 // Current time in seconds
      
      console.log('JUMPED!')
    }
  }

  projectVectorOntoPlane(vector, planeNormal) {
    // Project vector onto plane by removing the component along the normal
    const dot = vector.dot(planeNormal)
    const normalComponent = planeNormal.clone().multiplyScalar(dot)
    const projectedVector = vector.clone().sub(normalComponent)
    
    // Return the projected vector (don't normalize here - let caller decide)
    return projectedVector.length() > 0.001 ? projectedVector : new THREE.Vector3(0, 0, 0)
  }

  updatePhysics() {
    const translation = this.rigidBody.translation()
    this.position.set(translation.x, translation.y, translation.z)
    
    if (this.capsuleMesh) {
      this.capsuleMesh.position.copy(this.position)
      // Use our calculated capsule orientation instead of rigid body rotation
      this.capsuleMesh.quaternion.copy(this.capsuleOrientation)
    }
    
    if (this.attachedVehicle) {
      const vehiclePos = this.attachedVehicle.getPosition()
      const vehicleRot = this.attachedVehicle.getRotation()
      
      const worldOffset = this.vehicleOffset.clone()
      worldOffset.applyQuaternion(vehicleRot)
      
      const targetPos = vehiclePos.clone().add(worldOffset)
      this.rigidBody.setTranslation(targetPos, true)
      this.position.copy(targetPos)
    }
  }

  updateCamera() {
    // Use interpolated ground normal for smooth transitions
    const smoothGroundNormal = this.lastGroundNormal.clone()
    const transitionFactor = this.groundedTransition
    
    // Create smooth capsule orientation based on interpolated normal
    const up = new THREE.Vector3(0, 1, 0)
    const smoothCapsuleOrientation = new THREE.Quaternion()
    smoothCapsuleOrientation.setFromUnitVectors(up, smoothGroundNormal)
    
    if (this.thirdPerson) {
      if (this.grounded) {
        // Third person grounded: stable camera behind player with simple pitch control
        // Use only capsule yaw for horizontal rotation, independent pitch for up/down
        const capsuleEuler = new THREE.Euler()
        capsuleEuler.setFromQuaternion(this.capsuleOrientation, 'YXZ')
        
        // Create stable horizontal rotation (yaw only)
        const horizontalRotation = new THREE.Quaternion()
        horizontalRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), capsuleEuler.y)
        
        // Position camera behind and above player with pitch offset
        const baseOffset = new THREE.Vector3(0, 2, 5)
        baseOffset.applyQuaternion(horizontalRotation) // Apply only horizontal rotation
        
        // Add pitch-based height adjustment (simple up/down movement)
        const pitchOffset = new THREE.Vector3(0, Math.sin(-this.aimPitch) * 3, Math.cos(-this.aimPitch) * 2 - 2)
        
        this.camera.position.copy(this.position)
        this.camera.position.add(baseOffset)
        this.camera.position.add(pitchOffset)
        
        this.camera.up.copy(this.groundNormal)
        this.camera.lookAt(this.position)
      } else {
        // Third person airborne: use capsule orientation
        const cameraRotation = this.capsuleOrientation.clone()
        
        // Position camera behind player
        const cameraOffset = new THREE.Vector3(0, 2, 5)
        cameraOffset.applyQuaternion(cameraRotation)
        
        this.camera.position.copy(this.position)
        this.camera.position.add(cameraOffset)
        
        this.camera.up.set(0, 1, 0)
        this.camera.lookAt(this.position)
      }
    } else {
      // First person camera with smooth transitions
      
      // Get transition factor first
      const transitionFactor = this.groundedTransition
      
      // Calculate fixed eye position relative to body center
      const eyeOffsetGrounded = smoothGroundNormal.clone().multiplyScalar(0.8)
      eyeOffsetGrounded.applyQuaternion(smoothCapsuleOrientation) // Apply surface orientation only
      
      // Airborne behavior: simple eye offset
      const eyeOffsetAirborne = new THREE.Vector3(0, 0.8, 0)
      
      // Interpolate eye offset based on grounded state
      const eyeOffset = eyeOffsetAirborne.clone().lerp(eyeOffsetGrounded, transitionFactor)
      
      // Camera position is always body center + eye offset (no yaw translation)
      const cameraPosition = this.position.clone().add(eyeOffset)
      
      // Position camera (fixed eye position, no yaw movement)
      this.camera.position.copy(cameraPosition)
      
      // Camera rotation with instant transitions to prevent glitches
      if (this.grounded || this.isJumping) {
        // Grounded OR during jump delay: maintain grounded camera behavior
        const capsuleEuler = new THREE.Euler()
        capsuleEuler.setFromQuaternion(this.capsuleOrientation, 'YXZ')
        
        this.camera.rotation.order = 'YXZ'
        this.camera.rotation.y = capsuleEuler.y // Locked to capsule yaw
        this.camera.rotation.x = this.aimPitch  // Independent neck pitch
        this.camera.rotation.z = capsuleEuler.z // Locked to capsule roll
        
        this.camera.up.copy(this.groundNormal)
      } else {
        // Airborne (after jump delay): camera completely locked to capsule
        this.camera.quaternion.copy(this.capsuleOrientation)
        this.camera.up.set(0, 1, 0)
      }
    }
  }

  detectGround() {
    const currentPos = this.rigidBody.translation()
    
    // Cast ray from capsule bottom with proper exclusion filter
    const rayOrigin = { x: currentPos.x, y: currentPos.y - 0.7, z: currentPos.z }
    const rayDirection = { x: 0, y: -1, z: 0 }
    const rayLength = 0.6
    
    const ray = new RAPIER.Ray(rayOrigin, rayDirection)
    
    // Use intersection filter to exclude our own collider
    const filterFunction = (collider) => {
      return collider.handle !== this.collider.handle
    }
    
    const hit = this.world.castRay(ray, rayLength, true, 0xFFFFFFFF, 0xFFFFFFFF, null, null, filterFunction)
    
    this.updateDebugRay(rayOrigin, rayDirection, rayLength, hit)
    
    if (hit) {
      const distance = hit.toi
      console.log('Ground ray hit! Distance:', distance)
      
      if (distance > 0.01 && distance < 0.8) {
        this.grounded = true
        this.canJump = true
        console.log('GROUNDED! Distance:', distance)
        
        // Get normal
        const normalHit = this.world.castRayAndGetNormal(ray, rayLength, true, 0xFFFFFFFF, 0xFFFFFFFF, null, null, filterFunction)
        if (normalHit && normalHit.normal) {
          const normal = new THREE.Vector3(normalHit.normal.x, normalHit.normal.y, normalHit.normal.z)
          console.log('Ground normal:', normal.x.toFixed(2), normal.y.toFixed(2), normal.z.toFixed(2))
          
          // Check if we're inside a vehicle interior sensor
          const currentVehicle = this.gameManager?.vehicleManager?.playerInVehicle
          const inVehicleInterior = currentVehicle && this.gameManager?.vehicleManager?.checkVehicleAttachment()
          
          if (inVehicleInterior) {
            // Inside vehicle: use surface normal for local grid alignment
            if (normal.y > 0.3) { // Only if surface is walkable
              this.groundNormal.copy(normal)
              this.upDirection.copy(this.groundNormal)
              this.gravityDirection.copy(this.groundNormal).negate()
            } else {
              // Fallback to vehicle's up direction (usually vehicle floor normal)
              this.groundNormal.set(0, 1, 0) // Vehicle local up
              this.upDirection.set(0, 1, 0)
              this.gravityDirection.set(0, -1, 0)
            }
          } else {
            // Outside vehicle: always use gravity direction (0,1,0) regardless of surface normal
            this.groundNormal.set(0, 1, 0)
            this.upDirection.set(0, 1, 0)
            this.gravityDirection.set(0, -1, 0)
            console.log('Using gravity alignment (not in vehicle)')
          }
        } else {
          // No normal detected: use gravity
          this.groundNormal.set(0, 1, 0)
          this.upDirection.set(0, 1, 0)
          this.gravityDirection.set(0, -1, 0)
        }
        return
      } else {
        console.log('Hit but distance out of range:', distance)
      }
    } else {
      console.log('No ground ray hit detected')
    }
    
    // No valid ground hit
    this.grounded = false
    this.canJump = false
    this.groundNormal.set(0, 1, 0)
    this.upDirection.set(0, 1, 0)
    this.gravityDirection.set(0, -1, 0)
  }

  updateDebugRay(rayOrigin, rayDirection, rayLength, hit) {
    if (!this.debugRayHelper) {
      const geometry = new THREE.BufferGeometry()
      const material = new THREE.LineBasicMaterial({ color: 0xff0000 })
      this.debugRayHelper = new THREE.Line(geometry, material)
      this.scene.add(this.debugRayHelper)
    }
    
    // Validate input values to prevent NaN
    const startPoint = new THREE.Vector3(
      isNaN(rayOrigin.x) ? 0 : rayOrigin.x,
      isNaN(rayOrigin.y) ? 0 : rayOrigin.y,
      isNaN(rayOrigin.z) ? 0 : rayOrigin.z
    )
    
    const distance = hit && (hit.timeOfImpact || hit.toi) && !isNaN(hit.timeOfImpact || hit.toi) ? (hit.timeOfImpact || hit.toi) : rayLength
    const endPoint = new THREE.Vector3(
      startPoint.x + rayDirection.x * distance,
      startPoint.y + rayDirection.y * distance,
      startPoint.z + rayDirection.z * distance
    )
    
    // Validate end point
    if (isNaN(endPoint.x) || isNaN(endPoint.y) || isNaN(endPoint.z)) {
      endPoint.copy(startPoint).add(new THREE.Vector3(0, -1, 0))
    }
    
    const points = [startPoint, endPoint]
    
    this.debugRayHelper.geometry.setFromPoints(points)
    this.debugRayHelper.geometry.attributes.position.needsUpdate = true
    this.debugRayHelper.material.color.setHex(hit ? 0x00ff00 : 0xff0000)
  }

  attachToVehicle(vehicle) {
    this.attachedVehicle = vehicle
    
    const vehiclePos = vehicle.getPosition()
    const vehicleRot = vehicle.getRotation()
    
    const playerWorldPos = this.position.clone()
    const relativePos = playerWorldPos.sub(vehiclePos)
    
    const inverseRot = vehicleRot.clone().invert()
    this.vehicleOffset = relativePos.applyQuaternion(inverseRot)
    
    this.rigidBody.setBodyType(RAPIER.RigidBodyType.Kinematic)
  }

  detachFromVehicle() {
    if (this.attachedVehicle) {
      this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic)
      this.attachedVehicle = null
      this.vehicleOffset.set(0, 0, 0)
    }
  }
}