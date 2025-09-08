import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'

export class VehicleManager {
  constructor(scene, world) {
    this.scene = scene
    this.world = world
    this.vehicles = []
    this.playerInVehicle = null
    this.sensorEvents = new Map()
    
    this.COLLISION_GROUPS = {
      GROUND: 0x00010006,   // Group 1, collides with groups 2 (player) and 4 (vehicle)
      PLAYER: 0x00020017,   // Group 2, collides with groups 1 (ground), 4 (vehicle), 8 (sensor), and 16 (interior)
      VEHICLE_EXTERIOR: 0x00040003,  // Group 4, collides with groups 1 (ground) and 2 (player)
      VEHICLE_INTERIOR: 0x00100002, // Group 16, collides with group 2 (player) only
      SENSOR: 0x00080002    // Group 8, collides with group 2 (player)
    }
    
    this.setupCollisionEventHandler()
    
    this.createBoat()
    this.createPlane()
    this.createCar()
    this.createHelicopter()
    this.createSpaceship()
  }

  setupCollisionEventHandler() {
    // Create event queue for collision detection
    this.eventQueue = new RAPIER.EventQueue(true)
  }

  createBoat() {
    const boat = new Vehicle(this.scene, this.world, 'boat')
    
    const hullGeometry = new THREE.BoxGeometry(8, 2, 3)
    const hullMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 })
    boat.hull = new THREE.Mesh(hullGeometry, hullMaterial)
    boat.hull.position.set(35, 1, 0)
    boat.hull.castShadow = true
    boat.hull.receiveShadow = true
    this.scene.add(boat.hull)
    
    const deckGeometry = new THREE.BoxGeometry(7.5, 0.2, 2.5)
    const deckMaterial = new THREE.MeshLambertMaterial({ color: 0xDEB887 })
    boat.deck = new THREE.Mesh(deckGeometry, deckMaterial)
    boat.deck.position.set(35, 2.1, 0)
    boat.deck.castShadow = true
    boat.deck.receiveShadow = true
    this.scene.add(boat.deck)
    
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    bodyDesc.setTranslation(35, 1, 0)
    boat.rigidBody = this.world.createRigidBody(bodyDesc)
    
    const hullColliderDesc = RAPIER.ColliderDesc.cuboid(4, 1, 1.5)
    hullColliderDesc.setTranslation(0, 0, 0)
    hullColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    boat.hullCollider = this.world.createCollider(hullColliderDesc, boat.rigidBody)
    
    const interiorSensorDesc = RAPIER.ColliderDesc.cuboid(3.5, 1.5, 1.0)
    interiorSensorDesc.setTranslation(0, 1.5, 0)
    interiorSensorDesc.setSensor(true)
    interiorSensorDesc.setCollisionGroups(this.COLLISION_GROUPS.SENSOR)
    interiorSensorDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    boat.interiorSensor = this.world.createCollider(interiorSensorDesc, boat.rigidBody)
    
    boat.rigidBody.setLinearDamping(0.8)
    boat.rigidBody.setAngularDamping(0.8)
    
    this.vehicles.push(boat)
  }

  createPlane() {
    const plane = new Vehicle(this.scene, this.world, 'plane')
    
    // Materials
    const hullMaterial = new THREE.MeshLambertMaterial({ color: 0x555555 })
    const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 })
    const rampMaterial = new THREE.MeshLambertMaterial({ color: 0x777777 })
    
    // === EXTERIOR HULL ===
    // No hull bottom - cargo floor serves as the only floor surface
    
    // Hull top
    const hullTopGeometry = new THREE.BoxGeometry(25, 0.3, 8)
    plane.hullTop = new THREE.Mesh(hullTopGeometry, hullMaterial)
    plane.hullTop.position.set(-20, 6.8, -20)
    plane.hullTop.castShadow = true
    plane.hullTop.receiveShadow = true
    this.scene.add(plane.hullTop)
    
    // Hull left side
    const hullLeftGeometry = new THREE.BoxGeometry(25, 5.5, 0.3)
    plane.hullLeft = new THREE.Mesh(hullLeftGeometry, hullMaterial)
    plane.hullLeft.position.set(-20, 4.05, -24.15)
    plane.hullLeft.castShadow = true
    plane.hullLeft.receiveShadow = true
    this.scene.add(plane.hullLeft)
    
    // Hull right side
    const hullRightGeometry = new THREE.BoxGeometry(25, 5.5, 0.3)
    plane.hullRight = new THREE.Mesh(hullRightGeometry, hullMaterial)
    plane.hullRight.position.set(-20, 4.05, -15.85)
    plane.hullRight.castShadow = true
    plane.hullRight.receiveShadow = true
    this.scene.add(plane.hullRight)
    
    // Hull front (cockpit wall)
    const hullFrontGeometry = new THREE.BoxGeometry(0.3, 5.5, 8)
    plane.hullFront = new THREE.Mesh(hullFrontGeometry, hullMaterial)
    plane.hullFront.position.set(-7.5, 4.05, -20)
    plane.hullFront.castShadow = true
    plane.hullFront.receiveShadow = true
    this.scene.add(plane.hullFront)
    
    // === INTERIOR CARGO BAY ===
    // Cargo bay floor - walkable surface
    const cargoFloorGeometry = new THREE.BoxGeometry(22, 0.1, 6)
    plane.cargoFloor = new THREE.Mesh(cargoFloorGeometry, floorMaterial)
    plane.cargoFloor.position.set(-20, 1.6, -20) // Slightly above hull bottom
    plane.cargoFloor.castShadow = true
    plane.cargoFloor.receiveShadow = true
    this.scene.add(plane.cargoFloor)
    
    // === EXTERNAL RAMP ===
    // Entry ramp outside back of plane
    const rampGeometry = new THREE.BoxGeometry(4, 0.2, 6)
    plane.entryRamp = new THREE.Mesh(rampGeometry, rampMaterial)
    plane.entryRamp.position.set(-33.5, 1.0, -20)
    plane.entryRamp.rotation.z = Math.PI / 8 // Slope down from plane (back) to ground (front)
    plane.entryRamp.castShadow = true
    plane.entryRamp.receiveShadow = true
    this.scene.add(plane.entryRamp)
    
    // === WINGS AND LANDING GEAR ===
    // Wings
    const wingGeometry = new THREE.BoxGeometry(6, 0.8, 15)
    const wingMaterial = new THREE.MeshLambertMaterial({ color: 0x666666 })
    plane.wings = new THREE.Mesh(wingGeometry, wingMaterial)
    plane.wings.position.set(-20, 4, -20)
    plane.wings.castShadow = true
    plane.wings.receiveShadow = true
    this.scene.add(plane.wings)
    
    // Landing gear wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.8, 0.8, 0.5, 8)
    const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 })
    
    // Front wheel
    plane.frontWheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
    plane.frontWheel.position.set(-8, 0.8, -20)
    plane.frontWheel.rotation.x = Math.PI / 2
    plane.frontWheel.castShadow = true
    plane.frontWheel.receiveShadow = true
    this.scene.add(plane.frontWheel)
    
    // Left rear wheel
    plane.leftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
    plane.leftWheel.position.set(-25, 0.8, -16)
    plane.leftWheel.rotation.x = Math.PI / 2
    plane.leftWheel.castShadow = true
    plane.leftWheel.receiveShadow = true
    this.scene.add(plane.leftWheel)
    
    // Right rear wheel
    plane.rightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
    plane.rightWheel.position.set(-25, 0.8, -24)
    plane.rightWheel.rotation.x = Math.PI / 2
    plane.rightWheel.castShadow = true
    plane.rightWheel.receiveShadow = true
    this.scene.add(plane.rightWheel)
    
    
    // === INTERIOR LIGHTING ===
    // Main central light
    const mainInteriorLight = new THREE.PointLight(0xffffff, 2.5, 30)
    mainInteriorLight.position.set(-20, 5.5, -20) // Center of cargo bay
    mainInteriorLight.castShadow = true
    mainInteriorLight.shadow.camera.near = 0.1
    mainInteriorLight.shadow.camera.far = 30
    plane.mainInteriorLight = mainInteriorLight
    this.scene.add(mainInteriorLight)
    
    // Front cargo light
    const frontCargoLight = new THREE.PointLight(0xffffff, 1.5, 20)
    frontCargoLight.position.set(-12, 4.5, -20) // Front of cargo bay
    frontCargoLight.castShadow = false // Reduce shadow complexity
    plane.frontCargoLight = frontCargoLight
    this.scene.add(frontCargoLight)
    
    // Back cargo light near entrance
    const backCargoLight = new THREE.PointLight(0xffffff, 1.5, 20)
    backCargoLight.position.set(-28, 4.5, -20) // Back of cargo bay near entrance
    backCargoLight.castShadow = false
    plane.backCargoLight = backCargoLight
    this.scene.add(backCargoLight)
    
    // Ambient cargo lighting strips (left and right)
    const leftStripLight = new THREE.DirectionalLight(0xffffff, 0.8)
    leftStripLight.position.set(-20, 6, -23)
    leftStripLight.target.position.set(-20, 2, -23)
    leftStripLight.castShadow = false
    plane.leftStripLight = leftStripLight
    this.scene.add(leftStripLight)
    this.scene.add(leftStripLight.target)
    
    const rightStripLight = new THREE.DirectionalLight(0xffffff, 0.8)
    rightStripLight.position.set(-20, 6, -17)
    rightStripLight.target.position.set(-20, 2, -17)
    rightStripLight.castShadow = false
    plane.rightStripLight = rightStripLight
    this.scene.add(rightStripLight)
    this.scene.add(rightStripLight.target)
    
    // === PHYSICS SETUP ===
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    bodyDesc.setTranslation(-20, 2.0, -20) // Center the physics body
    plane.rigidBody = this.world.createRigidBody(bodyDesc)
    
    // === EXTERIOR HULL COLLIDERS ===
    // No hull bottom collider - cargo floor serves as the only floor collider
    
    // Hull top (mesh at y=6.8, body at y=2.0, offset = 4.8)
    const hullTopColliderDesc = RAPIER.ColliderDesc.cuboid(12.5, 0.15, 4)
    hullTopColliderDesc.setTranslation(0, 4.8, 0)
    hullTopColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    plane.hullTopCollider = this.world.createCollider(hullTopColliderDesc, plane.rigidBody)
    
    // Hull left side (mesh at z=-24.15, y=4.05, body at z=-20, y=2.0, offset = -4.15, 2.05)
    const hullLeftColliderDesc = RAPIER.ColliderDesc.cuboid(12.5, 2.75, 0.15)
    hullLeftColliderDesc.setTranslation(0, 2.05, -4.15)
    hullLeftColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    plane.hullLeftCollider = this.world.createCollider(hullLeftColliderDesc, plane.rigidBody)
    
    // Hull right side (mesh at z=-15.85, y=4.05, body at z=-20, y=2.0, offset = 4.15, 2.05)
    const hullRightColliderDesc = RAPIER.ColliderDesc.cuboid(12.5, 2.75, 0.15)
    hullRightColliderDesc.setTranslation(0, 2.05, 4.15)
    hullRightColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    plane.hullRightCollider = this.world.createCollider(hullRightColliderDesc, plane.rigidBody)
    
    // Hull front (mesh at x=-7.5, y=4.05, body at x=-20, y=2.0, offset = 12.5, 2.05)
    const hullFrontColliderDesc = RAPIER.ColliderDesc.cuboid(0.15, 2.75, 4)
    hullFrontColliderDesc.setTranslation(12.5, 2.05, 0)
    hullFrontColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    plane.hullFrontCollider = this.world.createCollider(hullFrontColliderDesc, plane.rigidBody)
    
    // === INTERIOR CARGO BAY COLLIDERS ===
    // Cargo floor (mesh at x=-20, y=1.6, body at x=-20, y=2.0, offset = 0, -0.4)
    const cargoFloorColliderDesc = RAPIER.ColliderDesc.cuboid(11, 0.05, 3)
    cargoFloorColliderDesc.setTranslation(0, -0.4, 0)
    cargoFloorColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_INTERIOR)
    plane.cargoFloorCollider = this.world.createCollider(cargoFloorColliderDesc, plane.rigidBody)
    
    // === EXTERNAL RAMP COLLIDER ===
    // Entry ramp (mesh at x=-33.5, y=1.0, body at x=-20, y=2.0, offset = -13.5, -1.0)
    const entryRampColliderDesc = RAPIER.ColliderDesc.cuboid(2, 0.1, 3)
    entryRampColliderDesc.setTranslation(-13.5, -1.0, 0)
    const rampQuat = new THREE.Quaternion()
    rampQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 8)
    entryRampColliderDesc.setRotation(rampQuat)
    entryRampColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_INTERIOR)
    plane.entryRampCollider = this.world.createCollider(entryRampColliderDesc, plane.rigidBody)
    
    // === INTERIOR DETECTION SENSOR ===
    // Large sensor volume covering the entire cargo bay interior
    const interiorSensorDesc = RAPIER.ColliderDesc.cuboid(11, 2.5, 3) // Cover cargo bay (22×5×6)
    interiorSensorDesc.setTranslation(0, -0.4, 0) // Positioned at cargo floor level (body at y=2.0, floor at y=1.6, offset = -0.4)
    interiorSensorDesc.setSensor(true)
    // Use explicit collision groups to ensure detection: group 8, collides with group 2 (player)
    interiorSensorDesc.setCollisionGroups(this.COLLISION_GROUPS.SENSOR)
    interiorSensorDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    plane.interiorSensor = this.world.createCollider(interiorSensorDesc, plane.rigidBody)
    
    plane.rigidBody.setLinearDamping(0.9)
    plane.rigidBody.setAngularDamping(0.9)
    
    this.vehicles.push(plane)
  }

  createCar() {
    const car = new Vehicle(this.scene, this.world, 'car')
    
    const chassisGeometry = new THREE.BoxGeometry(4, 1, 2)
    const chassisMaterial = new THREE.MeshLambertMaterial({ color: 0xFF0000 })
    car.chassis = new THREE.Mesh(chassisGeometry, chassisMaterial)
    car.chassis.position.set(0, 3, 20)
    car.chassis.castShadow = true
    car.chassis.receiveShadow = true
    this.scene.add(car.chassis)
    
    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8)
    const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 })
    
    car.wheels = []
    const wheelPositions = [
      { x: 1.2, y: 0.5, z: 0.8 },
      { x: 1.2, y: 0.5, z: -0.8 },
      { x: -1.2, y: 0.5, z: 0.8 },
      { x: -1.2, y: 0.5, z: -0.8 }
    ]
    
    wheelPositions.forEach((pos) => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
      wheel.position.set(0 + pos.x, 3 + pos.y, 20 + pos.z)
      wheel.rotation.z = Math.PI / 2
      wheel.castShadow = true
      wheel.receiveShadow = true
      car.wheels.push(wheel)
      this.scene.add(wheel)
    })
    
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    bodyDesc.setTranslation(0, 3, 20)
    car.rigidBody = this.world.createRigidBody(bodyDesc)
    
    const chassisColliderDesc = RAPIER.ColliderDesc.cuboid(2, 0.5, 1)
    chassisColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    car.chassisCollider = this.world.createCollider(chassisColliderDesc, car.rigidBody)
    
    const interiorSensorDesc = RAPIER.ColliderDesc.cuboid(1.8, 0.8, 0.8)
    interiorSensorDesc.setTranslation(0, 0.3, 0)
    interiorSensorDesc.setSensor(true)
    interiorSensorDesc.setCollisionGroups(this.COLLISION_GROUPS.SENSOR)
    interiorSensorDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    car.interiorSensor = this.world.createCollider(interiorSensorDesc, car.rigidBody)
    
    car.rigidBody.setLinearDamping(0.5)
    car.rigidBody.setAngularDamping(0.8)
    
    this.vehicles.push(car)
  }

  createHelicopter() {
    const helicopter = new Vehicle(this.scene, this.world, 'helicopter')
    
    const fuselageGeometry = new THREE.BoxGeometry(3, 1.5, 8)
    const fuselageMaterial = new THREE.MeshLambertMaterial({ color: 0x00AA00 })
    helicopter.fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial)
    helicopter.fuselage.position.set(20, 8, -20)
    helicopter.fuselage.castShadow = true
    helicopter.fuselage.receiveShadow = true
    this.scene.add(helicopter.fuselage)
    
    const rotorGeometry = new THREE.BoxGeometry(0.2, 0.1, 12)
    const rotorMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 })
    helicopter.mainRotor = new THREE.Mesh(rotorGeometry, rotorMaterial)
    helicopter.mainRotor.position.set(20, 9, -20)
    helicopter.mainRotor.castShadow = true
    helicopter.mainRotor.receiveShadow = true
    this.scene.add(helicopter.mainRotor)
    
    const tailRotorGeometry = new THREE.BoxGeometry(0.1, 3, 0.2)
    const tailRotorMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 })
    helicopter.tailRotor = new THREE.Mesh(tailRotorGeometry, tailRotorMaterial)
    helicopter.tailRotor.position.set(20, 8, -24)
    helicopter.tailRotor.castShadow = true
    helicopter.tailRotor.receiveShadow = true
    this.scene.add(helicopter.tailRotor)
    
    const cockpitGeometry = new THREE.BoxGeometry(2.5, 1.2, 2)
    const cockpitMaterial = new THREE.MeshLambertMaterial({ color: 0x222222, transparent: true, opacity: 0.3 })
    helicopter.cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial)
    helicopter.cockpit.position.set(20, 8.3, -18)
    helicopter.cockpit.castShadow = true
    helicopter.cockpit.receiveShadow = true
    this.scene.add(helicopter.cockpit)
    
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    bodyDesc.setTranslation(20, 8, -20)
    helicopter.rigidBody = this.world.createRigidBody(bodyDesc)
    
    const fuselageColliderDesc = RAPIER.ColliderDesc.cuboid(1.5, 0.75, 4)
    fuselageColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    fuselageColliderDesc.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT)
    fuselageColliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    helicopter.fuselageCollider = this.world.createCollider(fuselageColliderDesc, helicopter.rigidBody)
    
    const cockpitSensorDesc = RAPIER.ColliderDesc.cuboid(1.2, 0.6, 1)
    cockpitSensorDesc.setTranslation(0, 0.3, 2)
    cockpitSensorDesc.setSensor(true)
    cockpitSensorDesc.setCollisionGroups(this.COLLISION_GROUPS.SENSOR)
    cockpitSensorDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    helicopter.cockpitSensor = this.world.createCollider(cockpitSensorDesc, helicopter.rigidBody)
    
    helicopter.rigidBody.setLinearDamping(0.3)
    helicopter.rigidBody.setAngularDamping(0.5)
    
    // Ensure helicopter doesn't fall through platform by setting proper mass
    helicopter.rigidBody.setAdditionalMass(5.0, true)
    
    this.vehicles.push(helicopter)
  }

  createSpaceship() {
    const spaceship = new Vehicle(this.scene, this.world, 'spaceship')
    
    const hullGeometry = new THREE.CylinderGeometry(1, 2, 6, 6)
    const hullMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 })
    spaceship.hull = new THREE.Mesh(hullGeometry, hullMaterial)
    spaceship.hull.position.set(-20, 15, 20)
    spaceship.hull.castShadow = true
    spaceship.hull.receiveShadow = true
    this.scene.add(spaceship.hull)
    
    const thrusterGeometry = new THREE.CylinderGeometry(0.3, 0.5, 2, 6)
    const thrusterMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 })
    spaceship.thrusters = []
    
    for (let i = 0; i < 4; i++) {
      const thruster = new THREE.Mesh(thrusterGeometry, thrusterMaterial)
      const angle = (i / 4) * Math.PI * 2
      thruster.position.set(
        -20 + Math.cos(angle) * 1.5,
        15 - 4,
        20 + Math.sin(angle) * 1.5
      )
      thruster.castShadow = true
      thruster.receiveShadow = true
      spaceship.thrusters.push(thruster)
      this.scene.add(thruster)
    }
    
    const cockpitGeometry = new THREE.SphereGeometry(1.2, 8, 6)
    const cockpitMaterial = new THREE.MeshLambertMaterial({ color: 0x111111, transparent: true, opacity: 0.4 })
    spaceship.cockpit = new THREE.Mesh(cockpitGeometry, cockpitMaterial)
    spaceship.cockpit.position.set(-20, 15 + 1.5, 20)
    spaceship.cockpit.castShadow = true
    spaceship.cockpit.receiveShadow = true
    this.scene.add(spaceship.cockpit)
    
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    bodyDesc.setTranslation(-20, 15, 20)
    spaceship.rigidBody = this.world.createRigidBody(bodyDesc)
    
    const hullColliderDesc = RAPIER.ColliderDesc.cylinder(3, 1.5)
    hullColliderDesc.setCollisionGroups(this.COLLISION_GROUPS.VEHICLE_EXTERIOR)
    spaceship.hullCollider = this.world.createCollider(hullColliderDesc, spaceship.rigidBody)
    
    const cockpitSensorDesc = RAPIER.ColliderDesc.ball(1.1)
    cockpitSensorDesc.setTranslation(0, 1.5, 0)
    cockpitSensorDesc.setSensor(true)
    cockpitSensorDesc.setCollisionGroups(this.COLLISION_GROUPS.SENSOR)
    cockpitSensorDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    spaceship.cockpitSensor = this.world.createCollider(cockpitSensorDesc, spaceship.rigidBody)
    
    spaceship.rigidBody.setLinearDamping(0.3)
    spaceship.rigidBody.setAngularDamping(0.6)
    spaceship.rigidBody.setGravityScale(0.1)
    
    this.vehicles.push(spaceship)
  }

  update(deltaTime) {
    // Process collision events for sensor detection (correct method per Rapier docs)
    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const collider1 = this.world.getCollider(handle1)
      const collider2 = this.world.getCollider(handle2)
      
      if (!collider1 || !collider2) return
      
      // Debug: log all collision events
      console.log('Collision event:', handle1, handle2, started)
      console.log('Collider1 sensor?', collider1.isSensor(), 'groups:', collider1.collisionGroups().toString(16))
      console.log('Collider2 sensor?', collider2.isSensor(), 'groups:', collider2.collisionGroups().toString(16))
      
      // Check if one is a sensor and the other is the player
      let sensorCollider = null
      let playerCollider = null
      
      if (collider1.isSensor() && collider2.collisionGroups() === this.COLLISION_GROUPS.PLAYER) {
        sensorCollider = collider1
        playerCollider = collider2
      } else if (collider2.isSensor() && collider1.collisionGroups() === this.COLLISION_GROUPS.PLAYER) {
        sensorCollider = collider2
        playerCollider = collider1
      }
      
      if (sensorCollider && playerCollider) {
        console.log('Found sensor-player intersection!')
        // Find which vehicle this sensor belongs to
        const vehicle = this.vehicles.find(v => {
          return (v.interiorSensor && v.interiorSensor.handle === sensorCollider.handle) ||
                 (v.backAreaSensor && v.backAreaSensor.handle === sensorCollider.handle) ||
                 (v.cockpitSensor && v.cockpitSensor.handle === sensorCollider.handle)
        })
        
        if (vehicle) {
          // Determine which sensor was triggered
          let sensorType = 'interior'
          if (vehicle.backAreaSensor && vehicle.backAreaSensor.handle === sensorCollider.handle) {
            sensorType = 'backArea'
          } else if (vehicle.cockpitSensor && vehicle.cockpitSensor.handle === sensorCollider.handle) {
            sensorType = 'cockpit'
          }
          
          if (started) {
            console.log(`Player entered vehicle ${sensorType} sensor:`, vehicle.name)
            this.playerInVehicle = vehicle
          } else {
            console.log(`Player left vehicle ${sensorType} sensor:`, vehicle.name)
            if (this.playerInVehicle === vehicle) {
              this.playerInVehicle = null
            }
          }
        }
      }
    })
    
    for (const vehicle of this.vehicles) {
      vehicle.update(deltaTime)
    }
  }

  checkVehicleAttachment() {
    // Return the vehicle the player is currently in based on sensor collision events
    return this.playerInVehicle
  }
}

