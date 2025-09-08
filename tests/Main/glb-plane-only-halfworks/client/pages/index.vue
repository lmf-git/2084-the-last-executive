<template>
  <div>
    <canvas ref="canvas" />
    <div class="ui">
      <div>Connected: {{ connected }}</div>
      <div>Players Online: {{ Object.keys(otherPlayers).length + (playerId ? 1 : 0) }}</div>
      <div>Your ID: {{ playerId || 'Not assigned' }}</div>
      <div>On Plane's Floor: {{ isOnPlane ? 'Yes' : 'No' }}</div>
      <div>Camera: {{ isThirdPerson ? 'Third Person' : 'First Person' }}</div>
      <div>Press WASD to move, Space to jump, O to toggle camera</div>
    </div>
  </div>
</template>

<script setup>
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

const canvas = ref();
const connected = ref(false);
const otherPlayers = ref({});
const isOnPlane = ref(false); // Make reactive
const isThirdPerson = ref(false); // Make reactive

let ws;
let world;
let scene;
let camera;
let renderer;
let playerId;
let vehicles = new Map();
let otherPlayerMeshes = new Map(); // Track other player visual meshes

// FPS controls
let keys = { w: false, a: false, s: false, d: false, space: false };
let playerPosition = { x: -200, y: 5, z: -200 }; // Spawn extremely far from plane at (10,3,0)
let mouseX = 0, mouseY = 0;
let isPointerLocked = false;

let playerRigidBody;
let playerMesh;
let playerCollider; // Track player collider for filtering
let floorMesh;
let floorMeshCollider;
let debugRayLine;
let planeGltfScene;

let floorMeshColliderHandle; // Store handle separately for reliable comparison
let planeRigidBody; // Add plane rigid body reference
let floorWireframe; // Add reference to wireframe
let planeInitialized = false; // Track if plane position has been set by server

let planeRelativePosition = null; // Store player's relative position on plane

// Interior volume sensors
let interiorVolumes = [];
let interiorSensorColliders = [];
let playerCurrentVolume = null;
let isInInterior = ref(false);

onMounted(async () => {
  await initScene();
  connectToServer();
  setupControls();
  startGameLoop();
});

onUnmounted(() => {
  if (ws) {
    ws.close();
  }
  
  // Clean up all other player meshes when component unmounts
  otherPlayerMeshes.forEach((mesh) => {
    scene.remove(mesh);
  });
  otherPlayerMeshes.clear();
});

