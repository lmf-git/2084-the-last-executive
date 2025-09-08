<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import RAPIER from '@dimforge/rapier3d-compat';

	let canvas = $state();
	let scene, renderer, camera, world;
	let characterGroup;
	let characterParts = {};
	let characterBodies = {};
	let characterJoints = {};
	let mainCapsuleBody, mainCapsuleCollider;
	let ragdollMode = $state(false);
	let animationState = $state('idle');
	let animationTime = 0;
	let keys = $state({
		w: false,
		a: false,
		s: false,
		d: false,
		space: false,
		shift: false,
		ctrl: false,
		z: false,
		r: false
	});

	async function initPhysics() {
		await RAPIER.init();
		world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));
		return world;
	}

	function createCharacter() {
		characterGroup = new THREE.Group();
		characterGroup.position.set(0, 0, 0);
		scene.add(characterGroup);

		// Create character parts
		const headGeometry = new THREE.SphereGeometry(0.25, 8, 8);
		const bodyGeometry = new THREE.BoxGeometry(0.6, 0.8, 0.3);
		const upperArmGeometry = new THREE.CapsuleGeometry(0.08, 0.4, 4, 8);
		const lowerArmGeometry = new THREE.CapsuleGeometry(0.07, 0.35, 4, 8);
		const handGeometry = new THREE.SphereGeometry(0.08, 6, 6);
		const upperLegGeometry = new THREE.CapsuleGeometry(0.1, 0.45, 4, 8);
		const lowerLegGeometry = new THREE.CapsuleGeometry(0.09, 0.4, 4, 8);
		const footGeometry = new THREE.BoxGeometry(0.3, 0.15, 0.4);

		const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x4080ff });
		const skinMaterial = new THREE.MeshPhongMaterial({ color: 0xffdbac });
		const footMaterial = new THREE.MeshPhongMaterial({ color: 0x654321 });

		// Create body parts with physics bodies
		createBodyPart('head', headGeometry, skinMaterial, 0, 2.65, 0, 1.0, 'ball');
		createBodyPart('body', bodyGeometry, bodyMaterial, 0, 2, 0, 5.0, 'box');
		createBodyPart('upperArmL', upperArmGeometry, bodyMaterial, -0.5, 2.2, 0, 1.5, 'capsule');
		createBodyPart('upperArmR', upperArmGeometry, bodyMaterial, 0.5, 2.2, 0, 1.5, 'capsule');
		createBodyPart('lowerArmL', lowerArmGeometry, skinMaterial, -0.5, 1.7, 0, 1.0, 'capsule');
		createBodyPart('lowerArmR', lowerArmGeometry, skinMaterial, 0.5, 1.7, 0, 1.0, 'capsule');
		createBodyPart('handL', handGeometry, skinMaterial, -0.5, 1.4, 0, 0.5, 'ball');
		createBodyPart('handR', handGeometry, skinMaterial, 0.5, 1.4, 0, 0.5, 'ball');
		createBodyPart('upperLegL', upperLegGeometry, bodyMaterial, -0.2, 1.35, 0, 2.0, 'capsule');
		createBodyPart('upperLegR', upperLegGeometry, bodyMaterial, 0.2, 1.35, 0, 2.0, 'capsule');
		createBodyPart('lowerLegL', lowerLegGeometry, bodyMaterial, -0.2, 0.9, 0, 1.5, 'capsule');
		createBodyPart('lowerLegR', lowerLegGeometry, bodyMaterial, 0.2, 0.9, 0, 1.5, 'capsule');
		createBodyPart('footL', footGeometry, footMaterial, -0.2, 0.65, 0.1, 1.0, 'box');
		createBodyPart('footR', footGeometry, footMaterial, 0.2, 0.65, 0.1, 1.0, 'box');

		console.log('Character parts created:', Object.keys(characterParts));
		console.log('Character bodies created:', Object.keys(characterBodies));

		// Create main capsule collider for normal movement
		createMainCapsule();

		// Create joints between body parts
		createJoints();
		
		// Initially disable individual colliders
		disableRagdollColliders();
	}

	function createBodyPart(name, geometry, material, x, y, z, mass, shapeType) {
		// Create visual mesh
		characterParts[name] = new THREE.Mesh(geometry, material);
		characterParts[name].position.set(x, y, z);
		characterGroup.add(characterParts[name]);

		// Create physics body
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(x, y, z)
			.setLinearDamping(2.0)
			.setAngularDamping(3.0);
		characterBodies[name] = world.createRigidBody(bodyDesc);

		// Create collider based on shape type
		let colliderDesc;
		switch(shapeType) {
			case 'ball':
				const radius = geometry.parameters.radius;
				colliderDesc = RAPIER.ColliderDesc.ball(radius);
				break;
			case 'box':
				const width = geometry.parameters.width / 2;
				const height = geometry.parameters.height / 2;
				const depth = geometry.parameters.depth / 2;
				colliderDesc = RAPIER.ColliderDesc.cuboid(width, height, depth);
				break;
			case 'capsule':
				const capRadius = geometry.parameters.radiusTop;
				const capHeight = geometry.parameters.height / 2;
				colliderDesc = RAPIER.ColliderDesc.capsule(capHeight, capRadius);
				break;
		}
		
		colliderDesc.setMass(mass)
			.setFriction(0.7)
			.setRestitution(0.3);
		const collider = world.createCollider(colliderDesc, characterBodies[name]);
		
		// Store collider reference for enabling/disabling
		characterBodies[name].collider = collider;
	}

	function createJoints() {
		// Head to body - ball joint (neck)
		createBallJoint('head', 'body', 0, -0.25, 0, 0, 0.4, 0, Math.PI/6);

		// Arms - ball joints (shoulders)
		createBallJoint('upperArmL', 'body', 0, 0.25, 0, -0.3, 0.2, 0, Math.PI/3);
		createBallJoint('upperArmR', 'body', 0, 0.25, 0, 0.3, 0.2, 0, Math.PI/3);

		// Forearms - hinge joints (elbows)
		createHingeJoint('lowerArmL', 'upperArmL', 0, -0.25, 0, 0, 0.25, 0, 0, Math.PI*0.8);
		createHingeJoint('lowerArmR', 'upperArmR', 0, -0.25, 0, 0, 0.25, 0, 0, Math.PI*0.8);

		// Hands - ball joints (wrists)
		createBallJoint('handL', 'lowerArmL', 0, -0.15, 0, 0, -0.175, 0, Math.PI/4);
		createBallJoint('handR', 'lowerArmR', 0, -0.15, 0, 0, -0.175, 0, Math.PI/4);

		// Legs - ball joints (hips)
		createBallJoint('upperLegL', 'body', 0, -0.225, 0, -0.2, -0.4, 0, Math.PI/2);
		createBallJoint('upperLegR', 'body', 0, -0.225, 0, 0.2, -0.4, 0, Math.PI/2);

		// Lower legs - hinge joints (knees)
		createHingeJoint('lowerLegL', 'upperLegL', 0, -0.225, 0, 0, -0.225, 0, 0, Math.PI*0.8);
		createHingeJoint('lowerLegR', 'upperLegR', 0, -0.225, 0, 0, -0.225, 0, 0, Math.PI*0.8);

		// Feet - hinge joints (ankles)
		createHingeJoint('footL', 'lowerLegL', 0, -0.2, 0.1, 0, -0.2, 0, Math.PI/4, Math.PI/4);
		createHingeJoint('footR', 'lowerLegR', 0, -0.2, 0.1, 0, -0.2, 0, Math.PI/4, Math.PI/4);
	}

	function createBallJoint(childName, parentName, childAnchorX, childAnchorY, childAnchorZ, parentAnchorX, parentAnchorY, parentAnchorZ, maxAngle) {
		try {
			const childBody = characterBodies[childName];
			const parentBody = characterBodies[parentName];
			
			if (!childBody || !parentBody) {
				console.error(`Bodies not found for joint: ${childName}, ${parentName}`);
				return;
			}

			// Use prismatic joint with very tight limits to create stable connection
			const anchor1 = new RAPIER.Vector3(childAnchorX, childAnchorY, childAnchorZ);
			const anchor2 = new RAPIER.Vector3(parentAnchorX, parentAnchorY, parentAnchorZ);
			const axis = new RAPIER.Vector3(0, 1, 0); // Y-axis
			
			const jointDesc = RAPIER.JointDesc.prismatic(anchor1, anchor2, axis);
			jointDesc.limitsEnabled = true;
			jointDesc.limits = [-0.01, 0.01]; // Very tight limits
			
			const joint = world.createImpulseJoint(jointDesc, childBody, parentBody, true);
			characterJoints[`${childName}_${parentName}`] = joint;
			console.log(`Created stable joint between ${childName} and ${parentName}`);
		} catch (error) {
			console.error(`Failed to create ball joint between ${childName} and ${parentName}:`, error);
			
			// Fallback: try to create a simple attachment by modifying physics properties
			try {
				const childBody = characterBodies[childName];
				const parentBody = characterBodies[parentName];
				
				// Increase damping to reduce wild movement
				childBody.setLinearDamping(5.0);
				childBody.setAngularDamping(5.0);
				parentBody.setLinearDamping(5.0);
				parentBody.setAngularDamping(5.0);
			} catch (fallbackError) {
				console.error('Fallback damping also failed:', fallbackError);
			}
		}
	}

	function createHingeJoint(childName, parentName, childAnchorX, childAnchorY, childAnchorZ, parentAnchorX, parentAnchorY, parentAnchorZ, minAngle, maxAngle) {
		// Use same stable connection for now
		createBallJoint(childName, parentName, childAnchorX, childAnchorY, childAnchorZ, parentAnchorX, parentAnchorY, parentAnchorZ, maxAngle);
	}

	function createMainCapsule() {
		// Create main capsule body for character controller
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(0, 2, 0)
			.lockRotations()
			.setLinearDamping(2.0);
		mainCapsuleBody = world.createRigidBody(bodyDesc);

		const colliderDesc = RAPIER.ColliderDesc.capsule(0.75, 0.5)
			.setFriction(0.8)
			.setRestitution(0.1);
		mainCapsuleCollider = world.createCollider(colliderDesc, mainCapsuleBody);
	}

	function disableRagdollColliders() {
		// Disable individual body part colliders
		Object.values(characterBodies).forEach(body => {
			if (body.collider) {
				body.collider.setEnabled(false);
			}
		});
	}

	function enableRagdollColliders() {
		// Enable individual body part colliders
		Object.values(characterBodies).forEach(body => {
			if (body.collider) {
				body.collider.setEnabled(true);
			}
		});
	}

	function updateAnimation(deltaTime) {
		if (!characterGroup || !characterParts) return;
		
		animationTime += deltaTime;
		
		if (ragdollMode) {
			// In ragdoll mode, just sync meshes to physics
			syncMeshesToBodies();
		} else {
			// In normal mode, animate based on movement and sync to capsule
			animateCharacterMovement();
		}
	}

	function animateCharacterMovement() {
		if (!mainCapsuleBody) return;

		// Position character group at capsule location
		const capsulePos = mainCapsuleBody.translation();
		characterGroup.position.copy(capsulePos);

		// Apply walking/running animations
		const isMoving = keys.w || keys.s || keys.a || keys.d;
		const isRunning = keys.shift && isMoving;
		
		if (isMoving) {
			const speed = isRunning ? 8 : 5;
			const time = animationTime * speed;
			
			// Animate arms swinging opposite to each other
			characterParts.upperArmL.rotation.x = Math.sin(time) * 0.6;
			characterParts.upperArmR.rotation.x = -Math.sin(time) * 0.6;
			characterParts.lowerArmL.rotation.x = Math.sin(time + Math.PI/4) * 0.4;
			characterParts.lowerArmR.rotation.x = -Math.sin(time + Math.PI/4) * 0.4;
			
			// Animate legs swinging opposite to arms
			characterParts.upperLegL.rotation.x = -Math.sin(time) * 0.8;
			characterParts.upperLegR.rotation.x = Math.sin(time) * 0.8;
			characterParts.lowerLegL.rotation.x = Math.max(0, Math.sin(time + Math.PI/2) * 1.0);
			characterParts.lowerLegR.rotation.x = Math.max(0, -Math.sin(time + Math.PI/2) * 1.0);
			
			// Body bobbing
			const bobIntensity = isRunning ? 0.08 : 0.04;
			characterParts.body.position.y = Math.sin(time * 2) * bobIntensity;
			characterParts.head.position.y = 0.65 + Math.sin(time * 2) * bobIntensity;
			
		} else {
			// Idle animation - reset limbs and gentle breathing
			Object.values(characterParts).forEach(part => {
				part.rotation.set(0, 0, 0);
			});
			
			// Gentle breathing
			const breathe = Math.sin(animationTime * 2) * 0.02;
			characterParts.body.scale.y = 1 + breathe;
			characterParts.head.position.y = 0.65 + breathe * 0.3;
		}
	}

	function animateConstrainedRagdoll() {
		if (ragdollMode) return;

		// Apply controlled forces to create animations
		const isMoving = keys.w || keys.s || keys.a || keys.d;
		
		if (isMoving) {
			// Apply walking forces to legs
			const walkTime = animationTime * 5;
			const legForce = 15;
			
			// Leg swinging forces
			characterBodies.upperLegL.addForce(new RAPIER.Vector3(0, 0, Math.sin(walkTime) * legForce), true);
			characterBodies.upperLegR.addForce(new RAPIER.Vector3(0, 0, -Math.sin(walkTime) * legForce), true);
			
			// Arm swinging forces
			const armForce = 8;
			characterBodies.upperArmL.addForce(new RAPIER.Vector3(0, 0, -Math.sin(walkTime) * armForce), true);
			characterBodies.upperArmR.addForce(new RAPIER.Vector3(0, 0, Math.sin(walkTime) * armForce), true);
		}
		
		// Keep torso upright
		const bodyRotation = characterBodies.body.rotation();
		const uprightTorque = 50;
		characterBodies.body.addTorque(new RAPIER.Vector3(-bodyRotation.x * uprightTorque, 0, -bodyRotation.z * uprightTorque), true);
		
		// Sync visual meshes to physics bodies
		syncMeshesToBodies();
	}

	function syncMeshesToBodies() {
		for (const [name, body] of Object.entries(characterBodies)) {
			if (characterParts[name] && body) {
				const position = body.translation();
				const rotation = body.rotation();
				
				characterParts[name].position.copy(position);
				characterParts[name].quaternion.copy(rotation);
				
				// Make sure meshes are visible
				characterParts[name].visible = true;
			}
		}
	}

	function toggleRagdoll() {
		ragdollMode = !ragdollMode;
		
		if (ragdollMode) {
			// Switch to ragdoll mode
			mainCapsuleCollider.setEnabled(false);
			enableRagdollColliders();
			
			// Sync ragdoll bodies to current capsule position
			const capsulePos = mainCapsuleBody.translation();
			Object.entries(characterBodies).forEach(([name, body]) => {
				// Position ragdoll bodies relative to capsule
				const mesh = characterParts[name];
				if (mesh) {
					body.setTranslation(new RAPIER.Vector3(
						capsulePos.x + mesh.position.x,
						capsulePos.y + mesh.position.y - 2,
						capsulePos.z + mesh.position.z
					), true);
				}
			});
			
			// Apply random impulse to start ragdoll
			const impulseStrength = 10;
			const randomDirection = new RAPIER.Vector3(
				(Math.random() - 0.5) * impulseStrength,
				Math.random() * impulseStrength,
				(Math.random() - 0.5) * impulseStrength
			);
			characterBodies.body.applyImpulse(randomDirection, true);
		} else {
			// Switch back to capsule mode
			disableRagdollColliders();
			mainCapsuleCollider.setEnabled(true);
			
			// Position capsule at body location
			const bodyPos = characterBodies.body.translation();
			mainCapsuleBody.setTranslation(new RAPIER.Vector3(bodyPos.x, bodyPos.y, bodyPos.z), true);
			mainCapsuleBody.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
			mainCapsuleBody.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
			
			resetToStandingPose();
		}
	}

	function resetToStandingPose() {
		// Reset all bodies to upright positions
		characterBodies.body.setTranslation(new RAPIER.Vector3(0, 2, 0), true);
		characterBodies.body.setRotation(new RAPIER.Quaternion(0, 0, 0, 1), true);
		characterBodies.body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
		characterBodies.body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
		
		// Reset other body parts to approximate standing positions
		characterBodies.head.setTranslation(new RAPIER.Vector3(0, 2.65, 0), true);
		characterBodies.upperArmL.setTranslation(new RAPIER.Vector3(-0.5, 2.2, 0), true);
		characterBodies.upperArmR.setTranslation(new RAPIER.Vector3(0.5, 2.2, 0), true);
		characterBodies.upperLegL.setTranslation(new RAPIER.Vector3(-0.2, 1.35, 0), true);
		characterBodies.upperLegR.setTranslation(new RAPIER.Vector3(0.2, 1.35, 0), true);
		
		// Clear velocities
		Object.values(characterBodies).forEach(body => {
			body.setLinvel(new RAPIER.Vector3(0, 0, 0), true);
			body.setAngvel(new RAPIER.Vector3(0, 0, 0), true);
		});
	}

	function updateAnimationState() {
		const isMoving = keys.w || keys.s || keys.a || keys.d;
		const isRunning = keys.shift;
		const isCrouching = keys.ctrl;
		const isProne = keys.z;

		if (isProne) {
			animationState = 'prone';
		} else if (isCrouching) {
			animationState = 'crouch';
		} else if (isMoving && isRunning) {
			animationState = 'running';
		} else if (isMoving) {
			animationState = 'walking';
		} else {
			animationState = 'idle';
		}
	}

	function createGround() {
		const groundGeometry = new THREE.PlaneGeometry(20, 20);
		const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x404040 });
		const ground = new THREE.Mesh(groundGeometry, groundMaterial);
		ground.rotation.x = -Math.PI / 2;
		scene.add(ground);

		const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
			.setTranslation(0, 0, 0);
		const groundBody = world.createRigidBody(groundBodyDesc);

		const groundShape = RAPIER.ColliderDesc.cuboid(10, 0.1, 10)
			.setFriction(1.0)
			.setRestitution(0.1);
		world.createCollider(groundShape, groundBody);
	}

	function handleMovement() {
		if (ragdollMode) return;

		// Use capsule body for movement
		if (!mainCapsuleBody) return;

		const velocity = mainCapsuleBody.linvel();
		const impulse = new RAPIER.Vector3(0, 0, 0);
		let moveStrength = 5;
		let maxSpeed = 5;

		if (keys.shift && (keys.w || keys.s || keys.a || keys.d)) {
			moveStrength = 8;
			maxSpeed = 8;
		} else if (keys.ctrl) {
			moveStrength = 3;
			maxSpeed = 3;
		} else if (keys.z) {
			moveStrength = 2;
			maxSpeed = 2;
		}

		if (keys.w && velocity.z > -maxSpeed) impulse.z -= moveStrength;
		if (keys.s && velocity.z < maxSpeed) impulse.z += moveStrength;
		if (keys.a && velocity.x > -maxSpeed) impulse.x -= moveStrength;
		if (keys.d && velocity.x < maxSpeed) impulse.x += moveStrength;
		if (keys.space && !keys.z && Math.abs(velocity.y) < 0.1) impulse.y = 10;

		mainCapsuleBody.applyImpulse(impulse, true);
	}

	let lastTime = 0;
	function animate(currentTime) {
		if (!world || !characterGroup) return;

		const deltaTime = (currentTime - lastTime) / 1000;
		lastTime = currentTime;

		updateAnimationState();
		handleMovement();
		updateAnimation(deltaTime);
		
		world.step();

		// Camera follows either capsule or ragdoll body
		let followPosition;
		if (ragdollMode && characterBodies.body) {
			followPosition = characterBodies.body.translation();
		} else if (mainCapsuleBody) {
			followPosition = mainCapsuleBody.translation();
		} else {
			followPosition = { x: 0, y: 2, z: 0 };
		}
		
		camera.position.set(followPosition.x, followPosition.y + 4, followPosition.z + 6);
		camera.lookAt(followPosition.x, followPosition.y + 1, followPosition.z);

		renderer.render(scene, camera);
		requestAnimationFrame(animate);
	}

	function handleKeyDown(event) {
		switch(event.code) {
			case 'KeyW':
				keys.w = true;
				break;
			case 'KeyA':
				keys.a = true;
				break;
			case 'KeyS':
				keys.s = true;
				break;
			case 'KeyD':
				keys.d = true;
				break;
			case 'Space':
				keys.space = true;
				event.preventDefault();
				break;
			case 'ShiftLeft':
			case 'ShiftRight':
				keys.shift = true;
				break;
			case 'ControlLeft':
			case 'ControlRight':
				keys.ctrl = true;
				break;
			case 'KeyZ':
				keys.z = true;
				break;
			case 'KeyR':
				toggleRagdoll();
				break;
		}
	}

	function handleKeyUp(event) {
		switch(event.code) {
			case 'KeyW':
				keys.w = false;
				break;
			case 'KeyA':
				keys.a = false;
				break;
			case 'KeyS':
				keys.s = false;
				break;
			case 'KeyD':
				keys.d = false;
				break;
			case 'Space':
				keys.space = false;
				break;
			case 'ShiftLeft':
			case 'ShiftRight':
				keys.shift = false;
				break;
			case 'ControlLeft':
			case 'ControlRight':
				keys.ctrl = false;
				break;
			case 'KeyZ':
				keys.z = false;
				break;
		}
	}

	onMount(async () => {
		scene = new THREE.Scene();
		camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
		scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(10, 10, 5);
		directionalLight.castShadow = true;
		scene.add(directionalLight);

		await initPhysics();
		createGround();
		createCharacter();

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);

		animate();

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	});
</script>

<canvas bind:this={canvas} style="display: block; width: 100vw; height: 100vh;"></canvas>