class Vehicle {
  constructor(scene, world, name) {
    this.scene = scene
    this.world = world
    this.name = name
    this.rigidBody = null
    this.meshes = []
    this.interiorSensor = null
    this.movementSpeed = 2
    this.time = 0
    this.rotationsLocked = false
  }

  getPosition() {
    if (this.rigidBody) {
      const translation = this.rigidBody.translation()
      return new THREE.Vector3(translation.x, translation.y, translation.z)
    }
    return new THREE.Vector3()
  }

  getRotation() {
    if (this.rigidBody) {
      const rotation = this.rigidBody.rotation()
      return new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
    }
    return new THREE.Quaternion()
  }

  update(deltaTime) {
    this.time += deltaTime
    
    this.updateMovement()
    this.updateMeshes()
  }

  updateMovement() {
    if (!this.rigidBody) return
    
    // Light velocity limiting only for extreme cases
    const currentVel = this.rigidBody.linvel()
    const maxVel = 25
    if (Math.abs(currentVel.x) > maxVel || Math.abs(currentVel.y) > maxVel || Math.abs(currentVel.z) > maxVel) {
      this.rigidBody.setLinvel({
        x: Math.max(-maxVel, Math.min(maxVel, currentVel.x)),
        y: Math.max(-maxVel, Math.min(maxVel, currentVel.y)),
        z: Math.max(-maxVel, Math.min(maxVel, currentVel.z))
      }, true)
    }
    
    if (this.name === 'boat') {
      const currentPos = this.rigidBody.translation()
      const currentVel = this.rigidBody.linvel()
      const waterLevel = -2 // Water is below the platform
      
      // Check if boat hull is actually in water (below water level)
      if (currentPos.y < waterLevel + 1) {
        // Disable gravity when in water but keep as dynamic
        this.rigidBody.setGravityScale(0)
        
        // Lock rotations in water for stability
        if (!this.rotationsLocked) {
          this.rigidBody.lockRotations()
          this.rotationsLocked = true
        }
        
        // Strong velocity damping in water
        this.rigidBody.setLinvel({
          x: currentVel.x * 0.7,
          y: Math.max(-2, Math.min(2, currentVel.y * 0.5)),
          z: currentVel.z * 0.7
        }, true)
        
        // Proper buoyancy using impulse like the good boat code
        const depth = waterLevel - currentPos.y
        if (depth > 0) {
          const dt = 1/60
          const buoyancyForce = depth * 500 * dt
          this.rigidBody.applyImpulse({ x: 0, y: buoyancyForce, z: 0 }, true)
        }
      } else {
        // Re-enable gravity and unlock rotations when above water
        this.rigidBody.setGravityScale(1)
        
        if (this.rotationsLocked) {
          this.rigidBody.setEnabledRotations(true, true, true, true)
          this.rotationsLocked = false
        }
      }
      
      // Minimal movement forces
      if (this.time % 10 < 5) {
        const dt = 1/60
        const bobForce = Math.sin(this.time * 0.2) * 2 * dt
        const driftForceX = Math.sin(this.time * 0.05) * 1 * dt
        const driftForceZ = Math.cos(this.time * 0.04) * 1 * dt
        
        this.rigidBody.applyImpulse({ 
          x: driftForceX, 
          y: bobForce, 
          z: driftForceZ 
        }, true)
      }
    } else if (this.name === 'plane') {
      const currentPos = this.rigidBody.translation()
      const currentVel = this.rigidBody.linvel()
      const waterLevel = -2
      const targetHeight = 3
      
      if (currentPos.y < waterLevel + 1) {
        // Plane in water
        this.rigidBody.setGravityScale(0)
        
        if (!this.rotationsLocked) {
          this.rigidBody.lockRotations()
          this.rotationsLocked = true
        }
        
        this.rigidBody.setLinvel({
          x: currentVel.x * 0.65,
          y: Math.max(-1.5, Math.min(1.5, currentVel.y * 0.4)),
          z: currentVel.z * 0.65
        }, true)
        
        const depth = waterLevel - currentPos.y
        if (depth > 0) {
          const dt = 1/60
          const buoyancyForce = depth * 400 * dt
          this.rigidBody.applyImpulse({ x: 0, y: buoyancyForce, z: 0 }, true)
        }
      } else {
        // Normal flight
        this.rigidBody.setGravityScale(1)
        
        if (this.rotationsLocked) {
          this.rigidBody.setEnabledRotations(true, true, true, true)
          this.rotationsLocked = false
        }
        
        const heightDiff = Math.max(-1, Math.min(1, targetHeight - currentPos.y))
        const dt = 1/60
        const liftForce = heightDiff * 30 * dt
        
        if (this.time % 10 < 5) {
          const driftForceX = Math.sin(this.time * 0.04) * 8 * dt
          const driftForceZ = Math.cos(this.time * 0.05) * 8 * dt
          
          this.rigidBody.applyImpulse({ 
            x: driftForceX, 
            y: liftForce, 
            z: driftForceZ 
          }, true)
        }
      }
      
    } else if (this.name === 'car') {
      
    } else if (this.name === 'helicopter') {
      const currentPos = this.rigidBody.translation()
      const currentVel = this.rigidBody.linvel()
      const waterLevel = -2
      const targetHeight = 8
      
      if (currentPos.y < waterLevel + 1) {
        // Helicopter in water
        this.rigidBody.setGravityScale(0)
        
        if (!this.rotationsLocked) {
          this.rigidBody.lockRotations()
          this.rotationsLocked = true
        }
        
        this.rigidBody.setLinvel({
          x: currentVel.x * 0.6,
          y: Math.max(-1, Math.min(1, currentVel.y * 0.3)),
          z: currentVel.z * 0.6
        }, true)
        
        const depth = waterLevel - currentPos.y
        if (depth > 0) {
          const dt = 1/60
          const buoyancyForce = depth * 300 * dt
          this.rigidBody.applyImpulse({ x: 0, y: buoyancyForce, z: 0 }, true)
        }
      } else {
        // Normal helicopter flight
        this.rigidBody.setGravityScale(1)
        
        if (this.rotationsLocked) {
          this.rigidBody.setEnabledRotations(true, true, true, true)
          this.rotationsLocked = false
        }
        
        const heightDiff = Math.max(-1, Math.min(1, targetHeight - currentPos.y))
        const dt = 1/60
        const rotorLift = heightDiff * 20 * dt
        
        if (this.time % 8 < 4) {
          const driftForceX = Math.sin(this.time * 0.06) * 5 * dt
          const driftForceZ = Math.cos(this.time * 0.05) * 5 * dt
          
          this.rigidBody.applyImpulse({ 
            x: driftForceX, 
            y: rotorLift, 
            z: driftForceZ 
          }, true)
        }
      }
      
    } else if (this.name === 'spaceship') {
      const currentPos = this.rigidBody.translation()
      const currentVel = this.rigidBody.linvel()
      const waterLevel = -2
      const targetHeight = 15
      
      if (currentPos.y < waterLevel + 1) {
        // Spaceship in water
        this.rigidBody.setGravityScale(0)
        
        if (!this.rotationsLocked) {
          this.rigidBody.lockRotations()
          this.rotationsLocked = true
        }
        
        this.rigidBody.setLinvel({
          x: currentVel.x * 0.5,
          y: Math.max(-1, Math.min(1, currentVel.y * 0.2)),
          z: currentVel.z * 0.5
        }, true)
        
        const depth = waterLevel - currentPos.y
        if (depth > 0) {
          const dt = 1/60
          const buoyancyForce = depth * 200 * dt
          this.rigidBody.applyImpulse({ x: 0, y: buoyancyForce, z: 0 }, true)
        }
      } else {
        // Space flight
        this.rigidBody.setGravityScale(0.1)
        
        if (this.rotationsLocked) {
          this.rigidBody.setEnabledRotations(true, true, true, true)
          this.rotationsLocked = false
        }
        
        const heightDiff = Math.max(-2, Math.min(2, targetHeight - currentPos.y))
        const dt = 1/60
        const thrusterForce = heightDiff * 15 * dt
        
        if (this.time % 15 < 7) {
          const driftForceX = Math.sin(this.time * 0.08) * 10 * dt
          const driftForceZ = Math.cos(this.time * 0.09) * 10 * dt
          
          this.rigidBody.applyImpulse({ 
            x: driftForceX, 
            y: thrusterForce, 
            z: driftForceZ 
          }, true)
        }
      }
    }
  }