function setupControls() {
  // Keyboard controls
  window.addEventListener('keydown', (e) => {
    switch(e.code) {
      case 'KeyW': keys.w = true; break;
      case 'KeyA': keys.a = true; break;
      case 'KeyS': keys.s = true; break;
      case 'KeyD': keys.d = true; break;
      case 'Space': 
        e.preventDefault();
        keys.space = true; 
        break;
      case 'KeyO':
        e.preventDefault();
        isThirdPerson.value = !isThirdPerson.value; // Use .value for reactive ref
        console.log(`Switched to ${isThirdPerson.value ? 'third' : 'first'} person camera`);
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    switch(e.code) {
      case 'KeyW': keys.w = false; break;
      case 'KeyA': keys.a = false; break;
      case 'KeyS': keys.s = false; break;
      case 'KeyD': keys.d = false; break;
      case 'Space': keys.space = false; break;
    }
  });

  // Mouse controls
  canvas.value.addEventListener('click', () => {
    canvas.value.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === canvas.value;
  });

  document.addEventListener('mousemove', (e) => {
    if (isPointerLocked) {
      mouseX -= e.movementX * 0.002;
      mouseY -= e.movementY * 0.002;
      mouseY = Math.max(-Math.PI/2, Math.min(Math.PI/2, mouseY));
    }
  });
}

function updatePlayer() {
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  
  // Get camera direction for movement
  camera.getWorldDirection(forward);
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
  
  forward.y = 0;
  forward.normalize();
  right.normalize();

  const forceMultiplier = 30;
  
  // Re-enable plane attachment now that interior volume issue is fixed
  const forceDisablePlaneAttachment = false;
  
  // If player is in interior volume OR on plane floor, handle movement relative to plane
  if (!forceDisablePlaneAttachment && (isInInterior.value || isOnPlane.value) && planeRigidBody && planeGltfScene) {
    // Apply plane-relative movement using forces while keeping dynamic body
    const currentPlanePos = planeGltfScene.position.clone();
    const currentPlaneRot = planeGltfScene.quaternion.clone();
    
    // Get plane's local axes for movement
    const planeRight = new THREE.Vector3(1, 0, 0);
    const planeUp = new THREE.Vector3(0, 1, 0);
    const planeForward = new THREE.Vector3(0, 0, -1);
    
    // Transform to world space
    planeRight.applyQuaternion(currentPlaneRot);
    planeUp.applyQuaternion(currentPlaneRot);
    planeForward.applyQuaternion(currentPlaneRot);
    
    // Apply movement forces - use camera directions for consistent feel
    if (isInInterior.value) {
      // In interior: use camera-relative movement for natural feel
      if (keys.w) {
        playerRigidBody.applyImpulse({ x: forward.x * forceMultiplier, y: 0, z: forward.z * forceMultiplier }, true);
      }
      if (keys.s) {
        playerRigidBody.applyImpulse({ x: -forward.x * forceMultiplier, y: 0, z: -forward.z * forceMultiplier }, true);
      }
      if (keys.a) {
        playerRigidBody.applyImpulse({ x: -right.x * forceMultiplier, y: 0, z: -right.z * forceMultiplier }, true);
      }
      if (keys.d) {
        playerRigidBody.applyImpulse({ x: right.x * forceMultiplier, y: 0, z: right.z * forceMultiplier }, true);
      }
    } else {
      // On plane floor: use plane-relative movement
      if (keys.w) {
        const force = planeForward.clone().multiplyScalar(forceMultiplier);
        playerRigidBody.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
      }
      if (keys.s) {
        const force = planeForward.clone().multiplyScalar(-forceMultiplier);
        playerRigidBody.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
      }
      if (keys.a) {
        const force = planeRight.clone().multiplyScalar(-forceMultiplier);
        playerRigidBody.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
      }
      if (keys.d) {
        const force = planeRight.clone().multiplyScalar(forceMultiplier);
        playerRigidBody.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
      }
    }
    
    // Apply damping to prevent sliding
    const currentVel = playerRigidBody.linvel();
    playerRigidBody.setLinvel({ 
      x: currentVel.x * 0.8, 
      y: currentVel.y, 
      z: currentVel.z * 0.8 
    }, true);
    
    // Keep player oriented to plane's up direction (especially in interior)
    if (isInInterior.value) {
      // In interior: orient to plane up AND keep attached to floor
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(up, planeUp);
      playerRigidBody.setRotation(quaternion, true);
      
      // Cast ray down to find floor inside interior and stick to it
      const groundInfo = detectGround();
      if (groundInfo.hit && groundInfo.distance < 2.0) {
        const playerPos = playerRigidBody.translation();
        const floorPos = groundInfo.point;
        const heightDiff = playerPos.y - floorPos.y;
        
        // If player is floating above floor, apply downward force
        if (heightDiff > 1.5) { // Capsule height tolerance
          const downwardForce = planeUp.clone().multiplyScalar(-20); // Force toward floor
          playerRigidBody.applyImpulse({ 
            x: downwardForce.x, 
            y: downwardForce.y, 
            z: downwardForce.z 
          }, true);
          console.log('🔽 Applying floor attachment in interior');
        }
      }
      
      // Apply gentle attachment to keep with moving plane
      const playerPos = playerRigidBody.translation();
      const targetPlaneVelocity = new THREE.Vector3();
      targetPlaneVelocity.copy(currentPlanePos).sub(new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z));
      targetPlaneVelocity.multiplyScalar(1.0); // Gentle attachment for interior
      
      playerRigidBody.applyImpulse({ 
        x: targetPlaneVelocity.x, 
        y: 0, 
        z: targetPlaneVelocity.z 
      }, true);
      
    } else {
      // On plane floor, try to orient to floor normal AND attach to floor
      const groundInfo = detectGround();
      if (groundInfo.hit && groundInfo.distance < 0.5) {
        const floorNormal = new THREE.Vector3(groundInfo.normal.x, groundInfo.normal.y, groundInfo.normal.z);
        const up = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(up, floorNormal);
        playerRigidBody.setRotation(quaternion, true);
        
        // Apply stronger attachment force when on exterior floor
        const playerPos = playerRigidBody.translation();
        const targetPlaneVelocity = new THREE.Vector3();
        targetPlaneVelocity.copy(currentPlanePos).sub(new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z));
        targetPlaneVelocity.multiplyScalar(5.0); // Stronger attachment for floor
        
        playerRigidBody.applyImpulse({ 
          x: targetPlaneVelocity.x, 
          y: 0, 
          z: targetPlaneVelocity.z 
        }, true);
      }
    }
    
  } else {
    // Normal ground movement - player stays dynamic always
    const currentVel = playerRigidBody.linvel();
    playerRigidBody.setLinvel({ x: currentVel.x * 0.8, y: currentVel.y, z: currentVel.z * 0.8 }, true);
    
    if (keys.w) {
      playerRigidBody.applyImpulse({ x: forward.x * forceMultiplier, y: 0, z: forward.z * forceMultiplier }, true);
    }
    if (keys.s) {
      playerRigidBody.applyImpulse({ x: -forward.x * forceMultiplier, y: 0, z: -forward.z * forceMultiplier }, true);
    }
    if (keys.a) {
      playerRigidBody.applyImpulse({ x: -right.x * forceMultiplier, y: 0, z: -right.z * forceMultiplier }, true);
    }
    if (keys.d) {
      playerRigidBody.applyImpulse({ x: right.x * forceMultiplier, y: 0, z: right.z * forceMultiplier }, true);
    }
    
    // Reset rotation when on normal ground
    playerRigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  }
  
  // Jump with space - works in interior volumes and on floor
  if (keys.space) {
    // Check if player can jump - either touching ground or in interior volume
    const groundInfo = detectGround();
    const onGround = groundInfo.hit && groundInfo.distance < 0.5;
    const canJump = onGround || isInInterior.value;
    
    if (canJump) {
      // Apply jump impulse in appropriate direction
      const jumpForce = 50;
      let jumpDirection = new THREE.Vector3(0, 1, 0); // Default world up
      
      // If in interior or on plane, jump in plane's up direction
      if ((isInInterior.value || isOnPlane.value) && planeGltfScene) {
        jumpDirection.applyQuaternion(planeGltfScene.quaternion);
      }
      
      const jumpVector = jumpDirection.multiplyScalar(jumpForce);
      playerRigidBody.applyImpulse({ x: jumpVector.x, y: jumpVector.y, z: jumpVector.z }, true);
      
      console.log(`Jumped ${isInInterior.value ? 'in interior' : isOnPlane.value ? 'on plane' : 'on ground'}`);
    }
  }

  // Get player position from physics body
  if (playerRigidBody) {
    const translation = playerRigidBody.translation();
    const rotation = playerRigidBody.rotation();
    playerPosition.x = translation.x;
    playerPosition.y = translation.y;
    playerPosition.z = translation.z;
    
    // Update player mesh position and rotation to match physics body
    if (playerMesh) {
      playerMesh.position.copy(translation);
      playerMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }

  // Check if player is on plane
  checkPlayerOnPlane();
  
  // Handle collision events for interior volumes
  handleCollisionEvents();

  // Update camera based on view mode
  updateCamera();

  // REMOVED: Old sticking force logic - now relies purely on relative positioning

  // Send player update to server (only send position, don't duplicate physics)
  if (ws && connected.value) {
    const rotation = playerRigidBody.rotation();
    ws.send(JSON.stringify({
      type: 'playerUpdate',
      data: {
        position: playerPosition,
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, // Always send quaternion
        onPlane: isOnPlane.value // Use .value
      }
    }));
  }
}

