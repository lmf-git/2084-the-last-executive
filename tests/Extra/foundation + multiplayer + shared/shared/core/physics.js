import { PlayerConstants } from '../entity/players.js';

export class PhysicsConstants {
  static TIMESTEP = 1 / 60;
  static GRAVITY = { x: 0, y: -9.81, z: 0 };
}

export class Physics {
  static vector3ToRapier(v, RAPIER) {
    return new RAPIER.Vector3(v.x, v.y, v.z);
  }

  static rapierToVector3(v) {
    return { x: v.x, y: v.y, z: v.z };
  }

  // These methods now return configuration objects instead of RAPIER objects
  static getPlayerColliderConfig() {
    return {
      type: 'capsule',
      halfHeight: PlayerConstants.HEIGHT / 2,
      radius: PlayerConstants.RADIUS
    };
  }

  static getGroundColliderConfig(width = 50, height = 0.5, depth = 50) {
    return {
      type: 'cuboid',
      halfExtents: { x: width, y: height, z: depth }
    };
  }

  static getPlayerRigidBodyConfig(position = { x: 0, y: 5, z: 0 }) {
    return {
      type: 'dynamic',
      translation: position,
      linearDamping: 0.5
    };
  }

  static isGrounded(rigidBody, groundLevel = 1, tolerance = 0.1) {
    return Math.abs(rigidBody.translation().y - groundLevel) < tolerance;
  }
}
