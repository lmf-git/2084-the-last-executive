export const GhostTypes = {
  BOX: 'box',
  SPHERE: 'sphere',
  CYLINDER: 'cylinder'
};

export class GhostConstants {
  static INTERACTION_RANGE = 3;
  static CARRY_DISTANCE = 2.5;
  static THROW_FORCE = 15;
  static MAX_CARRY_MASS = 50;
  
  // Default sizes for different ghost types
  static DEFAULT_SIZES = {
    [GhostTypes.BOX]: { width: 1, height: 1, depth: 1 },
    [GhostTypes.SPHERE]: { radius: 0.5 },
    [GhostTypes.CYLINDER]: { radius: 0.5, height: 1 }
  };
  
  // Physics properties
  static DEFAULT_MASS = 10;
  static DEFAULT_RESTITUTION = 0.3;
  static DEFAULT_FRICTION = 0.5;
}
