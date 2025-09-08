import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';
import { Document, NodeIO } from '@gltf-transform/core';

const server = createServer();
const wss = new WebSocketServer({ server });

let world;
let vehicles = new Map();
let players = new Map();
let playerBodies = new Map();
let planeRigidBody; // Add plane physics body
let planeTakeoffActive = false;
let playersOnPlane = new Set(); // Track which players are on the plane
let planeRotationX = 0; // Track plane rotation
let planeAnimationTime = 0; // Track animation progress

class GLBParser {
  constructor() {
    this.io = new NodeIO();
    this.clientBaseUrl = 'http://localhost:3000';
  }

  async parseGLB(buffer) {
    const document = await this.io.readBinary(new Uint8Array(buffer));
    const root = document.getRoot();
    
    const colliders = [];

    // Find nodes with "Body" in name for colliders
    root.listNodes().forEach(node => {
      if (node.getName() && node.getName().includes('Body')) {
        const mesh = node.getMesh();
        if (mesh) {
          const colliderData = this.extractColliderData(mesh, node);
          if (colliderData) {
            colliders.push(colliderData);
          }
        }
      }
    });

    return { colliders };
  }

  extractColliderData(mesh, node) {
    const primitive = mesh.listPrimitives()[0];
    if (!primitive) return null;

    const position = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices();
    
    if (!position) return null;

    const vertices = position.getArray();
    const indicesArray = indices ? indices.getArray() : null;
    
    const transform = this.getWorldTransform(node);

    // Apply transform to vertices to get world positions
    const transformedVertices = new Float32Array(vertices.length);
    
    // Create transformation matrix from translation/rotation
    const translation = transform.translation;
    const rotation = transform.rotation;
    
    // Apply scene offset (10, 3, 0) to match client - increased Y to 3
    const sceneOffset = [10, 3, 0];
    
    for (let i = 0; i < vertices.length; i += 3) {
      // For simplicity, just apply translation (assuming no complex rotations)
      transformedVertices[i] = vertices[i] + translation[0] + sceneOffset[0];
      transformedVertices[i + 1] = vertices[i + 1] + translation[1] + sceneOffset[1];
      transformedVertices[i + 2] = vertices[i + 2] + translation[2] + sceneOffset[2];
    }

    return {
      name: node.getName(),
      vertices: Array.from(transformedVertices),
      indices: indicesArray ? Array.from(indicesArray) : null,
      transform: {
        translation: [0, 0, 0], // Identity since vertices are in world space
        rotation: [0, 0, 0, 1]
      }
    };
  }

  getWorldTransform(node) {
    const translation = node.getTranslation();
    const rotation = node.getRotation();
    const scale = node.getScale();
    
    return {
      translation: Array.from(translation),
      rotation: Array.from(rotation),
      scale: Array.from(scale)
    };
  }