function updateCamera() {
  if (isThirdPerson.value) {
    // Third person camera - stable regardless of plane orientation
    const distance = 8;
    const height = 3;
    
    // Calculate camera position behind the player in world space
    const cameraOffset = new THREE.Vector3();
    cameraOffset.setFromSphericalCoords(distance, Math.PI/2 + mouseY * 0.5, mouseX + Math.PI);
    
    const cameraPosition = new THREE.Vector3(
      playerPosition.x + cameraOffset.x,
      playerPosition.y + height + cameraOffset.y,
      playerPosition.z + cameraOffset.z
    );
    
    camera.position.copy(cameraPosition);
    camera.lookAt(playerPosition.x, playerPosition.y + 1.5, playerPosition.z);
    
    // Always use world up for third person camera
    camera.up.set(0, 1, 0);
  } else {
    // First person camera - adjusted for plane orientation
    const cameraHeight = 1.5; // Fixed eye height
    
    if (isOnPlane.value && planeGltfScene) {
      // When on plane, adjust camera orientation to match plane's "up"
      const planeUp = new THREE.Vector3(0, 1, 0);
      planeUp.applyQuaternion(planeGltfScene.quaternion);
      
      // Calculate camera position relative to player
      const cameraPos = new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z);
      cameraPos.add(planeUp.clone().multiplyScalar(cameraHeight));
      camera.position.copy(cameraPos);
      
      // Create look direction based on mouse input but relative to plane
      const lookDir = new THREE.Vector3(0, 0, -1);
      const euler = new THREE.Euler(mouseY, mouseX, 0, 'YXZ');
      lookDir.applyEuler(euler);
      
      // Apply plane rotation to look direction
      lookDir.applyQuaternion(planeGltfScene.quaternion);
      
      const lookTarget = camera.position.clone().add(lookDir);
      camera.lookAt(lookTarget);
      
      // Set camera up to match plane up
      camera.up.copy(planeUp);
    } else {
      // Normal first person camera
      camera.position.set(playerPosition.x, playerPosition.y + cameraHeight, playerPosition.z);
      
      const euler = new THREE.Euler(mouseY, mouseX, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);
      
      // Reset to world up when not on plane
      camera.up.set(0, 1, 0);
    }
  }
}

// Enhanced ground detection with better plane floor tracking
function detectGround() {
  if (!world || !playerRigidBody) {
    return { hit: false, distance: Infinity };
  }

  const playerPos = playerRigidBody.translation();
  
  // Cast ray from above player to below
  const rayOrigin = { 
    x: playerPos.x, 
    y: playerPos.y + 0.5, // Start from higher up
    z: playerPos.z 
  };
  const rayDirection = { x: 0, y: -1, z: 0 };
  
  // When on plane, adjust ray direction to match plane orientation
  if (planeGltfScene) {
    const planeUp = new THREE.Vector3(0, 1, 0);
    planeUp.applyQuaternion(planeGltfScene.quaternion);
    rayDirection.x = -planeUp.x;
    rayDirection.y = -planeUp.y;
    rayDirection.z = -planeUp.z;
  }
  
  const maxDistance = 5.0; // Increased for better detection
  const ray = new RAPIER.Ray(rayOrigin, rayDirection);
  
  const filterFlags = RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS;
  // Use collider handle to avoid aliasing issues
  const excludeCollider = playerCollider ? playerCollider.handle : null;
  const hit = world.castRayAndGetNormal(ray, maxDistance, true, filterFlags, 0xFFFFFFFF, excludeCollider);
  
  // Update debug ray line
  if (debugRayLine && hit) {
    const startPoint = new THREE.Vector3(rayOrigin.x, rayOrigin.y, rayOrigin.z);
    const hitPoint = ray.pointAt(hit.toi);
    const endPoint = new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z);
    
    debugRayLine.material.color.setHex(0xff0000);
    
    const positions = debugRayLine.geometry.attributes.position;
    positions.setXYZ(0, startPoint.x, startPoint.y, startPoint.z);
    positions.setXYZ(1, endPoint.x, endPoint.y, endPoint.z);
    positions.needsUpdate = true;
    debugRayLine.geometry.computeBoundingSphere();
  }

  if (hit) {
    const hitPoint = ray.pointAt(hit.toi);
    
    return {
      hit: true,
      point: hitPoint,
      normal: hit.normal,
      distance: hit.toi - 0.5, // Adjust for ray starting higher
      colliderHandle: hit.collider.handle
    };
  }

  return { hit: false, distance: Infinity };
}