  updateMeshes() {
    if (!this.rigidBody) return
    
    const position = this.getPosition()
    const rotation = this.getRotation()
    
    if (this.name === 'boat') {
      if (this.hull) {
        this.hull.position.copy(position)
        this.hull.quaternion.copy(rotation)
      }
      if (this.deck) {
        this.deck.position.copy(position)
        this.deck.position.y += 1.1
        this.deck.quaternion.copy(rotation)
      }
    } else if (this.name === 'plane') {
      // Update all fuselage parts with proper relative positioning
      
      // Fuselage bottom (mesh at y=1.45, body at y=2.5, so offset = 1.45-2.5 = -1.05)
      if (this.bottom) {
        this.bottom.position.copy(position)
        this.bottom.position.y += -1.05
        this.bottom.quaternion.copy(rotation)
      }
      
      // Fuselage top (mesh at y=6.85, body at y=2.5, so offset = 6.85-2.5 = 4.35)
      if (this.top) {
        this.top.position.copy(position)
        this.top.position.y += 4.35
        this.top.quaternion.copy(rotation)
      }
      
      // Fuselage left side (mesh at z=-24.15, y=4, body at z=-20, y=4, so offset = -4.15, 0)
      if (this.leftSide) {
        const leftSidePos = position.clone()
        const localOffset = new THREE.Vector3(0, 0, -4.15)
        localOffset.applyQuaternion(rotation)
        leftSidePos.add(localOffset)
        this.leftSide.position.copy(leftSidePos)
        this.leftSide.quaternion.copy(rotation)
      }
      
      // Fuselage right side (mesh at z=-15.85, y=4, body at z=-20, y=4, so offset = 4.15, 0)
      if (this.rightSide) {
        const rightSidePos = position.clone()
        const localOffset = new THREE.Vector3(0, 0, 4.15)
        localOffset.applyQuaternion(rotation)
        rightSidePos.add(localOffset)
        this.rightSide.position.copy(rightSidePos)
        this.rightSide.quaternion.copy(rotation)
      }
      
      // Fuselage front (mesh at x=-7.5, y=4, body at x=-20, y=4, so offset = 12.5, 0)
      if (this.front) {
        const frontPos = position.clone()
        const localOffset = new THREE.Vector3(12.5, 0, 0)
        localOffset.applyQuaternion(rotation)
        frontPos.add(localOffset)
        this.front.position.copy(frontPos)
        this.front.quaternion.copy(rotation)
      }
      
      // Cargo floor (mesh at y=1.6, body at y=2, so offset = 1.6-2 = -0.4)
      if (this.cargoFloor) {
        this.cargoFloor.position.copy(position)
        this.cargoFloor.position.y += -0.4
        this.cargoFloor.quaternion.copy(rotation)
      }
      
      // Interior walls with proper relative positioning (mesh at y=3.7, body at y=2, so offset = 1.7)
      if (this.leftWall) {
        const leftWallPos = position.clone()
        const localOffset = new THREE.Vector3(0, 1.7, -3.65)
        localOffset.applyQuaternion(rotation)
        leftWallPos.add(localOffset)
        this.leftWall.position.copy(leftWallPos)
        this.leftWall.quaternion.copy(rotation)
      }
      
      if (this.rightWall) {
        const rightWallPos = position.clone()
        const localOffset = new THREE.Vector3(0, 1.7, 3.65)
        localOffset.applyQuaternion(rotation)
        rightWallPos.add(localOffset)
        this.rightWall.position.copy(rightWallPos)
        this.rightWall.quaternion.copy(rotation)
      }
      
      if (this.frontWall) {
        const frontWallPos = position.clone()
        const localOffset = new THREE.Vector3(11, 1.7, 0)
        localOffset.applyQuaternion(rotation)
        frontWallPos.add(localOffset)
        this.frontWall.position.copy(frontWallPos)
        this.frontWall.quaternion.copy(rotation)
      }
      
      if (this.ceiling) {
        const ceilingPos = position.clone()
        const localOffset = new THREE.Vector3(0, 4.65, 0) // mesh at y=6.65, body at y=2, so offset = 4.65
        localOffset.applyQuaternion(rotation)
        ceilingPos.add(localOffset)
        this.ceiling.position.copy(ceilingPos)
        this.ceiling.quaternion.copy(rotation)
      }
      
      // Update wing visuals to match wing rigid bodies
      if (this.wings && this.leftWingBody && this.rightWingBody) {
        // Wings mesh stays at main position but we could split it later
        this.wings.position.copy(position)
        this.wings.quaternion.copy(rotation)
      }
      
      // Update wheels to move with main body
      if (this.frontWheel) {
        this.frontWheel.position.copy(position)
        this.frontWheel.quaternion.copy(rotation)
      }
      if (this.leftWheel) {
        this.leftWheel.position.copy(position)
        this.leftWheel.quaternion.copy(rotation)
      }
      if (this.rightWheel) {
        this.rightWheel.position.copy(position)
        this.rightWheel.quaternion.copy(rotation)
      }
      
      // Update ramp (mesh at x=-33.5, y=1.0, body at x=-20, y=2.0, so offset = -13.5, -1.0)
      if (this.entryRamp) {
        const rampPos = position.clone()
        const localOffset = new THREE.Vector3(-13.5, -1.0, 0)
        localOffset.applyQuaternion(rotation)
        rampPos.add(localOffset)
        this.entryRamp.position.copy(rampPos)
        this.entryRamp.quaternion.copy(rotation)
      }
      
      // Update interior lights to move with plane
      
      // Main cargo bay light in center of interior (cargo bay center at y=4, body at y=4, so offset = 0.5)
      if (this.cargoBayLight) {
        this.cargoBayLight.position.copy(position)
        this.cargoBayLight.position.y += 0.5 // Center of cargo bay interior space
      }
      
      // Secondary ceiling light (above ceiling at y=7.5, body at y=4, so offset = 3.5)
      if (this.interiorLight) {
        this.interiorLight.position.copy(position)
        this.interiorLight.position.y += 3.5 // Above ceiling mesh
      }
      if (this.accentLight1) {
        const frontLightPos = position.clone()
        const localOffset = new THREE.Vector3(5, 4.2, 0) // Front of cabin
        localOffset.applyQuaternion(rotation)
        frontLightPos.add(localOffset)
        this.accentLight1.position.copy(frontLightPos)
      }
      if (this.accentLight2) {
        const backLightPos = position.clone()
        const localOffset = new THREE.Vector3(-5, 4.2, 0) // Back of cabin
        localOffset.applyQuaternion(rotation)
        backLightPos.add(localOffset)
        this.accentLight2.position.copy(backLightPos)
      }
      if (this.backAreaLight) {
        const backAreaPos = position.clone()
        const localOffset = new THREE.Vector3(-12, 3, 0) // Back area
        localOffset.applyQuaternion(rotation)
        backAreaPos.add(localOffset)
        this.backAreaLight.position.copy(backAreaPos)
      }
    } else if (this.name === 'car') {
      if (this.chassis) {
        this.chassis.position.copy(position)
        this.chassis.quaternion.copy(rotation)
      }
      if (this.wheels) {
        const wheelPositions = [
          { x: 1.2, y: 0.5, z: 0.8 },
          { x: 1.2, y: 0.5, z: -0.8 },
          { x: -1.2, y: 0.5, z: 0.8 },
          { x: -1.2, y: 0.5, z: -0.8 }
        ]
        
        this.wheels.forEach((wheel, index) => {
          const wheelPos = position.clone()
          const localPos = new THREE.Vector3(wheelPositions[index].x, wheelPositions[index].y, wheelPositions[index].z)
          localPos.applyQuaternion(rotation)
          wheelPos.add(localPos)
          wheel.position.copy(wheelPos)
          wheel.quaternion.copy(rotation)
          wheel.rotation.z += Math.PI / 2
        })
      }
    } else if (this.name === 'helicopter') {
      if (this.fuselage) {
        this.fuselage.position.copy(position)
        this.fuselage.quaternion.copy(rotation)
      }
      if (this.mainRotor) {
        this.mainRotor.position.copy(position)
        this.mainRotor.position.y += 1
        this.mainRotor.quaternion.copy(rotation)
        this.mainRotor.rotation.y += this.time * 20
      }
      if (this.tailRotor) {
        const tailPos = position.clone()
        tailPos.z -= 4
        this.tailRotor.position.copy(tailPos)
        this.tailRotor.quaternion.copy(rotation)
        this.tailRotor.rotation.z += this.time * 25
      }
      if (this.cockpit) {
        const cockpitPos = position.clone()
        cockpitPos.y += 0.3
        cockpitPos.z += 2
        this.cockpit.position.copy(cockpitPos)
        this.cockpit.quaternion.copy(rotation)
      }
    } else if (this.name === 'spaceship') {
      if (this.hull) {
        this.hull.position.copy(position)
        this.hull.quaternion.copy(rotation)
      }
      if (this.thrusters) {
        this.thrusters.forEach((thruster, index) => {
          const angle = (index / 4) * Math.PI * 2
          const thrusterPos = position.clone()
          const localPos = new THREE.Vector3(Math.cos(angle) * 1.5, -4, Math.sin(angle) * 1.5)
          localPos.applyQuaternion(rotation)
          thrusterPos.add(localPos)
          thruster.position.copy(thrusterPos)
          thruster.quaternion.copy(rotation)
        })
      }
      if (this.cockpit) {
        const cockpitPos = position.clone()
        cockpitPos.y += 1.5
        this.cockpit.position.copy(cockpitPos)
        this.cockpit.quaternion.copy(rotation)
      }
    }
  }

