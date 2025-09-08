import { PhysicsEntity } from './PhysicsEntity.js';
import { Vector3, Quaternion } from 'three';

export class Carrier extends PhysicsEntity {
  constructor(world, options = {}) {
    super(world, {
      ...options,
      mass: options.mass || 50000, // 50 ton carrier
      isKinematic: options.isKinematic || false
    });
    
    // Carrier-specific properties
    this.maxSpeed = options.maxSpeed || 15.0; // m/s
    this.acceleration = options.acceleration || 2.0;
    this.turnRate = options.turnRate || 0.5; // rad/s
    
    // Large vessel physics
    this.dimensions = {
      length: options.length || 100,
      width: options.width || 20,
      height: options.height || 15
    };
    
    // Deck/hangar areas for contained entities
    this.hangarAreas = new Map();
    this.deckAreas = new Map();
    this.containedVehicles = new Set();
    this.containedPersonnel = new Set();
    
    // Navigation and movement
    this.propulsion = {
      throttle: 0,
      rudder: 0,
      thrust: 0
    };
    
    // Stability systems
    this.stabilizers = {
      active: true,
      strength: 0.8
    };
    
    this.createCarrierBody(options);
    this.setupInternalAreas(options);
  }

  createCarrierBody(options) {
    // Create main hull
    this.world.createRigidBody(this, {
      isKinematic: this.isKinematic,
      collider: {
        type: 'box',
        halfExtents: {
          x: this.dimensions.width / 2,
          y: this.dimensions.height / 2,
          z: this.dimensions.length / 2
        },
        friction: 0.6,
        restitution: 0.05,
        density: 0.3 // Lower density for large vessel
      }
    });
    
    // Set center of mass lower for stability (not available in current Rapier API)
    // const centerOfMass = new Vector3(0, -this.dimensions.height * 0.3, 0);
    // this.rigidBody.setCenterOfMass(centerOfMass); // Not available in current API
    
    // Set up collision groups for carrier
    this.world.setupCollisionGroups(this, {
      membership: 0x0004, // Carrier group
      filter: 0xFFFB      // Collides with everything except carriers
    });
    
    // Heavy damping for realistic large vessel movement
    this.rigidBody.setLinearDamping(0.3);
    this.rigidBody.setAngularDamping(0.5);
  }

  setupInternalAreas(options) {
    // Define hangar areas (internal spaces for vehicles)
    this.hangarAreas.set('main_hangar', {
      position: new Vector3(0, -2, -10),
      dimensions: new Vector3(15, 8, 30),
      capacity: 8,
      occupied: new Set()
    });
    
    this.hangarAreas.set('rear_hangar', {
      position: new Vector3(0, -2, 20),
      dimensions: new Vector3(12, 6, 20),
      capacity: 4,
      occupied: new Set()
    });
    
    // Define deck areas (external spaces)
    this.deckAreas.set('flight_deck', {
      position: new Vector3(0, this.dimensions.height / 2 + 1, -20),
      dimensions: new Vector3(18, 2, 40),
      capacity: 6,
      occupied: new Set()
    });
    
    this.deckAreas.set('cargo_deck', {
      position: new Vector3(0, this.dimensions.height / 2 + 1, 15),
      dimensions: new Vector3(15, 2, 25),
      capacity: 10,
      occupied: new Set()
    });
  }

  update(deltaTime) {
    if (!this.rigidBody) return;
    
    // Apply propulsion forces
    this.applyPropulsion(deltaTime);
    
    // Apply stability systems
    this.applyStabilizers(deltaTime);
    
    // Update contained entities
    this.updateContainedEntities(deltaTime);
    
    // Apply hydrodynamic effects
    this.applyHydrodynamics(deltaTime);
  }

  applyPropulsion(deltaTime) {
    if (Math.abs(this.propulsion.throttle) < 0.01) return;
    
    const mass = this.rigidBody.mass();
    const currentVel = this.rigidBody.linvel();
    const currentSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.z * currentVel.z);
    
