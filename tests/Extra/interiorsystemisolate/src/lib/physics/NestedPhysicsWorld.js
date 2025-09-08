import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { PhysicsEntity } from '../entities/PhysicsEntity.js';
import { TransformComposer } from '../transforms/TransformComposer.js';

export class NestedPhysicsWorld {
  constructor() {
    this.rapierWorld = null;
    this.entities = new Map();
    this.rootEntities = new Set();
    this.transformComposer = new TransformComposer();
    
    // Simulation state
    this.isInitialized = false;
    this.timeStep = 1.0 / 60.0;
    this.maxHierarchyDepth = 10;
  }

  async initialize() {
    await RAPIER.init();
    
    // Create physics world with gravity
    const gravity = new RAPIER.Vector3(0.0, -9.81, 0.0);
    this.rapierWorld = new RAPIER.World(gravity);
    
    this.isInitialized = true;
  }

  createEntity(options = {}) {
    const entity = new PhysicsEntity(this, options);
    this.entities.set(entity.id, entity);
    
    // Create physics body if needed
    if (options.createRigidBody !== false) {
      this.createRigidBody(entity, options);
    }
    
    return entity;
  }

  createRigidBody(entity, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Physics world not initialized');
    }

    // Create rigid body descriptor
    const rigidBodyDesc = options.isKinematic 
      ? RAPIER.RigidBodyDesc.kinematicPositionBased()
      : RAPIER.RigidBodyDesc.dynamic();

    // Set initial transform
    rigidBodyDesc.setTranslation(
      entity.worldPosition.x,
      entity.worldPosition.y,
      entity.worldPosition.z
    );
    
    rigidBodyDesc.setRotation({
      x: entity.worldRotation.x,
      y: entity.worldRotation.y,
      z: entity.worldRotation.z,
      w: entity.worldRotation.w
    });

    // Create rigid body
    entity.rigidBody = this.rapierWorld.createRigidBody(rigidBodyDesc);
    
    // Create collider if geometry provided
    if (options.collider) {
      this.createCollider(entity, options.collider);
    }