  isPlayerInside(playerPosition) {
    if (!this.interiorSensor) return false
    
    const sensor = this.interiorSensor
    const vehiclePos = this.getPosition()
    const relativePos = playerPosition.clone().sub(vehiclePos)
    
    if (this.name === 'boat') {
      return Math.abs(relativePos.x) < 3.5 && 
             Math.abs(relativePos.y - 1.5) < 1.5 && 
             Math.abs(relativePos.z) < 1.0
    } else if (this.name === 'plane') {
      const cargoPos = relativePos.clone()
      cargoPos.x += 2
      return Math.abs(cargoPos.x) < 1.3 && 
             Math.abs(cargoPos.y - 0.2) < 1.2 && 
             Math.abs(cargoPos.z) < 0.8
    } else if (this.name === 'car') {
      return Math.abs(relativePos.x) < 1.8 && 
             Math.abs(relativePos.y - 0.3) < 0.8 && 
             Math.abs(relativePos.z) < 0.8
    } else if (this.name === 'helicopter') {
      const cockpitPos = relativePos.clone()
      cockpitPos.z -= 2
      return Math.abs(cockpitPos.x) < 1.2 && 
             Math.abs(cockpitPos.y - 0.3) < 0.6 && 
             Math.abs(cockpitPos.z) < 1
    } else if (this.name === 'spaceship') {
      const cockpitPos = relativePos.clone()
      cockpitPos.y -= 1.5
      return Math.abs(cockpitPos.x) < 1.1 && 
             Math.abs(cockpitPos.y) < 1.1 && 
             Math.abs(cockpitPos.z) < 1.1
    }
    
    return false
  }
}