  async loadGLBFile(filename) {
    const url = `${this.clientBaseUrl}/models/vehicles/${filename}`;
    try {
      console.log(`Loading GLB from: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      return await this.parseGLB(buffer);
    } catch (error) {
      console.warn(`GLB file not found: ${url} - ${error.message}`);
      return { colliders: [] };
    }
  }

  async initializeColliders(world, filenames) {
    let colliders = [];
    
    // Try loading multiple files
    for (const filename of filenames) {
      const result = await this.loadGLBFile(filename);
      colliders = colliders.concat(result.colliders);
      if (result.colliders.length > 0) {
        console.log(`Loaded colliders from: ${filename}`);
      }
    }
    
    colliders.forEach(colliderData => {
      if (colliderData.vertices && colliderData.indices) {
        // Create new TypedArrays to avoid memory conflicts
        const vertices = new Float32Array(colliderData.vertices);
        const indices = new Uint32Array(colliderData.indices);
        
        const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
          .setCollisionGroups(0x00020002) // Group 2, only collides with groups other than 2
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS); // Enable collision events
        
        // Use identity transform since vertices are already in world space
        const { translation, rotation } = colliderData.transform;
        colliderDesc.setTranslation(translation[0], translation[1], translation[2]);
        colliderDesc.setRotation({ x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] });
        
        world.createCollider(colliderDesc);
        console.log(`Server created non-self-colliding collider for: ${colliderData.name} with ${vertices.length/3} vertices`);
      }
    });
  }
}

async function initializeServer() {
  // Initialize Rapier once with much stronger gravity
  await RAPIER.init();
  world = new RAPIER.World({ x: 0.0, y: -98.1, z: 0.0 }); // Match client gravity

  // Create bigger floor collider
  const floorSize = 500;
  const floorColliderDesc = RAPIER.ColliderDesc.cuboid(floorSize/2, 0.1, floorSize/2)
    .setTranslation(0, -0.1, 0);
  world.createCollider(floorColliderDesc);
  console.log('Server created floor collider');

  // Create plane physics body - start as kinematic for stable movement
  const planeBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(10, 3, 0);
  planeRigidBody = world.createRigidBody(planeBodyDesc);
  
  // Add collider to plane for floor collision
  const planeColliderDesc = RAPIER.ColliderDesc.cuboid(5, 1, 5)
    .setFriction(0.8)
    .setRestitution(0.1);
  world.createCollider(planeColliderDesc, planeRigidBody);
  
  console.log('Server created kinematic plane rigid body with collider');

  // Parse GLB files for colliders - try plane.glb first, then helicopter.glb
  const parser = new GLBParser();
  await parser.initializeColliders(world, ['plane.glb', 'helicopter.glb']);

  console.log('Server initialized with world colliders');
}

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substr(2, 9);
  
  // Create player physics body on server with matching client settings
  const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 5, 0)
    .lockRotations() // Will be manually controlled
    .setLinearDamping(3.0) // Match client damping
    .setCcdEnabled(true);
  
  const playerBody = world.createRigidBody(playerBodyDesc);
  
  const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.8, 0.4)
    .setFriction(3.0) // Match client friction
    .setRestitution(0.0) // No bounce
    .setCollisionGroups(0xFFFFFFFF);
  world.createCollider(playerColliderDesc, playerBody);
  
  playerBodies.set(playerId, playerBody);
  players.set(playerId, { ws, position: { x: 0, y: 5, z: 0 }, onPlane: false });

  console.log(`Player ${playerId} connected with physics body`);

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    handlePlayerMessage(playerId, message);
  });

  ws.on('close', () => {
    // Remove player physics body when disconnecting
    const playerBody = playerBodies.get(playerId);
    if (playerBody && world) {
      world.removeRigidBody(playerBody);
    }
    playerBodies.delete(playerId);
    players.delete(playerId);
    playersOnPlane.delete(playerId); // Remove from plane passengers
    
    console.log(`Player ${playerId} disconnected`);
    
    // Notify other players about disconnection AFTER removing from players map
    broadcastToOthers(playerId, {
      type: 'playerDisconnected',
      playerId: playerId
    });
  });

  // Send initial world state
  ws.send(JSON.stringify({
    type: 'connected',
    playerId: playerId,
    worldState: getWorldState()
  }));

  // Send current plane position to new client
  if (planeRigidBody) {
    const planePos = planeRigidBody.translation();
    const planeRot = planeRigidBody.rotation();
    ws.send(JSON.stringify({
      type: 'planeUpdate',
      data: {
        position: { x: planePos.x, y: planePos.y, z: planePos.z },
        rotation: { x: planeRot.x, y: planeRot.y, z: planeRot.z, w: planeRot.w }
      }
    }));
  }
});

function triggerPlaneTakeoff(playerId, data) {
  console.log(`Player ${playerId} triggered plane takeoff at position:`, data.playerPosition);
  
  if (!planeTakeoffActive) {
    planeTakeoffActive = true;
    console.log('Starting plane takeoff sequence...');
    
    // Start plane takeoff animation
    setTimeout(() => {
      planeTakeoffActive = false;
      console.log('Plane takeoff sequence completed');
    }, 10000); // 10 second takeoff sequence
  }
  
  broadcast({
    type: 'planeTakeoff',
    playerId: playerId,
    data: { 
      message: 'Plane is taking off!',
      playerPosition: data.playerPosition
    }
  });
}

function handlePlayerMessage(playerId, message) {
  switch (message.type) {
    case 'playerUpdate':
      updatePlayer(playerId, message.data);
      break;
    case 'playerOnPlane':
      handlePlayerOnPlane(playerId, message.data);
      break;
  }
}

function handlePlayerOnPlane(playerId, data) {
  if (data.onPlane) {
    // Player stepped on plane
    if (!playersOnPlane.has(playerId)) {
      playersOnPlane.add(playerId);
      console.log(`Player ${playerId} stepped on plane. Players on plane: ${playersOnPlane.size}`);
      
      // Start takeoff if this is the first player and not already active
      if (!planeTakeoffActive && playersOnPlane.size > 0) {
        planeTakeoffActive = true;
        planeAnimationTime = 0; // Reset animation timer
        console.log('Starting plane takeoff sequence...');
        
        // Don't reset plane position - let it animate from current position
        
        // Animation will run for 30 seconds total (takeoff + landing)
        setTimeout(() => {
          planeTakeoffActive = false;
          playersOnPlane.clear(); // Reset for next flight
          planeAnimationTime = 0; // Reset animation timer
          console.log('Plane flight sequence completed, ready for next passengers');
        }, 30000); // 30 second total flight
      }
    }
  } else {
    // Player left plane
    playersOnPlane.delete(playerId);
    console.log(`Player ${playerId} left plane. Players on plane: ${playersOnPlane.size}`);
  }
}

function updatePlayer(playerId, data) {
  const player = players.get(playerId);
  const playerBody = playerBodies.get(playerId);
  
  if (player && playerBody) {
    // Check if player is on plane
    if (data.onPlane && planeRigidBody) {
      // When player is on plane, we need to handle their physics differently
      const planePos = planeRigidBody.translation();
      const planeRot = planeRigidBody.rotation();
      const planeVel = planeRigidBody.linvel();
      const planeAngVel = planeRigidBody.angvel();
      
      // Calculate velocity to match plane movement
      let finalVelocity = {
        x: planeVel.x,
        y: planeVel.y,
        z: planeVel.z
      };
      
      // Add tangential velocity from rotation if plane is rotating
      if (planeAngVel) {
        const playerPos = data.position;
        const radiusVector = {
          x: playerPos.x - planePos.x,
          y: playerPos.y - planePos.y,
          z: playerPos.z - planePos.z
        };
        
        // Cross product for tangential velocity
        const tangentialVel = {
          x: planeAngVel.y * radiusVector.z - planeAngVel.z * radiusVector.y,
          y: planeAngVel.z * radiusVector.x - planeAngVel.x * radiusVector.z,
          z: planeAngVel.x * radiusVector.y - planeAngVel.y * radiusVector.x
        };
        
        finalVelocity.x += tangentialVel.x;
        finalVelocity.y += tangentialVel.y;
        finalVelocity.z += tangentialVel.z;
      }
      
      // Set player physics to match plane movement
      playerBody.setTranslation(data.position, true);
      playerBody.setLinvel(finalVelocity, true);
      
      // Apply rotation to align with floor normal (client sends this)
      if (data.rotation && data.rotation.w !== undefined) {
        playerBody.setRotation(data.rotation, true);
      }
    } else {
      // Normal physics update when not on plane
      playerBody.setTranslation(data.position, true);
      
      // Reset rotation to upright when not on plane
      playerBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      
      // Let client control velocity when not on plane
      if (data.velocity) {
        playerBody.setLinvel(data.velocity, true);
      }
    }
    
    player.position = data.position;
    player.onPlane = data.onPlane;
    
    // Get the actual rotation from physics body to broadcast
    const actualRotation = playerBody.rotation();
    
    broadcastToOthers(playerId, {
      type: 'playerUpdate',
      playerId: playerId,
      data: {
        ...data,
        rotation: actualRotation // Send actual physics rotation
      }
    });
  }
}

function spawnVehicle(playerId, data) {
  const vehicleId = Math.random().toString(36).substr(2, 9);
  // Create vehicle rigid body in Rapier
  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(data.position.x, data.position.y, data.position.z);
  const rigidBody = world.createRigidBody(rigidBodyDesc);
  
  vehicles.set(vehicleId, {
    playerId: playerId,
    rigidBody: rigidBody,
    position: data.position
  });

  broadcast({
    type: 'vehicleSpawn',
    vehicleId: vehicleId,
    data: data
  });
}

function broadcastToOthers(excludePlayerId, message) {
  players.forEach((player, currentPlayerId) => {
    if (currentPlayerId !== excludePlayerId) {
      try {
        player.ws.send(JSON.stringify(message));
      } catch (error) {
        console.warn(`Failed to send message to player ${currentPlayerId}:`, error.message);
      }
    }
  });
}

function broadcast(message) {
  players.forEach((player) => {
    player.ws.send(JSON.stringify(message));
  });
}

function getWorldState() {
  return {
    players: Array.from(players.entries()).map(([id, player]) => ({
      id: id,
      position: player.position
    })),
    vehicles: Array.from(vehicles.entries()).map(([id, vehicle]) => ({
      id: id,
      position: vehicle.position
    })),
    planePosition: planeRigidBody ? {
      position: planeRigidBody.translation(),
      rotation: planeRigidBody.rotation()
    } : null
  };
}

// Physics update loop
function gameLoop() {
  world.step();
  
  // Animate plane takeoff
  if (planeTakeoffActive && planeRigidBody) {
    planeAnimationTime += 1/60;
    
    const impulsePhaseTime = 3; // Use impulses for first 3 seconds
    const totalFlightTime = 30;
    const takeoffTime = 15;
    const landingTime = 15;
    
    if (planeAnimationTime <= impulsePhaseTime && planeAnimationTime === 1/60) {
      // IMPULSE DEMO: Convert to dynamic for impulse demonstration
      console.log('Converting plane to dynamic for impulse demo');
      
      // Get current position
      const currentPos = planeRigidBody.translation();
      const currentRot = planeRigidBody.rotation();
      
      // Remove kinematic body
      world.removeRigidBody(planeRigidBody);
      
      // Create dynamic body
      const dynamicDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(currentPos.x, currentPos.y, currentPos.z)
        .setRotation(currentRot)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5)
        .setCcdEnabled(true);
      planeRigidBody = world.createRigidBody(dynamicDesc);
      
      // Add mass and collider
      const planeColliderDesc = RAPIER.ColliderDesc.cuboid(5, 1, 5)
        .setMass(1000)
        .setFriction(0.8)
        .setRestitution(0.1);
      world.createCollider(planeColliderDesc, planeRigidBody);
      
    } else if (planeAnimationTime <= impulsePhaseTime) {
      // Apply impulses EVERY FRAME during demo phase for consistency
      const impulsePower = 200; // Reduced power but applied every frame
      const upwardImpulse = {
        x: 0,
        y: impulsePower * 2,
        z: -impulsePower * 0.5
      };
      
      // Apply impulse every frame for smooth consistent movement
      planeRigidBody.applyImpulse(upwardImpulse, true);
      
      // Counter gravity every frame
      planeRigidBody.applyImpulse({ x: 0, y: 980, z: 0 }, true);
      
    } else if (Math.abs(planeAnimationTime - (impulsePhaseTime + 1/60)) < 0.001) {
      // TRANSITION: Switch back to kinematic
      console.log('Switching plane back to kinematic for smooth flight');
      
      const currentPos = planeRigidBody.translation();
      const currentRot = planeRigidBody.rotation();
      
      world.removeRigidBody(planeRigidBody);
      
      const kinematicDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(currentPos.x, currentPos.y, currentPos.z)
        .setRotation(currentRot);
      planeRigidBody = world.createRigidBody(kinematicDesc);
      
      const planeColliderDesc = RAPIER.ColliderDesc.cuboid(5, 1, 5);
      world.createCollider(planeColliderDesc, planeRigidBody);
      
    } else {
      // KINEMATIC PHASE: Smooth controlled movement
      const adjustedTime = planeAnimationTime - impulsePhaseTime;
      let targetX = 10, targetY = 3, targetZ = 0;
      
      if (adjustedTime <= takeoffTime - impulsePhaseTime) {
        const takeoffProgress = adjustedTime / (takeoffTime - impulsePhaseTime);
        targetY = 10 + (takeoffProgress * 33);
        targetZ = -5 - (takeoffProgress * 45);
      } else {
        const landingProgress = (adjustedTime - (takeoffTime - impulsePhaseTime)) / landingTime;
        targetY = 43 - (landingProgress * 40);
        targetZ = -50 + (landingProgress * 50);
      }
      
      planeRigidBody.setTranslation({ x: targetX, y: targetY, z: targetZ }, true);
      
      // Reduced rotation for more stable player movement
      let rotationIntensity = Math.min((planeAnimationTime - 5) / 5, 1);
      const rotation = {
        x: Math.sin(planeAnimationTime * 0.5) * 0.15 * rotationIntensity, // Reduced from 0.3
        y: Math.cos(planeAnimationTime * 0.8) * 0.1 * rotationIntensity,  // Reduced from 0.2
        z: Math.sin(planeAnimationTime * 0.3) * 0.125 * rotationIntensity, // Reduced from 0.25
        w: 1
      };
      
      const mag = Math.sqrt(rotation.x**2 + rotation.y**2 + rotation.z**2 + rotation.w**2);
      rotation.x /= mag;
      rotation.y /= mag;
      rotation.z /= mag;
      rotation.w /= mag;
      
      planeRigidBody.setRotation(rotation, true);
    }
    
    // Broadcast current position
    const currentPos = planeRigidBody.translation();
    const currentRot = planeRigidBody.rotation();
    
    broadcast({
      type: 'planeUpdate',
      data: {
        position: { x: currentPos.x, y: currentPos.y, z: currentPos.z },
        rotation: currentRot
      }
    });
    
  } else if (planeRigidBody && planeAnimationTime > 0) {
    // Reset to kinematic at rest
    console.log('Resetting plane to rest position');
    
    world.removeRigidBody(planeRigidBody);
    
    const kinematicDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(10, 3, 0);
    planeRigidBody = world.createRigidBody(kinematicDesc);
    
    const planeColliderDesc = RAPIER.ColliderDesc.cuboid(5, 1, 5);
    world.createCollider(planeColliderDesc, planeRigidBody);
    
    planeAnimationTime = 0;
  }
  
  // Update player positions from server physics
  playerBodies.forEach((body, playerId) => {
    const translation = body.translation();
    const player = players.get(playerId);
    if (player) {
      player.position = { x: translation.x, y: translation.y, z: translation.z };
    }
  });
  
  // Update vehicle positions from physics
  vehicles.forEach((vehicle, vehicleId) => {
    const translation = vehicle.rigidBody.translation();
    vehicle.position = { x: translation.x, y: translation.y, z: translation.z };
  });

  // Broadcast physics updates for spawned vehicles only
  if (vehicles.size > 0) {
    broadcast({
      type: 'physicsUpdate',
      vehicles: Array.from(vehicles.entries()).map(([id, vehicle]) => ({
        id: id,
        position: vehicle.position,
        rotation: vehicle.rigidBody.rotation()
      }))
    });
  }
}

// Helper function to convert Euler angles to quaternion
function eulerToQuaternion(euler) {
  const { x, y, z } = euler;
  
  const cx = Math.cos(x * 0.5);
  const sx = Math.sin(x * 0.5);
  const cy = Math.cos(y * 0.5);
  const sy = Math.sin(y * 0.5);
  const cz = Math.cos(z * 0.5);
  const sz = Math.sin(z * 0.5);

  const qw = cx * cy * cz + sx * sy * sz;
  const qx = sx * cy * cz - cx * sy * sz;
  const qy = cx * sy * cz + sx * cy * sz;
  const qz = cx * cy * sz - sx * sy * cz;

  return { x: qx, y: qy, z: qz, w: qw };
}

await initializeServer();

// Start game loop at 60 FPS
setInterval(gameLoop, 1000 / 60);

server.listen(3001, () => {
  console.log('Game server running on port 3001');
});