    // Reduce thrust at high speeds
    const speedFactor = Math.max(0, 1 - (currentSpeed / this.maxSpeed));
    const thrust = this.propulsion.throttle * this.acceleration * speedFactor * mass;
    
    // Apply force in forward direction
    const forwardDir = new Vector3(0, 0, -1).applyQuaternion(this.worldRotation);
    const thrustVector = forwardDir.multiplyScalar(thrust);
    
    this.rigidBody.applyForce({
      x: thrustVector.x,
      y: thrustVector.y,
      z: thrustVector.z
    }, true);
    
    // Apply rudder turning
    if (Math.abs(this.propulsion.rudder) > 0.01 && currentSpeed > 1) {
      const turnForce = this.propulsion.rudder * this.turnRate * (currentSpeed / this.maxSpeed);
      this.rigidBody.applyTorque({
        x: 0,
        y: turnForce * mass,
        z: 0
      }, true);
    }
  }

  applyStabilizers(deltaTime) {
    if (!this.stabilizers.active) return;
    
    const angVel = this.rigidBody.angvel();
    const rotation = this.rigidBody.rotation();
    
    // Reduce roll and pitch oscillations
    const stabilizeForce = this.stabilizers.strength * this.rigidBody.mass();
    
    // Counter roll (X-axis rotation)
    if (Math.abs(rotation.x) > 0.05 || Math.abs(angVel.x) > 0.1) {
      this.rigidBody.applyTorque({
        x: -rotation.x * stabilizeForce - angVel.x * stabilizeForce * 0.5,
        y: 0,
        z: 0
      }, true);
    }
    
    // Counter pitch (Z-axis rotation)  
    if (Math.abs(rotation.z) > 0.05 || Math.abs(angVel.z) > 0.1) {
      this.rigidBody.applyTorque({
        x: 0,
        y: 0,
        z: -rotation.z * stabilizeForce - angVel.z * stabilizeForce * 0.5
      }, true);
    }
  }

  updateContainedEntities(deltaTime) {
    // Update all child entities (vehicles, personnel)
    for (const child of this.children) {
      if (child.update && typeof child.update === 'function') {
        child.update(deltaTime);
      }
    }
  }

  applyHydrodynamics(deltaTime) {
    const velocity = this.rigidBody.linvel();
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    
    if (speed < 0.5) return;
    
    // Water resistance (much higher than air drag)
    const dragCoeff = 0.8;
    const frontalArea = this.dimensions.width * this.dimensions.height;
    const waterDensity = 1000; // kg/m³
    
    const dragForce = 0.5 * waterDensity * dragCoeff * frontalArea * speed * speed * 0.001; // Scale down
    const dragDirection = new Vector3(-velocity.x, 0, -velocity.z).normalize();
    
    this.rigidBody.applyForce({
      x: dragDirection.x * dragForce,
      y: 0,
      z: dragDirection.z * dragForce
    }, true);
  }

  // Control methods
  setThrottle(value) {
    this.propulsion.throttle = Math.max(-1, Math.min(1, value));
  }

  setRudder(value) {
    this.propulsion.rudder = Math.max(-1, Math.min(1, value));
  }

  // Vehicle/entity management
  dockVehicle(vehicle, areaName = 'main_hangar', position = null) {
    const area = this.hangarAreas.get(areaName) || this.deckAreas.get(areaName);
    if (!area) {
      throw new Error(`Unknown area: ${areaName}`);
    }
    
    if (area.occupied.size >= area.capacity) {
      throw new Error(`Area ${areaName} is at capacity`);
    }
    
    // Calculate docking position
    let dockPosition;
    if (position) {
      dockPosition = position.clone();
    } else {
      dockPosition = this.findAvailableDockPosition(area);
    }
    
    // Set vehicle position relative to carrier
    vehicle.localPosition.copy(area.position.clone().add(dockPosition));
    vehicle.localRotation.set(0, 0, 0, 1);
    
    // Add as child entity
    this.addChild(vehicle);
    this.containedVehicles.add(vehicle);
    area.occupied.add(vehicle);
    
    // Store docking info
    vehicle.dockedArea = areaName;
    vehicle.dockPosition = dockPosition;
    
    return dockPosition;
  }

  undockVehicle(vehicle, exitOffset = new Vector3(0, 5, -50)) {
    if (!this.containedVehicles.has(vehicle)) return false;
    
    // Remove from area
    const areaName = vehicle.dockedArea;
    if (areaName) {
      const area = this.hangarAreas.get(areaName) || this.deckAreas.get(areaName);
      if (area) {
        area.occupied.delete(vehicle);
      }
    }
    
    // Calculate exit position in world space
    const exitWorldPos = this.worldPosition.clone().add(
      exitOffset.clone().applyQuaternion(this.worldRotation)
    );
    
    // Transfer to world
    return this.world.transitionManager.transferEntity(
      vehicle.id,
      null, // World root
      {
        motionPreservation: 'preserve_relative',
        smoothTransition: true,
        transitionDuration: 1.0,
        targetPosition: exitWorldPos
      }
    ).then(() => {
      this.containedVehicles.delete(vehicle);
      delete vehicle.dockedArea;
      delete vehicle.dockPosition;
      return true;
    });
  }

  findAvailableDockPosition(area) {
    // Simple grid-based positioning
    const gridSize = 8; // meters
    const cols = Math.floor(area.dimensions.x / gridSize);
    const rows = Math.floor(area.dimensions.z / gridSize);
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const testPos = new Vector3(
          (col - cols / 2) * gridSize,
          0,
          (row - rows / 2) * gridSize
        );
        
        // Check if position is free
        const occupied = Array.from(area.occupied).some(entity => {
          const distance = entity.dockPosition?.distanceTo(testPos) || Infinity;
          return distance < gridSize * 0.8;
        });
        
        if (!occupied) {
          return testPos;
        }
      }
    }
    
    // Fallback to center if no grid position available
    return new Vector3(0, 0, 0);
  }

  // Get available areas and their capacity
  getAreaStatus() {
    const status = {};
    
    for (const [name, area] of this.hangarAreas) {
      status[name] = {
        type: 'hangar',
        capacity: area.capacity,
        occupied: area.occupied.size,
        available: area.capacity - area.occupied.size
      };
    }
    
    for (const [name, area] of this.deckAreas) {
      status[name] = {
        type: 'deck',
        capacity: area.capacity,
        occupied: area.occupied.size,
        available: area.capacity - area.occupied.size
      };
    }
    
    return status;
  }

  // Carrier state for networking/UI
  getCarrierState() {
    return {
      position: this.worldPosition.clone(),
      rotation: this.worldRotation.clone(),
      velocity: (() => {
        const vel = this.rigidBody.linvel();
        return new Vector3(vel.x, vel.y, vel.z);
      })(),
      propulsion: { ...this.propulsion },
      containedVehicles: this.containedVehicles.size,
      containedPersonnel: this.containedPersonnel.size,
      areaStatus: this.getAreaStatus()
    };
  }

  // Emergency systems
  emergencyStop() {
    this.propulsion.throttle = 0;
    this.propulsion.rudder = 0;
    
    // Apply strong braking force
    const velocity = this.rigidBody.linvel();
    const brakeForce = this.rigidBody.mass() * 5;
    
    this.rigidBody.applyForce({
      x: -velocity.x * brakeForce,
      y: 0,
      z: -velocity.z * brakeForce
    }, true);
  }

  dispose() {
    // Undock all vehicles
    for (const vehicle of this.containedVehicles) {
      this.undockVehicle(vehicle);
    }
    
    super.dispose();
  }
}