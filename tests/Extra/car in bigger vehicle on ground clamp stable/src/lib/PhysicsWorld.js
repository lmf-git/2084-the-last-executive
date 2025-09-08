import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';


/**
 * Physics world manager that handles Three.js scene and Rapier physics integration
 */
export class PhysicsWorld {
	static create() {
		const world = {
			scene: new THREE.Scene(),
			camera: new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000),
			renderer: new THREE.WebGLRenderer({ antialias: true }),
			world: null,
			bodies: new Map(),
			meshes: new Map()
		};
		
		PhysicsWorld.setupRenderer(world);
		PhysicsWorld.setupCamera(world);
		PhysicsWorld.setupLights(world);
		
		return world;
	}

	static async init(physicsWorld) {
		await RAPIER.init();
		
		// Create physics world with gravity
		physicsWorld.world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0));
		
		// Create ground
		PhysicsWorld.createGround(physicsWorld);
		
		console.log('Physics world initialized');
	}

	static setupRenderer(physicsWorld) {
		physicsWorld.renderer.setSize(window.innerWidth, window.innerHeight);
		physicsWorld.renderer.shadowMap.enabled = true;
		physicsWorld.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		physicsWorld.renderer.setClearColor(0x87CEEB);
		
		// Handle window resize
		window.addEventListener('resize', () => {
			physicsWorld.camera.aspect = window.innerWidth / window.innerHeight;
			physicsWorld.camera.updateProjectionMatrix();
			physicsWorld.renderer.setSize(window.innerWidth, window.innerHeight);
		});
	}

	static setupCamera(physicsWorld) {
		physicsWorld.camera.position.set(0, 5, 10);
		physicsWorld.camera.lookAt(0, 0, 0);
	}

	static setupLights(physicsWorld) {
		// Ambient light
		const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
		physicsWorld.scene.add(ambientLight);

		// Directional light
		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(50, 50, 50);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.width = 2048;
		directionalLight.shadow.mapSize.height = 2048;
		physicsWorld.scene.add(directionalLight);
	}

	static createGround(physicsWorld) {
		// Visual ground - much bigger platform
		const groundGeometry = new THREE.PlaneGeometry(200, 200);
		const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90EE90 });
		const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
		groundMesh.rotation.x = -Math.PI / 2;
		groundMesh.receiveShadow = true;
		physicsWorld.scene.add(groundMesh);

		// Physics ground - much bigger platform
		const groundColliderDesc = RAPIER.ColliderDesc.cuboid(100, 0.1, 100);
		groundColliderDesc.setFriction(1.2); // Moderate friction ground
		groundColliderDesc.setRestitution(0.1); // Small bounce
		// Remove collision groups to use default (interacts with everything)
		const groundCollider = physicsWorld.world.createCollider(groundColliderDesc);
		groundCollider.setTranslation(new RAPIER.Vector3(0, -0.1, 0));
	}

	/**
	 * Create a dynamic rigidbody with mesh
	 * @param {THREE.Geometry} geometry 
	 * @param {THREE.Material} material 
	 * @param {RAPIER.ColliderDesc} colliderDesc 
	 * @param {THREE.Vector3} position 
	 * @param {boolean} lockRotation 
	 * @returns {object} { body, mesh, collider }
	 */
	static createDynamicBody(physicsWorld, geometry, material, colliderDesc, position, lockRotation = false) {
		// Create mesh
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(position);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		physicsWorld.scene.add(mesh);

		// Create rigidbody
		const bodyDesc = RAPIER.RigidBodyDesc.dynamic();
		bodyDesc.setTranslation(position.x, position.y, position.z);
		
		if (lockRotation) {
			bodyDesc.lockRotations(true, true, true);
		}
		
		const body = physicsWorld.world.createRigidBody(bodyDesc);
		
		// Create collider
		const collider = physicsWorld.world.createCollider(colliderDesc, body);

		const id = body.handle;
		physicsWorld.bodies.set(id, body);
		physicsWorld.meshes.set(id, mesh);

		return { body, mesh, collider, id };
	}

	/**
	 * Create a kinematic rigidbody with mesh
	 * @param {THREE.Geometry} geometry 
	 * @param {THREE.Material} material 
	 * @param {RAPIER.ColliderDesc} colliderDesc 
	 * @param {THREE.Vector3} position 
	 * @returns {object} { body, mesh, collider }
	 */
	createKinematicBody(geometry, material, colliderDesc, position) {
		// Create mesh
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.copy(position);
		mesh.castShadow = true;
		this.scene.add(mesh);

		// Create rigidbody
		const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
		bodyDesc.setTranslation(position.x, position.y, position.z);
		
		const body = this.world.createRigidBody(bodyDesc);
		
		// Create collider
		const collider = this.world.createCollider(colliderDesc, body);

		const id = body.handle;
		this.bodies.set(id, body);
		this.meshes.set(id, mesh);

		return { body, mesh, collider, id };
	}

	/**
	 * Create a sensor (trigger) collider
	 * @param {RAPIER.ColliderDesc} colliderDesc 
	 * @param {THREE.Vector3} position 
	 * @param {RAPIER.RigidBody} parentBody 
	 * @returns {RAPIER.Collider}
	 */
	static createSensor(physicsWorld, colliderDesc, position, parentBody = null) {
		colliderDesc.setSensor(true);
		
		if (parentBody) {
			// Set the collider position relative to the parent body
			colliderDesc.setTranslation(position.x, position.y, position.z);
			const collider = physicsWorld.world.createCollider(colliderDesc, parentBody);
			return collider;
		} else {
			const collider = physicsWorld.world.createCollider(colliderDesc);
			collider.setTranslation(new RAPIER.Vector3(position.x, position.y, position.z));
			return collider;
		}
	}

	/**
	 * Update physics simulation and sync meshes
	 */
	static update(physicsWorld, deltaTime = 1/60) {
		if (!physicsWorld.world) return;
		
		// Step physics simulation with fixed timestep
		physicsWorld.world.timestep = Math.min(deltaTime, 1/30); // Cap at 30 FPS minimum
		physicsWorld.world.step();
		
		// Sync mesh positions with physics bodies
		physicsWorld.bodies.forEach((body, id) => {
			const mesh = physicsWorld.meshes.get(id);
			if (mesh && body.bodyType() === RAPIER.RigidBodyType.Dynamic) {
				const position = body.translation();
				const rotation = body.rotation();
				
				mesh.position.set(position.x, position.y, position.z);
				mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
			}
		});
	}

	/**
	 * Render the scene
	 */
	static render(physicsWorld) {
		physicsWorld.renderer.render(physicsWorld.scene, physicsWorld.camera);
	}

	/**
	 * Get the renderer's DOM element
	 * @returns {HTMLCanvasElement}
	 */
	static getDOMElement(physicsWorld) {
		return physicsWorld.renderer.domElement;
	}

	/**
	 * Cleanup resources
	 */
	static dispose(physicsWorld) {
		if (physicsWorld.world) {
			physicsWorld.world.free();
		}
		physicsWorld.renderer.dispose();
	}
}