function handleCollisionEvents() {
  if (!world || !playerCollider) return;
  
  // Debug: Show player position and detection status (only once per second to avoid spam)
  if (playerRigidBody && Math.floor(Date.now() / 1000) !== (window.lastDebugTime || 0)) {
    window.lastDebugTime = Math.floor(Date.now() / 1000);
    const pos = playerRigidBody.translation();
    const planePos = planeGltfScene ? planeGltfScene.position : null;
    const distance = planePos ? Math.sqrt(Math.pow(pos.x - planePos.x, 2) + Math.pow(pos.z - planePos.z, 2)) : 'N/A';
    console.log(`🎮 Player: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) | Distance to plane: ${distance} | Interior: ${isInInterior.value} | OnPlane: ${isOnPlane.value}`);
  }
  
  // Check for intersection with interior volumes using direct collision detection
  interiorVolumes.forEach(volume => {
    if (!volume.collider || !volume.isActive) return;
    
    // IMPORTANT: Only check interior intersection if player is reasonably close to plane
    // This prevents false detections when plane moves and sensors sweep past distant players
    const playerPos = playerRigidBody.translation();
    const planePos = planeGltfScene ? planeGltfScene.position : null;
    const distanceToPlane = planePos ? 
      Math.sqrt(Math.pow(playerPos.x - planePos.x, 2) + Math.pow(playerPos.y - planePos.y, 2) + Math.pow(playerPos.z - planePos.z, 2)) : Infinity;
    
    // Only check intersection if within reasonable range (50 units max)
    let isCurrentlyInside = false;
    if (distanceToPlane < 50) {
      const intersection = world.intersectionPair(playerCollider, volume.collider);
      isCurrentlyInside = intersection !== null;
    }
    
    const wasInside = playerCurrentVolume === volume;
    
    // Debug intersection detection with position info
    if (isCurrentlyInside !== wasInside) {
      const playerPos = playerRigidBody ? playerRigidBody.translation() : null;
      console.log(`🔍 Interior intersection CHANGED: ${volume.name} = ${isCurrentlyInside}`);
      console.log(`   - Player at: (${playerPos?.x.toFixed(1)}, ${playerPos?.y.toFixed(1)}, ${playerPos?.z.toFixed(1)})`);
      console.log(`   - Volume size from creation: check earlier logs`);
    }
    
    // Also log if we're inside ANY interior volume when far from plane
    if (isCurrentlyInside && playerRigidBody) {
      const playerPos = playerRigidBody.translation();
      const planePos = planeGltfScene ? planeGltfScene.position : null;
      const distance = planePos ? Math.sqrt(Math.pow(playerPos.x - planePos.x, 2) + Math.pow(playerPos.z - planePos.z, 2)) : 'N/A';
      if (distance > 50) { // If more than 50 units away but still "inside"
        console.warn(`⚠️ PROBLEM: Player is ${distance} units from plane but detected inside interior volume "${volume.name}"`);
      }
    }
    
    if (isCurrentlyInside && !wasInside) {
      // Player entered volume
      if (volume.type === 'interior') {
        // Entered main interior volume
        playerCurrentVolume = volume;
        isInInterior.value = true;
        
        console.log(`🏠 Player entered interior: ${volume.name}`);
        
        if (ws && connected.value) {
          ws.send(JSON.stringify({
            type: 'playerEnteredInterior',
            data: { 
              playerId: playerId,
              volumeName: volume.name,
              playerPosition: playerPosition
            }
          }));
        }
      } else if (volume.type === 'entry_exit') {
        // Entered entry/exit zone - temporary disable interior mode for smooth transition
        console.log(`🚪 Player in entry/exit zone: ${volume.name}`);
      }
    } else if (!isCurrentlyInside && wasInside) {
      // Player exited volume
      if (volume.type === 'interior' && playerCurrentVolume === volume) {
        // Exited main interior volume
        playerCurrentVolume = null;
        isInInterior.value = false;
        
        console.log('🌅 Player exited interior');
        
        if (ws && connected.value) {
          ws.send(JSON.stringify({
            type: 'playerExitedInterior',
            data: { 
              playerId: playerId,
              playerPosition: playerPosition
            }
          }));
        }
      } else if (volume.type === 'entry_exit') {
        console.log(`🚪 Player left entry/exit zone: ${volume.name}`);
      }
    }
  });
}

