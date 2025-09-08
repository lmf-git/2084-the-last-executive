import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Vehicle } from './Vehicle.js';

/**
 * Player capsule controller that can move inside vehicles
 */
export class Player {
	static create(physicsWorld, position = new THREE.Vector3(0, 2, 0)) {
		const player = {
			physicsWorld,
			position,
			body: null,
			mesh: null,
			collider: null,
			grounded: false,
			inCar: false,
			currentCar: null,
			moveSpeed: 5.0,
			jumpForce: 8.0,
			acceleration: 10.0,
			deceleration: 8.0,
			maxSpeed: 6.0,
			yaw: 0, // Left/right rotation (around Y axis)
			pitch: 0, // Up/down look (camera only)
			mouseSensitivity: 0.002,
			id: 'player_' + Math.random().toString(36).substr(2, 9)
		};
		
		Player.initialize(player);
		return player;
	}

	static initialize(player) {
		// Create capsule geometry for visual representation
		const capsuleGeometry = new THREE.CapsuleGeometry(0.5, 1.5, 8, 16);
		const capsuleMaterial = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
		
		// Create capsule physics collider - standard FPS setup
		const capsuleColliderDesc = RAPIER.ColliderDesc.capsule(0.75, 0.5);
		capsuleColliderDesc.setFriction(0.0); // No friction - we'll handle movement manually
		capsuleColliderDesc.setRestitution(0.0); // No bounce
		// Remove collision groups to use default (interacts with everything except specifically excluded)
		
		// Create as dynamic body with locked rotation
		const playerData = PhysicsWorld.createDynamicBody(
			player.physicsWorld,
			capsuleGeometry,
			capsuleMaterial,
			capsuleColliderDesc,
			player.position,
			true // Lock rotation
		);
		
		player.body = playerData.body;
		player.mesh = playerData.mesh;
		player.collider = playerData.collider;
		
		// No linear damping - we'll handle stopping manually
		player.body.setLinearDamping(0.0);
		
		console.log('Player created at:', player.position);
	}

	/**
	 * Get player position
	 * @param {object} player 
	 * @returns {THREE.Vector3}
	 */
	static getPosition(player) {
		if (player.body) {
			const pos = player.body.translation();
			return new THREE.Vector3(pos.x, pos.y, pos.z);
		}
		return new THREE.Vector3(0, 0, 0);
	}

