import { PhysicsEntity } from './PhysicsEntity.js';
import { Vector3, Quaternion } from 'three';

export class Vehicle extends PhysicsEntity {
  constructor(world, options = {}) {
    super(world, {
      ...options,
      mass: options.mass || 1500, // 1.5 ton default
      isKinematic: false
    });
    
    // Vehicle-specific properties
    this.maxSpeed = options.maxSpeed || 25.0; // m/s
    this.acceleration = options.acceleration || 8.0;
    this.turnSpeed = options.turnSpeed || 2.0;
    this.brakeForce = options.brakeForce || 15.0;
    
    // Vehicle state
    this.engine = {
      rpm: 0,
      throttle: 0,
      brake: 0,
      steering: 0,
      gear: 1
    };
    
    // Physics properties
    this.wheelBase = options.wheelBase || 2.5;
    this.trackWidth = options.trackWidth || 1.8;
    this.centerOfMass = new Vector3(0, -0.5, 0); // Lower CoM for stability
    
    // Passengers
    this.passengers = new Set();
    this.maxPassengers = options.maxPassengers || 4;
    this.seatPositions = this.generateSeatPositions(options);
    
    // Create vehicle physics body
    this.createVehicleBody(options);
  }

  createVehicleBody(options) {
    const length = options.length || 4.5;
    const width = options.width || 1.8;
    const height = options.height || 1.5;
    
    // Create main vehicle body
    this.world.createRigidBody(this, {
      isKinematic: false,
      collider: {
        type: 'box',
        halfExtents: {
          x: width / 2,
          y: height / 2,
          z: length / 2
        },
        friction: 0.8,
        restitution: 0.1,
        density: 0.8
      }
    });
    
    // Set center of mass (use setAdditionalMass instead in newer Rapier versions)
    // this.rigidBody.setCenterOfMass(this.centerOfMass); // Not available in current API
    
    // Set up collision groups for vehicle
    this.world.setupCollisionGroups(this, {
      membership: 0x0002, // Vehicle group
      filter: 0xFFFD      // Collides with everything except vehicles
    });
    
    // Add drag and angular damping for realistic movement
    this.rigidBody.setLinearDamping(0.1);
    this.rigidBody.setAngularDamping(0.8);
  }

  generateSeatPositions(options) {
    const positions = [];
    const seatHeight = 0.5;
    const seatSpacing = 0.8;
    
    // Driver seat (front left)
    positions.push(new Vector3(-0.6, seatHeight, 1.0));
    
    // Passenger seat (front right)  
    positions.push(new Vector3(0.6, seatHeight, 1.0));
    
    // Rear seats
    if (this.maxPassengers > 2) {
      positions.push(new Vector3(-0.6, seatHeight, -0.5));
      positions.push(new Vector3(0.6, seatHeight, -0.5));
    }
    
    return positions;
  }

  update(deltaTime) {
    if (!this.rigidBody) return;
    
    // Apply engine forces
    this.applyEngineForces(deltaTime);
    
    // Apply steering
    this.applySteering(deltaTime);
    
    // Update engine RPM based on speed
    this.updateEngine(deltaTime);
    
    // Apply aerodynamic effects
    this.applyAerodynamics(deltaTime);
  }

  applyEngineForces(deltaTime) {
    if (Math.abs(this.engine.throttle) < 0.01) return;
    
    // Calculate force based on throttle and current speed
    const currentVel = this.rigidBody.linvel();
    const currentSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.z * currentVel.z);
    
    // Reduce force at high speeds
    const speedFactor = Math.max(0, 1 - (currentSpeed / this.maxSpeed));
    const force = this.engine.throttle * this.acceleration * speedFactor * this.rigidBody.mass();
    
    // Apply force in forward direction
    const forwardDir = new Vector3(0, 0, -1).applyQuaternion(this.worldRotation);
    const forceVector = forwardDir.multiplyScalar(force);
    
    this.rigidBody.applyForce({
      x: forceVector.x,
      y: forceVector.y,
      z: forceVector.z
    }, true);
    
