import { NestedPhysicsWorld } from './physics/NestedPhysicsWorld.js';
import { EntityTransitionManager } from './transitions/EntityTransitionManager.js';
import { Player } from './entities/Player.js';
import { Vehicle } from './entities/Vehicle.js';
import { Carrier } from './entities/Carrier.js';
import { Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, AmbientLight, BoxGeometry, CapsuleGeometry, MeshLambertMaterial, Mesh } from 'three';

export class NestedPhysicsSimulation {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = {
      debug: false,
      fixedTimeStep: 1.0 / 60.0,
      maxSubSteps: 3,
      gravity: { x: 0, y: -9.81, z: 0 },
      ...options
    };
    
    // Core systems
    this.physicsWorld = null;
    this.transitionManager = null;
    
    // Three.js rendering
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    
    // Simulation state
    this.isRunning = false;
    this.isPaused = false;
    this.lastTime = 0;
    this.accumulator = 0;
    this.frameCount = 0;
    
    // Entity registry
    this.entities = new Map(); // Three.js objects mapped to physics entities
    this.entityFactories = new Map();
    
    // Event system
    this.eventListeners = new Map();
    
    this.setupEntityFactories();
  }

  async initialize() {
    // Initialize physics world
    this.physicsWorld = new NestedPhysicsWorld();
    await this.physicsWorld.initialize();
    
    // Initialize transition manager
    this.transitionManager = new EntityTransitionManager(this.physicsWorld);
    this.physicsWorld.transitionManager = this.transitionManager;
    
    // Setup Three.js
    this.setupThreeJS();
    
    // Setup event listeners
    this.setupEventListeners();
    
    console.log('Nested Physics Simulation initialized');
  }

  setupThreeJS() {
    // Create scene
    this.scene = new Scene();
    
    // Create camera
    this.camera = new PerspectiveCamera(
      75, 
      this.canvas.clientWidth / this.canvas.clientHeight, 
      0.1, 
      10000
    );
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 0, 0);
    
    // Create renderer
    this.renderer = new WebGLRenderer({ 
      canvas: this.canvas, 
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.renderer.PCFSoftShadowMap;
    
    // Setup lighting
    const ambientLight = new AmbientLight(0x404040, 0.6);
    this.scene.add(ambientLight);
    
    const directionalLight = new DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);
  }

  setupEntityFactories() {
    this.entityFactories.set('player', (options) => new Player(this.physicsWorld, options));
    this.entityFactories.set('vehicle', (options) => new Vehicle(this.physicsWorld, options));
    this.entityFactories.set('carrier', (options) => new Carrier(this.physicsWorld, options));
  }

  setupEventListeners() {
    // Handle window resize
    window.addEventListener('resize', () => {
      if (!this.camera || !this.renderer) return;
      
      this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    });
  }

  // Entity creation and management
  createEntity(type, options = {}) {
    const factory = this.entityFactories.get(type);
    if (!factory) {
      throw new Error(`Unknown entity type: ${type}`);
    }
    
    const entity = factory(options);
    
    // Register entity with physics world
    this.physicsWorld.entities.set(entity.id, entity);
    
    // Create Three.js representation if requested
    if (options.createMesh !== false) {
      this.createEntityMesh(entity, type, options);
    }
    
    // Add to root entities if no parent
    if (!entity.parent) {
      this.physicsWorld.addRootEntity(entity);
    }
    
    this.emit('entityCreated', { entity, type, options });
    
    return entity;
  }

  createEntityMesh(entity, type, options) {
    // This would be implemented based on your specific rendering needs
    // For now, create basic placeholder meshes
    const mesh = this.createBasicMesh(type, options);
    
    if (mesh) {
      this.scene.add(mesh);
      this.entities.set(entity.id, mesh);
      mesh.userData.physicsEntity = entity;
    }
  }

  createBasicMesh(type, options) {
    // Placeholder implementation - you would create proper meshes here
    const geometry = this.getGeometryForType(type, options);
    const material = this.getMaterialForType(type, options);
    
    if (geometry && material) {
      const mesh = new Mesh(geometry, material);
      return mesh;
    }
    
    return null;
  }

  getGeometryForType(type, options) {
    switch (type) {
      case 'player':
        const height = options.height || 1.8;
        const radius = options.radius || 0.3;
        return new CapsuleGeometry(radius, height);
        
      case 'vehicle':
        const vLength = options.length || 4.5;
        const vWidth = options.width || 1.8;
        const vHeight = options.height || 1.5;
        return new BoxGeometry(vWidth, vHeight, vLength);
        
      case 'carrier':
        const cLength = options.length || 100;
        const cWidth = options.width || 20;
        const cHeight = options.height || 15;
        return new BoxGeometry(cWidth, cHeight, cLength);
        
      default:
        return new BoxGeometry(1, 1, 1);
    }
  }

  getMaterialForType(type, options) {
    // Placeholder - implement actual material creation
    const materials = {
      player: new MeshLambertMaterial({ color: 0x00ff00 }),
      vehicle: new MeshLambertMaterial({ color: 0x0000ff }),
      carrier: new MeshLambertMaterial({ 
        color: options?.name === 'Ground Platform' ? 0x8B4513 : 0x888888 
      })
    };
    
    return materials[type] || new MeshLambertMaterial({ color: 0xff0000 });
  }

  // Simulation control
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();
    this.accumulator = 0;
    
    this.simulationLoop();
    this.emit('simulationStarted');
  }

  pause() {
    this.isPaused = true;
    this.emit('simulationPaused');
  }

  resume() {
    if (!this.isRunning) return;
    
    this.isPaused = false;
    this.lastTime = performance.now();
    this.emit('simulationResumed');
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.emit('simulationStopped');
  }

  simulationLoop() {
    if (!this.isRunning) return;
    
    const currentTime = performance.now();
    const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
    this.lastTime = currentTime;
    
    if (!this.isPaused) {
      this.update(deltaTime);
    }
    
    this.render();
    
    requestAnimationFrame(() => this.simulationLoop());
  }

  update(deltaTime) {
    // Fixed timestep physics simulation with accumulator
    this.accumulator += Math.min(deltaTime, 0.05); // Cap delta to prevent spiral of death
    
    let subSteps = 0;
    while (this.accumulator >= this.options.fixedTimeStep && subSteps < this.options.maxSubSteps) {
      // Update physics world
      this.physicsWorld.step(this.options.fixedTimeStep);
      
      this.accumulator -= this.options.fixedTimeStep;
      subSteps++;
    }
    
    // Update entity meshes to match physics
    this.syncMeshesToPhysics();
    
    // Update frame counter
    this.frameCount++;
    
    this.emit('simulationUpdate', { deltaTime, subSteps, frameCount: this.frameCount });
  }

  syncMeshesToPhysics() {
    for (const [entityId, mesh] of this.entities) {
      const entity = this.physicsWorld.entities.get(entityId);
      if (!entity) continue;
      
      // Update mesh transform to match physics entity
      mesh.position.copy(entity.worldPosition);
      mesh.quaternion.copy(entity.worldRotation);
      mesh.scale.copy(entity.worldScale);
    }
  }

  render() {
    if (!this.renderer || !this.scene || !this.camera) return;
    
    this.renderer.render(this.scene, this.camera);
    this.emit('render');
  }

  // Utility methods
  getEntity(id) {
    return this.physicsWorld.entities.get(id);
  }

  getAllEntities() {
    return Array.from(this.physicsWorld.entities.values());
  }

  getEntitiesByType(type) {
    return this.getAllEntities().filter(entity => {
      if (type === 'player') return entity instanceof Player;
      if (type === 'vehicle') return entity instanceof Vehicle;
      if (type === 'carrier') return entity instanceof Carrier;
      return false;
    });
  }

  // Create a proper ground plane
  createGroundPlane() {
    const groundEntity = this.physicsWorld.createEntity({
      isKinematic: true,
      createRigidBody: true,
      collider: {
        type: 'box',
        halfExtents: {
          x: 1000, // Very large ground
          y: 1,    // Thin
          z: 1000
        },
        friction: 0.8,
        restitution: 0.1,
        density: 1.0
      }
    });
    
    // Create visual representation
    const groundGeometry = new BoxGeometry(2000, 2, 2000);
    const groundMaterial = new MeshLambertMaterial({ color: 0x228B22 }); // Forest green
    const groundMesh = new Mesh(groundGeometry, groundMaterial);
    
    this.scene.add(groundMesh);
    this.entities.set(groundEntity.id, groundMesh);
    groundMesh.userData.physicsEntity = groundEntity;
    
    // Register with physics world
    this.physicsWorld.entities.set(groundEntity.id, groundEntity);
    this.physicsWorld.addRootEntity(groundEntity);
    
    return groundEntity;
  }

  // Example hierarchy setup
  createExampleHierarchy() {
    // Create ground platform to prevent infinite falling
    const ground = this.createGroundPlane();
    
    // Position ground at Y=-1 (below everything)
    ground.localPosition.set(0, -1, 0);
    if (ground.rigidBody) {
      ground.rigidBody.setTranslation({ x: 0, y: -1, z: 0 });
      ground.rigidBody.setBodyType(1); // Kinematic/static
    }
    
    // Create world carrier at origin (large enough to contain smaller ships)
    const worldCarrier = this.createEntity('carrier', {
      name: 'World Carrier',
      mass: 20000,
      length: 80,
      width: 25,
      height: 15
    });
    
    // Position world carrier above ground
    worldCarrier.localPosition.set(0, 15, 0);
    if (worldCarrier.rigidBody) {
      worldCarrier.rigidBody.setTranslation({ x: 0, y: 15, z: 0 });
    }
    
    // Create smaller carrier INSIDE the world carrier
    const smallCarrier = this.createEntity('carrier', {
      name: 'Escort Carrier',
      mass: 8000,
      length: 35,
      width: 12,
      height: 8
    });
    
    // Position small carrier INSIDE world carrier (relative position)
    smallCarrier.localPosition.set(0, 2, 0); // Slightly above the deck
    smallCarrier.localRotation.set(0, 0, 0, 1);
    
    // Make small carrier a child of world carrier immediately
    worldCarrier.addChild(smallCarrier);
    
    // Make small carrier kinematic initially to prevent falling through
    if (smallCarrier.rigidBody) {
      smallCarrier.rigidBody.setBodyType(1); // Kinematic
      smallCarrier.isKinematic = true;
    }
    
    // Create vehicle INSIDE the small carrier
    const vehicle = this.createEntity('vehicle', {
      name: 'Transport Vehicle',
      mass: 2000
    });
    
    // Position vehicle inside small carrier (relative position)
    vehicle.localPosition.set(0, 1, 0); // Above the small carrier deck
    vehicle.localRotation.set(0, 0, 0, 1);
    
    // Make vehicle a child of small carrier immediately
    smallCarrier.addChild(vehicle);
    
    // Make vehicle kinematic initially to prevent falling through
    if (vehicle.rigidBody) {
      vehicle.rigidBody.setBodyType(1); // Kinematic
      vehicle.isKinematic = true;
    }
    
    // Create player INSIDE the vehicle
    const player = this.createEntity('player', {
      name: 'Test Player'
    });
    
    // Position player inside vehicle (relative position) 
    player.localPosition.set(0, 0.5, 0); // Inside the vehicle
    player.localRotation.set(0, 0, 0, 1);
    
    // Make player a child of vehicle immediately
    vehicle.addChild(player);
    
    // Make player kinematic to prevent falling through
    if (player.rigidBody) {
      player.rigidBody.setBodyType(1); // Kinematic
      player.isKinematic = true;
    }
    
    // Update collision groups for the entire hierarchy to prevent internal collisions
    this.physicsWorld.updateHierarchyCollisionGroups(worldCarrier);
    this.physicsWorld.updateHierarchyCollisionGroups(ground);
    
    // Position camera to view the hierarchy
    this.camera.position.set(0, 30, 100);
    this.camera.lookAt(0, 10, 0);
    
    this.emit('exampleHierarchyCreated', {
      ground,
      worldCarrier,
      smallCarrier,
      vehicle,
      player
    });
    
    return { ground, worldCarrier, smallCarrier, vehicle, player };
  }

  // Event system
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data = null) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  // Debug information
  getSimulationStats() {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      frameCount: this.frameCount,
      entityCount: this.physicsWorld.entities.size,
      rootEntityCount: this.physicsWorld.rootEntities.size,
      activeTransitions: this.transitionManager.activeTransitions.size
    };
  }

  // Cleanup
  dispose() {
    this.stop();
    
    // Clean up Three.js
    if (this.renderer) {
      this.renderer.dispose();
    }
    
    // Clean up physics
    if (this.physicsWorld) {
      this.physicsWorld.dispose();
    }
    
    if (this.transitionManager) {
      this.transitionManager.dispose();
    }
    
    // Clear event listeners
    this.eventListeners.clear();
    this.entities.clear();
    
    this.emit('disposed');
  }
}