<script>
	import { onMount } from 'svelte';
	import { PhysicsWorld } from '$lib/PhysicsWorld.js';
	import { Vehicle } from '$lib/Vehicle.js';
	import { Player } from '$lib/Player.js';
	import { Car } from '$lib/Car.js';
	import * as THREE from 'three';
	import RAPIER from '@dimforge/rapier3d-compat';

	let canvasContainer;
	let physicsWorld;
	let vehicle;
	let player;
	let car;
	let animationId;
	let lastTime = 0;
	let cameraMode = 'fps'; // 'fps' or 'third'
	let pointerLocked = false;
	
	// Input state
	let keys = {
		w: false,
		a: false,
		s: false,
		d: false,
		space: false,
		shift: false,
		arrowup: false,
		arrowdown: false,
		arrowleft: false,
		arrowright: false,
		o: false,
		e: false,
		b: false
	};
	
	// Input smoothing
	let inputSmooth = {
		w: 0,
		a: 0,
		s: 0,
		d: 0
	};
	
	// Debug info
	let lastVehicleImpulse = null;
	let vehicleImpulseTime = 0;
	
	// Car clamping state
	let carClamped = false;

	onMount(async () => {
		// Initialize physics world
		physicsWorld = PhysicsWorld.create();
		await PhysicsWorld.init(physicsWorld);
		
		// Add canvas to DOM
		canvasContainer.appendChild(PhysicsWorld.getDOMElement(physicsWorld));
		
		// Create vehicle
		vehicle = Vehicle.create(physicsWorld, new THREE.Vector3(0, 15, 0));
		
		// Create player (spawn away from vehicle)
		player = Player.create(physicsWorld, new THREE.Vector3(10, 3, 5));
		
		// Create car - spawn higher so it drops and settles properly
		car = Car.create(physicsWorld, new THREE.Vector3(15, 8, 0));
		
		// Set up initial camera (will be updated in animate loop)
		physicsWorld.camera.position.set(0, 8, 12);
		physicsWorld.camera.lookAt(0, 0, 0);
		
		// Set up input handlers
		setupInputHandlers();
		
		// Start animation loop
		animate();
		
		return () => {
			// Cleanup
			if (animationId) {
				cancelAnimationFrame(animationId);
			}
			PhysicsWorld.dispose(physicsWorld);
		};
	});

	function setupInputHandlers() {
		window.addEventListener('keydown', (event) => {
			let key = event.key.toLowerCase();
			// Handle special keys
			if (key === ' ') key = 'space';
			if (key in keys) {
				keys[key] = true;
			}
			// Removed Enter key vehicle entry - now purely physical entry
			if (key === 'e') {
				// Car entry/exit
				if (player.inCar) {
					// Exit car
					Player.exitCar(player);
					Car.exitCar(car);
					// Move player next to car
					const carPos = Car.getPosition(car);
					player.body.setTranslation(new RAPIER.Vector3(carPos.x + 3, carPos.y + 1, carPos.z));
				} else {
					// Try to enter car
					const playerPos = Player.getPosition(player);
					if (Car.isPlayerNearCar(car, playerPos)) {
						Player.enterCar(player, car);
						Car.enterCar(car, player);
					}
				}
			}
			if (key === 'escape') {
				if (pointerLocked) {
					// Exit pointer lock
					document.exitPointerLock();
				}
			}
			if (key === 'o') {
				// Toggle camera mode
				cameraMode = cameraMode === 'fps' ? 'third' : 'fps';
				console.log('Camera mode:', cameraMode);
			}
			if (key === 'b') {
				// Handle car clamping when B is pressed
				handleCarClamping();
			}
		});
		
		window.addEventListener('keyup', (event) => {
			let key = event.key.toLowerCase();
			// Handle special keys
			if (key === ' ') key = 'space';
			if (key in keys) {
				keys[key] = false;
			}
		});

		// Click to enter pointer lock
		canvasContainer.addEventListener('click', () => {
			if (!pointerLocked) {
				canvasContainer.requestPointerLock();
			}
		});

		// Pointer lock change events
		document.addEventListener('pointerlockchange', () => {
			pointerLocked = document.pointerLockElement === canvasContainer;
			console.log('Pointer lock:', pointerLocked);
		});

		// Mouse movement for looking
		document.addEventListener('mousemove', (event) => {
			if (pointerLocked && player) {
				const deltaX = event.movementX || 0;
				const deltaY = event.movementY || 0;
				Player.applyMouseLook(player, deltaX, deltaY);
			}
		});
	}

	function handleCarClamping() {
		if (!car || !vehicle) return;
		
		const carPos = Car.getPosition(car);
		const isCarInVehicle = Vehicle.isPositionInside(vehicle, carPos);
		
		if (isCarInVehicle && !carClamped) {
			// Clamp car to vehicle
			carClamped = true;
			car.clamped = true; // Mark car as clamped for rigid attachment
			// Clear any stored local position to recalculate
			delete car.localPosition;
			delete car.localRotation;
			console.log('Car clamped to vehicle');
		} else if (carClamped) {
			// Unclamp car from vehicle
			carClamped = false;
			car.clamped = false; // Mark car as unclamped for smooth following
			// Clear stored local position
			delete car.localPosition;
			delete car.localRotation;
			console.log('Car unclamped from vehicle');
		}
	}

	function processInput(deltaTime) {
		if (player.inCar) {
			// Super simple car controls
			const carRotation = Car.getRotation(car);
			
			// Forward/backward movement
			if (keys.w || keys.s) {
				const forward = new THREE.Vector3(0, 0, 1);
				forward.applyQuaternion(carRotation);
				
				const force = keys.w ? 1200 : -800; // Much stronger force for ramp climbing
				forward.multiplyScalar(force);
				
				Car.applyImpulse(car, forward);
			}
			
			// Simple turning
			if (keys.a || keys.d) {
				const turnForce = keys.a ? 0.02 : -0.02;
				
				const currentRot = Car.getRotation(car);
				const yawRot = new THREE.Quaternion();
				yawRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turnForce);
				
				const newRot = currentRot.clone().multiply(yawRot);
				if (car.body) {
					car.body.setRotation(new RAPIER.Quaternion(newRot.x, newRot.y, newRot.z, newRot.w), true);
				}
			}
		} else {
			// Player movement - direct key input (no smoothing for now)
			const playerDirection = new THREE.Vector3();
			
			if (keys.w) playerDirection.z -= 1;
			if (keys.s) playerDirection.z += 1;
			if (keys.a) playerDirection.x -= 1;
			if (keys.d) playerDirection.x += 1;
			
			// Always call applyMovement, even with zero direction for stopping
			Player.applyMovement(player, playerDirection, deltaTime);
			
			// Player jump
			if (keys.space) {
				Player.jump(player);
			}
		}
		
		// Vehicle movement (when player is in vehicle interior OR when player is in car that's in vehicle interior)
		const playerInVehicleInterior = vehicle && player && Vehicle.isPlayerInside(vehicle, Player.getPosition(player));
		const playerInCarInVehicleInterior = vehicle && car && player && player.inCar && Vehicle.isPositionInside(vehicle, Car.getPosition(car));
		
		if (playerInVehicleInterior || playerInCarInVehicleInterior) {
			if (keys.arrowup || keys.arrowdown || keys.arrowleft || keys.arrowright) {
				const vehicleImpulse = new THREE.Vector3();
				
				if (keys.arrowup) vehicleImpulse.z -= 1;
				if (keys.arrowdown) vehicleImpulse.z += 1;
				if (keys.arrowleft) vehicleImpulse.x -= 1;
				if (keys.arrowright) vehicleImpulse.x += 1;
				
				if (vehicleImpulse.length() > 0) {
					vehicleImpulse.normalize();
					vehicleImpulse.multiplyScalar(2000); // Much stronger impulse
					Vehicle.applyImpulse(vehicle, vehicleImpulse);
					
					// Debug info
					lastVehicleImpulse = vehicleImpulse.clone();
					vehicleImpulseTime = Date.now();
				}
			}
		}
	}

	function updateCamera() {
		if (player.inCar) {
			// Car camera
			const carPos = Car.getPosition(car);
			const carRotation = Car.getRotation(car);
			
			if (cameraMode === 'fps') {
				// First person car camera - inside car, facing forward (toward windshield)
				physicsWorld.camera.position.set(
					carPos.x,
					carPos.y + 1,
					carPos.z
				);
				
				// Look forward toward windshield (positive Z direction relative to car)
				const lookDirection = new THREE.Vector3(0, 0, 1);
				lookDirection.applyQuaternion(carRotation);
				const lookTarget = carPos.clone().add(lookDirection);
				physicsWorld.camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
			} else {
				// Third person car camera - behind car (negative Z direction)
				const cameraDistance = 8;
				const cameraHeight = 4;
				
				const cameraOffset = new THREE.Vector3(0, cameraHeight, -cameraDistance);
				cameraOffset.applyQuaternion(carRotation);
				
				physicsWorld.camera.position.set(
					carPos.x + cameraOffset.x,
					carPos.y + cameraOffset.y,
					carPos.z + cameraOffset.z
				);
				physicsWorld.camera.lookAt(carPos.x, carPos.y, carPos.z);
			}
		} else {
			// Player camera
			const playerPos = Player.getPosition(player);
			
			if (cameraMode === 'fps') {
				// First person camera - position at player's eye level
				const eyeLevel = 0.6;
				physicsWorld.camera.position.set(
					playerPos.x,
					playerPos.y + eyeLevel,
					playerPos.z
				);
				
				// Look in direction based on player's yaw and pitch
				const lookDirection = Player.getCameraLookDirection(player);
				const lookTarget = playerPos.clone().add(lookDirection);
				lookTarget.y += eyeLevel;
				physicsWorld.camera.lookAt(lookTarget.x, lookTarget.y, lookTarget.z);
				
				// Hide player mesh in FPS mode
				player.mesh.visible = false;
			} else {
				// Third person camera - position behind and above player, rotating with player
				const cameraDistance = 12;
				const cameraHeight = 8;
				
				// Get player's yaw rotation
				const playerRotation = Player.getRotation(player);
				const yawAngle = Math.atan2(2 * (playerRotation.w * playerRotation.y + playerRotation.x * playerRotation.z), 
					1 - 2 * (playerRotation.y * playerRotation.y + playerRotation.z * playerRotation.z));
				
				// Calculate camera position behind player
				const cameraX = playerPos.x + Math.sin(yawAngle) * cameraDistance;
				const cameraZ = playerPos.z + Math.cos(yawAngle) * cameraDistance;
				
				physicsWorld.camera.position.set(
					cameraX,
					playerPos.y + cameraHeight,
					cameraZ
				);
				physicsWorld.camera.lookAt(playerPos.x, playerPos.y + 2, playerPos.z);
				
				// Show player mesh in third person mode
				player.mesh.visible = true;
			}
		}
	}

	function animate(currentTime = 0) {
		const deltaTime = (currentTime - lastTime) / 1000;
		lastTime = currentTime;
		
		if (deltaTime < 0.1) {
			// Process input
			processInput(deltaTime);
			
			// Update physics
			PhysicsWorld.update(physicsWorld, deltaTime);
			
			// Update entities
			Player.update(player, deltaTime, vehicle);
			Vehicle.update(vehicle, deltaTime);
			Car.update(car);
			
			// Check if player enters/exits vehicle interior
			if (vehicle && player && !player.inCar) {
				const playerPos = Player.getPosition(player);
				const isInside = Vehicle.isPlayerInside(vehicle, playerPos);
				
				if (isInside && !vehicle.entitiesInside.has(player)) {
					Vehicle.addEntityInside(vehicle, player);
				} else if (!isInside && vehicle.entitiesInside.has(player)) {
					Vehicle.removeEntityInside(vehicle, player);
				}
			}
			
			// Check if car enters/exits vehicle interior
			if (vehicle && car) {
				const carPos = Car.getPosition(car);
				const isCarInside = Vehicle.isPositionInside(vehicle, carPos);
				
				if (isCarInside && !vehicle.entitiesInside.has(car)) {
					Vehicle.addEntityInside(vehicle, car);
					console.log('Car entered vehicle interior');
				} else if (!isCarInside && vehicle.entitiesInside.has(car)) {
					Vehicle.removeEntityInside(vehicle, car);
					console.log('Car left vehicle interior');
				}
			}
			
			// Update camera based on mode
			updateCamera();
			
			// Render
			PhysicsWorld.render(physicsWorld);
		}
		
		animationId = requestAnimationFrame(animate);
	}
