import { Vector3, Matrix4, Quaternion } from 'three';

export class PhysicsEntity {
  constructor(world, options = {}) {
    this.id = crypto.randomUUID();
    this.world = world;
    this.parent = null;
    this.children = new Set();
    
    // Local transform (relative to parent)
    this.localPosition = new Vector3();
    this.localRotation = new Quaternion();
    this.localScale = new Vector3(1, 1, 1);
    
    // World transform (computed)
    this.worldPosition = new Vector3();
    this.worldRotation = new Quaternion();
    this.worldScale = new Vector3(1, 1, 1);
    this.worldMatrix = new Matrix4();
    
    // Physics properties
    this.rigidBody = null;
    this.isKinematic = options.isKinematic || false;
    this.mass = options.mass || 1.0;
    
    // Hierarchy management
    this.transformDirty = true;
    this.hierarchyLevel = 0;
  }

  addChild(child) {
    if (child.parent) {
      child.parent.removeChild(child);
    }
    
    // Remove from root entities if it was a root
    if (this.world && this.world.rootEntities && this.world.rootEntities.has(child)) {
      this.world.removeRootEntity(child);
    }
    
    child.parent = this;
    child.hierarchyLevel = this.hierarchyLevel + 1;
    this.children.add(child);
    
    this.markTransformDirty();
  }

  removeChild(child) {
    if (this.children.has(child)) {
      child.parent = null;
      child.hierarchyLevel = 0;
      this.children.delete(child);
      
      this.markTransformDirty();
    }
  }

  markTransformDirty() {
    this.transformDirty = true;
    
    // Propagate dirty flag to children
    for (const child of this.children) {
      child.markTransformDirty();
    }
  }

  updateWorldTransform() {
    if (!this.transformDirty) return;
    
    if (this.parent) {
      // Compose with parent transform
      this.worldMatrix.multiplyMatrices(
        this.parent.worldMatrix,
        this.getLocalMatrix()
      );
    } else {
      // Root entity - use local transform as world
      this.worldMatrix.copy(this.getLocalMatrix());
    }
    
    // Decompose world matrix
    this.worldMatrix.decompose(
      this.worldPosition,
      this.worldRotation,
      this.worldScale
    );
    
    this.transformDirty = false;
  }

  getLocalMatrix() {
    return new Matrix4().compose(
      this.localPosition,
      this.localRotation,
      this.localScale
    );
  }

  // Convert position from this entity's frame to parent frame
  toParentFrame(position) {
    if (!this.parent) return position.clone();
    
    const localMatrix = this.getLocalMatrix();
    return position.clone().applyMatrix4(localMatrix);
  }

  // Convert position from parent frame to this entity's frame
  fromParentFrame(position) {
    if (!this.parent) return position.clone();
    
    const localMatrix = this.getLocalMatrix();
    const inverseMatrix = localMatrix.invert();
    return position.clone().applyMatrix4(inverseMatrix);
  }

  // Transition this entity to a new parent
  transferTo(newParent) {
    if (this.parent === newParent) return;
    
    // Convert current world position to new parent's local space
    const worldPos = this.worldPosition.clone();
    
    if (this.parent) {
      this.parent.removeChild(this);
    }
    
    if (newParent) {
      // Convert world position to new parent's local space
      const newLocalPos = newParent.fromParentFrame(worldPos);
      this.localPosition.copy(newLocalPos);
      
      newParent.addChild(this);
    } else {
      // Becoming root - world position becomes local position
      this.localPosition.copy(worldPos);
    }
    
    this.markTransformDirty();
  }

  dispose() {
    // Remove from parent
    if (this.parent) {
      this.parent.removeChild(this);
    }
    
    // Remove all children
    for (const child of this.children) {
      child.dispose();
    }
    
    // Clean up physics body
    if (this.rigidBody) {
      this.world.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
    }
  }
}