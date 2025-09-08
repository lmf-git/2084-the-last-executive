export const VehicleTypes = {
  CAR: 'car',
  TRUCK: 'truck',
  TANK: 'tank',
  HELICOPTER: 'helicopter',
  PLANE: 'plane'
};

export class VehicleConstants {
  static INTERACTION_RANGE = 5;
  static CAR_SIZE = {
    width: 2,
    height: 1.2,
    length: 4
  };
  static CAR_SPEED = 15;
  static CAR_TURN_SPEED = 2;
  
  // Helicopter constants
  static HELICOPTER_SIZE = {
    width: 2.5,
    height: 2.5,
    length: 5
  };
  static HELICOPTER_LIFT_FORCE = 15;
  static HELICOPTER_MAX_ALTITUDE = 50;
  static HELICOPTER_FORWARD_SPEED = 20;
  static HELICOPTER_TURN_SPEED = 1.5;
  static HELICOPTER_TILT_ANGLE = 0.3; // Max tilt in radians
  
  // Plane constants
  static PLANE_SIZE = {
    width: 6,
    height: 2,
    length: 5
  };
  static PLANE_MIN_SPEED = 10; // Minimum speed to generate lift
  static PLANE_MAX_SPEED = 40;
  static PLANE_ACCELERATION = 8;
  static PLANE_LIFT_COEFFICIENT = 0.8;
  static PLANE_TURN_SPEED = 1.0;
  static PLANE_PITCH_SPEED = 0.8;
}