    // Apply braking
    if (this.engine.brake > 0) {
      const brakeForce = this.engine.brake * this.brakeForce * this.rigidBody.mass();
      const velocityDir = new Vector3(currentVel.x, 0, currentVel.z).normalize();
      const brakeVector = velocityDir.multiplyScalar(-brakeForce);
      
      this.rigidBody.applyForce({
        x: brakeVector.x,
        y: 0,
        z: brakeVector.z
      }, true);
    }
  }

  applySteering(deltaTime) {
    if (Math.abs(this.engine.steering) < 0.01) return;
    
    const currentVel = this.rigidBody.linvel();
    const currentSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.z * currentVel.z);
    
    // Steering effectiveness based on speed
    const speedFactor = Math.min(1, currentSpeed / 5.0); // Effective at 5 m/s+
    const steeringForce = this.engine.steering * this.turnSpeed * speedFactor;
    
    // Apply torque around Y-axis
    this.rigidBody.applyTorque({
      x: 0,
      y: steeringForce,
      z: 0
    }, true);
  }

  updateEngine(deltaTime) {
    const currentVel = this.rigidBody.linvel();
    const currentSpeed = Math.sqrt(currentVel.x * currentVel.x + currentVel.z * currentVel.z);
    
    // Simulate RPM based on speed and throttle
    const targetRpm = (currentSpeed / this.maxSpeed) * 6000 + this.engine.throttle * 2000;
    this.engine.rpm = lerp(this.engine.rpm, targetRpm, deltaTime * 5);
  }

  applyAerodynamics(deltaTime) {
    const velocity = this.rigidBody.linvel();
    const speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    
    if (speed < 1) return; // Skip at low speeds
    
    // Air resistance (drag)
    const dragCoeff = 0.3;
    const frontalArea = 2.5; // m²
    const airDensity = 1.225; // kg/m³
    
    const dragForce = 0.5 * airDensity * dragCoeff * frontalArea * speed * speed;
    const dragDirection = new Vector3(-velocity.x, 0, -velocity.z).normalize();
    
    this.rigidBody.applyForce({
      x: dragDirection.x * dragForce,
      y: 0,
      z: dragDirection.z * dragForce
    }, true);
  }

  // Control methods
  setThrottle(value) {
    this.engine.throttle = Math.max(-1, Math.min(1, value));
  }

  setBrake(value) {
    this.engine.brake = Math.max(0, Math.min(1, value));
  }

  setSteering(value) {
    this.engine.steering = Math.max(-1, Math.min(1, value));
  }

  // Passenger management
  addPassenger(passenger, seatIndex = null) {
    if (this.passengers.size >= this.maxPassengers) {
      throw new Error('Vehicle is full');
    }
    
    // Find available seat
    if (seatIndex === null) {
      seatIndex = this.findAvailableSeat();
    }
    
    if (seatIndex === -1) {
      throw new Error('No available seats');
    }
    
    // Set passenger position relative to vehicle
    const seatPosition = this.seatPositions[seatIndex];
    passenger.localPosition.copy(seatPosition);
    passenger.localRotation.set(0, 0, 0, 1);
    
    // Make passenger kinematic to prevent falling through
    if (passenger.rigidBody) {
      passenger.wasKinematic = passenger.isKinematic;
      passenger.rigidBody.setBodyType(1); // Kinematic
      passenger.isKinematic = true;
    }
    
    // Add as child entity
    this.addChild(passenger);
    this.passengers.add(passenger);
    
    // Store seat assignment
    passenger.vehicleSeatIndex = seatIndex;
    
    return seatIndex;
  }

  removePassenger(passenger) {
    if (!this.passengers.has(passenger)) return false;
    
    // Restore original physics state
    if (passenger.rigidBody && passenger.wasKinematic !== undefined) {
      passenger.rigidBody.setBodyType(passenger.wasKinematic ? 1 : 0); // Restore original type
      passenger.isKinematic = passenger.wasKinematic;
      delete passenger.wasKinematic;
    }
    
    this.removeChild(passenger);
    this.passengers.delete(passenger);
    
    delete passenger.vehicleSeatIndex;
    
    return true;
  }

  findAvailableSeat() {
    const occupiedSeats = new Set();
    for (const passenger of this.passengers) {
      if (passenger.vehicleSeatIndex !== undefined) {
        occupiedSeats.add(passenger.vehicleSeatIndex);
      }
    }
    
    for (let i = 0; i < this.seatPositions.length; i++) {
      if (!occupiedSeats.has(i)) {
        return i;
      }
    }
    
    return -1;
  }

  // Vehicle state for networking/UI
  getVehicleState() {
    return {
      position: this.worldPosition.clone(),
      rotation: this.worldRotation.clone(),
      velocity: (() => {
        const vel = this.rigidBody.linvel();
        return new Vector3(vel.x, vel.y, vel.z);
      })(),
      engine: { ...this.engine },
      passengerCount: this.passengers.size,
      passengers: Array.from(this.passengers).map(p => p.id)
    };
  }

  // Damage and destruction
  takeDamage(amount, impactPoint = null) {
    // Apply damage impulse if impact point provided
    if (impactPoint && this.rigidBody) {
      const impulse = impactPoint.clone().normalize().multiplyScalar(amount * 100);
      this.rigidBody.applyImpulseAtPoint({
        x: impulse.x,
        y: impulse.y,
        z: impulse.z
      }, {
        x: impactPoint.x,
        y: impactPoint.y,
        z: impactPoint.z
      }, true);
    }
  }

  dispose() {
    // Eject all passengers
    for (const passenger of this.passengers) {
      this.removePassenger(passenger);
    }
    
    super.dispose();
  }
}

// Utility function
function lerp(start, end, factor) {
  return start + (end - start) * factor;
}