	/**
	 * Set player position (use sparingly - prefer impulses)
	 * @param {object} player 
	 * @param {THREE.Vector3} position 
	 */
	static setPosition(player, position) {
		if (player.body) {
			player.body.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z), true);
		}
	}

	/**
	 * Apply impulse to player
	 * @param {object} player 
	 * @param {THREE.Vector3} impulse 
	 */
	static applyImpulse(player, impulse) {
		if (player.body) {
			const rapierImpulse = new RAPIER.Vector3(impulse.x, impulse.y, impulse.z);
			player.body.applyImpulse(rapierImpulse, true);
		}
	}

	/**
	 * Apply force to player (for continuous movement)
	 * @param {object} player 
	 * @param {THREE.Vector3} force 
	 */
	static applyForce(player, force) {
		if (player.body) {
			const rapierForce = new RAPIER.Vector3(force.x, force.y, force.z);
			player.body.addForce(rapierForce, true);
		}
	}

	/**
	 * Get player velocity
	 * @param {object} player 
	 * @returns {THREE.Vector3}
	 */
	static getVelocity(player) {
		if (player.body) {
			const vel = player.body.linvel();
			return new THREE.Vector3(vel.x, vel.y, vel.z);
		}
		return new THREE.Vector3(0, 0, 0);
	}

	/**
	 * Set player velocity
	 * @param {object} player 
	 * @param {THREE.Vector3} velocity 
	 */
	static setVelocity(player, velocity) {
		if (player.body) {
			const rapierVel = new RAPIER.Vector3(velocity.x, velocity.y, velocity.z);
			player.body.setLinvel(rapierVel, true);
		}
	}

	/**
	 * Get player rotation
	 * @param {object} player 
	 * @returns {THREE.Quaternion}
	 */
	static getRotation(player) {
		if (player.body) {
			const rot = player.body.rotation();
			return new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		}
		return new THREE.Quaternion(0, 0, 0, 1);
	}

	/**
	 * Set player rotation
	 * @param {object} player 
	 * @param {THREE.Quaternion} rotation 
	 */
	static setRotation(player, rotation) {
		if (player.body) {
			player.body.setRotation(new RAPIER.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), true);
		}
	}

	/**
	 * Apply mouse look movement
	 * @param {object} player 
	 * @param {number} deltaX 
	 * @param {number} deltaY 
	 */
	static applyMouseLook(player, deltaX, deltaY) {
		// Update yaw (left/right rotation of capsule)
		player.yaw -= deltaX * player.mouseSensitivity;
		
		// Update pitch (up/down camera look) with limits
		player.pitch -= deltaY * player.mouseSensitivity;
		player.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, player.pitch));
		
		// Apply yaw rotation to the capsule body
		const yawQuaternion = new THREE.Quaternion();
		yawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
		Player.setRotation(player, yawQuaternion);
	}

	/**
	 * Get camera look direction based on player rotation and pitch
	 * @param {object} player 
	 * @returns {THREE.Vector3}
	 */
	static getCameraLookDirection(player) {
		// Create rotation from yaw and pitch
		const yawQuaternion = new THREE.Quaternion();
		yawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
		
		const pitchQuaternion = new THREE.Quaternion();
		pitchQuaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch);
		
		// Combine rotations
		const combinedRotation = new THREE.Quaternion();
		combinedRotation.multiplyQuaternions(yawQuaternion, pitchQuaternion);
		
		// Apply to forward vector
		const forward = new THREE.Vector3(0, 0, -1);
		forward.applyQuaternion(combinedRotation);
		
		return forward;
	}

	/**
	 * Enter vehicle
	 * @param {object} player 
	 * @param {object} vehicle 
	 */
	static enterVehicle(player, vehicle) {
		player.isInVehicle = true;
		player.currentVehicle = vehicle;
		
		// Add player to vehicle's interior tracking
		Vehicle.addEntityInside(vehicle, player);
		
		console.log('Player entered vehicle:', vehicle.id);
	}

	/**
	 * Exit vehicle
	 * @param {object} player 
	 */
	static exitVehicle(player) {
		if (player.currentVehicle) {
			// Remove player from vehicle's interior tracking
			Vehicle.removeEntityInside(player.currentVehicle, player);
			
			player.isInVehicle = false;
			player.currentVehicle = null;
			
			console.log('Player exited vehicle');
		}
	}

	/**
	 * Check if player is grounded
	 * @param {object} player 
	 * @returns {boolean}
	 */
	static isGrounded(player) {
		if (!player.body) return false;
		
		// Create a small ray downward to check for ground
		const playerPos = Player.getPosition(player);
		const rayOrigin = new RAPIER.Vector3(playerPos.x, playerPos.y - 0.4, playerPos.z);
		const rayDir = new RAPIER.Vector3(0, -1, 0);
		const maxDistance = 0.3; // Increased distance for better detection
		
		const ray = new RAPIER.Ray(rayOrigin, rayDir);
		const hit = player.physicsWorld.world.castRay(ray, maxDistance, true); // Include all colliders
		
		const grounded = hit !== null;
		
		// Debug: Check velocity to also determine grounded state
		if (!grounded) {
			const vel = Player.getVelocity(player);
			// If vertical velocity is very small and we're close to ground, consider grounded
			if (Math.abs(vel.y) < 0.1 && playerPos.y < 2) {
				return true;
			}
		}
		
		return grounded;
	}

	/**
	 * Apply movement input
	 * @param {object} player 
	 * @param {THREE.Vector3} direction - direction vector (can be zero)
	 * @param {number} deltaTime 
	 */
	static applyMovement(player, direction, deltaTime) {
		if (!player.body) return;
		
		if (player.isInVehicle && player.currentVehicle) {
			// Movement inside vehicle (local space) - much gentler
			Player.applyVehicleMovement(player, direction, deltaTime);
		} else {
			// Movement in world space
			Player.applyWorldMovement(player, direction, deltaTime);
		}
	}

	/**
	 * Standard FPS character controller movement
	 * @param {object} player 
	 * @param {THREE.Vector3} direction 
	 * @param {number} deltaTime 
	 */
	static applyWorldMovement(player, direction, deltaTime) {
		const grounded = Player.isGrounded(player);
		const currentVel = Player.getVelocity(player);
		
		// Get current horizontal velocity
		const horizontalVel = new THREE.Vector3(currentVel.x, 0, currentVel.z);
		let newHorizontalVel = horizontalVel.clone();
		
		// Apply horizontal movement
		const horizontalDirection = direction.clone();
		horizontalDirection.y = 0;
		
		if (horizontalDirection.length() > 0) {
			// Normalize and rotate direction based on player's yaw
			horizontalDirection.normalize();
			const yawQuaternion = new THREE.Quaternion();
			yawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
			horizontalDirection.applyQuaternion(yawQuaternion);
			
			// Calculate desired velocity
			const desiredVel = horizontalDirection.clone().multiplyScalar(player.moveSpeed);
			
			// Accelerate towards desired velocity
			const velDiff = desiredVel.clone().sub(horizontalVel);
			const acceleration = velDiff.clone().multiplyScalar(player.acceleration * deltaTime);
			
			// Limit acceleration to prevent overshooting
			if (acceleration.length() > velDiff.length()) {
				acceleration.copy(velDiff);
			}
			
			newHorizontalVel.add(acceleration);
		} else {
			// No input - apply deceleration
			if (grounded && horizontalVel.length() > 0) {
				const deceleration = horizontalVel.clone().normalize().multiplyScalar(-player.deceleration * deltaTime);
				newHorizontalVel.add(deceleration);
				
				// Stop if we've decelerated past zero
				if (newHorizontalVel.dot(horizontalVel) <= 0) {
					newHorizontalVel.set(0, 0, 0);
				}
			}
		}
		
		// Cap maximum speed
		if (newHorizontalVel.length() > player.maxSpeed) {
			newHorizontalVel.normalize().multiplyScalar(player.maxSpeed);
		}
		
		// Apply the new velocity
		Player.setVelocity(player, new THREE.Vector3(newHorizontalVel.x, currentVel.y, newHorizontalVel.z));
	}

	/**
	 * Apply movement inside vehicle (local space) using kinematic movement
	 * @param {object} player 
	 * @param {THREE.Vector3} direction 
	 * @param {number} deltaTime 
	 */
	static applyVehicleMovement(player, direction, deltaTime) {
		// Only apply movement if player is kinematic
		if (!player.wasKinematic) return;
		
		const currentPos = Player.getPosition(player);
		const vehicle = player.currentVehicle;
		
		// Convert world position to vehicle local space
		const localPos = Vehicle.worldToLocal(vehicle, currentPos);
		
		// Check bounds - if player is near boundary, reduce movement in that direction
		const localMovement = direction.clone();
		localMovement.y = 0; // No vertical movement inside vehicle
		
		// Get interior dimensions for boundary checking
		const { width, depth } = vehicle.interiorDimensions;
		const boundaryPadding = 0.5; // Leave some space from walls
		
		// Apply boundary constraints
		if (localPos.x > (width/2 - boundaryPadding) && localMovement.x > 0) localMovement.x = 0;
		if (localPos.x < -(width/2 - boundaryPadding) && localMovement.x < 0) localMovement.x = 0;
		if (localPos.z > (depth/2 - boundaryPadding) && localMovement.z > 0) localMovement.z = 0;
		if (localPos.z < -(depth/2 - boundaryPadding) && localMovement.z < 0) localMovement.z = 0;
		
		if (localMovement.length() > 0) {
			localMovement.normalize();
			
			// Apply player's yaw rotation to movement direction
			const yawQuaternion = new THREE.Quaternion();
			yawQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
			localMovement.applyQuaternion(yawQuaternion);
			
			// Transform local movement to world space using vehicle orientation
			const vehicleRot = Vehicle.getRotation(vehicle);
			const worldMovement = localMovement.clone().applyQuaternion(vehicleRot);
			
			// Calculate movement distance for this frame
			const moveDistance = player.moveSpeed * deltaTime;
			const moveVector = worldMovement.multiplyScalar(moveDistance);
			
			// Apply movement directly to kinematic body
			const newPos = currentPos.clone().add(moveVector);
			player.body.setTranslation(new RAPIER.Vector3(newPos.x, newPos.y, newPos.z), true);
		}
	}

	/**
	 * Make player jump
	 * @param {object} player 
	 */
	static jump(player) {
		if (Player.isGrounded(player)) {
			const currentVel = Player.getVelocity(player);
			Player.setVelocity(player, new THREE.Vector3(currentVel.x, player.jumpForce, currentVel.z));
		}
	}

	/**
	 * Enter car
	 * @param {object} player 
	 * @param {object} car 
	 */
	static enterCar(player, car) {
		player.inCar = true;
		player.currentCar = car;
		// Hide player mesh and disable collider
		player.mesh.visible = false;
		player.collider.setEnabled(false);
		console.log('Player entered car');
	}

	/**
	 * Exit car
	 * @param {object} player 
	 */
	static exitCar(player) {
		if (player.inCar) {
			player.inCar = false;
			player.currentCar = null;
			// Show player mesh and enable collider
			player.mesh.visible = true;
			player.collider.setEnabled(true);
			console.log('Player exited car');
		}
	}

	/**
	 * Update player physics and state
	 * @param {object} player 
	 * @param {number} deltaTime 
	 * @param {object} vehicle 
	 */
	static update(player, deltaTime, vehicle) {
		// Only update physics if not in car
		if (!player.inCar) {
			// Update grounded state
			player.grounded = Player.isGrounded(player);
		}
		
		// No enter/exit logic - player just physically moves in/out of spaces
	}

	/**
	 * Check if player should enter a vehicle
	 * @param {object} player 
	 * @param {object} vehicle 
	 */
	static checkVehicleEntry(player, vehicle) {
		if (!vehicle) return;
		
		// Check if player is inside the vehicle interior bounds
		const playerPos = Player.getPosition(player);
		const isInside = Vehicle.isPositionInside(vehicle, playerPos);
		
		if (isInside) {
			Player.enterVehicle(player, vehicle);
		}
	}

	/**
	 * Check if player should exit a vehicle
	 * @param {object} player 
	 */
	static checkVehicleExit(player, vehicle) {
		if (!player.currentVehicle) return;
		
		const playerPos = Player.getPosition(player);
		const isInsideVehicle = Vehicle.isPositionInside(player.currentVehicle, playerPos);
		
		if (!isInsideVehicle) {
			Player.exitVehicle(player);
		}
	}

	/**
	 * Get player's forward direction
	 * @param {object} player 
	 * @returns {THREE.Vector3}
	 */
	static getForwardDirection(player) {
		const rotation = Player.getRotation(player);
		const forward = new THREE.Vector3(0, 0, -1);
		forward.applyQuaternion(rotation);
		return forward;
	}

	/**
	 * Get player's right direction
	 * @param {object} player 
	 * @returns {THREE.Vector3}
	 */
	static getRightDirection(player) {
		const rotation = Player.getRotation(player);
		const right = new THREE.Vector3(1, 0, 0);
		right.applyQuaternion(rotation);
		return right;
	}

	/**
	 * Rotate player to face direction
	 * @param {object} player 
	 * @param {THREE.Vector3} direction 
	 */
	static faceDirection(player, direction) {
		if (direction.length() < 0.1) return;
		
		const targetRotation = new THREE.Quaternion();
		targetRotation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.normalize());
		
		Player.setRotation(player, targetRotation);
	}
}