function checkPlayerOnPlane() {
  // Use ray casting to detect if we're standing on the plane's Floor collider
  const groundInfo = detectGround();
  
  const wasOnPlane = isOnPlane.value;
  isOnPlane.value = false;
  
  // Check floor mesh collision with stricter distance AND proximity to plane
  const playerPos = playerRigidBody ? playerRigidBody.translation() : null;
  const planePos = planeGltfScene ? planeGltfScene.position : null;
  const distanceToPlane = (playerPos && planePos) ? 
    Math.sqrt(Math.pow(playerPos.x - planePos.x, 2) + Math.pow(playerPos.y - planePos.y, 2) + Math.pow(playerPos.z - planePos.z, 2)) : Infinity;
  
  // Only consider floor collision if close to plane AND raycast hits floor
  const onFloorMesh = groundInfo.hit && groundInfo.distance < 0.5 && 
                     floorMeshColliderHandle !== undefined && 
                     groundInfo.colliderHandle === floorMeshColliderHandle &&
                     distanceToPlane < 50; // Must be within 50 units of plane
  
  const inInteriorVolume = isInInterior.value;
  
  // Debug: Show detection logic with more detail
  if (Math.floor(Date.now() / 1000) !== (window.lastPlaneDebugTime || 0)) {
    window.lastPlaneDebugTime = Math.floor(Date.now() / 1000);
    const playerPos = playerRigidBody ? playerRigidBody.translation() : null;
    const planePos = planeGltfScene ? planeGltfScene.position : null;
    const distance = (playerPos && planePos) ? 
      Math.sqrt(Math.pow(playerPos.x - planePos.x, 2) + Math.pow(playerPos.z - planePos.z, 2)) : 'N/A';
    
    console.log(`🛫 DETAILED Floor Detection:
      - Player pos: (${playerPos?.x.toFixed(1)}, ${playerPos?.y.toFixed(1)}, ${playerPos?.z.toFixed(1)})
      - Plane pos: (${planePos?.x.toFixed(1)}, ${planePos?.y.toFixed(1)}, ${planePos?.z.toFixed(1)})
      - Distance to plane: ${distance}
      - Ground hit: ${groundInfo.hit}
      - Ground distance: ${groundInfo.distance?.toFixed(2)}
      - Floor handle defined: ${floorMeshColliderHandle !== undefined}
      - Floor handle value: ${floorMeshColliderHandle}
      - Hit handle: ${groundInfo.colliderHandle}
      - Handles match: ${groundInfo.colliderHandle === floorMeshColliderHandle}
      - On floor mesh: ${onFloorMesh}
      - In interior: ${inInteriorVolume}
      - Interior volumes count: ${interiorVolumes.length}
      - Final onPlane: ${onFloorMesh || inInteriorVolume}`);
  }
  
  // Player is on plane if they're ACTUALLY on the floor mesh OR inside an interior volume
  // But distinguish between floor contact and interior volume
  if (onFloorMesh || inInteriorVolume) {
    isOnPlane.value = true;
    
    if (onFloorMesh) {
      console.log("🛫 Player on floor mesh");
    }
    if (inInteriorVolume) {
      console.log("🏠 Player in interior volume");
    }
    
    if (!wasOnPlane) {
      console.log("🛫 Player stepped on plane! Establishing relative position...");
      
      // Initialize relative position when first stepping on plane
      if (planeGltfScene) {
        const playerWorldPos = playerMesh.position.clone();
        const planePos = planeGltfScene.position.clone();
        const planeRot = planeGltfScene.quaternion.clone();
        const planeInverse = planeRot.clone().invert();
        
        planeRelativePosition = new THREE.Vector3();
        planeRelativePosition.copy(playerWorldPos).sub(planePos);
        planeRelativePosition.applyQuaternion(planeInverse);
        
        console.log('Initial relative position:', planeRelativePosition);
      }
      
      // Just notify server that player is on plane
      if (ws && connected.value) {
        ws.send(JSON.stringify({
          type: 'playerOnPlane',
          data: { 
            playerId: playerId,
            playerPosition: playerPosition,
            onPlane: true
          }
        }));
      }
    }
  } else if (wasOnPlane) {
    // Player left the plane
    planeRelativePosition = null;
    if (ws && connected.value) {
      ws.send(JSON.stringify({
        type: 'playerOnPlane',
        data: { 
          playerId: playerId,
          playerPosition: playerPosition,
          onPlane: false
        }
      }));
    }
  }
}

function startGameLoop() {
  function gameLoop() {
    updatePlayer();
    world.step();
    renderer.render(scene, camera);
    requestAnimationFrame(gameLoop);
  }
  gameLoop();
}

function connectToServer() {
  ws = new WebSocket('ws://localhost:3001');
  
  ws.onopen = () => {
    connected.value = true;
    console.log('Connected to server');
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  };

  ws.onclose = () => {
    connected.value = false;
    console.log('Disconnected from server');
  };
}

function handleServerMessage(message) {
  switch (message.type) {
    case 'connected':
      playerId = message.playerId;
      console.log(`Assigned player ID: ${playerId}`);
      break;
    case 'playerUpdate':
      updateOtherPlayer(message.playerId, message.data);
      break;
    case 'playerDisconnected':
      removeOtherPlayer(message.playerId);
      break;
    case 'planeUpdate':
      updatePlanePosition(message.data);
      break;
    case 'physicsUpdate':
      updatePhysics(message.vehicles);
      break;
  }
}

