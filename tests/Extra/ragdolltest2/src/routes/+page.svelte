<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import { GLTFLoader } from 'three-stdlib';
	import { OrbitControls } from 'three-stdlib';
	import RAPIER from '@dimforge/rapier3d-compat';
	
	let canvas;
	let scene, camera, renderer, world, controls;
	let model, mixer, animations;
	let ragdollBodies = [];
	let ragdollConstraints = [];
	let skeletonBones = [];
	let debugMeshes = [];
	let originalBonePoses = new Map(); // Store original bone poses for spring back
	
	// Control states
	let isRagdoll = $state(false);
	let isAnimating = $state(true);
	let animationWeight = $state(1.0);
	let physicsWeight = $state(0.0);
	let showDebug = $state(true);
	let springStiffness = $state(0.3);
	let springDamping = $state(0.8);
	let colliderScale = $state(1.0);
	
	// Humanoid bone mapping - matched to your exact bone names
	const humanoidBoneNames = {
		// Torso - using your exact bone names
		spine: ['torso'],
		chest: ['torso'], // Will use torso for both spine and chest
		neck: ['neck'], // Note: Neck has no Col_ mesh, will use box collider
		head: ['head'],
		
		// Arms - Left (using your exact names)
		leftUpperArm: ['upperarm_left'],
		leftLowerArm: ['lowerarm_left'], 
		
		// Arms - Right (using your exact names)
		rightUpperArm: ['upperarm_right'],
		rightLowerArm: ['lowerarm_right'],
		
		// Legs - Left (using your exact names)
		leftUpperLeg: ['upperleg_left'],
		leftLowerLeg: ['lowerleg_left'],
		
		// Legs - Right (using your exact names) 
		rightUpperLeg: ['upperleg_right'],
		rightLowerLeg: ['lowerleg_right']
	};
	
	// Body segment properties (matched to actual bones with Col_ meshes)
	const bodySegments = {
		head: { size: [0.2, 0.25, 0.2], mass: 4.5 },
		neck: { size: [0.15, 0.15, 0.15], mass: 1.2 }, // Only neck uses box collider
		chest: { size: [0.4, 0.35, 0.2], mass: 15.0 }, // Uses Col_Torso mesh
		spine: { size: [0.35, 0.25, 0.18], mass: 12.0 }, // Same as chest since using torso bone
		
		leftUpperArm: { size: [0.08, 0.28, 0.08], mass: 2.8 }, // Uses Col_UpperArm_Left mesh
		leftLowerArm: { size: [0.06, 0.3, 0.06], mass: 2.2 }, // Uses Col_LowerArm_Left mesh
		
		rightUpperArm: { size: [0.08, 0.28, 0.08], mass: 2.8 }, // Uses Col_UpperArm_Right mesh
		rightLowerArm: { size: [0.06, 0.3, 0.06], mass: 2.2 }, // Uses Col_LowerArm_Right mesh
		
		leftUpperLeg: { size: [0.12, 0.4, 0.12], mass: 8.5 }, // Uses Col_UpperLeg_Left mesh
		leftLowerLeg: { size: [0.08, 0.4, 0.08], mass: 5.7 }, // Uses Col_LowerLeg_Left mesh
		
		rightUpperLeg: { size: [0.12, 0.4, 0.12], mass: 8.5 }, // Uses Col_UpperLeg_Right mesh
		rightLowerLeg: { size: [0.08, 0.4, 0.08], mass: 5.7 } // Uses Col_LowerLeg_Right mesh
	};
	
	onMount(async () => {
		await initRapier();
		initThree();
		loadModel();
		animate();
	});
	
	async function initRapier() {
		await RAPIER.init();
		console.log('RAPIER initialized. Available JointData methods:', Object.getOwnPropertyNames(RAPIER.JointData));
		const gravity = { x: 0.0, y: -9.81, z: 0.0 };
		world = new RAPIER.World(gravity);
	}
	
	function initThree() {
		// Scene setup
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x404040);
		
		// Camera
		camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
		camera.position.set(0, 5, 10);
		camera.lookAt(0, 2, 0);
		
		// Renderer
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		
		// Lighting
		const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
		scene.add(ambientLight);
		
		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(-1, 1, 1);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.setScalar(2048);
		scene.add(directionalLight);
		
		// Ground
		const groundGeometry = new THREE.PlaneGeometry(20, 20);
		const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x999999 });
		const ground = new THREE.Mesh(groundGeometry, groundMaterial);
		ground.rotation.x = -Math.PI / 2;
		ground.receiveShadow = true;
		scene.add(ground);
		
		// Ground physics
		const groundColliderDesc = RAPIER.ColliderDesc.cuboid(10, 0.1, 10);
		groundColliderDesc.setTranslation(0, -0.1, 0);
		world.createCollider(groundColliderDesc);
		
		// Camera controls
		controls = new OrbitControls(camera, canvas);
		controls.target.set(0, 2, 0);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;
		controls.minDistance = 2;
		controls.maxDistance = 20;
		controls.maxPolarAngle = Math.PI * 0.8;
		controls.update();
		
		// Window resize
		window.addEventListener('resize', onWindowResize);
	}
	
	function loadModel() {
		const loader = new GLTFLoader();
		loader.load('/model.glb', (gltf) => {
			model = gltf.scene;
			
			// Find and store collision meshes
			const collisionMeshes = {};
			
			model.traverse((child) => {
				if (child.isMesh) {
					if (child.name.startsWith('Col_')) {
						// Store collision mesh and make it invisible
						collisionMeshes[child.name] = child;
						child.visible = false; // Hide collision meshes
						console.log('Found collision mesh:', child.name);
					} else {
						// Regular mesh - enable shadows
						child.castShadow = true;
						child.receiveShadow = true;
					}
				}
			});
			
			// Store collision meshes globally
			window.collisionMeshes = collisionMeshes;
			
			// Animation setup
			if (gltf.animations && gltf.animations.length > 0) {
				mixer = new THREE.AnimationMixer(model);
				animations = gltf.animations.map(clip => {
					const action = mixer.clipAction(clip);
					action.play();
					return action;
				});
			}
			
			// Calculate bounding box and position model above ground
			const box = new THREE.Box3().setFromObject(model);
			const center = box.getCenter(new THREE.Vector3());
			const size = box.getSize(new THREE.Vector3());
			
			// Position model so bottom is at ground level (y = 0)
			model.position.set(0, -box.min.y, 0);
			
			console.log('Model bounds:', { center: center.toArray(), size: size.toArray() });
			console.log('Collision meshes found:', Object.keys(collisionMeshes));
			
			scene.add(model);
			
			// Analyze skeleton and create ragdoll
			analyzeSkeletonAndCreateRagdoll();
		});
	}
	
	function analyzeSkeletonAndCreateRagdoll() {
		if (!model) return;
		
		// Find skeleton
		const skeleton = model.getObjectByProperty('type', 'SkinnedMesh')?.skeleton;
		if (!skeleton) {
			console.warn('No skeleton found in model');
			return;
		}
		
		skeletonBones = skeleton.bones;
		console.log(`Found ${skeletonBones.length} bones in skeleton`);
		
		// Map bones to humanoid segments
		const boneMapping = mapBonestoHumanoid(skeletonBones);
		
		// Create physics bodies for mapped bones
		Object.entries(boneMapping).forEach(([segmentName, bone]) => {
			if (bone) {
				createAnatomicalCollider(bone, segmentName);
			}
		});
		
		// Create joints with proper constraints
		createAnatomicalConstraints(boneMapping);
	}
	
	function mapBonestoHumanoid(bones) {
		const mapping = {};
		
		// First, log all bone names for debugging
		console.log('Available bone names:', bones.map(b => b.name));
		
		// Map each bone to a humanoid segment
		Object.entries(humanoidBoneNames).forEach(([segmentName, possibleNames]) => {
			const bone = bones.find(b => {
				const name = b.name.toLowerCase();
				return possibleNames.some(possible => name.includes(possible.toLowerCase()));
			});
			mapping[segmentName] = bone;
		});
		
		// Log mapping results
		console.log('Bone mapping:', mapping);
		
		// If no matches found, create a fallback mapping based on bone hierarchy
		const hasAnyMatches = Object.values(mapping).some(bone => bone !== undefined);
		if (!hasAnyMatches) {
			console.log('No bone name matches found, creating fallback mapping...');
			return createFallbackMapping(bones);
		}
		
		return mapping;
	}
	
	function createFallbackMapping(bones) {
		// Create a simple mapping using bone hierarchy and positions
		const mapping = {};
		
		// Try to identify bones by their hierarchy and position
		bones.forEach((bone, index) => {
			const name = bone.name.toLowerCase();
			
			// Get world position to help identify bone type
			bone.updateWorldMatrix(true, false);
			const worldPos = new THREE.Vector3();
			bone.getWorldPosition(worldPos);
			
			console.log(`Bone ${index}: "${bone.name}" at position:`, worldPos.toArray());
			
			// Simple heuristic mapping based on common patterns
			if (index === 0 && !mapping.spine) mapping.spine = bone;
			else if (index === 1 && !mapping.chest && worldPos.y > 0) mapping.chest = bone;
			else if (!mapping.head && worldPos.y > (mapping.chest?.position?.y || 1)) mapping.head = bone;
			else if (!mapping.leftUpperArm && worldPos.x > 0.1) mapping.leftUpperArm = bone;
			else if (!mapping.rightUpperArm && worldPos.x < -0.1) mapping.rightUpperArm = bone;
			else if (!mapping.leftUpperLeg && worldPos.x > 0.05 && worldPos.y < 0) mapping.leftUpperLeg = bone;
			else if (!mapping.rightUpperLeg && worldPos.x < -0.05 && worldPos.y < 0) mapping.rightUpperLeg = bone;
		});
		
		console.log('Fallback mapping created:', mapping);
		return mapping;
	}
	
	function createAnatomicalCollider(bone, segmentName) {
		if (!bodySegments[segmentName]) return;
		
		// Try to find corresponding collision mesh
		const collisionMeshName = `Col_${bone.name}`;
		const collisionMesh = window.collisionMeshes?.[collisionMeshName];
		
		// Get bone world position and rotation
		bone.updateWorldMatrix(true, false);
		const worldPos = new THREE.Vector3();
		const worldQuat = new THREE.Quaternion();
		bone.getWorldPosition(worldPos);
		bone.getWorldQuaternion(worldQuat);
		
		let colliderDesc;
		let meshPos = worldPos.clone();
		let meshQuat = worldQuat.clone();
		let meshScale = new THREE.Vector3(1, 1, 1);
		
		if (collisionMesh) {
			console.log(`Using collision mesh for ${segmentName}: ${collisionMeshName}`);
			
			// Use collision mesh position/rotation/scale directly
			collisionMesh.updateWorldMatrix(true, false);
			meshPos = new THREE.Vector3();
			meshQuat = new THREE.Quaternion();
			meshScale = new THREE.Vector3();
			collisionMesh.getWorldPosition(meshPos);
			collisionMesh.getWorldQuaternion(meshQuat);
			collisionMesh.getWorldScale(meshScale);
			
			// Get collision mesh local geometry
			const geometry = collisionMesh.geometry;
			const vertices = [];
			const positionAttribute = geometry.attributes.position;
			
			// Extract vertices in local space with proper scaling
			// Don't apply additional colliderScale to mesh-derived colliders since they should match exactly
			const scaleX = Math.abs(meshScale.x);
			const scaleY = Math.abs(meshScale.y);  
			const scaleZ = Math.abs(meshScale.z);
			
			for (let i = 0; i < positionAttribute.count; i++) {
				vertices.push(
					positionAttribute.getX(i) * scaleX,
					positionAttribute.getY(i) * scaleY,
					positionAttribute.getZ(i) * scaleZ
				);
			}
			
			// Create convex hull from scaled vertices
			colliderDesc = RAPIER.ColliderDesc.convexHull(vertices);
			
			if (!colliderDesc) {
				// Fallback to bounding box if convex hull fails
				console.warn(`Convex hull failed for ${segmentName}, using bounding box`);
				const bbox = new THREE.Box3().setFromBufferGeometry(geometry);
				const size = bbox.getSize(new THREE.Vector3());
				colliderDesc = RAPIER.ColliderDesc.cuboid(
					Math.abs(size.x * meshScale.x) / 2,
					Math.abs(size.y * meshScale.y) / 2,
					Math.abs(size.z * meshScale.z) / 2
				);
			}
			
			// Position collider at collision mesh location (not bone location)
			colliderDesc.setTranslation(meshPos.x, meshPos.y, meshPos.z);
			colliderDesc.setRotation(meshQuat);
			
			// Store the transform relationship between bone and collision mesh
			const boneToMeshOffset = meshPos.clone().sub(worldPos);
			const boneToMeshRotOffset = new THREE.Quaternion().multiplyQuaternions(meshQuat.clone().invert(), worldQuat);
			
			console.log(`${segmentName} - Bone pos:`, worldPos.toArray(), 'Mesh pos:', meshPos.toArray(), 'Offset:', boneToMeshOffset.toArray(), 'Scale:', meshScale.toArray());
		} else {
			console.log(`No collision mesh found for ${segmentName}, using box collider`);
			
			// Fallback to box collider (apply colliderScale here since it's a generic box)
			const segment = bodySegments[segmentName];
			const [width, height, depth] = segment.size;
			colliderDesc = RAPIER.ColliderDesc.cuboid(
				(width * colliderScale) / 2, 
				(height * colliderScale) / 2, 
				(depth * colliderScale) / 2
			);
			colliderDesc.setTranslation(worldPos.x, worldPos.y, worldPos.z);
			colliderDesc.setRotation(worldQuat);
		}
		
		// Create rigid body at collision mesh position (if available) or bone position
		const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();
		if (collisionMesh) {
			rigidBodyDesc.setTranslation(meshPos.x, meshPos.y, meshPos.z);
			rigidBodyDesc.setRotation(meshQuat);
		} else {
			rigidBodyDesc.setTranslation(worldPos.x, worldPos.y, worldPos.z);
			rigidBodyDesc.setRotation(worldQuat);
		}
		
		const rigidBody = world.createRigidBody(rigidBodyDesc);
		const collider = world.createCollider(colliderDesc, rigidBody);
		
		// Set collision filtering - prevent collision between adjacent connected joints
		// Use bit flags for different body parts to enable selective filtering
		const segmentGroups = {
			head: 0x0001,
			neck: 0x0002, 
			chest: 0x0004,
			spine: 0x0008,
			leftUpperArm: 0x0010,
			leftLowerArm: 0x0020,
			rightUpperArm: 0x0040,
			rightLowerArm: 0x0080,
			leftUpperLeg: 0x0100,
			leftLowerLeg: 0x0200,
			rightUpperLeg: 0x0400,
			rightLowerLeg: 0x0800
		};
		
		// Get collision group for this segment
		const myGroup = segmentGroups[segmentName] || 0x1000;
		
		// Define which groups this segment should NOT collide with (adjacent connected parts)
		let excludeGroups = 0x0000;
		if (segmentName === 'head') excludeGroups = segmentGroups.neck;
		if (segmentName === 'neck') excludeGroups = segmentGroups.head | segmentGroups.chest;
		if (segmentName === 'chest') excludeGroups = segmentGroups.neck | segmentGroups.spine | segmentGroups.leftUpperArm | segmentGroups.rightUpperArm;
		if (segmentName === 'spine') excludeGroups = segmentGroups.chest | segmentGroups.leftUpperLeg | segmentGroups.rightUpperLeg;
		if (segmentName === 'leftUpperArm') excludeGroups = segmentGroups.chest | segmentGroups.leftLowerArm;
		if (segmentName === 'leftLowerArm') excludeGroups = segmentGroups.leftUpperArm;
		if (segmentName === 'rightUpperArm') excludeGroups = segmentGroups.chest | segmentGroups.rightLowerArm;
		if (segmentName === 'rightLowerArm') excludeGroups = segmentGroups.rightUpperArm;
		if (segmentName === 'leftUpperLeg') excludeGroups = segmentGroups.spine | segmentGroups.leftLowerLeg;
		if (segmentName === 'leftLowerLeg') excludeGroups = segmentGroups.leftUpperLeg;
		if (segmentName === 'rightUpperLeg') excludeGroups = segmentGroups.spine | segmentGroups.rightLowerLeg;
		if (segmentName === 'rightLowerLeg') excludeGroups = segmentGroups.rightUpperLeg;
		
		// Set collision groups: can collide with everything EXCEPT excluded groups
		const canCollideWith = 0xFFFF & ~excludeGroups;
		collider.setCollisionGroups((myGroup << 16) | canCollideWith);
		collider.setSolverGroups((myGroup << 16) | canCollideWith);
		
		// Store segment info for debugging
		collider.userData = { segmentName: segmentName, group: myGroup };
		
		// Set mass
		const segment = bodySegments[segmentName];
		rigidBody.setAdditionalMass(segment.mass, true);
		
		// Create debug visualization (show collision mesh if available)
		if (showDebug) {
			if (collisionMesh) {
				createMeshDebugVisualization(collisionMesh, segmentName);
			} else {
				const [width, height, depth] = segment.size;
				createDebugMesh(worldPos, worldQuat, [width, height, depth], segmentName);
			}
		}
		
		ragdollBodies.push({
			bone: bone,
			rigidBody: rigidBody,
			collider: collider,
			segmentName: segmentName,
			originalMass: segment.mass,
			collisionMesh: collisionMesh,
			boneToMeshOffset: collisionMesh ? meshPos.clone().sub(worldPos) : new THREE.Vector3(),
			boneToMeshRotOffset: collisionMesh ? new THREE.Quaternion().multiplyQuaternions(meshQuat.clone().invert(), worldQuat) : new THREE.Quaternion(),
			meshPosition: collisionMesh ? meshPos.clone() : worldPos.clone(),
			meshQuaternion: collisionMesh ? meshQuat.clone() : worldQuat.clone()
		});
	}
	
	function createDebugMesh(position, quaternion, size, segmentName) {
		const [width, height, depth] = size;
		const geometry = new THREE.BoxGeometry(width, height, depth);
		
		// Color code by body part
		const color = getSegmentColor(segmentName);
		const material = new THREE.MeshLambertMaterial({ 
			color: color, 
			transparent: true, 
			opacity: 0.6,
			wireframe: true
		});
		
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(position);
		mesh.quaternion.copy(quaternion);
		mesh.name = `debug_${segmentName}`;
		
		scene.add(mesh);
		debugMeshes.push(mesh);
	}
	
	function createMeshDebugVisualization(collisionMesh, segmentName) {
		// Clone the collision mesh for debug visualization
		const debugGeometry = collisionMesh.geometry.clone();
		const color = getSegmentColor(segmentName);
		
		const debugMaterial = new THREE.MeshLambertMaterial({ 
			color: color, 
			transparent: true, 
			opacity: 0.7,
			wireframe: true
		});
		
		const debugMesh = new THREE.Mesh(debugGeometry, debugMaterial);
		
		// Copy transform from collision mesh
		debugMesh.position.copy(collisionMesh.position);
		debugMesh.quaternion.copy(collisionMesh.quaternion);
		debugMesh.scale.copy(collisionMesh.scale);
		
		debugMesh.name = `debug_${segmentName}`;
		debugMesh.visible = showDebug;
		
		scene.add(debugMesh);
		debugMeshes.push(debugMesh);
		
		console.log(`Created debug visualization for collision mesh: ${segmentName}`);
	}
	
	function getSegmentColor(segmentName) {
		if (segmentName.includes('head')) return 0xff6b6b;
		if (segmentName.includes('neck')) return 0xffd93d;
		if (segmentName.includes('chest') || segmentName.includes('spine')) return 0x6bcf7f;
		if (segmentName.includes('arm') || segmentName.includes('hand')) return 0x4ecdc4;
		if (segmentName.includes('leg') || segmentName.includes('foot')) return 0x45b7d1;
		return 0x96ceb4;
	}
	
	function calculateBoneLength(bone) {
		if (bone.children.length > 0) {
			// Use distance to first child as bone length
			const childPos = new THREE.Vector3();
			bone.children[0].getWorldPosition(childPos);
			const bonePos = new THREE.Vector3();
			bone.getWorldPosition(bonePos);
			return Math.max(0.1, bonePos.distanceTo(childPos));
		}
		return 0.2; // Default bone length
	}
	
	function createAnatomicalConstraints(boneMapping) {
		// Store original bone poses for spring forces
		Object.values(boneMapping).forEach(bone => {
			if (bone) {
				bone.updateWorldMatrix(true, false);
				const worldPos = new THREE.Vector3();
				const worldQuat = new THREE.Quaternion();
				bone.getWorldPosition(worldPos);
				bone.getWorldQuaternion(worldQuat);
				
				originalBonePoses.set(bone.name, {
					position: worldPos.clone(),
					quaternion: worldQuat.clone()
				});
			}
		});
		
		// Define joint connections with very tight, anatomically correct limits
		const jointConnections = [
			// Spine/neck chain - very restricted
			{ parent: 'chest', child: 'neck', type: 'ball', limits: { x: [-15, 15], y: [-25, 25], z: [-10, 10] }, stiffness: 0.9 },
			{ parent: 'neck', child: 'head', type: 'ball', limits: { x: [-20, 20], y: [-30, 30], z: [-15, 15] }, stiffness: 0.8 },
			
			// Arms - realistic shoulder and elbow movement
			{ parent: 'chest', child: 'leftUpperArm', type: 'ball', limits: { x: [-45, 90], y: [-30, 45], z: [-15, 120] }, stiffness: 0.5 },
			{ parent: 'leftUpperArm', child: 'leftLowerArm', type: 'revolute', limits: { x: [5, 135] }, stiffness: 0.6 },
			
			{ parent: 'chest', child: 'rightUpperArm', type: 'ball', limits: { x: [-45, 90], y: [-45, 30], z: [-120, 15] }, stiffness: 0.5 },
			{ parent: 'rightUpperArm', child: 'rightLowerArm', type: 'revolute', limits: { x: [5, 135] }, stiffness: 0.6 },
			
			// Legs - hip and knee constraints for walking
			{ parent: 'spine', child: 'leftUpperLeg', type: 'ball', limits: { x: [-45, 25], y: [-15, 15], z: [-20, 20] }, stiffness: 0.7 },
			{ parent: 'leftUpperLeg', child: 'leftLowerLeg', type: 'revolute', limits: { x: [-110, 0] }, stiffness: 0.8 },
			
			{ parent: 'spine', child: 'rightUpperLeg', type: 'ball', limits: { x: [-45, 25], y: [-15, 15], z: [-20, 20] }, stiffness: 0.7 },
			{ parent: 'rightUpperLeg', child: 'rightLowerLeg', type: 'revolute', limits: { x: [-110, 0] }, stiffness: 0.8 }
		];
		
		// Create joints
		jointConnections.forEach(connection => {
			const parentBone = boneMapping[connection.parent];
			const childBone = boneMapping[connection.child];
			
			if (parentBone && childBone) {
				createAnatomicalJoint(parentBone, childBone, connection);
			}
		});
	}
	
	function createAnatomicalJoint(parentBone, childBone, connection) {
		const parentBody = ragdollBodies.find(rb => rb.bone === parentBone)?.rigidBody;
		const childBody = ragdollBodies.find(rb => rb.bone === childBone)?.rigidBody;
		
		if (!parentBody || !childBody) return;
		
		// Calculate joint anchor points
		const parentPos = new THREE.Vector3();
		const childPos = new THREE.Vector3();
		parentBone.getWorldPosition(parentPos);
		childBone.getWorldPosition(childPos);
		
		// Create joints with proper API for compatibility version
		let joint = null;
		
		try {
			// Try different joint creation methods for compatibility
			if (connection.type === 'ball') {
				// Try spherical joint first, then ball joint alternatives
				if (RAPIER.JointData.spherical) {
					joint = world.createImpulseJoint(
						RAPIER.JointData.spherical(
							{ x: 0.0, y: 0.0, z: 0.0 },
							{ x: 0.0, y: 0.0, z: 0.0 }
						),
						parentBody, childBody, true
					);
				} else if (world.createBallJoint) {
					joint = world.createBallJoint(parentBody, childBody, { x: 0, y: 0, z: 0 });
				}
			} else if (connection.type === 'revolute') {
				if (RAPIER.JointData.revolute) {
					joint = world.createImpulseJoint(
						RAPIER.JointData.revolute(
							{ x: 0.0, y: 0.0, z: 0.0 },
							{ x: 0.0, y: 0.0, z: 0.0 },
							{ x: 1.0, y: 0.0, z: 0.0 }
						),
						parentBody, childBody, true
					);
				} else if (world.createRevoluteJoint) {
					joint = world.createRevoluteJoint(parentBody, childBody, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
				}
			}
		} catch (error) {
			console.warn(`Failed to create ${connection.type} joint for ${connection.parent} -> ${connection.child}:`, error);
		}
		
		if (!joint) {
			console.warn(`Could not create joint for ${connection.parent} -> ${connection.child} - API not available`);
			return;
		}
		
		console.log(`Created ${connection.type} joint for ${connection.parent} -> ${connection.child}`);
		
		// Apply joint limits if the API supports it  
		if (connection.limits && typeof joint.setLimits === 'function') {
			try {
				if (connection.type === 'ball') {
					const { x, y, z } = connection.limits;
					// Try different API variations for setting limits
					if (x) {
						try {
							joint.setLimits(0, x[0] * Math.PI / 180, x[1] * Math.PI / 180); // Axis 0 = X
						} catch {
							joint.setAngularLimits?.(x[0] * Math.PI / 180, x[1] * Math.PI / 180, 0);
						}
					}
					if (y) {
						try {
							joint.setLimits(1, y[0] * Math.PI / 180, y[1] * Math.PI / 180); // Axis 1 = Y  
						} catch {
							joint.setAngularLimits?.(y[0] * Math.PI / 180, y[1] * Math.PI / 180, 1);
						}
					}
					if (z) {
						try {
							joint.setLimits(2, z[0] * Math.PI / 180, z[1] * Math.PI / 180); // Axis 2 = Z
						} catch {
							joint.setAngularLimits?.(z[0] * Math.PI / 180, z[1] * Math.PI / 180, 2);
						}
					}
				} else if (connection.type === 'revolute') {
					const { x } = connection.limits;
					if (x) {
						try {
							joint.setLimits(0, x[0] * Math.PI / 180, x[1] * Math.PI / 180);
						} catch {
							joint.setAngularLimits?.(x[0] * Math.PI / 180, x[1] * Math.PI / 180);
						}
					}
				}
			} catch (error) {
				console.warn(`Could not set limits for joint ${connection.parent} -> ${connection.child}:`, error);
			}
		}
		
		// Skip joint limits for now - focus on basic functionality
		console.log(`Joint created without limits for ${connection.parent} -> ${connection.child}`);
		
		// Store joint with connection info for spring forces
		ragdollConstraints.push({
			joint: joint,
			connection: connection,
			parentBone: parentBone,
			childBone: childBone
		});
	}
	
	function toggleRagdoll() {
		isRagdoll = !isRagdoll;
		
		if (isRagdoll) {
			// Enable physics mode
			isAnimating = false;
			physicsWeight = 1.0;
			animationWeight = 0.0;
			
			// Sync bone transforms to physics bodies
			ragdollBodies.forEach(({ bone, rigidBody }) => {
				// Update the entire model's world matrix first
				model.updateWorldMatrix(true, true);
				bone.updateWorldMatrix(true, false);
				
				const worldPos = new THREE.Vector3();
				const worldQuat = new THREE.Quaternion();
				bone.getWorldPosition(worldPos);
				bone.getWorldQuaternion(worldQuat);
				
				rigidBody.setTranslation(worldPos, true);
				rigidBody.setRotation(worldQuat, true);
				rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
				rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
			});
		} else {
			// Enable animation mode
			isAnimating = true;
			physicsWeight = 0.0;
			animationWeight = 1.0;
		}
	}
	
	function addForce() {
		if (ragdollBodies.length > 0) {
			const randomBody = ragdollBodies[Math.floor(Math.random() * ragdollBodies.length)];
			const force = {
				x: (Math.random() - 0.5) * 50,
				y: Math.random() * 25,
				z: (Math.random() - 0.5) * 50
			};
			randomBody.rigidBody.addForce(force, true);
		}
	}
	
	function toggleDebugVisualization() {
		showDebug = !showDebug;
		
		debugMeshes.forEach(mesh => {
			mesh.visible = showDebug;
		});
	}
	
	function resetRagdoll() {
		if (!isRagdoll) return;
		
		// Reset physics bodies to animation pose
		ragdollBodies.forEach(({ bone, rigidBody }) => {
			bone.updateWorldMatrix(true, false);
			const worldPos = new THREE.Vector3();
			const worldQuat = new THREE.Quaternion();
			bone.getWorldPosition(worldPos);
			bone.getWorldQuaternion(worldQuat);
			
			rigidBody.setTranslation(worldPos, true);
			rigidBody.setRotation(worldQuat, true);
			rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
			rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
		});
	}
	
	function updatePhysics() {
		if (!world) return;
		
		// Apply spring forces toward original pose before physics step
		if (isRagdoll && springStiffness > 0) {
			applySpringForces();
		}
		
		world.step();
		
		if (isRagdoll) {
			// Update bones from physics bodies using stored offset relationships
			ragdollBodies.forEach(({ bone, rigidBody, segmentName, collisionMesh, boneToMeshOffset, boneToMeshRotOffset }) => {
				const translation = rigidBody.translation();
				const rotation = rigidBody.rotation();
				
				const physicsPos = new THREE.Vector3(translation.x, translation.y, translation.z);
				const physicsQuat = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
				
				// Calculate bone world position from physics body position
				let boneWorldPos, boneWorldQuat;
				
				if (collisionMesh && boneToMeshOffset) {
					// Physics body is at collision mesh position, calculate bone position using stored offset
					boneWorldPos = physicsPos.clone().sub(boneToMeshOffset);
					// Apply rotation offset to get bone rotation from mesh rotation
					boneWorldQuat = physicsQuat.clone().multiply(boneToMeshRotOffset);
				} else {
					// Direct mapping for bones without collision meshes
					boneWorldPos = physicsPos.clone();
					boneWorldQuat = physicsQuat.clone();
				}
				
				// Convert world transform to local bone space
				const boneWorldMatrix = new THREE.Matrix4();
				boneWorldMatrix.compose(boneWorldPos, boneWorldQuat, new THREE.Vector3(1, 1, 1));
				
				if (bone.parent) {
					// Ensure parent world matrix is current
					bone.parent.updateWorldMatrix(true, false);
					
					// Convert to local space relative to parent
					const parentInverse = new THREE.Matrix4().copy(bone.parent.matrixWorld).invert();
					const localMatrix = new THREE.Matrix4().multiplyMatrices(parentInverse, boneWorldMatrix);
					
					const localPos = new THREE.Vector3();
					const localQuat = new THREE.Quaternion();
					const localScale = new THREE.Vector3();
					localMatrix.decompose(localPos, localQuat, localScale);
					
					// Apply transform directly to minimize distortion
					bone.position.copy(localPos);
					bone.quaternion.copy(localQuat);
				} else {
					// Root bone - convert to model local space
					const modelInverse = new THREE.Matrix4().copy(model.matrixWorld).invert();
					const localMatrix = new THREE.Matrix4().multiplyMatrices(modelInverse, boneWorldMatrix);
					
					const localPos = new THREE.Vector3();
					const localQuat = new THREE.Quaternion();
					const localScale = new THREE.Vector3();
					localMatrix.decompose(localPos, localQuat, localScale);
					
					bone.position.copy(localPos);
					bone.quaternion.copy(localQuat);
				}
				
				// Update debug mesh to show physics body position
				if (showDebug) {
					const debugMesh = debugMeshes.find(m => m.name === `debug_${segmentName}`);
					if (debugMesh) {
						debugMesh.position.copy(physicsPos);
						debugMesh.quaternion.copy(physicsQuat);
					}
				}
			});
			
			// Update skeleton hierarchy - ensure proper order and force updates
			const skinnedMesh = model.getObjectByProperty('type', 'SkinnedMesh');
			if (skinnedMesh?.skeleton) {
				// Update all bone matrices in hierarchy order
				skinnedMesh.skeleton.bones.forEach(bone => {
					bone.updateMatrix();
				});
				
				// Force world matrix update from root
				if (skinnedMesh.skeleton.bones[0]) {
					skinnedMesh.skeleton.bones[0].updateMatrixWorld(true);
				}
				
				// Update skeleton binding
				skinnedMesh.skeleton.update();
				
				// Force geometry update
				if (skinnedMesh.geometry.attributes.position) {
					skinnedMesh.geometry.attributes.position.needsUpdate = true;
				}
				if (skinnedMesh.geometry.attributes.normal) {
					skinnedMesh.geometry.attributes.normal.needsUpdate = true;
				}
			}
		}
	}
	
	function applySpringForces() {
		ragdollBodies.forEach(({ bone, rigidBody }) => {
			const originalPose = originalBonePoses.get(bone.name);
			if (!originalPose) return;
			
			// Get current physics body transform
			const currentPos = rigidBody.translation();
			const currentRot = rigidBody.rotation();
			
			// Calculate position difference
			const targetPos = originalPose.position;
			const positionDiff = new THREE.Vector3(
				targetPos.x - currentPos.x,
				targetPos.y - currentPos.y,
				targetPos.z - currentPos.z
			);
			
			// Apply spring force toward original position
			const springForce = {
				x: positionDiff.x * springStiffness * 10,
				y: positionDiff.y * springStiffness * 10,
				z: positionDiff.z * springStiffness * 10
			};
			
			rigidBody.addForce(springForce, true);
			
			// Calculate rotation difference and apply torque
			const targetRot = originalPose.quaternion;
			const currentQuaternion = new THREE.Quaternion(currentRot.x, currentRot.y, currentRot.z, currentRot.w);
			const targetQuaternion = targetRot.clone();
			
			// Find rotation needed to go from current to target
			const rotationDiff = targetQuaternion.clone().multiply(currentQuaternion.clone().invert());
			
			// Convert to axis-angle for torque
			const angle = 2 * Math.acos(Math.abs(rotationDiff.w));
			if (angle > 0.01) { // Avoid division by zero
				const axis = new THREE.Vector3(rotationDiff.x, rotationDiff.y, rotationDiff.z).normalize();
				const torque = {
					x: axis.x * angle * springStiffness * 5,
					y: axis.y * angle * springStiffness * 5,
					z: axis.z * angle * springStiffness * 5
				};
				
				rigidBody.addTorque(torque, true);
			}
		});
	}
	
	function animate() {
		requestAnimationFrame(animate);
		
		// Update camera controls
		if (controls) {
			controls.update();
		}
		
		// Update animation mixer
		if (mixer && isAnimating) {
			mixer.update(0.016); // 60fps
		}
		
		// Update physics
		updatePhysics();
		
		// Render
		renderer.render(scene, camera);
	}
	
	function onWindowResize() {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	}
</script>

<canvas bind:this={canvas}></canvas>

<div class="controls">
	<h2>🎯 Ragdoll Physics Demo</h2>
	
	<div class="control-group">
		<button onclick={toggleRagdoll} class="primary">
			{isRagdoll ? '🎬 Enable Animation' : '🦴 Enable Ragdoll'}
		</button>
		
		<button onclick={addForce} disabled={!isRagdoll} class="secondary">
			💥 Add Force
		</button>
		
		<button onclick={resetRagdoll} disabled={!isRagdoll} class="secondary">
			🔄 Reset Pose
		</button>
	</div>
	
	<div class="control-group">
		<button onclick={toggleDebugVisualization} class="debug">
			{showDebug ? '👁️ Hide Debug' : '👁️‍🗨️ Show Debug'}
		</button>
	</div>
	
	<div class="control-group sliders">
		<label>
			🎭 Animation: {animationWeight.toFixed(2)}
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				bind:value={animationWeight}
				disabled={isRagdoll}
			/>
		</label>
		
		<label>
			⚙️ Physics: {physicsWeight.toFixed(2)}
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				bind:value={physicsWeight}
				disabled={!isRagdoll}
			/>
		</label>
		
		<label>
			🌸 Spring Stiffness: {springStiffness.toFixed(2)}
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				bind:value={springStiffness}
			/>
		</label>
		
		<label>
			🛑 Spring Damping: {springDamping.toFixed(2)}
			<input
				type="range"
				min="0.1"
				max="2"
				step="0.1"
				bind:value={springDamping}
			/>
		</label>
		
		<label>
			📏 Collider Scale: {colliderScale.toFixed(2)}
			<input
				type="range"
				min="0.1"
				max="3"
				step="0.1"
				bind:value={colliderScale}
			/>
		</label>
	</div>
	
	<div class="info">
		<div class="status-grid">
			<div class="stat">
				<span class="label">📊 Bones</span>
				<span class="value">{skeletonBones.length}</span>
			</div>
			<div class="stat">
				<span class="label">🔗 Bodies</span>
				<span class="value">{ragdollBodies.length}</span>
			</div>
			<div class="stat">
				<span class="label">🎮 Mode</span>
				<span class="value">{isRagdoll ? '⚡ Physics' : '🎬 Animation'}</span>
			</div>
			<div class="stat">
				<span class="label">🎨 Debug</span>
				<span class="value">{showDebug ? '✅ On' : '❌ Off'}</span>
			</div>
		</div>
	</div>
	
	<div class="instructions">
		<h3>🎮 Controls</h3>
		<ul>
			<li><strong>Ragdoll Mode:</strong> Physics-based movement</li>
			<li><strong>Animation Mode:</strong> Original FK animations</li>
			<li><strong>Add Force:</strong> Apply random impulse</li>
			<li><strong>Debug View:</strong> Show collision boxes</li>
		</ul>
	</div>
</div>

<style>
	canvas {
		display: block;
		width: 100%;
		height: 100vh;
		background: linear-gradient(135deg, #1e3c72, #2a5298);
	}
	
	.controls {
		position: fixed;
		top: 10px;
		left: 10px;
		background: linear-gradient(145deg, rgba(0, 0, 0, 0.9), rgba(20, 20, 40, 0.9));
		backdrop-filter: blur(10px);
		color: white;
		padding: 12px;
		border-radius: 12px;
		font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
		width: 240px;
		max-height: 80vh;
		overflow-y: auto;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(255, 255, 255, 0.1);
	}
	
	.controls h2 {
		margin-top: 0;
		margin-bottom: 12px;
		font-size: 16px;
		font-weight: 700;
		background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
		-webkit-background-clip: text;
		background-clip: text;
		-webkit-text-fill-color: transparent;
		text-align: center;
	}
	
	.control-group {
		margin: 10px 0;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	
	.control-group button {
		padding: 6px 10px;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		font-weight: 600;
		font-size: 12px;
		transition: all 0.3s ease;
		flex: 1;
		min-width: 100px;
	}
	
	.control-group button.primary {
		background: linear-gradient(135deg, #667eea, #764ba2);
		color: white;
	}
	
	.control-group button.primary:hover {
		background: linear-gradient(135deg, #5a6fd8, #6a4190);
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
	}
	
	.control-group button.secondary {
		background: linear-gradient(135deg, #f093fb, #f5576c);
		color: white;
	}
	
	.control-group button.secondary:hover {
		background: linear-gradient(135deg, #e081e9, #e3455a);
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(240, 147, 251, 0.4);
	}
	
	.control-group button.debug {
		background: linear-gradient(135deg, #4facfe, #00f2fe);
		color: white;
		width: 100%;
	}
	
	.control-group button.debug:hover {
		background: linear-gradient(135deg, #3d8bfe, #00d9fe);
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(79, 172, 254, 0.4);
	}
	
	.control-group button:disabled {
		background: #444;
		color: #888;
		cursor: not-allowed;
		transform: none;
		box-shadow: none;
	}
	
	.control-group.sliders label {
		display: block;
		margin: 6px 0;
		font-size: 11px;
		font-weight: 500;
	}
	
	.control-group.sliders input[type="range"] {
		width: 100%;
		margin: 4px 0;
		height: 4px;
		background: #333;
		border-radius: 2px;
		outline: none;
		-webkit-appearance: none;
	}
	
	.control-group.sliders input[type="range"]::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		background: linear-gradient(135deg, #667eea, #764ba2);
		border-radius: 50%;
		cursor: pointer;
	}
	
	.control-group.sliders input[type="range"]::-moz-range-thumb {
		width: 14px;
		height: 14px;
		background: linear-gradient(135deg, #667eea, #764ba2);
		border-radius: 50%;
		cursor: pointer;
		border: none;
	}
	
	.info {
		background: rgba(255, 255, 255, 0.05);
		border-radius: 12px;
		padding: 16px;
		margin-top: 20px;
		border: 1px solid rgba(255, 255, 255, 0.1);
	}
	
	.status-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 8px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 8px;
	}
	
	.stat .label {
		font-size: 11px;
		color: #aaa;
		margin-bottom: 4px;
	}
	
	.stat .value {
		font-size: 14px;
		font-weight: 600;
		color: #fff;
	}
	
	.instructions {
		background: rgba(255, 255, 255, 0.03);
		border-radius: 12px;
		padding: 16px;
		margin-top: 16px;
		border: 1px solid rgba(255, 255, 255, 0.08);
	}
	
	.instructions h3 {
		margin-top: 0;
		margin-bottom: 12px;
		font-size: 14px;
		color: #fff;
	}
	
	.instructions ul {
		margin: 0;
		padding-left: 16px;
		font-size: 12px;
		color: #ccc;
		line-height: 1.6;
	}
	
	.instructions li {
		margin: 6px 0;
	}
	
	.instructions strong {
		color: #fff;
	}
</style>