</script>

<div class="game-container">
	<div bind:this={canvasContainer} class="canvas-container"></div>
	
	<div class="controls">
		<div class="controls-section">
			<h3>Player Controls</h3>
			<p>WASD - Move player</p>
			<p>Mouse - Look around</p>
			<p>Space - Jump</p>
			<p>Click - Enter pointer lock</p>
			<p>O - Toggle camera (FPS/Third person)</p>
			<p>Jump into vehicle interior to enter</p>
			<p>E - Enter/Exit car (when near)</p>
			<p>Escape - Exit vehicle/pointer lock</p>
		</div>
		
		<div class="controls-section">
			<h3>Vehicle Controls</h3>
			<p>Arrow Keys - Move vehicle (when inside interior)</p>
			<p>Must be detected in vehicle interior to control</p>
		</div>
		
		<div class="controls-section">
			<h3>Car Controls</h3>
			<p>WASD - Drive car (when inside car)</p>
			<p>B - Clamp/Unclamp car to vehicle (when car is inside)</p>
			<p>Camera follows car when driving</p>
		</div>
		
		<div class="status">
			<h3>Status</h3>
			<p>Camera mode: {cameraMode.toUpperCase()}</p>
			<p>Pointer lock: {pointerLocked ? 'Yes' : 'No'}</p>
			<p>Player in car: {player?.inCar ? 'Yes' : 'No'}</p>
			<p>Player in vehicle interior: {vehicle && player && Vehicle.isPlayerInside(vehicle, Player.getPosition(player)) ? 'Yes' : 'No'}</p>
			<p>Car in vehicle interior: {vehicle && car && Vehicle.isPositionInside(vehicle, Car.getPosition(car)) ? 'Yes' : 'No'}</p>
			<p>Car clamped to vehicle: {carClamped ? 'Yes' : 'No'}</p>
			{#if player}
				<p>Player position: {Player.getPosition(player).x.toFixed(1)}, {Player.getPosition(player).y.toFixed(1)}, {Player.getPosition(player).z.toFixed(1)}</p>
			{/if}
			{#if vehicle && player}
				<p>Local position: {Vehicle.worldToLocal(vehicle, Player.getPosition(player)).x.toFixed(1)}, {Vehicle.worldToLocal(vehicle, Player.getPosition(player)).y.toFixed(1)}, {Vehicle.worldToLocal(vehicle, Player.getPosition(player)).z.toFixed(1)}</p>
			{/if}
			{#if lastVehicleImpulse && (Date.now() - vehicleImpulseTime) < 1000}
				<p style="color: #ffff00;">Vehicle impulse: {lastVehicleImpulse.x.toFixed(1)}, {lastVehicleImpulse.y.toFixed(1)}, {lastVehicleImpulse.z.toFixed(1)}</p>
			{/if}
			{#if vehicle && player && Vehicle.isPlayerInside(vehicle, Player.getPosition(player))}
				<p style="color: #00ff00;">Arrow keys control vehicle!</p>
				<p>Vehicle velocity: {Vehicle.getVelocity(vehicle).x.toFixed(1)}, {Vehicle.getVelocity(vehicle).y.toFixed(1)}, {Vehicle.getVelocity(vehicle).z.toFixed(1)}</p>
			{/if}
		</div>
	</div>
</div>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
		position: fixed;
		width: 100%;
		height: 100%;
	}
	
	.game-container {
		position: fixed;
		top: 0;
		left: 0;
		width: 100vw;
		height: 100vh;
		height: 100dvh; /* Safari dynamic viewport height */
		overflow: hidden;
		background: #87CEEB; /* Match renderer clear color */
	}
	
	.canvas-container {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: #87CEEB; /* Match renderer clear color */
	}
	
	.canvas-container canvas {
		position: absolute;
		top: 0;
		left: 0;
		width: 100% !important;
		height: 100% !important;
	}
	
	.controls {
		position: absolute;
		top: 20px;
		left: 20px;
		background: rgba(0, 0, 0, 0.8);
		color: white;
		padding: 20px;
		border-radius: 10px;
		font-family: Arial, sans-serif;
		font-size: 14px;
		max-width: 300px;
	}
	
	.controls-section {
		margin-bottom: 20px;
	}
	
	.controls-section h3 {
		margin: 0 0 10px 0;
		color: #ffff00;
	}
	
	.controls-section p {
		margin: 5px 0;
	}
	
	.status {
		border-top: 1px solid #444;
		padding-top: 15px;
	}
</style>