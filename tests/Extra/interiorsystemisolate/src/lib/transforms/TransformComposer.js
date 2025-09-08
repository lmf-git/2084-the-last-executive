import { Vector3, Matrix4, Quaternion } from 'three';

export class TransformComposer {
  constructor() {
    this.tempMatrix = new Matrix4();
    this.tempVector = new Vector3();
    this.tempQuaternion = new Quaternion();
  }

  // Update transforms for entire hierarchy from root to leaves
  updateHierarchy(rootEntity) {
    this._updateEntityRecursive(rootEntity);
  }

  _updateEntityRecursive(entity) {
    // Update this entity's world transform
    entity.updateWorldTransform();
    
    // Update all children
    for (const child of entity.children) {
      this._updateEntityRecursive(child);
    }
  }

  // Compose velocity from parent motion and local motion
  composeVelocity(entity, localVelocity) {
    const worldVelocity = new Vector3();
    
    if (entity.parent && entity.parent.rigidBody) {
      // Get parent's velocity in world space
      const parentVel = entity.parent.rigidBody.linvel();
      const parentWorldVel = new Vector3(parentVel.x, parentVel.y, parentVel.z);
      
      // Transform local velocity to world space
      const localWorldVel = localVelocity.clone()
        .applyQuaternion(entity.worldRotation);
      
      // Combine parent and local velocities
      worldVelocity.copy(parentWorldVel).add(localWorldVel);
    } else {
      // No parent - just transform local velocity to world space
      worldVelocity.copy(localVelocity)
        .applyQuaternion(entity.worldRotation);
    }
    
    return worldVelocity;
  }

  // Compose angular velocity from parent and local rotation
  composeAngularVelocity(entity, localAngularVelocity) {
    const worldAngularVelocity = new Vector3();
    
    if (entity.parent && entity.parent.rigidBody) {
      // Get parent's angular velocity
      const parentAngVel = entity.parent.rigidBody.angvel();
      const parentWorldAngVel = new Vector3(parentAngVel.x, parentAngVel.y, parentAngVel.z);
      
      // Transform local angular velocity to world space
      const localWorldAngVel = localAngularVelocity.clone()
        .applyQuaternion(entity.worldRotation);
      
      // Combine parent and local angular velocities
      worldAngularVelocity.copy(parentWorldAngVel).add(localWorldAngVel);
    } else {
      // No parent - just transform to world space
      worldAngularVelocity.copy(localAngularVelocity)
        .applyQuaternion(entity.worldRotation);
    }
    
    return worldAngularVelocity;
  }

  // Get relative transform between two entities
  getRelativeTransform(fromEntity, toEntity) {
    // Find common ancestor
    const commonAncestor = this._findCommonAncestor(fromEntity, toEntity);
    
    // Build transform from 'from' to common ancestor
    const fromToCommon = this._buildTransformToAncestor(fromEntity, commonAncestor);
    
    // Build transform from common ancestor to 'to'
    const commonToTo = this._buildTransformToAncestor(toEntity, commonAncestor);
    commonToTo.invert();
    
    // Combine transforms
    const relativeTransform = new Matrix4();
    relativeTransform.multiplyMatrices(commonToTo, fromToCommon);
    
    return relativeTransform;
  }

  _findCommonAncestor(entityA, entityB) {
    // Build path from entityA to root
    const pathA = [];
    let current = entityA;
    while (current) {
      pathA.push(current);
      current = current.parent;
    }
    
    // Walk up from entityB until we find a common ancestor
    current = entityB;
    while (current) {
      if (pathA.includes(current)) {
        return current;
      }
      current = current.parent;
    }
    
    return null; // No common ancestor (different trees)
  }

  _buildTransformToAncestor(entity, ancestor) {
    const transform = new Matrix4().identity();
    
    let current = entity;
    while (current && current !== ancestor) {
      const localMatrix = current.getLocalMatrix();
      transform.multiplyMatrices(localMatrix, transform);
      current = current.parent;
    }
    
    return transform;
  }

  // Synchronize physics body transform with entity world transform
  syncPhysicsToEntity(entity) {
    if (!entity.rigidBody) return;
    
    // Update rigid body position and rotation
    entity.rigidBody.setTranslation({
      x: entity.worldPosition.x,
      y: entity.worldPosition.y,
      z: entity.worldPosition.z
    });
    
    entity.rigidBody.setRotation({
      x: entity.worldRotation.x,
      y: entity.worldRotation.y,
      z: entity.worldRotation.z,
      w: entity.worldRotation.w
    });
  }

  // Update entity transform from physics body
  syncEntityToPhysics(entity) {
    if (!entity.rigidBody) return;
    
    const translation = entity.rigidBody.translation();
    const rotation = entity.rigidBody.rotation();
    
    // Update world transform
    entity.worldPosition.set(translation.x, translation.y, translation.z);
    entity.worldRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
    
    // Convert world transform back to local transform
    if (entity.parent) {
      const parentWorldMatrix = entity.parent.worldMatrix;
      const inverseParentMatrix = parentWorldMatrix.clone().invert();
      
      // Create world matrix from physics body
      entity.worldMatrix.compose(
        entity.worldPosition,
        entity.worldRotation,
        entity.worldScale
      );
      
      // Get local matrix relative to parent
      const localMatrix = new Matrix4();
      localMatrix.multiplyMatrices(inverseParentMatrix, entity.worldMatrix);
      
      // Decompose to local transform
      localMatrix.decompose(
        entity.localPosition,
        entity.localRotation,
        entity.localScale
      );
    } else {
      // Root entity - world = local
      entity.localPosition.copy(entity.worldPosition);
      entity.localRotation.copy(entity.worldRotation);
    }
  }
}