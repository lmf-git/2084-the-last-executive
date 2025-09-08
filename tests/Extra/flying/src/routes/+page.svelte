<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import RAPIER from '@dimforge/rapier3d-compat';

	let canvas = $state();
	let gameRunning = $state(false);
	let altitude = $state(0);
	let speed = $state(0);
	let throttle = $state(0);
	let onGround = $state(true);
	let gearDown = $state(true);

	// Trajectory tracking and prediction
	class TrajectoryTracker {
		constructor(scene) {
			this.positions = [];
			this.predictedPositions = [];
			this.maxPoints = 500; // Keep last 500 positions
			this.maxPrediction = 100; // Predict 100 steps ahead
			this.updateInterval = 5; // Update every 5 frames for smoother line
			this.frameCount = 0;
			this.line = null;
			this.predictionLine = null;
			this.scene = scene;
			this.createLines();
		}

		createLines() {
			// Historical trajectory line (red)
			const geometry = new THREE.BufferGeometry();
			const material = new THREE.LineBasicMaterial({ 
				color: 0xff4444, 
				transparent: true, 
				opacity: 0.8,
				linewidth: 2
			});
			
			const positions = new Float32Array(this.maxPoints * 3);
			geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			geometry.setDrawRange(0, 0);
			
			this.line = new THREE.Line(geometry, material);
			this.scene.add(this.line);

			// Prediction trajectory line (yellow)
			const predGeometry = new THREE.BufferGeometry();
			const predMaterial = new THREE.LineBasicMaterial({ 
				color: 0xffff00, 
				transparent: true, 
				opacity: 0.6,
				linewidth: 2
			});
			
			const predPositions = new Float32Array(this.maxPrediction * 3);
			predGeometry.setAttribute('position', new THREE.BufferAttribute(predPositions, 3));
			predGeometry.setDrawRange(0, 0);
			
			this.predictionLine = new THREE.Line(predGeometry, predMaterial);
			this.scene.add(this.predictionLine);
		}

		predictTrajectory(currentPos, currentVel, controls) {
			this.predictedPositions = [];
			let pos = currentPos.clone();
			let vel = currentVel.clone();
			const deltaTime = 0.05; // Small time step for prediction
			
			for (let i = 0; i < this.maxPrediction; i++) {
				// Simplified physics prediction
				let totalForce = new THREE.Vector3();
				
				// Gravity
				totalForce.add(new THREE.Vector3(0, -9.81, 0));
				
				// Thrust (using current throttle)
				const forward = controls.forward.clone();
				const thrust = controls.throttle * controls.maxThrust;
				totalForce.add(forward.multiplyScalar(thrust));
				
				// Drag
				const speed = vel.length();
				if (speed > 0) {
					const dragMagnitude = controls.dragCoeff * speed * speed;
					const dragVector = vel.clone().normalize().multiplyScalar(-dragMagnitude);
					totalForce.add(dragVector);
				}
				
				// Lift (if airborne and has speed)
				if (pos.y > 2.5 && speed > 15) {
					const up = controls.up.clone();
					const speedFactor = Math.max(0, (speed - 15) / controls.takeoffSpeed);
					const liftMagnitude = controls.liftCoeff * speed * speed * 0.012 * speedFactor;
					totalForce.add(up.multiplyScalar(liftMagnitude));
				}
				
				// Update velocity and position
				const acceleration = totalForce.multiplyScalar(deltaTime);
				vel.add(acceleration);
				
				// Ground collision
				if (pos.y <= 2.0 && vel.y < 0) {
					vel.y = 0;
					vel.multiplyScalar(0.95); // Ground friction
				}
				
				pos.add(vel.clone().multiplyScalar(deltaTime));
				
				this.predictedPositions.push({
					x: pos.x,
					y: pos.y,
					z: pos.z
				});
			}
			
			this.updatePredictionLine();
		}

		addPosition(position, velocity, controls) {
			this.frameCount++;
			if (this.frameCount % this.updateInterval !== 0) return;

			this.positions.push({
				x: position.x,
				y: position.y,
				z: position.z
			});

			// Keep only recent positions
			if (this.positions.length > this.maxPoints) {
				this.positions.shift();
			}

			this.updateLine();
			this.predictTrajectory(position, velocity, controls);
		}

		updateLine() {
			if (!this.line || this.positions.length < 2) return;

			const positions = new Float32Array(this.positions.length * 3);
			
			for (let i = 0; i < this.positions.length; i++) {
				positions[i * 3] = this.positions[i].x;
				positions[i * 3 + 1] = this.positions[i].y;
				positions[i * 3 + 2] = this.positions[i].z;
			}

			this.line.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			this.line.geometry.setDrawRange(0, this.positions.length);
			this.line.geometry.attributes.position.needsUpdate = true;
		}

		updatePredictionLine() {
			if (!this.predictionLine || this.predictedPositions.length < 2) return;

			const positions = new Float32Array(this.predictedPositions.length * 3);
			
			for (let i = 0; i < this.predictedPositions.length; i++) {
				positions[i * 3] = this.predictedPositions[i].x;
				positions[i * 3 + 1] = this.predictedPositions[i].y;
				positions[i * 3 + 2] = this.predictedPositions[i].z;
			}

			this.predictionLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
			this.predictionLine.geometry.setDrawRange(0, this.predictedPositions.length);
			this.predictionLine.geometry.attributes.position.needsUpdate = true;
		}

		clear() {
			this.positions = [];
			this.predictedPositions = [];
			if (this.line) {
				this.line.geometry.setDrawRange(0, 0);
			}
			if (this.predictionLine) {
				this.predictionLine.geometry.setDrawRange(0, 0);
			}
		}

		toggle() {
			if (this.line) {
				this.line.visible = !this.line.visible;
			}
			if (this.predictionLine) {
				this.predictionLine.visible = !this.predictionLine.visible;
			}
		}
	}

	// Simplified Physics World Class
	class PhysicsWorld {
		constructor() {
			this.world = null;
			this.planeBody = null;
			this.planeCollider = null;
			this.initialized = false;
		}

		async init() {
			await RAPIER.init();
			const gravity = { x: 0.0, y: -9.81, z: 0.0 };
			this.world = new RAPIER.World(gravity);
			this.initialized = true;
		}

		createPlane(position = { x: 0, y: 10, z: 0 }, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
			if (!this.initialized) return null;
			const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
				.setTranslation(position.x, position.y, position.z)
				.setRotation(rotation);
			this.planeBody = this.world.createRigidBody(rigidBodyDesc);
			const colliderDesc = RAPIER.ColliderDesc.cuboid(6, 1, 4);
			this.planeCollider = this.world.createCollider(colliderDesc, this.planeBody);
			return this.planeBody;
		}

		createGround() {
			if (!this.initialized) return null;
			const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0.0, -1.0, 0.0);
			const groundBody = this.world.createRigidBody(groundBodyDesc);
			const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100.0, 0.1, 100.0);
			this.world.createCollider(groundColliderDesc, groundBody);
			return groundBody;
		}

		updatePlane(velocity, angularVelocity, deltaTime) {
			if (!this.planeBody) return;
			
			const currentPos = this.planeBody.translation();
			const currentRot = this.planeBody.rotation();
			
			const newPos = {
				x: currentPos.x + velocity.x * deltaTime,
				y: currentPos.y + velocity.y * deltaTime,
				z: currentPos.z + velocity.z * deltaTime
			};
			
			const rotationChange = new THREE.Quaternion().setFromEuler(
				new THREE.Euler(
					angularVelocity.x * deltaTime,
					angularVelocity.y * deltaTime,
					angularVelocity.z * deltaTime
				)
			);
			
			const currentQuaternion = new THREE.Quaternion(currentRot.x, currentRot.y, currentRot.z, currentRot.w);
			const newQuaternion = currentQuaternion.multiply(rotationChange);
			
			this.planeBody.setNextKinematicTranslation(newPos);
			this.planeBody.setNextKinematicRotation({
				x: newQuaternion.x,
				y: newQuaternion.y, 
				z: newQuaternion.z,
				w: newQuaternion.w
			});
		}

		getPlaneTransform() {
			if (!this.planeBody) return null;
			const translation = this.planeBody.translation();
			const rotation = this.planeBody.rotation();
			return {
				position: { x: translation.x, y: translation.y, z: translation.z },
				rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }
			};
		}

		step() {
			if (this.world) {
				this.world.step();
				
				// Update falling parts
				if (this.fallingParts) {
					this.fallingParts.forEach(part => {
						const pos = part.body.translation();
						const rot = part.body.rotation();
						part.mesh.position.set(pos.x, pos.y, pos.z);
						part.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
					});
				}
			}
		}
	}

	// Realistic Flight Controls Class
	class FlightControls {
		constructor() {
			this.keys = {};
			this.velocity = new THREE.Vector3(0, 0, 0);
			this.angularVelocity = new THREE.Vector3(0, 0, 0);
			this.forward = new THREE.Vector3(0, 0, 1);
			this.up = new THREE.Vector3(0, 1, 0);
			this.right = new THREE.Vector3(1, 0, 0);
			
			// Aircraft parameters
			this.throttle = 0.0;
			this.airspeed = 0;
			this.groundSpeed = 0;
			this.onGround = true;
			this.gearDown = true;
			
			// Momentum tracking for realistic physics
			this.dragMomentum = 1.0; // Current drag multiplier that changes gradually
			this.targetDragMultiplier = 1.0; // Target drag multiplier based on current inputs
			
			// Flight characteristics
			this.maxThrust = 150;
			this.takeoffSpeed = 55;
			this.stallSpeed = 35;
			this.maxSpeed = 200;
			this.liftCoeff = 0.8;
			this.dragCoeff = 0.05;
			this.groundFriction = 0.1;
			this.pitchAuthority = 1.5;
			this.yawAuthority = 1.0;
			this.rollAuthority = 2.0;
			
			this.setupControls();
		}

		setupControls() {
			document.addEventListener('keydown', (e) => { 
				this.keys[e.code] = true;
				if (e.code === 'KeyG') this.toggleGear();
			});
			document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
		}

		toggleGear() {
			if (this.airspeed < 30) { // Only allow gear operation at low speeds
				this.gearDown = !this.gearDown;
				console.log('Gear toggled:', this.gearDown ? 'DOWN' : 'UP');
			} else {
				console.log('Cannot toggle gear at high speed:', this.airspeed);
			}
		}

		update(deltaTime, planePosition, planeQuaternion) {
			// Update orientation vectors (plane faces +Z direction)
			this.forward.set(0, 0, 1).applyQuaternion(planeQuaternion);
			this.up.set(0, 1, 0).applyQuaternion(planeQuaternion);
			this.right.set(1, 0, 0).applyQuaternion(planeQuaternion);

			// Handle throttle with slower, more realistic engine response
			const throttleInput = this.getThrottleInput();
			this.throttle = THREE.MathUtils.lerp(this.throttle, throttleInput, deltaTime * 0.8); // Much slower throttle response

			// Ground detection based on altitude and lift - more gradual takeoff
			const groundClearance = planePosition.y - 2.0; // Match ground level
			const liftThreshold = this.takeoffSpeed * 0.85; // 85% of takeoff speed
			const hasAdequateSpeed = this.airspeed > liftThreshold;
			const hasLift = hasAdequateSpeed && this.velocity.y > 0.05; // Actually ascending
			
			// Gradual transition - only consider airborne when clearly flying
			this.onGround = groundClearance <= 0.5 || (!hasLift && groundClearance <= 2.0);

			// Calculate thrust
			const thrust = this.throttle * this.maxThrust;
			const thrustVector = this.forward.clone().multiplyScalar(thrust);

			// Calculate drag with turning penalty and angle of attack penalties
			let baseDragMagnitude = this.dragCoeff * this.airspeed * this.airspeed;
			
			// Calculate target drag multiplier based on current flight conditions
			const turningRate = this.angularVelocity.length();
			this.targetDragMultiplier = 1 + turningRate * 0.8; // Base turning drag
			
			// Add drag penalties based on flight technique
			if (!this.onGround && this.velocity.length() > 5) {
				const velocityDirection = this.velocity.clone().normalize();
				
				// Calculate how much the plane's up vector aligns with world up (roll angle)
				const worldUp = new THREE.Vector3(0, 1, 0);
				const planeUpAlignment = Math.abs(this.up.dot(worldUp)); // 1 = wings level, 0 = sideways
				
				// Calculate angle between plane's forward direction and velocity direction (angle of attack)
				const forwardVelocityAlignment = Math.max(-1, Math.min(1, this.forward.dot(velocityDirection)));
				const angleOfAttack = Math.acos(Math.abs(forwardVelocityAlignment));
				const angleOfAttackDegrees = angleOfAttack * (180 / Math.PI);
				
				// Angle of attack penalty
				let angleOfAttackPenalty = 0;
				if (angleOfAttackDegrees > 10) {
					angleOfAttackPenalty = Math.pow((angleOfAttackDegrees - 10) / 80, 2) * 5.0;
				}
				
				// Control input penalty when pulling back while rolled sideways
				let controlInputPenalty = 0;
				if (this.keys['KeyS'] || this.keys['ArrowDown']) {
					if (planeUpAlignment < 0.7) {
						controlInputPenalty = (1 - planeUpAlignment) * 6.0;
					}
				}
				
				// Add penalties to target drag multiplier
				this.targetDragMultiplier += angleOfAttackPenalty + controlInputPenalty;
			}
			
			// Gradually adjust drag momentum toward target (adds inertia to drag changes)
			const dragResponseRate = deltaTime * 2.0; // How quickly drag changes
			this.dragMomentum = THREE.MathUtils.lerp(this.dragMomentum, this.targetDragMultiplier, dragResponseRate);
			
			const totalDragMagnitude = baseDragMagnitude * this.dragMomentum;
			
			const dragVector = this.velocity.clone().normalize().multiplyScalar(-totalDragMagnitude);
			
			// Add speed changes based on vertical velocity component only (climbing/diving)
			if (!this.onGround && this.velocity.length() > 5) {
				// Only consider vertical velocity component for energy exchange
				const verticalVelocity = this.velocity.y;
				
				// Convert vertical velocity to energy exchange rate (climbing = negative, diving = positive)
				const energyExchangeRate = -verticalVelocity * 0.015; // Climbing loses speed, diving gains speed
				
				// Apply speed change based on vertical movement only
				const speedChange = energyExchangeRate * this.airspeed * deltaTime * 2.0;
				const newSpeed = Math.max(10, this.airspeed + speedChange); // Minimum speed of 10
				
				// Apply the speed change to velocity
				if (this.airspeed > 0) {
					this.velocity.multiplyScalar(newSpeed / this.airspeed);
				}
			}

			// Calculate lift based on angle of attack and airspeed
			let liftVector = new THREE.Vector3(0, 0, 0);
			if (this.airspeed > 15) {
				// Calculate angle of attack (pitch relative to flight direction)
				const velocityDirection = this.velocity.length() > 5 ? this.velocity.clone().normalize() : this.forward.clone();
				const angleOfAttack = Math.asin(Math.max(-1, Math.min(1, this.forward.dot(velocityDirection))));
				
				// Lift requires minimum thrust and optimal angle of attack
				const thrustFactor = Math.min(1.0, this.throttle * 1.2); // Need significant thrust for lift
				const optimalAngle = 0.087; // ~5 degrees optimal angle of attack
				const stallAngle = 0.26; // ~15 degrees stall angle
				
				let liftCoeff;
				if (Math.abs(angleOfAttack) < stallAngle) {
					// Lift peaks at optimal angle, then decreases toward stall
					const angleEfficiency = 1 - Math.pow((Math.abs(angleOfAttack) - optimalAngle) / stallAngle, 2);
					liftCoeff = this.liftCoeff * Math.max(0.1, angleEfficiency) * thrustFactor;
				} else {
					// Post-stall - dramatically reduced lift
					liftCoeff = this.liftCoeff * 0.1 * thrustFactor;
				}
				
				// Speed factor and ground effect
				const speedFactor = Math.max(0, (this.airspeed - 15) / this.takeoffSpeed);
				const groundEffect = this.onGround ? 0.6 : 1.0; // Reduced lift on ground
				const liftMagnitude = liftCoeff * this.airspeed * this.airspeed * 0.012 * speedFactor * groundEffect;
				
				// Lift acts perpendicular to velocity direction, not just upward
				const liftDirection = velocityDirection.clone().cross(this.right).normalize();
				if (liftDirection.length() > 0.1) {
					liftVector = liftDirection.multiplyScalar(liftMagnitude * Math.sign(angleOfAttack));
				} else {
					// Fallback to upward lift if cross product is too small
					liftVector = this.up.clone().multiplyScalar(liftMagnitude);
				}
			}

			// Ground friction
			let frictionVector = new THREE.Vector3(0, 0, 0);
			if (this.onGround) {
				frictionVector = this.velocity.clone().multiplyScalar(-this.groundFriction);
			}

			// Gravity
			const gravity = new THREE.Vector3(0, -9.81, 0);

			// Total force
			const totalForce = new THREE.Vector3()
				.add(thrustVector)
				.add(dragVector) 
				.add(liftVector)
				.add(frictionVector)
				.add(gravity);

			// Update velocity
			const acceleration = totalForce.multiplyScalar(deltaTime);
			this.velocity.add(acceleration);
			
			// Ground collision - prevent going through ground with smooth landing
			const groundLevel = 2.0; // Match runway Y position 
			if (planePosition.y <= groundLevel && this.velocity.y < 0) {
				// Smooth ground contact with progressive damping
				const impactVelocity = Math.abs(this.velocity.y);
				if (impactVelocity > 5) {
					// Hard landing - some bounce but heavily damped
					this.velocity.y = Math.max(0, this.velocity.y * -0.3);
				} else {
					// Soft landing - no bounce
					this.velocity.y = Math.max(0, this.velocity.y * 0.05);
				}
				
				// Progressive ground friction based on contact
				if (this.onGround) {
					const frictionFactor = Math.max(0.88, 1.0 - (impactVelocity / 20)); // Less friction on hard impacts
					this.velocity.multiplyScalar(frictionFactor);
				}
			}

			// Calculate speeds
			this.airspeed = this.velocity.length();
			this.groundSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);

			// Angular controls (reduced when on ground)
			this.angularVelocity.set(0, 0, 0);
			const baseControlAuthority = this.onGround ? 0.3 : Math.min(1.0, this.airspeed / 30);
			
			// Pitch authority - based on airspeed and where the pitch input will actually move the plane
			const speedFactor = this.onGround ? 
				Math.max(0.005, (this.groundSpeed - 30) / 60) * 0.08 : // Much more limited on ground
				Math.max(0.05, this.airspeed / 100); // Need airspeed for authority
			
			// Calculate where pitch input will actually move the plane relative to gravity
			let gravityFactor = 1.0;
			if (!this.onGround && this.velocity.length() > 1) {
				const velocityDirection = this.velocity.clone().normalize();
				const gravityDirection = new THREE.Vector3(0, -1, 0);
				
				// Calculate the direction that pitch up/down will move the plane
				// When rolled sideways, pitch doesn't fight gravity as much
				const pitchUpDirection = this.up.clone(); // Direction plane will move when pitching up
				const pitchDownDirection = this.up.clone().multiplyScalar(-1); // Direction when pitching down
				
				// For pitch up (W key): check if we're fighting gravity
				const pitchUpGravityAlignment = pitchUpDirection.dot(gravityDirection);
				// For pitch down (S key): check if we're fighting gravity  
				const pitchDownGravityAlignment = pitchDownDirection.dot(gravityDirection);
				
				// Use the alignment that corresponds to current input (this will be calculated per input)
				// For now, use average - will be refined per pitch input below
				const avgGravityAlignment = Math.abs((pitchUpGravityAlignment + pitchDownGravityAlignment) / 2);
				gravityFactor = 1.0 + avgGravityAlignment * 0.3; // Reduced gravity penalty
			}
				
			const basePitchAuthority = speedFactor * baseControlAuthority / gravityFactor * 0.8;

			// Roll authority - reduced from base control and speed dependent
			const rollAuthority = baseControlAuthority * 0.3 * Math.min(1.0, this.airspeed / 30); // Much reduced roll authority, speed dependent

			// Pitch control with velocity-based gravity penalties
			if (this.keys['KeyW'] || this.keys['ArrowUp']) {
				// Pitch up (W key) - different handling for ground vs air
				let pitchUpAuthority = basePitchAuthority;
				
				if (this.onGround) {
					// Ground: Allow rotation for takeoff when at speed
					if (this.airspeed > 30) {
						pitchUpAuthority = baseControlAuthority * 0.6; // Strong enough for takeoff rotation
					} else {
						pitchUpAuthority = baseControlAuthority * 0.2; // Limited at low speeds
					}
				} else {
					// Air: Use velocity-based penalties
					if (this.velocity.length() > 1) {
						const velocityDirection = this.velocity.clone().normalize();
						const isClimbing = velocityDirection.y < -0.1;
						const specificGravityFactor = isClimbing ? 1.4 : 1.0;
						pitchUpAuthority = speedFactor * baseControlAuthority / specificGravityFactor * 0.8;
					}
				}
				this.angularVelocity.x += this.pitchAuthority * pitchUpAuthority;
			}
			if (this.keys['KeyS'] || this.keys['ArrowDown']) {
				// Pitch down (S key) - different handling for ground vs air
				let pitchDownAuthority = basePitchAuthority;
				
				if (this.onGround) {
					// Ground: Allow pitch down for ground operations
					pitchDownAuthority = baseControlAuthority * 0.4;
				} else {
					// Air: Use velocity-based penalties
					if (this.velocity.length() > 1) {
						const velocityDirection = this.velocity.clone().normalize();
						const isDiving = velocityDirection.y > 0.1;
						const specificGravityFactor = isDiving ? 1.2 : 0.8;
						pitchDownAuthority = speedFactor * baseControlAuthority / specificGravityFactor * 1.2;
					}
				}
				this.angularVelocity.x -= this.pitchAuthority * pitchDownAuthority;
			}

			// A/D controls - Roll in air, steering on ground
			if (this.onGround) {
				// On ground: A/D control nose wheel steering (yaw)
				const groundSteerAuthority = this.yawAuthority * 1.5; // Moderate ground steering
				if (this.keys['KeyA']) {
					this.angularVelocity.y += groundSteerAuthority;
				}
				if (this.keys['KeyD']) {
					this.angularVelocity.y -= groundSteerAuthority;
				}
			} else {
				// In air: A/D control roll
				if (this.keys['KeyA']) {
					// Left roll (counter-clockwise when viewed from behind)
					this.angularVelocity.z -= this.rollAuthority * rollAuthority;
				}
				if (this.keys['KeyD']) {
					// Right roll (clockwise when viewed from behind)
					this.angularVelocity.z += this.rollAuthority * rollAuthority;
				}
			}

			// Q/E controls - Yaw (reduced power)
			const reducedYawAuthority = this.onGround ? 
				this.yawAuthority * 1.2 : // Moderate on ground
				this.yawAuthority * baseControlAuthority * 0.4; // Much reduced in air
				
			if (this.keys['KeyQ']) {
				this.angularVelocity.y += reducedYawAuthority;
			}
			if (this.keys['KeyE']) {
				this.angularVelocity.y -= reducedYawAuthority;
			}
			
			// Arrow keys for roll in air only
			if (!this.onGround) {
				if (this.keys['ArrowLeft']) {
					// Left roll (counter-clockwise when viewed from behind)
					this.angularVelocity.z -= this.rollAuthority * rollAuthority;
				}
				if (this.keys['ArrowRight']) {
					// Right roll (clockwise when viewed from behind)
					this.angularVelocity.z += this.rollAuthority * rollAuthority;
				}
			}

			// Natural ground damping only - no artificial alignment
			if (this.onGround) {
				// Natural rotation damping due to ground contact friction
				this.angularVelocity.x *= 0.85; // Lighter pitch damping for takeoff rotation
				this.angularVelocity.y *= 0.4; // Moderate yaw damping (tires/ground)
				this.angularVelocity.z *= 0.6; // Light roll damping
			}
			
			
			// Reduce pitch authority significantly at low airspeeds even in flight
			if (!this.onGround && this.airspeed < 120) {
				// Much reduced pitch authority at low airspeeds after takeoff
				const lowSpeedFactor = Math.max(0.08, this.airspeed / 120); // Very limited authority below 120 speed
				this.angularVelocity.x *= lowSpeedFactor;
			}

			return { 
				velocity: this.velocity, 
				angularVelocity: this.angularVelocity,
				throttle: this.throttle,
				airspeed: this.airspeed,
				onGround: this.onGround,
				gearDown: this.gearDown
			};
		}

		getThrottleInput() {
			if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) return 1.0;
			if (this.keys['Space']) return 1.0; // Afterburner
			if (this.keys['ControlLeft'] || this.keys['ControlRight']) return 0.0;
			return this.throttle; // Maintain current throttle when no input
		}
	}

	// Flight Camera Class
	class FlightCamera {
		constructor(camera) {
			this.camera = camera;
			this.offset = new THREE.Vector3(0, 5, -15); // Behind plane (negative Z)
			this.lookAhead = new THREE.Vector3(0, 0, 20); // Look ahead (positive Z)
			this.smoothing = 0.1;
			this.targetPosition = new THREE.Vector3();
			this.targetLookAt = new THREE.Vector3();
		}

		update(planePosition, planeQuaternion) {
			const offset = this.offset.clone().applyQuaternion(planeQuaternion);
			this.targetPosition.copy(planePosition).add(offset);
			const lookAhead = this.lookAhead.clone().applyQuaternion(planeQuaternion);
			this.targetLookAt.copy(planePosition).add(lookAhead);
			this.camera.position.lerp(this.targetPosition, this.smoothing);
			this.camera.lookAt(this.targetLookAt);
		}
	}

	// Create 737-style Plane Geometry
	function createPlaneGeometry() {
		const group = new THREE.Group();
		
		// Main fuselage - Boeing 737 proportions (oriented along Z-axis)
		const fuselageGeometry = new THREE.CylinderGeometry(0.8, 0.6, 12, 16);
		const fuselageMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
		fuselage.rotation.x = Math.PI / 2;
		group.add(fuselage);
		
		// Nose cone (pointing forward along Z-axis)
		const noseGeometry = new THREE.ConeGeometry(0.6, 2, 12);
		const nose = new THREE.Mesh(noseGeometry, fuselageMaterial);
		nose.rotation.x = Math.PI / 2;
		nose.position.z = 7;
		group.add(nose);
		
		// Main wings - swept back like 737 (perpendicular to fuselage)
		const wingGeometry = new THREE.BoxGeometry(8, 0.2, 3);
		const wingMaterial = new THREE.MeshLambertMaterial({ color: 0xe0e0e0 });
		const wings = new THREE.Mesh(wingGeometry, wingMaterial);
		wings.position.z = 1;
		group.add(wings);
		
		// Wing tips (winglets)
		const wingletGeometry = new THREE.BoxGeometry(0.6, 1.2, 0.3);
		const leftWinglet = new THREE.Mesh(wingletGeometry, wingMaterial);
		leftWinglet.position.set(4, 0.6, 1);
		leftWinglet.rotation.z = 0.2;
		group.add(leftWinglet);
		
		const rightWinglet = new THREE.Mesh(wingletGeometry, wingMaterial);
		rightWinglet.position.set(-4, 0.6, 1);
		rightWinglet.rotation.z = -0.2;
		group.add(rightWinglet);
		
		// Engines under wings (oriented along Z-axis)
		const engineGeometry = new THREE.CylinderGeometry(0.6, 0.6, 2.5, 12);
		const engineMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
		
		const leftEngine = new THREE.Mesh(engineGeometry, engineMaterial);
		leftEngine.rotation.x = Math.PI / 2;
		leftEngine.position.set(2.5, -0.5, 0); // Raised from -1.2 to -0.5
		group.add(leftEngine);
		
		const rightEngine = new THREE.Mesh(engineGeometry, engineMaterial);
		rightEngine.rotation.x = Math.PI / 2;
		rightEngine.position.set(-2.5, -0.5, 0); // Raised from -1.2 to -0.5
		group.add(rightEngine);
		
		// Horizontal stabilizer (tail wings)
		const tailWingGeometry = new THREE.BoxGeometry(3, 0.15, 1.5);
		const tailWings = new THREE.Mesh(tailWingGeometry, wingMaterial);
		tailWings.position.z = -5;
		tailWings.position.y = 0.5;
		group.add(tailWings);
		
		// Vertical stabilizer
		const verticalGeometry = new THREE.BoxGeometry(2, 3, 0.2);
		const vertical = new THREE.Mesh(verticalGeometry, wingMaterial);
		vertical.position.z = -5.5;
		vertical.position.y = 1.5;
		group.add(vertical);
		
		// Cockpit windows
		const windowGeometry = new THREE.SphereGeometry(0.3, 8, 6);
		const windowMaterial = new THREE.MeshLambertMaterial({ color: 0x000044 });
		const cockpitWindow = new THREE.Mesh(windowGeometry, windowMaterial);
		cockpitWindow.position.set(0, 0.3, 5.5);
		cockpitWindow.scale.set(2, 0.8, 1);
		group.add(cockpitWindow);
		
		// Landing gear (simplified)
		const gearGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 6);
		const gearMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
		
		const noseGear = new THREE.Mesh(gearGeometry, gearMaterial);
		noseGear.position.set(0, -1.3, 4);
		group.add(noseGear);
		
		const leftGear = new THREE.Mesh(gearGeometry, gearMaterial);
		leftGear.position.set(1.5, -1.3, -1);
		group.add(leftGear);
		
		const rightGear = new THREE.Mesh(gearGeometry, gearMaterial);
		rightGear.position.set(-1.5, -1.3, -1);
		group.add(rightGear);
		
		// Store references to destructible parts
		group.destructibleParts = {
			wings: group.children.find(child => child.geometry && child.geometry.parameters && child.geometry.parameters.width === 8),
			leftWinglet: group.children.find(child => child.position.x === 4),
			rightWinglet: group.children.find(child => child.position.x === -4),
			leftEngine: group.children.find(child => child.position.x === 2.5 && child.material.color.getHex() === 0x333333),
			rightEngine: group.children.find(child => child.position.x === -2.5 && child.material.color.getHex() === 0x333333),
			tailWings: group.children.find(child => child.position.z === -5),
			vertical: group.children.find(child => child.position.z === -5.5),
			intact: true
		};
		
		// Damage check function with physical part separation
		group.checkDamage = function(planePosition, planeQuaternion, velocity, scene, physics) {
			if (!this.destructibleParts.intact) return;
			
			const groundLevel = 2.0;
			const minDamageSpeed = 35; // Much higher minimum speed to cause damage
			const speed = velocity.length();
			
			// Only check for damage when actually hitting ground at high speed
			const actuallyOnGround = planePosition.y <= groundLevel + 0.1; // Very close to ground
			const crashLanding = actuallyOnGround && speed > 40; // High speed ground impact
			
			if (crashLanding) {
				// Calculate which parts hit ground based on plane orientation
				const worldUp = new THREE.Vector3(0, 1, 0);
				const planeUp = new THREE.Vector3(0, 1, 0).applyQuaternion(planeQuaternion);
				const planeForward = new THREE.Vector3(0, 0, 1).applyQuaternion(planeQuaternion);
				const planeRight = new THREE.Vector3(1, 0, 0).applyQuaternion(planeQuaternion);
				
				const upDot = planeUp.dot(worldUp);
				const rollAngle = Math.abs(Math.atan2(planeRight.y, Math.sqrt(planeRight.x * planeRight.x + planeRight.z * planeRight.z)));
				const pitchAngle = Math.abs(Math.atan2(planeForward.y, Math.sqrt(planeForward.x * planeForward.x + planeForward.z * planeForward.z)));
				
				// Much more restrictive damage thresholds - only for severe crashes
				if ((rollAngle > 0.7 || speed > 60) && this.destructibleParts.wings) { // ~40 degrees roll or very high speed
					this.createFallingPart(this.destructibleParts.wings, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.wings);
					this.destructibleParts.wings = null;
					console.log('Wings destroyed!');
				}
				
				// Damage winglets only on severe roll
				if (rollAngle > 0.6 && this.destructibleParts.leftWinglet) { // ~35 degrees
					this.createFallingPart(this.destructibleParts.leftWinglet, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.leftWinglet);
					this.destructibleParts.leftWinglet = null;
				}
				if (rollAngle > 0.6 && this.destructibleParts.rightWinglet) {
					this.createFallingPart(this.destructibleParts.rightWinglet, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.rightWinglet);
					this.destructibleParts.rightWinglet = null;
				}
				
				// Damage engines only on very severe impact
				if ((rollAngle > 0.8 || speed > 65) && this.destructibleParts.leftEngine) { // ~45 degrees roll
					this.createFallingPart(this.destructibleParts.leftEngine, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.leftEngine);
					this.destructibleParts.leftEngine = null;
					console.log('Left engine destroyed!');
				}
				if ((rollAngle > 0.8 || speed > 65) && this.destructibleParts.rightEngine) {
					this.createFallingPart(this.destructibleParts.rightEngine, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.rightEngine);
					this.destructibleParts.rightEngine = null;
					console.log('Right engine destroyed!');
				}
				
				// Damage tail only on severe nose-down crash
				if ((pitchAngle > 0.8 || speed > 70) && this.destructibleParts.tailWings) { // ~45 degrees pitch
					this.createFallingPart(this.destructibleParts.tailWings, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.tailWings);
					this.destructibleParts.tailWings = null;
					console.log('Tail wings destroyed!');
				}
				if ((pitchAngle > 1.0 || speed > 75) && this.destructibleParts.vertical) { // ~57 degrees pitch
					this.createFallingPart(this.destructibleParts.vertical, scene, physics, velocity, planePosition, planeQuaternion);
					this.remove(this.destructibleParts.vertical);
					this.destructibleParts.vertical = null;
					console.log('Vertical stabilizer destroyed!');
				}
				
				if (speed > 80) { // Only mark as severely damaged at very high crash speeds
					this.destructibleParts.intact = false;
					console.log('Aircraft severely damaged!');
				}
			}
		};
		
		// Create falling part with physics
		group.createFallingPart = function(part, scene, physics, velocity, planePosition, planeQuaternion) {
			if (!part || !physics.initialized) return;
			
			// Clone the part's geometry and material
			const fallingPart = part.clone();
			
			// Get world position and rotation of the part
			const worldPos = new THREE.Vector3();
			const worldRot = new THREE.Quaternion();
			part.getWorldPosition(worldPos);
			part.getWorldQuaternion(worldRot);
			
			// Set position relative to world
			fallingPart.position.copy(worldPos);
			fallingPart.quaternion.copy(worldRot);
			
			// Add to scene as independent object
			scene.add(fallingPart);
			
			// Create dynamic rigid body for the falling part
			const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
				.setTranslation(worldPos.x, worldPos.y, worldPos.z)
				.setRotation({ x: worldRot.x, y: worldRot.y, z: worldRot.z, w: worldRot.w });
			
			const rigidBody = physics.world.createRigidBody(rigidBodyDesc);
			
			// Create appropriate collider based on part geometry
			let colliderDesc;
			if (part.geometry.type === 'BoxGeometry') {
				const params = part.geometry.parameters;
				colliderDesc = RAPIER.ColliderDesc.cuboid(
					params.width / 2, 
					params.height / 2, 
					params.depth / 2
				);
			} else if (part.geometry.type === 'CylinderGeometry') {
				const params = part.geometry.parameters;
				colliderDesc = RAPIER.ColliderDesc.cylinder(
					params.height / 2,
					params.radiusTop
				);
			} else {
				// Default box collider
				colliderDesc = RAPIER.ColliderDesc.cuboid(1, 0.5, 1);
			}
			
			// Set material properties for realistic bouncing
			colliderDesc.setRestitution(0.3);
			colliderDesc.setFriction(0.7);
			
			const collider = physics.world.createCollider(colliderDesc, rigidBody);
			
			// Apply initial velocity from plane crash - much gentler
			const initialVel = velocity.clone().multiplyScalar(0.3); // Inherit less plane velocity
			initialVel.add(new THREE.Vector3(
				(Math.random() - 0.5) * 5,  // Much smaller random horizontal velocity
				Math.random() * 3 + 1,      // Smaller upward velocity
				(Math.random() - 0.5) * 5   // Much smaller random horizontal velocity
			));
			
			rigidBody.setLinvel(initialVel, true);
			rigidBody.setAngvel({
				x: (Math.random() - 0.5) * 3, // Reduced angular velocity
				y: (Math.random() - 0.5) * 3, 
				z: (Math.random() - 0.5) * 3
			}, true);
			
			// Store reference for physics updates
			physics.fallingParts = physics.fallingParts || [];
			physics.fallingParts.push({
				mesh: fallingPart,
				body: rigidBody
			});
		};
		
		return group;
	}

	// Create Environment with Runway
	function createEnvironment(scene) {
		// Main ground (expanded)
		const groundGeometry = new THREE.PlaneGeometry(800, 600);
		const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 });
		const ground = new THREE.Mesh(groundGeometry, groundMaterial);
		ground.rotation.x = -Math.PI / 2;
		ground.position.y = -1;
		scene.add(ground);

		// Runway (much bigger and longer)
		const runwayGeometry = new THREE.PlaneGeometry(400, 40);
		const runwayMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 });
		const runway = new THREE.Mesh(runwayGeometry, runwayMaterial);
		runway.rotation.x = -Math.PI / 2;
		runway.position.y = -0.98;
		runway.position.z = 0;
		scene.add(runway);

		// Runway center line (longer)
		const centerLineGeometry = new THREE.PlaneGeometry(380, 2);
		const centerLineMaterial = new THREE.MeshLambertMaterial({ color: 0xffff00 });
		const centerLine = new THREE.Mesh(centerLineGeometry, centerLineMaterial);
		centerLine.rotation.x = -Math.PI / 2;
		centerLine.position.y = -0.97;
		centerLine.position.z = 0;
		scene.add(centerLine);

		// Runway edge lines (longer and positioned for wider runway)
		const edgeLineGeometry = new THREE.PlaneGeometry(380, 1);
		const edgeLineMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		
		const leftEdge = new THREE.Mesh(edgeLineGeometry, edgeLineMaterial);
		leftEdge.rotation.x = -Math.PI / 2;
		leftEdge.position.set(0, -0.97, 19);
		scene.add(leftEdge);
		
		const rightEdge = new THREE.Mesh(edgeLineGeometry, edgeLineMaterial);
		rightEdge.rotation.x = -Math.PI / 2;
		rightEdge.position.set(0, -0.97, -19);
		scene.add(rightEdge);

		// Runway numbers (positioned for longer runway)
		const numberGeometry = new THREE.PlaneGeometry(6, 12);
		const numberMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
		
		const number09 = new THREE.Mesh(numberGeometry, numberMaterial);
		number09.rotation.x = -Math.PI / 2;
		number09.position.set(170, -0.96, -8);
		scene.add(number09);
		
		const number27 = new THREE.Mesh(numberGeometry, numberMaterial);
		number27.rotation.x = -Math.PI / 2;
		number27.rotation.z = Math.PI;
		number27.position.set(-170, -0.96, 8);
		scene.add(number27);

		// Terminal building
		const terminalGeometry = new THREE.BoxGeometry(40, 15, 20);
		const terminalMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc });
		const terminal = new THREE.Mesh(terminalGeometry, terminalMaterial);
		terminal.position.set(-50, 7.5, 40);
		scene.add(terminal);

		// Control tower
		const towerBaseGeometry = new THREE.BoxGeometry(8, 25, 8);
		const towerBase = new THREE.Mesh(towerBaseGeometry, terminalMaterial);
		towerBase.position.set(-30, 12.5, 60);
		scene.add(towerBase);
		
		const towerTopGeometry = new THREE.BoxGeometry(10, 4, 10);
		const towerTop = new THREE.Mesh(towerTopGeometry, new THREE.MeshLambertMaterial({ color: 0x666666 }));
		towerTop.position.set(-30, 27, 60);
		scene.add(towerTop);

		// Some hangars
		const hangarGeometry = new THREE.BoxGeometry(25, 12, 30);
		const hangarMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 });
		
		const hangar1 = new THREE.Mesh(hangarGeometry, hangarMaterial);
		hangar1.position.set(40, 6, 40);
		scene.add(hangar1);
		
		const hangar2 = new THREE.Mesh(hangarGeometry, hangarMaterial);
		hangar2.position.set(70, 6, 40);
		scene.add(hangar2);

		// Distant buildings
		const buildingMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
		for (let i = 0; i < 8; i++) {
			const height = Math.random() * 15 + 10;
			const width = Math.random() * 8 + 5;
			const depth = Math.random() * 8 + 5;
			const buildingGeometry = new THREE.BoxGeometry(width, height, depth);
			const building = new THREE.Mesh(buildingGeometry, buildingMaterial);
			
			// Position buildings away from runway
			let x, z;
			do {
				x = (Math.random() - 0.5) * 300;
				z = (Math.random() - 0.5) * 300;
			} while (Math.abs(z) < 50 && Math.abs(x) < 120); // Keep clear of runway area
			
			building.position.x = x;
			building.position.y = height / 2;
			building.position.z = z;
			scene.add(building);
		}

		// Sky
		const skyGeometry = new THREE.SphereGeometry(800, 32, 32);
		const skyMaterial = new THREE.MeshBasicMaterial({ color: 0x87CEEB, side: THREE.BackSide });
		const sky = new THREE.Mesh(skyGeometry, skyMaterial);
		scene.add(sky);

		// Lighting
		const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
		scene.add(ambientLight);
		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(100, 100, 50);
		directionalLight.castShadow = true;
		scene.add(directionalLight);
	}

	onMount(async () => {
		if (!canvas) return;

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);

		const physics = new PhysicsWorld();
		await physics.init();

		const planeGeometry = createPlaneGeometry();
		scene.add(planeGeometry);
		
		// Start at runway end, facing down the runway 
		// Runway runs along X-axis, plane geometry is built along Z-axis
		// Need 90 degrees to align with runway + 180 degrees to face correct direction = 270 degrees total
		const initialRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
		physics.createPlane({ x: 150, y: 2, z: 0 }, { x: initialRotation.x, y: initialRotation.y, z: initialRotation.z, w: initialRotation.w });
		physics.createGround();
		createEnvironment(scene);

		const controls = new FlightControls();
		const flightCamera = new FlightCamera(camera);
		const trajectoryTracker = new TrajectoryTracker(scene);

		let lastTime = 0;
		const planeQuaternion = new THREE.Quaternion();
		const planePosition = new THREE.Vector3();

		function animate(currentTime) {
			const deltaTime = (currentTime - lastTime) / 1000;
			lastTime = currentTime;

			if (deltaTime > 0 && deltaTime < 0.1) {
				const transform = physics.getPlaneTransform();
				if (transform) {
					planePosition.set(transform.position.x, transform.position.y, transform.position.z);
					planeQuaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
					planeGeometry.position.copy(planePosition);
					planeGeometry.quaternion.copy(planeQuaternion);
				}

				const controlInputs = controls.update(deltaTime, planePosition, planeQuaternion);
				
				// Track trajectory with prediction (after controlInputs is defined)
				if (transform) {
					trajectoryTracker.addPosition(planePosition, controlInputs.velocity, controls);
					
					// Check for damage on collision
					planeGeometry.checkDamage(planePosition, planeQuaternion, controlInputs.velocity, scene, physics);
				}
				physics.updatePlane(controlInputs.velocity, controlInputs.angularVelocity, deltaTime);
				physics.step();
				flightCamera.update(planePosition, planeQuaternion);

				// Update UI values
				altitude = Math.max(0, planePosition.y - 2); // Ground level offset
				speed = Math.round(controlInputs.airspeed * 3.6); // Convert to km/h
				throttle = Math.round(controlInputs.throttle * 100);
				onGround = controlInputs.onGround;
				gearDown = controlInputs.gearDown;
			}

			renderer.render(scene, camera);
			if (gameRunning) requestAnimationFrame(animate);
		}

		function handleResize() {
			camera.aspect = window.innerWidth / window.innerHeight;
			camera.updateProjectionMatrix();
			renderer.setSize(window.innerWidth, window.innerHeight);
		}

		// Add trajectory toggle
		function handleKeyDown(e) {
			if (e.code === 'KeyT') {
				trajectoryTracker.toggle();
			}
		}

		window.addEventListener('resize', handleResize);
		window.addEventListener('keydown', handleKeyDown);
		gameRunning = true;
		requestAnimationFrame(animate);

		return () => {
			gameRunning = false;
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('keydown', handleKeyDown);
		};
	});
