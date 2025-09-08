import { PhysicsEntity } from './PhysicsEntity.js';
import { Vector3, Quaternion } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Player extends PhysicsEntity {
  constructor(world, options = {}) {
    super(world, {
      ...options,
      mass: options.mass || 70, // 70kg default
      isKinematic: false
    });
    
    // Player-specific properties
    this.moveSpeed = options.moveSpeed || 5.0;
    this.jumpForce = options.jumpForce || 400.0;
    this.isGrounded = false;
    this.canJump = true;
    
    // Input state
    this.inputState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
      sprint: false
    };
    
    // Movement state
    this.velocity = new Vector3();
    this.groundNormal = new Vector3(0, 1, 0);
    this.maxGroundAngle = Math.PI / 4; // 45 degrees
    
    // Create player physics body
    this.createPlayerBody(options);
  }

  createPlayerBody(options) {
    // Create capsule collider for player
    const height = options.height || 1.8;
    const radius = options.radius || 0.3;
    
    this.world.createRigidBody(this, {
      isKinematic: false,
      collider: {
        type: 'capsule',
        halfHeight: (height - radius * 2) / 2,
        radius: radius,
        friction: 0.7,
        restitution: 0.0,
        density: 1.0
      }
    });
    
    // Set up collision groups for player
    this.world.setupCollisionGroups(this, {
      membership: 0x0001, // Player group
      filter: 0xFFFF      // Collides with everything
    });
    
    // Prevent rotation on X and Z axes (keep player upright)
    // Note: setLockedAxes API may vary in different Rapier versions
    try {
      this.rigidBody.lockRotations(true, false, true); // Lock X and Z rotations
    } catch (e) {
      // Fallback if API is different
      console.warn('Could not lock player rotations:', e.message);
    }
  }

  update(deltaTime) {
    if (!this.rigidBody) return;
    
    // Update grounded state
    this.updateGroundedState();
    
    // Apply movement based on input
    this.applyMovement(deltaTime);
    
    // Apply jump if requested
    this.applyJump();
    
    // Update velocity tracking
    const linVel = this.rigidBody.linvel();
    this.velocity.set(linVel.x, linVel.y, linVel.z);
  }

  updateGroundedState() {
    // Cast ray downward to check for ground
    const rayOrigin = {
      x: this.worldPosition.x,
      y: this.worldPosition.y,
      z: this.worldPosition.z
    };
    
    const rayDirection = { x: 0, y: -1, z: 0 };
    const maxDistance = 0.1; // Small distance below player
    
    const ray = new RAPIER.Ray(rayOrigin, rayDirection);
    const hit = this.world.rapierWorld.castRay(ray, maxDistance, true);
    
    if (hit) {
      const hitPoint = ray.pointAt(hit.toi);
      const normal = hit.normal;
      
      // Check if surface is walkable (not too steep)
      const angle = Math.acos(normal.y);
      this.isGrounded = angle <= this.maxGroundAngle;
      
      if (this.isGrounded) {
        this.groundNormal.set(normal.x, normal.y, normal.z);
      }
    } else {
      this.isGrounded = false;
    }
  }

  applyMovement(deltaTime) {
    if (!this.isGrounded) return; // Only move when grounded
    
    // Calculate movement direction based on input
    const moveDirection = new Vector3();
    
    if (this.inputState.forward) moveDirection.z -= 1;
    if (this.inputState.backward) moveDirection.z += 1;
    if (this.inputState.left) moveDirection.x -= 1;
    if (this.inputState.right) moveDirection.x += 1;
    
    if (moveDirection.lengthSq() === 0) return;
    
    // Normalize movement direction
    moveDirection.normalize();
    
    // Apply sprint multiplier
    let currentSpeed = this.moveSpeed;
    if (this.inputState.sprint) {
      currentSpeed *= 1.5;
    }
    
    // Transform movement direction to world space relative to current parent
    if (this.parent) {
      moveDirection.applyQuaternion(this.parent.worldRotation);
    }
    
    // Project movement onto ground plane
    const projectedMovement = moveDirection.clone();
    const dot = projectedMovement.dot(this.groundNormal);
    projectedMovement.sub(this.groundNormal.clone().multiplyScalar(dot));
    projectedMovement.normalize();
    
    // Scale by speed
    projectedMovement.multiplyScalar(currentSpeed);
    
    // Apply force to physics body
    const currentVel = this.rigidBody.linvel();
    const targetVel = {
      x: projectedMovement.x,
      y: currentVel.y, // Preserve vertical velocity
      z: projectedMovement.z
    };
    
    // Use impulse for more responsive movement
    const velDiff = {
      x: targetVel.x - currentVel.x,
      y: 0,
      z: targetVel.z - currentVel.z
    };
    
    const mass = this.rigidBody.mass();
    const impulse = {
      x: velDiff.x * mass * 0.1, // Damped impulse
      y: 0,
      z: velDiff.z * mass * 0.1
    };
    
    this.rigidBody.applyImpulse(impulse, true);
  }

  applyJump() {
    if (!this.inputState.jump || !this.canJump || !this.isGrounded) return;
    
    // Apply upward impulse
    const jumpImpulse = {
      x: 0,
      y: this.jumpForce,
      z: 0
    };
    
    this.rigidBody.applyImpulse(jumpImpulse, true);
    
    // Prevent multiple jumps
    this.canJump = false;
    this.isGrounded = false;
    
    // Reset jump ability after a short delay
    setTimeout(() => {
      this.canJump = true;
    }, 200);
  }

  // Enter/exit vehicle or other parent entity
  enterVehicle(vehicleEntity, options = {}) {
    return this.world.transitionManager.transferEntity(
      this.id,
      vehicleEntity.id,
      {
        motionPreservation: 'inherit',
        smoothTransition: true,
        transitionDuration: 0.2,
        ...options
      }
    );
  }

  exitVehicle(options = {}) {
    if (!this.parent) return Promise.resolve();
    
    // Calculate exit position (slightly offset from vehicle)
    const exitOffset = options.exitOffset || new Vector3(2, 0, 0);
    const exitWorldPos = this.parent.worldPosition.clone().add(exitOffset);
    
    return this.world.transitionManager.transferEntity(
      this.id,
      null, // Exit to world root
      {
        motionPreservation: 'preserve_relative',
        smoothTransition: true,
        transitionDuration: 0.3,
        targetPosition: exitWorldPos,
        ...options
      }
    );
  }

  // Handle input updates
  setInput(inputType, value) {
    if (inputType in this.inputState) {
      this.inputState[inputType] = value;
    }
  }

  // Get current movement state for UI/networking
  getMovementState() {
    return {
      position: this.worldPosition.clone(),
      rotation: this.worldRotation.clone(),
      velocity: this.velocity.clone(),
      isGrounded: this.isGrounded,
      isInVehicle: !!this.parent,
      parentId: this.parent?.id || null
    };
  }

  // Apply external force (e.g., from vehicle acceleration)
  applyExternalForce(force, point = null) {
    if (!this.rigidBody) return;
    
    if (point) {
      this.rigidBody.applyForceAtPoint(force, point, true);
    } else {
      this.rigidBody.applyForce(force, true);
    }
  }

  dispose() {
    // Clean up any player-specific resources
    super.dispose();
  }
}