import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld } from './PhysicsWorld.js';

/**
 * Simple minimal car - just a box on wheels
 */
export class Car {
	static create(physicsWorld, position = new THREE.Vector3(0, 1, 0)) {
		const car = {
			physicsWorld,
			position,
			body: null,
			mesh: null,
			collider: null,
			wheels: [],
			id: Math.random().toString(36).substr(2, 9),
			occupied: false,
			driver: null
		};
		
		Car.initialize(car);
		return car;
	}

	static initialize(car) {
		// Simple dimensions
		const width = 2;
		const height = 1;
		const length = 4;
		const wheelRadius = 0.8; // Bigger wheels
		
		// Create visual group
		const carGroup = new THREE.Group();
		carGroup.position.copy(car.position);
		car.physicsWorld.scene.add(carGroup);
		
		// Create simple red box body
		const bodyGeometry = new THREE.BoxGeometry(width, height, length);
		const bodyMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });
		const bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
		bodyMesh.position.set(0, wheelRadius + 0.4, 0); // More clearance above wheels
		bodyMesh.castShadow = true;
		carGroup.add(bodyMesh);
		
		// Create 4 wheels
		const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.3, 12);
		const wheelMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
		
		const wheelPositions = [
			{ x: -width/2 - 0.2, y: 0, z: length/2 - 0.5 },  // Front left - more clearance
			{ x: width/2 + 0.2, y: 0, z: length/2 - 0.5 },   // Front right - more clearance
			{ x: -width/2 - 0.2, y: 0, z: -length/2 + 0.5 }, // Back left - more clearance
			{ x: width/2 + 0.2, y: 0, z: -length/2 + 0.5 }   // Back right - more clearance
		];
		
		// Add wheels to car group
		wheelPositions.forEach((pos, index) => {
			const wheelMesh = new THREE.Mesh(wheelGeometry, wheelMaterial);
			wheelMesh.position.set(pos.x, pos.y, pos.z);
			wheelMesh.rotation.z = Math.PI / 2;
			wheelMesh.castShadow = true;
			carGroup.add(wheelMesh);
			
			car.wheels.push({ mesh: wheelMesh, position: pos, index });
		});
		
		// Create very short physics collider that definitely fits under ramp
		const colliderHeight = wheelRadius; // Just wheel height
		const bodyColliderDesc = RAPIER.ColliderDesc.cuboid(width/2, colliderHeight/2, length/2);
		bodyColliderDesc.setMass(600);
		bodyColliderDesc.setFriction(1.0);
		bodyColliderDesc.setRestitution(0.1);
		
		// Position so bottom of collider touches ground
		const bodyPos = car.position.clone();
		bodyPos.y += colliderHeight/2; // Center of tall collider
		
		const carData = PhysicsWorld.createDynamicBody(
			car.physicsWorld,
			bodyGeometry,
			bodyMaterial,
			bodyColliderDesc,
			bodyPos,
			true // LOCK ROTATION - no rolling!
		);
		
		car.body = carData.body;
		car.mesh = carGroup;
		car.collider = carData.collider;
		
		car.physicsWorld.scene.remove(carData.mesh);
		car.physicsWorld.meshes.set(carData.id, carGroup);
		
		console.log('Simple car created');
	}

	/**
	 * Apply impulse to move the car
	 * @param {object} car 
	 * @param {THREE.Vector3} impulse 
	 */
	static applyImpulse(car, impulse) {
		if (car.body) {
			const rapierImpulse = new RAPIER.Vector3(impulse.x, impulse.y, impulse.z);
			car.body.applyImpulse(rapierImpulse, true);
		}
	}

	/**
	 * Get car position
	 * @param {object} car 
	 * @returns {THREE.Vector3}
	 */
	static getPosition(car) {
		if (car.body) {
			const pos = car.body.translation();
			return new THREE.Vector3(pos.x, pos.y, pos.z);
		}
		return new THREE.Vector3(0, 0, 0);
	}

	/**
	 * Get car velocity
	 * @param {object} car 
	 * @returns {THREE.Vector3}
	 */
	static getVelocity(car) {
		if (car.body) {
			const vel = car.body.linvel();
			return new THREE.Vector3(vel.x, vel.y, vel.z);
		}
		return new THREE.Vector3(0, 0, 0);
	}

	/**
	 * Set car velocity
	 * @param {object} car 
	 * @param {THREE.Vector3} velocity 
	 */
	static setVelocity(car, velocity) {
		if (car.body) {
			const rapierVel = new RAPIER.Vector3(velocity.x, velocity.y, velocity.z);
			car.body.setLinvel(rapierVel, true);
		}
	}

	/**
	 * Get car rotation
	 * @param {object} car 
	 * @returns {THREE.Quaternion}
	 */
	static getRotation(car) {
		if (car.body) {
			const rot = car.body.rotation();
			return new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
		}
		return new THREE.Quaternion(0, 0, 0, 1);
	}

	/**
	 * Check if player is near car for entry
	 * @param {object} car 
	 * @param {THREE.Vector3} playerPos 
	 * @returns {boolean}
	 */
	static isPlayerNearCar(car, playerPos) {
		const carPos = Car.getPosition(car);
		const distance = playerPos.distanceTo(carPos);
		return distance < 3; // Within 3 units
	}

	/**
	 * Enter car
	 * @param {object} car 
	 * @param {object} player 
	 */
	static enterCar(car, player) {
		if (!car.occupied) {
			car.occupied = true;
			car.driver = player;
			console.log('Player entered car:', car.id);
		}
	}

	/**
	 * Exit car
	 * @param {object} car 
	 */
	static exitCar(car) {
		if (car.occupied) {
			car.occupied = false;
			car.driver = null;
			console.log('Player exited car:', car.id);
		}
	}

	/**
	 * Update wheel steering angle
	 * @param {object} car 
	 * @param {number} steerInput - -1 to 1, where -1 is left, 1 is right
	 */
	static updateSteering(car, steerInput) {
		const maxSteerAngle = Math.PI / 3; // 60 degrees max for much tighter turning
		const targetSteerAngle = steerInput * maxSteerAngle;
		
		car.wheels.forEach(wheel => {
			if (wheel.isFront) {
				// Even faster interpolation for very responsive steering
				const lerpSpeed = 0.5;
				wheel.steerAngle += (targetSteerAngle - wheel.steerAngle) * lerpSpeed;
			}
		});
	}

	/**
	 * Update car
	 * @param {object} car 
	 */
	static update(car) {
		// Simple wheel update - only show steering on front wheels
		car.wheels.forEach(wheel => {
			// Reset to base wheel orientation
			wheel.mesh.rotation.set(0, 0, Math.PI / 2);
			
			if (wheel.isFront) {
				// For front wheels, add steering rotation around Y axis
				wheel.mesh.rotation.y = wheel.steerAngle;
			}
			// No rolling animation - just static wheels with steering
		});
	}
}