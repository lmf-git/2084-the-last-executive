import { Vector3, Quaternion } from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class EntityTransitionManager {
  constructor(physicsWorld) {
    this.physicsWorld = physicsWorld;
    this.transitionCallbacks = new Map();
    this.activeTransitions = new Set();
  }

  // Register callback for transition events
  onTransition(entityId, callback) {
    if (!this.transitionCallbacks.has(entityId)) {
      this.transitionCallbacks.set(entityId, []);
    }
    this.transitionCallbacks.get(entityId).push(callback);
  }

  // Remove transition callback
  offTransition(entityId, callback) {
    const callbacks = this.transitionCallbacks.get(entityId);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  // Main transition method - moves entity between parents with motion preservation
  async transferEntity(entityId, newParentId, options = {}) {
    const entity = this.physicsWorld.entities.get(entityId);
    const newParent = newParentId ? this.physicsWorld.entities.get(newParentId) : null;
    
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }
    
    if (newParentId && !newParent) {
      throw new Error(`New parent entity ${newParentId} not found`);
    }

    // Prevent circular references
    if (this.wouldCreateCycle(entity, newParent)) {
      throw new Error('Transfer would create circular hierarchy');
    }

    // Mark transition as active
    this.activeTransitions.add(entityId);

    try {
      // Prepare transition data
      const transitionData = await this.prepareTransition(entity, newParent, options);
      
      // Execute the transition
      await this.executeTransition(entity, newParent, transitionData, options);
      
      // Notify callbacks
      this.notifyTransitionCallbacks(entityId, {
        type: 'completed',
        fromParent: transitionData.oldParent,
        toParent: newParent,
        preservedMotion: transitionData.preservedMotion
      });
      
    } catch (error) {
      // Notify error callbacks
      this.notifyTransitionCallbacks(entityId, {
        type: 'error',
        error: error.message
      });
      throw error;
    } finally {
      // Remove from active transitions
      this.activeTransitions.delete(entityId);
    }
  }

  async prepareTransition(entity, newParent, options) {
    const oldParent = entity.parent;
    
    // Capture current motion state
    const preservedMotion = this.captureMotionState(entity);
    
    // Calculate new local transform in target parent space
    const newLocalTransform = this.calculateNewLocalTransform(entity, newParent);
    
    // Prepare collision group changes if needed
    const collisionGroups = this.calculateCollisionGroups(entity, newParent, options);
    
    return {
      oldParent,
      newLocalTransform,
      preservedMotion,
      collisionGroups
    };
  }

  captureMotionState(entity) {
    if (!entity.rigidBody) {
      return {
        linearVelocity: new Vector3(),
        angularVelocity: new Vector3()
      };
    }

    const linVel = entity.rigidBody.linvel();
    const angVel = entity.rigidBody.angvel();
    
    return {
      linearVelocity: new Vector3(linVel.x, linVel.y, linVel.z),
      angularVelocity: new Vector3(angVel.x, angVel.y, angVel.z),
      worldPosition: entity.worldPosition.clone(),
      worldRotation: entity.worldRotation.clone()
    };
  }

  calculateNewLocalTransform(entity, newParent) {
    if (!newParent) {
      // Becoming root - world transform becomes local
      return {
        position: entity.worldPosition.clone(),
        rotation: entity.worldRotation.clone(),
        scale: entity.worldScale.clone()
      };
    }

    // Convert current world transform to new parent's local space
    const relativeTransform = this.physicsWorld.transformComposer
      .getRelativeTransform(entity, newParent);
    
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    
    relativeTransform.decompose(position, rotation, scale);
    
    return { position, rotation, scale };
  }

  calculateCollisionGroups(entity, newParent, options) {
    // Default collision groups based on hierarchy level
    const baseGroups = {
      membership: 1 << (newParent ? newParent.hierarchyLevel + 1 : 0),
      filter: 0xFFFF
    };
    
    // Override with user-provided groups
    return { ...baseGroups, ...options.collisionGroups };
  }

  async executeTransition(entity, newParent, transitionData, options) {
    // Pause physics simulation during transition to prevent artifacts
    const wasKinematic = entity.isKinematic;
    if (entity.rigidBody && !wasKinematic) {
      entity.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
    }

    try {
      // Perform hierarchy transfer
      entity.transferTo(newParent);
      
      // Apply new local transform
      entity.localPosition.copy(transitionData.newLocalTransform.position);
      entity.localRotation.copy(transitionData.newLocalTransform.rotation);
      entity.localScale.copy(transitionData.newLocalTransform.scale);
      
      // Update world transforms
      this.physicsWorld.transformComposer.updateHierarchy(
        this.findRootEntity(entity)
      );
      
      // Restore motion in new reference frame
      await this.restoreMotionState(entity, transitionData.preservedMotion, options);
      
      // Update collision groups
      if (transitionData.collisionGroups) {
        this.physicsWorld.setupCollisionGroups(entity, transitionData.collisionGroups);
      }
      
    } finally {
      // Restore physics body type
      if (entity.rigidBody && !wasKinematic) {
        entity.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic);
      }
    }
  }

  async restoreMotionState(entity, motionState, options) {
    if (!entity.rigidBody || !motionState) return;
    
    // Convert preserved world velocities to new local reference frame
    let targetLinVel = motionState.linearVelocity.clone();
    let targetAngVel = motionState.angularVelocity.clone();
    
    // Apply motion preservation strategy
    const strategy = options.motionPreservation || 'inherit';
    
    switch (strategy) {
      case 'preserve_world':
        // Keep absolute world velocity
        break;
        
      case 'preserve_relative':
        // Subtract parent motion to get relative velocity
        if (entity.parent && entity.parent.rigidBody) {
          const parentLinVel = entity.parent.rigidBody.linvel();
          const parentAngVel = entity.parent.rigidBody.angvel();
          
          targetLinVel.sub(new Vector3(parentLinVel.x, parentLinVel.y, parentLinVel.z));
          targetAngVel.sub(new Vector3(parentAngVel.x, parentAngVel.y, parentAngVel.z));
        }
        break;
        
      case 'inherit':
        // Inherit parent motion, preserve only relative velocity
        if (entity.parent) {
          const composedVel = this.physicsWorld.transformComposer
            .composeVelocity(entity, new Vector3());
          const composedAngVel = this.physicsWorld.transformComposer
            .composeAngularVelocity(entity, new Vector3());
          
          targetLinVel = composedVel;
          targetAngVel = composedAngVel;
        }
        break;
        
      case 'zero':
        // Reset all motion
        targetLinVel.set(0, 0, 0);
        targetAngVel.set(0, 0, 0);
        break;
    }
    
    // Apply smoothing if requested
    if (options.smoothTransition) {
      await this.applySmoothVelocityTransition(entity, targetLinVel, targetAngVel, options);
    } else {
      // Immediate velocity application
      entity.rigidBody.setLinvel({ x: targetLinVel.x, y: targetLinVel.y, z: targetLinVel.z }, true);
      entity.rigidBody.setAngvel({ x: targetAngVel.x, y: targetAngVel.y, z: targetAngVel.z }, true);
    }
  }

  async applySmoothVelocityTransition(entity, targetLinVel, targetAngVel, options) {
    const duration = options.transitionDuration || 0.1; // 100ms default
    const steps = Math.ceil(duration / this.physicsWorld.timeStep);
    
    if (steps <= 1) {
      // Too short for smoothing
      entity.rigidBody.setLinvel({ x: targetLinVel.x, y: targetLinVel.y, z: targetLinVel.z }, true);
      entity.rigidBody.setAngvel({ x: targetAngVel.x, y: targetAngVel.y, z: targetAngVel.z }, true);
      return;
    }
    
    // Get current velocity
    const currentLinVel = entity.rigidBody.linvel();
    const currentAngVel = entity.rigidBody.angvel();
    
    const startLinVel = new Vector3(currentLinVel.x, currentLinVel.y, currentLinVel.z);
    const startAngVel = new Vector3(currentAngVel.x, currentAngVel.y, currentAngVel.z);
    
    // Interpolate over multiple physics steps
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const easedT = this.easeInOutCubic(t);
      
      const interpLinVel = startLinVel.clone().lerp(targetLinVel, easedT);
      const interpAngVel = startAngVel.clone().lerp(targetAngVel, easedT);
      
      entity.rigidBody.setLinvel({ 
        x: interpLinVel.x, 
        y: interpLinVel.y, 
        z: interpLinVel.z 
      }, true);
      
      entity.rigidBody.setAngvel({ 
        x: interpAngVel.x, 
        y: interpAngVel.y, 
        z: interpAngVel.z 
      }, true);
      
      // Wait for next physics step
      if (step < steps) {
        await new Promise(resolve => setTimeout(resolve, this.physicsWorld.timeStep * 1000));
      }
    }
  }

  easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  wouldCreateCycle(entity, newParent) {
    if (!newParent) return false;
    
    // Check if newParent is a descendant of entity
    let current = newParent;
    while (current) {
      if (current === entity) return true;
      current = current.parent;
    }
    
    return false;
  }

  findRootEntity(entity) {
    let root = entity;
    while (root.parent) {
      root = root.parent;
    }
    return root;
  }

  notifyTransitionCallbacks(entityId, eventData) {
    const callbacks = this.transitionCallbacks.get(entityId);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(eventData);
        } catch (error) {
          console.error('Error in transition callback:', error);
        }
      });
    }
  }

  // Batch transition for multiple entities
  async transferMultipleEntities(transfers, options = {}) {
    const results = [];
    
    if (options.parallel) {
      // Execute transfers in parallel
      const promises = transfers.map(({ entityId, newParentId, transferOptions }) =>
        this.transferEntity(entityId, newParentId, { ...options, ...transferOptions })
          .then(() => ({ entityId, success: true }))
          .catch(error => ({ entityId, success: false, error: error.message }))
      );
      
      results.push(...await Promise.all(promises));
    } else {
      // Execute transfers sequentially
      for (const { entityId, newParentId, transferOptions } of transfers) {
        try {
          await this.transferEntity(entityId, newParentId, { ...options, ...transferOptions });
          results.push({ entityId, success: true });
        } catch (error) {
          results.push({ entityId, success: false, error: error.message });
          
          if (options.stopOnError) break;
        }
      }
    }
    
    return results;
  }

  dispose() {
    this.transitionCallbacks.clear();
    this.activeTransitions.clear();
  }
}