</script>

<main>
	<canvas bind:this={canvas}></canvas>
	
	<div class="hud">
		<div class="hud-item">
			<span class="label">ALT:</span>
			<span class="value">{altitude.toFixed(0)}m</span>
		</div>
		<div class="hud-item">
			<span class="label">SPD:</span>
			<span class="value">{speed} km/h</span>
		</div>
		<div class="hud-item">
			<span class="label">THR:</span>
			<span class="value">{throttle}%</span>
		</div>
		<div class="hud-item">
			<span class="label">GEAR:</span>
			<span class="value" class:warning={!gearDown}>{gearDown ? 'DOWN' : 'UP'}</span>
		</div>
		<div class="hud-item">
			<span class="label">STATUS:</span>
			<span class="value" class:ground={onGround}>{onGround ? 'GROUND' : 'AIRBORNE'}</span>
		</div>
	</div>

	<div class="controls">
		<p><strong>Flight Controls:</strong></p>
		<p>W/S, Up/Down - Pitch</p>
		<p>A/D - Ground Steering / Air Roll</p>
		<p>Q/E - Yaw (reduced power)</p>
		<p>Left/Right - Air Roll Only</p>
		<p>Shift - Full Throttle</p>
		<p>Space - Afterburner</p>
		<p>Ctrl - Idle Throttle</p>
		<p>G - Toggle Landing Gear</p>
		<p>T - Toggle Trajectory Lines (red=history, yellow=prediction)</p>
		<p></p>
		<p><strong>Takeoff:</strong> Full throttle, 180+ km/h, pull up</p>
		<p><strong>Landing:</strong> Gear down, &lt;110 km/h approach</p>
	</div>
</main>

<style>
	:global(html), :global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		background: #000;
		font-family: system-ui, sans-serif;
	}

	main {
		position: relative;
		width: 100vw;
		height: 100vh;
		overflow: hidden;
		background: #000;
	}

	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.hud {
		position: absolute;
		top: 20px;
		left: 20px;
		color: #00ff00;
		font-family: 'Courier New', monospace;
		font-size: 18px;
		text-shadow: 0 0 10px #00ff00;
		z-index: 100;
	}

	.hud-item {
		margin-bottom: 10px;
	}

	.label {
		font-weight: bold;
		margin-right: 10px;
	}

	.value {
		color: #ffffff;
	}

	.value.warning {
		color: #ff6600;
		animation: blink 1s infinite;
	}

	.value.ground {
		color: #ffff00;
	}

	@keyframes blink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0.3; }
	}

	.controls {
		position: absolute;
		top: 20px;
		right: 20px;
		color: #00ff00;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		text-shadow: 0 0 5px #00ff00;
		background: rgba(0, 0, 0, 0.3);
		padding: 10px;
		border-radius: 5px;
	}

	.controls p {
		margin: 2px 0;
	}
</style>