    return entity.rigidBody;
  }

  createCollider(entity, colliderOptions) {
    if (!entity.rigidBody) {
      throw new Error('Entity must have rigid body before adding collider');
    }

    let colliderDesc;
    
    switch (colliderOptions.type) {
      case 'box':
        colliderDesc = RAPIER.ColliderDesc.cuboid(
          colliderOptions.halfExtents.x,
          colliderOptions.halfExtents.y,
          colliderOptions.halfExtents.z
        );
        break;
      case 'sphere':
        colliderDesc = RAPIER.ColliderDesc.ball(colliderOptions.radius);
        break;
      case 'capsule':
        colliderDesc = RAPIER.ColliderDesc.capsule(
          colliderOptions.halfHeight,
          colliderOptions.radius
        );
        break;
      default:
        throw new Error(`Unsupported collider type: ${colliderOptions.type}`);
    }

    // Set collider properties
    if (colliderOptions.friction !== undefined) {
      colliderDesc.setFriction(colliderOptions.friction);
    }
    if (colliderOptions.restitution !== undefined) {
      colliderDesc.setRestitution(colliderOptions.restitution);
    }
    if (colliderOptions.density !== undefined) {
      colliderDesc.setDensity(colliderOptions.density);
    }

    const collider = this.rapierWorld.createCollider(colliderDesc, entity.rigidBody);
    entity.collider = collider;
    
    return collider;
  }

  // Main simulation step - processes hierarchy from outermost to innermost
  step(deltaTime = this.timeStep) {
    if (!this.isInitialized) return;

    // 1. Update all transform hierarchies
    this.updateTransformHierarchies();
    
    // 2. Apply hierarchical physics simulation
    this.simulateHierarchicalPhysics(deltaTime);
    
    // 3. Step the main physics world
    this.rapierWorld.step();
    
    // 4. Sync physics results back to entities
    this.syncPhysicsToEntities();
  }

  updateTransformHierarchies() {
    // Update transforms for all root entities (and their children recursively)
    for (const rootEntity of this.rootEntities) {
      this.transformComposer.updateHierarchy(rootEntity);
    }
  }

  simulateHierarchicalPhysics(deltaTime) {
    // Group entities by hierarchy level for ordered processing
    const levelGroups = new Map();
    
    for (const entity of this.entities.values()) {
      const level = entity.hierarchyLevel;
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level).push(entity);
    }
    
    // Process from outermost (level 0) to innermost
    const maxLevel = Math.max(...levelGroups.keys());
    for (let level = 0; level <= Math.min(maxLevel, this.maxHierarchyDepth); level++) {
      const entities = levelGroups.get(level) || [];
      this.simulateLevel(entities, deltaTime);
    }
  }

  simulateLevel(entities, deltaTime) {
    for (const entity of entities) {
      if (!entity.rigidBody) continue;
      
      // For kinematic parents, update their physics representation
      if (entity.isKinematic && entity.children.size > 0) {
        this.updateKinematicProxy(entity);
      }
      
      // Apply inherited motion from parent
      if (entity.parent && entity.parent.rigidBody) {
        this.applyInheritedMotion(entity, entity.parent);
      }
    }
  }

  updateKinematicProxy(entity) {
    // Update kinematic body to match entity's world transform
    this.transformComposer.syncPhysicsToEntity(entity);
  }

  applyInheritedMotion(childEntity, parentEntity) {
    if (!childEntity.rigidBody || !parentEntity.rigidBody) return;
    
    // Get parent velocity in world space
    const parentLinVel = parentEntity.rigidBody.linvel();
    const parentAngVel = parentEntity.rigidBody.angvel();
    
    // Get child's local velocity
    const childLinVel = childEntity.rigidBody.linvel();
    const childAngVel = childEntity.rigidBody.angvel();
    
    // Compose velocities using transform composer
    const localVel = new Vector3(childLinVel.x, childLinVel.y, childLinVel.z);
    const localAngVel = new Vector3(childAngVel.x, childAngVel.y, childAngVel.z);
    
    const worldVel = this.transformComposer.composeVelocity(childEntity, localVel);
    const worldAngVel = this.transformComposer.composeAngularVelocity(childEntity, localAngVel);
    
    // Apply composed velocity to physics body
    childEntity.rigidBody.setLinvel({
      x: worldVel.x,
      y: worldVel.y,
      z: worldVel.z
    }, true);
    
    childEntity.rigidBody.setAngvel({
      x: worldAngVel.x,
      y: worldAngVel.y,
      z: worldAngVel.z
    }, true);
  }

  syncPhysicsToEntities() {
    for (const entity of this.entities.values()) {
      if (entity.rigidBody && !entity.isKinematic) {
        this.transformComposer.syncEntityToPhysics(entity);
      }
    }
  }

  addRootEntity(entity) {
    this.rootEntities.add(entity);
  }

  removeRootEntity(entity) {
    this.rootEntities.delete(entity);
  }

  removeEntity(entityId) {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    
    // Remove from root entities if it's a root
    this.rootEntities.delete(entity);
    
    // Dispose entity (handles hierarchy cleanup)
    entity.dispose();
    
    // Remove from entities map
    this.entities.delete(entityId);
  }

  // Collision filtering for nested hierarchies
  setupCollisionGroups(entity, groups = {}) {
    if (!entity.collider) return;
    
    // Create collision groups based on hierarchy level to prevent parent-child collisions
    const hierarchyLevel = entity.hierarchyLevel;
    const membership = groups.membership || (1 << hierarchyLevel);
    
    // Filter excludes the entity's own group and its parent's group
    let filter = groups.filter || 0xFFFF;
    if (entity.parent) {
      const parentGroup = 1 << entity.parent.hierarchyLevel;
      filter = filter & (~parentGroup); // Exclude parent's group
    }
    filter = filter & (~membership); // Exclude own group
    
    entity.collider.setCollisionGroups(membership, filter);
  }
  
  // Update collision groups for entire hierarchy
  updateHierarchyCollisionGroups(rootEntity) {
    this.setupCollisionGroups(rootEntity);
    for (const child of rootEntity.children) {
      this.updateHierarchyCollisionGroups(child);
    }
  }

  dispose() {
    // Clean up all entities
    for (const entity of this.entities.values()) {
      entity.dispose();
    }
    
    this.entities.clear();
    this.rootEntities.clear();
    
    // Clean up Rapier world
    if (this.rapierWorld) {
      this.rapierWorld.free();
      this.rapierWorld = null;
    }
    
    this.isInitialized = false;
  }
}