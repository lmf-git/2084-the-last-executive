import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LocalGrid } from './LocalGrid.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { Player } from './Player.js';

/**
 * Vehicle with interior space and local grid system
 */
export class Vehicle {
	static create(physicsWorld, position = new THREE.Vector3(0, 1, 0)) {
		const vehicle = {
			physicsWorld,
			position,
			localGrid: LocalGrid.create(16, 16), // 16x16 grid
			body: null,
			mesh: null,
			collider: null,
			interiorSensor: null,
			floorCollider: null,
			entitiesInside: new Set(),
			id: Math.random().toString(36).substr(2, 9)
		};
		
		Vehicle.initialize(vehicle);
		return vehicle;
	}

	static initialize(vehicle) {
		// Create an empty group for the vehicle
		const vehicleGroup = new THREE.Group();
		vehicleGroup.position.copy(vehicle.position);
		vehicle.physicsWorld.scene.add(vehicleGroup);
		
		// Create the main vehicle body (properly sized for physics)
		const bodyGeometry = new THREE.BoxGeometry(12, 5, 20); // Match vehicle dimensions
		const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0x666666, transparent: true, opacity: 0 });
		
		// Create main rigidbody (minimal for mass center only)
		const bodyColliderDesc = RAPIER.ColliderDesc.cuboid(0.1, 0.1, 0.1); // Minimal size
		bodyColliderDesc.setMass(5000); // Much heavier so car can't push it
		// Remove collision groups for now to ensure ground collision works
		const vehicleData = PhysicsWorld.createDynamicBody(
			vehicle.physicsWorld,
			bodyGeometry,
			bodyMaterial,
			bodyColliderDesc,
			vehicle.position,
			false // Don't lock rotation - let it be dynamic
		);
		
		// Add heavy damping to make vehicle movement more stable
		vehicleData.body.setLinearDamping(0.8); // Heavy linear damping
		vehicleData.body.setAngularDamping(0.9); // Heavy angular damping
		
		vehicle.body = vehicleData.body;
		vehicle.mesh = vehicleGroup; // Use the group as the main mesh
		vehicle.collider = vehicleData.collider;
		
		// Remove the physics body mesh from scene and add our group as the physics mesh
		vehicle.physicsWorld.scene.remove(vehicleData.mesh);
		vehicle.physicsWorld.meshes.set(vehicleData.id, vehicleGroup);
		
		// Create vehicle structure (walls, floor, ceiling)
		Vehicle.createVehicleStructure(vehicle);
		
		// Create interior sensor volume
		Vehicle.createInteriorSensor(vehicle);
		
		console.log('Vehicle created at:', vehicle.position);
	}

	static createVehicleStructure(vehicle) {
		const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x666666 });
		const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
		const ceilingMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
		
		// Vehicle dimensions (made larger for easier entry)
		const width = 12;
		const height = 5;
		const depth = 20;
		const wallThickness = 0.2;
		
		// Floor (integrated with chassis)
		const floorGeometry = new THREE.BoxGeometry(width, wallThickness, depth);
		const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
		floorMesh.position.set(0, -height/2 + wallThickness/2, 0);
		floorMesh.receiveShadow = true;
		vehicle.mesh.add(floorMesh);
		
		// Floor physics collider
		const floorColliderDesc = RAPIER.ColliderDesc.cuboid(width/2, wallThickness/2, depth/2);
		floorColliderDesc.setFriction(1.2);
		floorColliderDesc.setRestitution(0.1);
		vehicle.floorCollider = PhysicsWorld.createSensor(
			vehicle.physicsWorld,
			floorColliderDesc,
			new THREE.Vector3(0, -height/2 + wallThickness/2, 0),
			vehicle.body
		);
		vehicle.floorCollider.setSensor(false);
		
		// Ceiling
		const ceilingGeometry = new THREE.BoxGeometry(width, wallThickness, depth);
		const ceilingMesh = new THREE.Mesh(ceilingGeometry, ceilingMaterial);
		ceilingMesh.position.set(0, height/2, 0);
		ceilingMesh.receiveShadow = true;
		vehicle.mesh.add(ceilingMesh);
		
		// Ceiling physics collider
		const ceilingColliderDesc = RAPIER.ColliderDesc.cuboid(width/2, wallThickness/2, depth/2);
		ceilingColliderDesc.setFriction(3.0);
		ceilingColliderDesc.setRestitution(0.01);
		vehicle.ceilingCollider = PhysicsWorld.createSensor(
			vehicle.physicsWorld,
			ceilingColliderDesc,
			new THREE.Vector3(0, height/2, 0),
			vehicle.body
		);
		vehicle.ceilingCollider.setSensor(false);
		
		// Front wall
		const frontWallGeometry = new THREE.BoxGeometry(width, height, wallThickness);
		const frontWallMesh = new THREE.Mesh(frontWallGeometry, wallMaterial);
		frontWallMesh.position.set(0, 0, depth/2);
		frontWallMesh.receiveShadow = true;
		vehicle.mesh.add(frontWallMesh);
		
		// Front wall physics collider
		const frontWallColliderDesc = RAPIER.ColliderDesc.cuboid(width/2, height/2, wallThickness/2);
		frontWallColliderDesc.setFriction(3.0);
		frontWallColliderDesc.setRestitution(0.01);
		vehicle.frontWallCollider = PhysicsWorld.createSensor(
			vehicle.physicsWorld,
			frontWallColliderDesc,
			new THREE.Vector3(0, 0, depth/2),
			vehicle.body
		);
		vehicle.frontWallCollider.setSensor(false);
		
		// Back wall removed - this is the entrance to the vehicle
		
		// Left wall
		const leftWallGeometry = new THREE.BoxGeometry(wallThickness, height, depth);
		const leftWallMesh = new THREE.Mesh(leftWallGeometry, wallMaterial);
		leftWallMesh.position.set(-width/2, 0, 0);
		leftWallMesh.receiveShadow = true;
		vehicle.mesh.add(leftWallMesh);
		
		// Left wall physics collider
		const leftWallColliderDesc = RAPIER.ColliderDesc.cuboid(wallThickness/2, height/2, depth/2);
		leftWallColliderDesc.setFriction(3.0);
		leftWallColliderDesc.setRestitution(0.01);
		vehicle.leftWallCollider = PhysicsWorld.createSensor(
			vehicle.physicsWorld,
			leftWallColliderDesc,
			new THREE.Vector3(-width/2, 0, 0),
			vehicle.body
		);
		vehicle.leftWallCollider.setSensor(false);
		
		// Right wall
		const rightWallGeometry = new THREE.BoxGeometry(wallThickness, height, depth);
		const rightWallMesh = new THREE.Mesh(rightWallGeometry, wallMaterial);
		rightWallMesh.position.set(width/2, 0, 0);
		rightWallMesh.receiveShadow = true;
		vehicle.mesh.add(rightWallMesh);
		
		// Right wall physics collider
		const rightWallColliderDesc = RAPIER.ColliderDesc.cuboid(wallThickness/2, height/2, depth/2);
		rightWallColliderDesc.setFriction(3.0);
		rightWallColliderDesc.setRestitution(0.01);
		vehicle.rightWallCollider = PhysicsWorld.createSensor(
			vehicle.physicsWorld,
			rightWallColliderDesc,
			new THREE.Vector3(width/2, 0, 0),
			vehicle.body
		);
		vehicle.rightWallCollider.setSensor(false);
		
		// Store dimensions for later use
		vehicle.dimensions = { width, height, depth, wallThickness };
		
		// Create chassis and wheels
		Vehicle.createChassisAndWheels(vehicle);
		
		// Create ramp at back entrance
		Vehicle.createRamp(vehicle);
	}

	static createChassisAndWheels(vehicle) {
		const { width, height, depth } = vehicle.dimensions;
		const chassisMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
		const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x111111 });
		
		// Create chassis support structure (visible undercarriage)
		const chassisGeometry = new THREE.BoxGeometry(width - 0.5, 0.15, depth - 1);
		const chassisMesh = new THREE.Mesh(chassisGeometry, chassisMaterial);
		chassisMesh.position.set(0, -height/2 - 0.175, 0);
		chassisMesh.receiveShadow = true;
		chassisMesh.castShadow = true;
		vehicle.mesh.add(chassisMesh);
		
		// Create wheels (scaled for larger vehicle)
		const wheelRadius = 0.6;
		const wheelWidth = 0.4;
		const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 16);
		
		// Wheel positions (4 wheels) - positioned so wheels just touch ground
		const wheelPositions = [
			{ x: -width/2 + 1, y: -height/2 - wheelRadius, z: depth/2 - 2 },  // Front left
			{ x: width/2 - 1, y: -height/2 - wheelRadius, z: depth/2 - 2 },   // Front right
			{ x: -width/2 + 1, y: -height/2 - wheelRadius, z: -depth/2 + 2 }, // Back left
			{ x: width/2 - 1, y: -height/2 - wheelRadius, z: -depth/2 + 2 }   // Back right
		];
		
		vehicle.wheels = [];
		
		wheelPositions.forEach((pos, index) => {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.position.set(pos.x, pos.y, pos.z);
			wheelMesh.rotation.z = Math.PI / 2; // Rotate to correct orientation
			wheelMesh.receiveShadow = true;
			wheelMesh.castShadow = true;
			vehicle.mesh.add(wheelMesh);
			
			// Create wheel collider - match visual wheel radius exactly
			const colliderRadius = wheelRadius; // Match visual wheel exactly
			const wheelColliderDesc = RAPIER.ColliderDesc.cylinder(wheelWidth/2, colliderRadius);
			wheelColliderDesc.setFriction(2.0);
			wheelColliderDesc.setRestitution(0.1);
			
			// Apply the same rotation as visual wheels (90 degrees around Z axis)
			const wheelRotation = new THREE.Quaternion();
			wheelRotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
			wheelColliderDesc.setRotation(new RAPIER.Quaternion(wheelRotation.x, wheelRotation.y, wheelRotation.z, wheelRotation.w));
			
			const wheelCollider = PhysicsWorld.createSensor(
				vehicle.physicsWorld,
				wheelColliderDesc,
				new THREE.Vector3(pos.x, pos.y, pos.z),
				vehicle.body
			);
			wheelCollider.setSensor(false);
			
			vehicle.wheels.push({
				mesh: wheelMesh,
				position: pos,
				index,
				collider: wheelCollider
			});
		});
	}

	static createRamp(vehicle) {
		const { width, height, depth } = vehicle.dimensions;
		const rampMaterial = new THREE.MeshLambertMaterial({ color: 0x8B7355 });
		
		// Ramp for car wheel access - thin but thick enough for wheels to contact
		const rampWidth = width * 0.8;
		const rampHeight = 0.1; // Thin ramp like a curb
		const rampDepth = 5; // Even longer for very gradual approach
		
		const rampGeometry = new THREE.BoxGeometry(rampWidth, rampHeight, rampDepth);
		const rampMesh = new THREE.Mesh(rampGeometry, rampMaterial);
		// Position ramp lower for easier car and player access
		rampMesh.position.set(0, -height/2 - rampHeight/2 - 0.3, -depth/2 - rampDepth/2); // Lower the ramp start point
		rampMesh.rotation.x = -Math.PI / 12; // Gentler angle (15 degrees)
		rampMesh.receiveShadow = true;
		rampMesh.castShadow = true;
		vehicle.mesh.add(rampMesh);
		
		// Ramp physics collider - attach to vehicle body for proper movement
		const rampColliderDesc = RAPIER.ColliderDesc.cuboid(rampWidth/2, rampHeight/2, rampDepth/2);
		rampColliderDesc.setFriction(1.0); // Good friction for driving up
		rampColliderDesc.setRestitution(0.1);
		
		// Set the position and rotation relative to the vehicle body - match visual mesh
		const rampPosition = new THREE.Vector3(0, -height/2 - rampHeight/2 - 0.3, -depth/2 - rampDepth/2);
		const rampRotation = new THREE.Quaternion();
		rampRotation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 12); // Match gentler angle (15 degrees)
		
		// Convert to Rapier format
		rampColliderDesc.setTranslation(rampPosition.x, rampPosition.y, rampPosition.z);
		rampColliderDesc.setRotation(new RAPIER.Quaternion(rampRotation.x, rampRotation.y, rampRotation.z, rampRotation.w));
		
		// Create the collider attached to the vehicle body so it moves with the vehicle
		const rampCollider = vehicle.physicsWorld.world.createCollider(rampColliderDesc, vehicle.body);
		
		vehicle.rampCollider = rampCollider;
		
		console.log('Ramp collider created and attached to vehicle');
	}

	static createInteriorSensor(vehicle) {
		// Create sensor volume as convex hull inside the walls, just above the floor
		const { width, height, depth, wallThickness } = vehicle.dimensions;
		
		// Interior dimensions (accounting for wall thickness, but make it more generous)
		const interiorWidth = width - wallThickness;
		const interiorHeight = height - wallThickness;
		const interiorDepth = depth - wallThickness;
		
		// Position sensor at floor level for better detection
		const sensorY = -height/2 + wallThickness/2 + interiorHeight/2;
		
		// Create convex hull sensor for interior detection
		const sensorDesc = RAPIER.ColliderDesc.cuboid(
			interiorWidth/2, 
			interiorHeight/2, 
			interiorDepth/2
		);
		
		vehicle.interiorSensor = PhysicsWorld.createSensor(
			vehicle.physicsWorld,
			sensorDesc,
			new THREE.Vector3(0, sensorY, 0),
			vehicle.body
		);
		
		// Store interior dimensions for boundary checking
		vehicle.interiorDimensions = {
			width: interiorWidth,
			height: interiorHeight,
			depth: interiorDepth,
			sensorY
		};
	}


	/**
	 * Apply impulse to move the vehicle
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} impulse 
	 */
	static applyImpulse(vehicle, impulse) {
		if (vehicle.body) {
			const rapierImpulse = new RAPIER.Vector3(impulse.x, impulse.y, impulse.z);
			vehicle.body.applyImpulse(rapierImpulse, true);
		}
	}

	/**
	 * Apply force to move the vehicle (for continuous forces)
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} force 
	 */
	static applyForce(vehicle, force) {
		if (vehicle.body) {
			const rapierForce = new RAPIER.Vector3(force.x, force.y, force.z);
			vehicle.body.applyImpulse(rapierForce, true);
		}
	}

	/**
	 * Set vehicle velocity
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} velocity 
	 */
	static setVelocity(vehicle, velocity) {
		if (vehicle.body) {
			const rapierVel = new RAPIER.Vector3(velocity.x, velocity.y, velocity.z);
			vehicle.body.setLinvel(rapierVel, true);
		}
	}

	/**
	 * Get vehicle velocity
	 * @param {object} vehicle 
	 * @returns {THREE.Vector3}
	 */
	static getVelocity(vehicle) {
		if (vehicle.body) {
			const vel = vehicle.body.linvel();
			return new THREE.Vector3(vel.x, vel.y, vel.z);
		}
		return new THREE.Vector3(0, 0, 0);
	}

	/**
	 * Get vehicle position
	 * @param {object} vehicle 
	 * @returns {THREE.Vector3}
	 */
	static getPosition(vehicle) {
		if (vehicle.body) {
			const pos = vehicle.body.translation();
			return new THREE.Vector3(pos.x, pos.y, pos.z);
		}
		return new THREE.Vector3(0, 0, 0);
	}

	/**
	 * Get vehicle rotation
	 * @param {object} vehicle 
	 * @returns {THREE.Quaternion}
	 */
	static getRotation(vehicle) {
		if (vehicle.body) {
			const rot = vehicle.body.rotation();
			return new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		}
		return new THREE.Quaternion(0, 0, 0, 1);
	}

	/**
	 * Convert world position to local vehicle coordinate system
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} worldPos 
	 * @returns {THREE.Vector3}
	 */
	static worldToLocal(vehicle, worldPos) {
		const vehiclePos = Vehicle.getPosition(vehicle);
		const vehicleRot = Vehicle.getRotation(vehicle);
		
		// Create temporary objects for transformation
		const localPos = worldPos.clone().sub(vehiclePos);
		const inverseRot = vehicleRot.clone().invert();
		localPos.applyQuaternion(inverseRot);
		
		return localPos;
	}

	/**
	 * Convert local vehicle position to world coordinate system
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} localPos 
	 * @returns {THREE.Vector3}
	 */
	static localToWorld(vehicle, localPos) {
		const vehiclePos = Vehicle.getPosition(vehicle);
		const vehicleRot = Vehicle.getRotation(vehicle);
		
		// Create temporary objects for transformation
		const worldPos = localPos.clone();
		worldPos.applyQuaternion(vehicleRot);
		worldPos.add(vehiclePos);
		
		return worldPos;
	}

	/**
	 * Check if a position is inside the vehicle
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} worldPos 
	 * @returns {boolean}
	 */
	static isPositionInside(vehicle, worldPos) {
		const localPos = Vehicle.worldToLocal(vehicle, worldPos);
		const { width, height, depth } = vehicle.interiorDimensions;
		
		// Check if position is within interior bounds
		return Math.abs(localPos.x) <= width/2 && 
			   Math.abs(localPos.y - vehicle.interiorDimensions.sensorY) <= height/2 && 
			   Math.abs(localPos.z) <= depth/2;
	}

	/**
	 * Check if player is inside the vehicle interior sensor
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} playerPos 
	 * @returns {boolean}
	 */
	static isPlayerInside(vehicle, playerPos) {
		return Vehicle.isPositionInside(vehicle, playerPos);
	}

	/**
	 * Add entity to interior tracking
	 * @param {object} vehicle 
	 * @param {object} entity 
	 */
	static addEntityInside(vehicle, entity) {
		vehicle.entitiesInside.add(entity);
		
		// Add to local grid
		const entityPos = entity.body ? 
			new THREE.Vector3(entity.body.translation().x, entity.body.translation().y, entity.body.translation().z) :
			new THREE.Vector3(0, 0, 0);
		const localPos = Vehicle.worldToLocal(vehicle, entityPos);
		LocalGrid.addEntity(vehicle.localGrid, entity, localPos);
		
		// Schedule player body replacement (defer to avoid physics conflicts)
		if (entity.id && entity.id.startsWith('player_') && entity.body) {
			entity.pendingKinematic = true;
			entity.body.setGravityScale(0.0, true); // Disable gravity immediately
		}
		
		console.log('Entity entered vehicle:', entity.id);
	}

	/**
	 * Remove entity from interior tracking
	 * @param {object} vehicle 
	 * @param {object} entity 
	 */
	static removeEntityInside(vehicle, entity) {
		vehicle.entitiesInside.delete(entity);
		LocalGrid.removeEntity(vehicle.localGrid, entity);
		
		// Schedule player body replacement (defer to avoid physics conflicts)
		if (entity.id && entity.id.startsWith('player_') && entity.body && entity.wasKinematic) {
			entity.pendingDynamic = true;
			// Add to pending changes since entity will no longer be in entitiesInside
			if (!vehicle.pendingBodyChanges) vehicle.pendingBodyChanges = [];
			vehicle.pendingBodyChanges.push(entity);
		}
		
		console.log('Entity left vehicle:', entity.id);
	}

	/**
	 * Update vehicle and interior entities
	 * @param {object} vehicle 
	 * @param {number} deltaTime 
	 */
	static update(vehicle, deltaTime) {
		// Handle deferred body replacements to avoid physics conflicts
		vehicle.entitiesInside.forEach(entity => {
			if (entity.pendingKinematic && entity.body) {
				Vehicle.replaceWithKinematicBody(entity);
				delete entity.pendingKinematic;
			}
		});
		
		// Handle pending changes for entities that have left the vehicle
		if (vehicle.pendingBodyChanges) {
			vehicle.pendingBodyChanges.forEach(entity => {
				if (entity.pendingDynamic && entity.body) {
					Vehicle.replaceWithDynamicBody(entity);
					delete entity.pendingDynamic;
				}
			});
			vehicle.pendingBodyChanges = [];
		}
		
		// Get vehicle's movement since last frame
		const currentPos = Vehicle.getPosition(vehicle);
		const currentRot = Vehicle.getRotation(vehicle);
		
		if (!vehicle.lastPosition) {
			vehicle.lastPosition = currentPos.clone();
			vehicle.lastRotation = currentRot.clone();
		}
		
		// Calculate vehicle movement delta
		const positionDelta = currentPos.clone().sub(vehicle.lastPosition);
		const rotationDelta = new THREE.Quaternion().multiplyQuaternions(
			currentRot,
			vehicle.lastRotation.clone().invert()
		);
		
		// Apply movement to all entities inside the vehicle
		vehicle.entitiesInside.forEach(entity => {
			if (entity.body) {
				// Check if this entity is a clamped car
				const isClamped = entity.id && !entity.id.startsWith('player_') && entity.clamped;
				
				if (isClamped) {
					// Clamped entities: rigid attachment to vehicle local grid
					// Store their local position if not already stored
					if (!entity.localPosition) {
						const entityPos = entity.body.translation();
						const entityWorldPos = new THREE.Vector3(entityPos.x, entityPos.y, entityPos.z);
						entity.localPosition = Vehicle.worldToLocal(vehicle, entityWorldPos);
						entity.localRotation = entity.body.rotation();
					}
					
					// Convert local position back to world space
					const newWorldPos = Vehicle.localToWorld(vehicle, entity.localPosition);
					
					// Set position and rotation rigidly
					entity.body.setTranslation(new RAPIER.Vector3(newWorldPos.x, newWorldPos.y, newWorldPos.z), true);
					entity.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
					entity.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
					
					// Keep the original rotation relative to vehicle
					const vehicleRot = Vehicle.getRotation(vehicle);
					const localRot = new THREE.Quaternion(entity.localRotation.x, entity.localRotation.y, entity.localRotation.z, entity.localRotation.w);
					const worldRot = localRot.clone().premultiply(vehicleRot);
					entity.body.setRotation(new RAPIER.Quaternion(worldRot.x, worldRot.y, worldRot.z, worldRot.w), true);
				} else {
					// Non-clamped entities: smooth following
					// Get entity's current position
					const entityPos = entity.body.translation();
					const entityWorldPos = new THREE.Vector3(entityPos.x, entityPos.y, entityPos.z);
					
					// Convert to local space relative to vehicle's previous position
					const relativePos = entityWorldPos.clone().sub(vehicle.lastPosition);
					
					// Apply rotation delta to the relative position
					relativePos.applyQuaternion(rotationDelta);
					
					// Calculate new world position
					const newWorldPos = vehicle.lastPosition.clone().add(relativePos).add(positionDelta);
					
					// Handle player - smooth following with vehicle movement
					if (entity.id && entity.id.startsWith('player_')) {
						// Move the player smoothly with vehicle movement
						entity.body.setTranslation(new RAPIER.Vector3(newWorldPos.x, newWorldPos.y, newWorldPos.z), true);
						
						// Inherit some vehicle velocity to help with movement
						const vehicleVel = vehicle.body.linvel();
						const currentVel = entity.body.linvel();
						const inheritanceAmount = 0.3; // Partial velocity inheritance
						const inheritedVel = new RAPIER.Vector3(
							currentVel.x + vehicleVel.x * inheritanceAmount,
							currentVel.y + vehicleVel.y * inheritanceAmount,
							currentVel.z + vehicleVel.z * inheritanceAmount
						);
						entity.body.setLinvel(inheritedVel, true);
					} else {
						// Non-player entities: simple vehicle velocity inheritance
						entity.body.setTranslation(new RAPIER.Vector3(newWorldPos.x, newWorldPos.y, newWorldPos.z), true);
						const vehicleVel = vehicle.body.linvel();
						entity.body.setLinvel(vehicleVel, true);
					}
					// Car keeps its own orientation for steering
				}
			}
		});
		
		// CONTINUOUSLY orient all players inside the vehicle to the floor
		vehicle.entitiesInside.forEach(entity => {
			if (entity.id && entity.id.startsWith('player_')) {
				Vehicle.orientPlayerToVehicleFloor(vehicle, entity);
			}
		});
		
		// Update stored position and rotation for next frame
		vehicle.lastPosition = currentPos.clone();
		vehicle.lastRotation = currentRot.clone();
		
		// Update local grid positions for entities inside
		vehicle.entitiesInside.forEach(entity => {
			const entityPos = entity.body ? 
				new THREE.Vector3(entity.body.translation().x, entity.body.translation().y, entity.body.translation().z) :
				new THREE.Vector3(0, 0, 0);
			const localPos = Vehicle.worldToLocal(vehicle, entityPos);
			LocalGrid.updateEntityPosition(vehicle.localGrid, entity, localPos);
		});
	}

	/**
	 * Replace player's dynamic body with kinematic body
	 * @param {object} entity 
	 */
	static replaceWithKinematicBody(entity) {
		if (!entity.body) return;
		
		// Store original body info
		const originalPos = entity.body.translation();
		const originalRot = entity.body.rotation();
		const originalHandle = entity.body.handle;
		
		// Remove from physics world tracking first
		entity.physicsWorld.bodies.delete(originalHandle);
		entity.physicsWorld.meshes.delete(originalHandle);
		
		// Remove original dynamic body
		entity.physicsWorld.world.removeRigidBody(entity.body);
		
		// Create kinematic body
		const kinematicBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
		kinematicBodyDesc.setTranslation(originalPos.x, originalPos.y, originalPos.z);
		kinematicBodyDesc.setRotation(originalRot);
		
		const kinematicBody = entity.physicsWorld.world.createRigidBody(kinematicBodyDesc);
		
		// Create capsule collider for kinematic body
		const capsuleColliderDesc = RAPIER.ColliderDesc.capsule(0.75, 0.5);
		capsuleColliderDesc.setFriction(0.0);
		capsuleColliderDesc.setRestitution(0.0);
		
		const kinematicCollider = entity.physicsWorld.world.createCollider(capsuleColliderDesc, kinematicBody);
		
		// Update entity references
		entity.body = kinematicBody;
		entity.collider = kinematicCollider;
		entity.wasKinematic = true;
		
		// Update physics world tracking with new body
		entity.physicsWorld.bodies.set(kinematicBody.handle, kinematicBody);
		entity.physicsWorld.meshes.set(kinematicBody.handle, entity.mesh);
	}

	/**
	 * Replace player's kinematic body with dynamic body
	 * @param {object} entity 
	 */
	static replaceWithDynamicBody(entity) {
		if (!entity.body) return;
		
		// Store current body info
		const currentPos = entity.body.translation();
		const currentRot = entity.body.rotation();
		const currentHandle = entity.body.handle;
		
		// Remove from physics world tracking first
		entity.physicsWorld.bodies.delete(currentHandle);
		entity.physicsWorld.meshes.delete(currentHandle);
		
		// Remove kinematic body
		entity.physicsWorld.world.removeRigidBody(entity.body);
		
		// Create dynamic body
		const dynamicBodyDesc = RAPIER.RigidBodyDesc.dynamic();
		dynamicBodyDesc.setTranslation(currentPos.x, currentPos.y, currentPos.z);
		dynamicBodyDesc.setRotation(currentRot);
		dynamicBodyDesc.lockRotations(true, true, true); // Lock rotations like original
		
		const dynamicBody = entity.physicsWorld.world.createRigidBody(dynamicBodyDesc);
		
		// Create capsule collider for dynamic body
		const capsuleColliderDesc = RAPIER.ColliderDesc.capsule(0.75, 0.5);
		capsuleColliderDesc.setFriction(0.0);
		capsuleColliderDesc.setRestitution(0.0);
		
		const dynamicCollider = entity.physicsWorld.world.createCollider(capsuleColliderDesc, dynamicBody);
		
		// Update entity references
		entity.body = dynamicBody;
		entity.collider = dynamicCollider;
		entity.body.setGravityScale(1.0, true);
		delete entity.wasKinematic;
		
		// Update physics world tracking with new body
		entity.physicsWorld.bodies.set(dynamicBody.handle, dynamicBody);
		entity.physicsWorld.meshes.set(dynamicBody.handle, entity.mesh);
	}

	/**
	 * Orient kinematic player to vehicle floor with raycasting
	 * @param {object} vehicle 
	 * @param {object} player 
	 */
	static orientPlayerToVehicleFloor(vehicle, player) {
		if (!player.body || !player.wasKinematic) return;
		
		// Get current vehicle rotation
		const vehicleRot = Vehicle.getRotation(vehicle);
		
		// Calculate the vehicle's floor normal (what direction is "up" for the vehicle floor)
		const vehicleFloorNormal = new THREE.Vector3(0, 1, 0); // Vehicle's local up
		vehicleFloorNormal.applyQuaternion(vehicleRot); // Transform to world space
		
		// Get current player position
		const currentPos = Player.getPosition(player);
		
		// Raycast down toward the vehicle floor to find the correct height
		const rayStart = currentPos.clone().add(vehicleFloorNormal.clone().multiplyScalar(2)); // Start above
		const rayDir = vehicleFloorNormal.clone().multiplyScalar(-1); // Cast toward floor
		const maxDistance = 5.0; // Maximum distance to floor
		
		const ray = new RAPIER.Ray(
			new RAPIER.Vector3(rayStart.x, rayStart.y, rayStart.z),
			new RAPIER.Vector3(rayDir.x, rayDir.y, rayDir.z)
		);
		
		const hit = player.physicsWorld.world.castRay(ray, maxDistance, true);
		
		if (hit) {
			// Calculate the hit point
			const hitPoint = new THREE.Vector3(
				rayStart.x + rayDir.x * hit.toi,
				rayStart.y + rayDir.y * hit.toi,
				rayStart.z + rayDir.z * hit.toi
			);
			
			// Position player slightly above the hit point
			const playerHeight = 0.75; // Half the capsule height
			const targetPos = hitPoint.clone().add(vehicleFloorNormal.clone().multiplyScalar(playerHeight));
			
			// Set kinematic position
			player.body.setTranslation(new RAPIER.Vector3(targetPos.x, targetPos.y, targetPos.z), true);
		}
		
		// Orient the player to the vehicle floor
		// Calculate the player's yaw rotation in the vehicle's coordinate system
		const playerYawInVehicleSpace = new THREE.Quaternion();
		playerYawInVehicleSpace.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw);
		
		// Combine player's yaw with vehicle's rotation to keep feet pointing to floor
		const finalRotation = new THREE.Quaternion().multiplyQuaternions(vehicleRot, playerYawInVehicleSpace);
		
		// Apply the rotation to the kinematic body
		player.body.setRotation(new RAPIER.Quaternion(finalRotation.x, finalRotation.y, finalRotation.z, finalRotation.w), true);
	}

	/**
	 * Get all entities in local grid cell
	 * @param {object} vehicle 
	 * @param {number} gridX 
	 * @param {number} gridZ 
	 * @returns {Array}
	 */
	static getEntitiesInGridCell(vehicle, gridX, gridZ) {
		return LocalGrid.getEntitiesInCell(vehicle.localGrid, gridX, gridZ);
	}

	/**
	 * Find path using local grid
	 * @param {object} vehicle 
	 * @param {THREE.Vector3} start 
	 * @param {THREE.Vector3} end 
	 * @returns {Array}
	 */
	static findPath(vehicle, start, end) {
		return LocalGrid.findPath(vehicle.localGrid, start, end);
	}
}