function updateOtherPlayer(playerIdMsg, data) {
  otherPlayers.value[playerIdMsg] = data;
  
  // Create or update visual mesh for other player
  let otherPlayerMesh = otherPlayerMeshes.get(playerIdMsg);
  
  if (!otherPlayerMesh) {
    // Create new mesh for other player
    const capsuleGeometry = new THREE.CapsuleGeometry(0.4, 1.6, 4, 8);
    const capsuleMaterial = new THREE.MeshLambertMaterial({ 
      color: 0xff0000, // Red for other players
      transparent: true,
      opacity: 0.8
    });
    otherPlayerMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
    otherPlayerMesh.castShadow = true;
    scene.add(otherPlayerMesh);
    otherPlayerMeshes.set(playerIdMsg, otherPlayerMesh);
    console.log(`Created mesh for other player: ${playerIdMsg}`);
  }
  
  // Update position
  if (data.position) {
    otherPlayerMesh.position.set(data.position.x, data.position.y, data.position.z);
  }
  
  // Update rotation to match floor normal when on plane
  if (data.rotation && data.rotation.w !== undefined) {
    otherPlayerMesh.quaternion.set(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
  }
}

function removeOtherPlayer(playerIdMsg) {
  const otherPlayerMesh = otherPlayerMeshes.get(playerIdMsg);
  if (otherPlayerMesh) {
    scene.remove(otherPlayerMesh);
    otherPlayerMeshes.delete(playerIdMsg);
    console.log(`Removed mesh for disconnected player: ${playerIdMsg}`);
  }
  
  // Fix: Use Vue's reactive deletion
  if (otherPlayers.value[playerIdMsg]) {
    delete otherPlayers.value[playerIdMsg];
    console.log(`Removed player data for: ${playerIdMsg}`);
  }
}

function updatePhysics(vehicleUpdates) {
  vehicleUpdates.forEach(update => {
    const vehicleMesh = vehicles.get(update.id);
    if (vehicleMesh) {
      vehicleMesh.position.set(update.position.x, update.position.y, update.position.z);
      vehicleMesh.quaternion.set(update.rotation.x, update.rotation.y, update.rotation.z, update.rotation.w);
    }
  });
}

function updatePlanePosition(data) {
  if (planeGltfScene) {
    const targetPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    const targetRot = new THREE.Quaternion(data.rotation.x, data.rotation.y, data.rotation.z, data.rotation.w);
    
    if (!planeInitialized) {
      // First update from server - set position directly
      planeGltfScene.position.copy(targetPos);
      planeGltfScene.quaternion.copy(targetRot);
      planeInitialized = true;
      console.log(`Plane initialized at server position: ${targetPos.x}, ${targetPos.y}, ${targetPos.z}`);
    } else {
      // Subsequent updates - smooth interpolation
      const lerpFactor = 0.1;
      planeGltfScene.position.lerp(targetPos, lerpFactor);
      planeGltfScene.quaternion.slerp(targetRot, lerpFactor);
    }
    
    // Update plane rigid body position so colliders move with it
    if (planeRigidBody) {
      planeRigidBody.setTranslation(planeGltfScene.position, true);
      planeRigidBody.setRotation(planeGltfScene.quaternion, true);
    }
    
    // Update wireframe position to match plane
    if (floorWireframe) {
      floorWireframe.position.copy(planeGltfScene.position);
      floorWireframe.quaternion.copy(planeGltfScene.quaternion);
    }
  }
}

function extractColliderFromMesh(mesh) {
  const geometry = mesh.geometry;
  if (!geometry) return null;

  // Make sure geometry is updated
  geometry.computeBoundingBox();
  
  const vertices = geometry.attributes.position.array;
  const indices = geometry.index ? geometry.index.array : null;

  // Apply the mesh's world matrix to get actual world positions
  const worldMatrix = mesh.matrixWorld;
  const transformedVertices = new Float32Array(vertices.length);
  
  for (let i = 0; i < vertices.length; i += 3) {
    const vertex = new THREE.Vector3(vertices[i], vertices[i + 1], vertices[i + 2]);
    vertex.applyMatrix4(worldMatrix);
    transformedVertices[i] = vertex.x;
    transformedVertices[i + 1] = vertex.y;
    transformedVertices[i + 2] = vertex.z;
  }

  return {
    vertices: Array.from(transformedVertices),
    indices: indices ? Array.from(indices) : null,
    worldMatrix: worldMatrix
  };
}

async function initScene() {
  // Initialize Rapier with much stronger gravity
  await RAPIER.init();
  world = new RAPIER.World({ x: 0.0, y: -98.1, z: 0.0 }); // Much stronger gravity (10x normal)

  // Three.js setup
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value });
  
  // Ensure canvas is ready before setting size
  if (canvas.value && canvas.value.width !== null) {
    renderer.setSize(window.innerWidth, window.innerHeight);
  } else {
    // Fallback size if canvas not ready
    renderer.setSize(800, 600);
    console.warn('Canvas not ready, using fallback size');
  }

  // Add lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(50, 50, 25);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);

  // Create bigger floor plane
  const floorSize = 500;
  const groundGeometry = new THREE.PlaneGeometry(floorSize, floorSize);
  const groundMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x228B22,
    transparent: true,
    opacity: 0.8
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Create floor collider with default collision group
  const floorColliderDesc = RAPIER.ColliderDesc.cuboid(floorSize/2, 0.1, floorSize/2)
    .setTranslation(0, -0.1, 0)
    .setCollisionGroups(0xFFFFFFFF); // Default collision group
  world.createCollider(floorColliderDesc);
  console.log('Created floor collider');

  // Create player physics body with better collision settings
  const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(playerPosition.x, playerPosition.y, playerPosition.z)
    .lockRotations() // Keep rotations locked - we'll set them manually
    .setLinearDamping(3.0) // Increased for better control
    .setCcdEnabled(true) // Enable continuous collision detection
    .setCanSleep(false); // Prevent sleeping to maintain CCD
  
  playerRigidBody = world.createRigidBody(playerBodyDesc);
  
  // Adjust capsule collider to be properly oriented
  const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.8, 0.4) // height, radius
    .setFriction(2.0) // Increased friction
    .setRestitution(0.0) // Keep at 0 for no bounce
    .setCollisionGroups(0xFFFFFFFF);
  playerCollider = world.createCollider(playerColliderDesc, playerRigidBody);
  
  // Create visual player mesh (capsule) to match the collider
  const capsuleGeometry = new THREE.CapsuleGeometry(0.4, 1.6, 4, 8);
  const capsuleMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8
  });
  playerMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
  playerMesh.position.set(playerPosition.x, playerPosition.y, playerPosition.z);
  playerMesh.castShadow = true;
  scene.add(playerMesh);
  console.log('Created player visual mesh');

  // Create debug ray line with larger size for visibility
  const rayGeometry = new THREE.BufferGeometry();
  const rayPositions = new Float32Array([
    0, 4, 0,   // Start point (above player spawn)
    0, 1, 0    // End point (below player spawn)
  ]);
  rayGeometry.setAttribute('position', new THREE.BufferAttribute(rayPositions, 3));
  
  const rayMaterial = new THREE.LineBasicMaterial({ 
    color: 0xffff00,
    linewidth: 5,
    transparent: false
  });
  
  debugRayLine = new THREE.Line(rayGeometry, rayMaterial);
  scene.add(debugRayLine);
  console.log('Created visible debug ray line');

  // Load GLB file - trying both plane.glb and helicopter.glb
  try {
    const loader = new GLTFLoader();
    let gltf;
    
    try {
      gltf = await new Promise((resolve, reject) => {
        loader.load('/models/vehicles/plane.glb', resolve, undefined, reject);
      });
      console.log('Loaded plane.glb successfully');
    } catch (planeError) {
      console.warn('Could not load plane.glb, trying helicopter.glb:', planeError.message);
      gltf = await new Promise((resolve, reject) => {
        loader.load('/models/vehicles/helicopter.glb', resolve, undefined, reject);
      });
      console.log('Loaded helicopter.glb successfully');
    }

    // Add mesh to scene - DON'T set position, wait for server
    scene.add(gltf.scene);
    planeGltfScene = gltf.scene;
    console.log('Plane mesh loaded, waiting for server position...');

    // Create a kinematic rigid body for the plane
    const planeBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(0, 0, 0); // Temporary position until server updates
    planeRigidBody = world.createRigidBody(planeBodyDesc);
    console.log('Created plane kinematic rigid body');

    // Update all transforms before creating colliders
    gltf.scene.updateMatrixWorld(true);

    // Find Floor mesh for plane landing detection and Body meshes for colliders
    console.log('🔍 All meshes in GLB:');
    gltf.scene.traverse((child) => {
      if (child.isMesh) {
        console.log(`  📄 Mesh: "${child.name}" (type: ${child.type})`);
      }
    });
    
    gltf.scene.traverse((child) => {
      console.log(`Checking mesh: ${child.name}, type: ${child.type}`);
      
      // Re-enable interior volume creation with proper size validation
      const skipInteriorVolumes = false;
      
      // Check for Interior volume sensors and entry/exit zones
      const isInteriorVolume = child.name && (
        child.name.toLowerCase().includes('interior') || 
        child.name.toLowerCase().includes('volume') ||
        child.name.toLowerCase().includes('cube')
      );
      
      const isEntryExitZone = child.name && (
        child.name.toLowerCase().includes('entry') ||
        child.name.toLowerCase().includes('exit') ||
        child.name.toLowerCase().includes('door') ||
        child.name.toLowerCase().includes('transition')
      );
      
      if (!skipInteriorVolumes && child.isMesh && (isInteriorVolume || isEntryExitZone)) {
        console.log('🏠 Found Interior volume sensor:', child.name);
        
        // For interior volumes, use LOCAL geometry without world transform
        const geometry = child.geometry;
        if (!geometry) {
          console.warn(`❌ Interior volume ${child.name} has no geometry`);
          return;
        }
        
        geometry.computeBoundingBox();
        const vertices = geometry.attributes.position.array;
        
        // Use local vertices directly (no world transform for interior sensors)
        const localVertices = new Float32Array(vertices);
        
        if (localVertices && localVertices.length > 0) {
          console.log(`Interior volume has ${localVertices.length/3} vertices`);
          
          // Debug: Show the bounds of the LOCAL interior volume
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          for (let i = 0; i < localVertices.length; i += 3) {
            minX = Math.min(minX, localVertices[i]);
            minY = Math.min(minY, localVertices[i + 1]);
            minZ = Math.min(minZ, localVertices[i + 2]);
            maxX = Math.max(maxX, localVertices[i]);
            maxY = Math.max(maxY, localVertices[i + 1]);
            maxZ = Math.max(maxZ, localVertices[i + 2]);
          }
          const width = maxX - minX;
          const height = maxY - minY;
          const depth = maxZ - minZ;
          console.log(`🔍 Interior LOCAL bounds: X(${minX.toFixed(2)} to ${maxX.toFixed(2)}) Y(${minY.toFixed(2)} to ${maxY.toFixed(2)}) Z(${minZ.toFixed(2)} to ${maxZ.toFixed(2)})`);
          console.log(`📏 Interior LOCAL size: ${width.toFixed(2)} x ${height.toFixed(2)} x ${depth.toFixed(2)}`);
          
          // Check if interior volume is unreasonably large (indicating a problem)
          if (width > 20 || height > 20 || depth > 20) {
            console.warn(`❌ Interior volume is too large! This will cause false detections. Size: ${width.toFixed(1)} x ${height.toFixed(1)} x ${depth.toFixed(1)}`);
            console.warn(`❌ Skipping creation of oversized interior volume sensor`);
            return; // Skip creating this sensor
          }
          
          // TEMPORARY: Also skip if any dimension is extremely small (degenerate geometry)
          if (width < 0.1 || height < 0.1 || depth < 0.1) {
            console.warn(`❌ Interior volume is degenerate! Size: ${width.toFixed(3)} x ${height.toFixed(3)} x ${depth.toFixed(3)}`);
            console.warn(`❌ Skipping creation of degenerate interior volume sensor`);
            return; // Skip creating this sensor
          }
          
          // Create convex hull collider from LOCAL vertices (will be positioned by plane rigid body)
          const sensorColliderDesc = RAPIER.ColliderDesc.convexHull(localVertices)
          .setCollisionGroups(0x00010000) // Different collision group for sensors
          .setSensor(true) // Make it a sensor (no collision response)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
          
          // Attach sensor to plane rigid body
          const sensorCollider = world.createCollider(sensorColliderDesc, planeRigidBody);
          
          const volume = {
            name: child.name,
            mesh: child,
            collider: sensorCollider,
            colliderHandle: sensorCollider.handle,
            isActive: true,
            type: isInteriorVolume ? 'interior' : 'entry_exit'
          };
          
          interiorVolumes.push(volume);
          interiorSensorColliders.push(sensorCollider.handle);
          
          // Visual debug representation
          child.material = new THREE.MeshBasicMaterial({ 
            color: 0x00ff00, 
            transparent: true, 
            opacity: 0.1,
            wireframe: true 
          });
          
          console.log(`✅ Created interior volume sensor: ${child.name} (handle: ${sensorCollider.handle})`);
        } else {
          console.warn(`❌ Failed to extract collider data from interior volume: ${child.name}`);
        }
      }
      
      if (child.isMesh && child.name === 'Floor') {
        floorMesh = child;
        console.log('🔍 Found Floor mesh for plane detection');
        
        // Create a dedicated collider for the Floor mesh that we can identify
        child.updateMatrixWorld(true);
        const floorColliderData = extractColliderFromMesh(child);
        if (floorColliderData && floorColliderData.vertices && floorColliderData.indices) {
          console.log(`Floor has ${floorColliderData.vertices.length/3} vertices and ${floorColliderData.indices ? floorColliderData.indices.length/3 : 0} triangles`);
          
          // Extract relative position from plane origin for BOTH collider and wireframe
          const relativeVertices = new Float32Array(floorColliderData.vertices.length);
          for (let i = 0; i < floorColliderData.vertices.length; i += 3) {
            relativeVertices[i] = floorColliderData.vertices[i] - 0; // Don't subtract anything since plane starts at 0,0,0 now
            relativeVertices[i + 1] = floorColliderData.vertices[i + 1] - 0;
            relativeVertices[i + 2] = floorColliderData.vertices[i + 2] - 0;
          }
          
          const floorColliderDesc = RAPIER.ColliderDesc.trimesh(
            relativeVertices,
            new Uint32Array(floorColliderData.indices)
          )
          .setCollisionGroups(0xFFFFFFFF)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
          .setFriction(1.5) // Increase friction to help prevent sliding
          .setRestitution(0.0);
          
          // Attach Floor collider to plane rigid body
          floorMeshCollider = world.createCollider(floorColliderDesc, planeRigidBody);
          floorMeshColliderHandle = floorMeshCollider.handle;
          console.log(`✅ Created Floor mesh collider attached to plane`);
          console.log(`Floor collider handle: ${floorMeshColliderHandle} (type: ${typeof floorMeshColliderHandle})`);
          
          // Create wireframe using the SAME relative vertices as the collider
          const wireframeGeometry = new THREE.BufferGeometry();
          wireframeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(relativeVertices, 3));
          
          if (floorColliderData.indices) {
            wireframeGeometry.setIndex(floorColliderData.indices);
          }
          
          const wireframeMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xff00ff, 
            wireframe: true,
            transparent: true,
            opacity: 1.0
          });
          
          floorWireframe = new THREE.Mesh(wireframeGeometry, wireframeMaterial);
          // Wireframe will be positioned when server sends plane position
          scene.add(floorWireframe);
          console.log(`Floor wireframe added using same relative vertices as collider`);

        } else {
          console.warn('❌ Failed to extract collider data from Floor mesh');
        }
      }
      
      if (child.isMesh && child.name && child.name.includes('Body') && child.name !== 'Floor') {
        // Update the child's world matrix
        child.updateMatrixWorld(true);
        
        const colliderData = extractColliderFromMesh(child);
        if (colliderData && colliderData.vertices && colliderData.indices) {
          // Extract relative position from plane origin
          const relativeVertices = new Float32Array(colliderData.vertices.length);
          for (let i = 0; i < colliderData.vertices.length; i += 3) {
            relativeVertices[i] = colliderData.vertices[i] - 0; // Don't subtract anything since plane starts at 0,0,0 now
            relativeVertices[i + 1] = colliderData.vertices[i + 1] - 0;
            relativeVertices[i + 2] = colliderData.vertices[i + 2] - 0;
          }
          
          const colliderDesc = RAPIER.ColliderDesc.trimesh(
            relativeVertices,
            new Uint32Array(colliderData.indices)
          )
          .setCollisionGroups(0xFFFFFFFF)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
          .setFriction(0.8)
          .setRestitution(0.1);
          
          // Attach body collider to plane rigid body
          const bodyCollider = world.createCollider(colliderDesc, planeRigidBody);
          console.log(`Created collider for: ${child.name} with handle: ${bodyCollider.handle} (attached to plane)`);
        }
      }
    });

  } catch (error) {
    console.warn('Could not load any vehicle models:', error);
  }

  // Position camera
  camera.position.set(playerPosition.x, playerPosition.y, playerPosition.z);
  camera.lookAt(0, 0, 0);

  // Enable shadows
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
</script>

<style scoped>
canvas {
  display: block;
  width: 100%;
  height: 100vh;
  cursor: crosshair;
}

.ui {
  position: absolute;
  top: 10px;
  left: 10px;
  color: white;
  font-family: monospace;
  background: rgba(0, 0, 0, 0.7);
  padding: 15px;
  border-radius: 5px;
  pointer-events: none;
}
</style>