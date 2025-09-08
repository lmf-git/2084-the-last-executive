export const MessageTypes = {
  INIT: 'init',
  JOIN: 'join',
  LEAVE: 'leave',
  INPUT: 'input',
  GAME_STATE: 'gameState',
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  FIRE: 'fire',
  HIT: 'hit',
  PROJECTILE_SPAWN: 'projectileSpawn',
  PROJECTILE_REMOVE: 'projectileRemove',
  ENTER_VEHICLE: 'enterVehicle',
  EXIT_VEHICLE: 'exitVehicle',
  VEHICLE_UPDATE: 'vehicleUpdate',
  GRAB_GHOST: 'grabGhost',
  DROP_GHOST: 'dropGhost',
  THROW_GHOST: 'throwGhost',
  GHOST_UPDATE: 'ghostUpdate'
};

// Model paths for 3D assets
export const ModelPaths = {
  // Player models
  PLAYER: '/models/player.glb',
  
  // Vehicle models
  CAR: '/models/vehicles/car.glb',
  HELICOPTER: '/models/vehicles/helicopter.glb',
  PLANE: '/models/vehicles/plane.glb',
  
  // Ghost models
  GHOST_BOX: '/models/ghosts/box.glb',
  GHOST_SPHERE: '/models/ghosts/sphere.glb',
  GHOST_CYLINDER: '/models/ghosts/cylinder.glb'
}