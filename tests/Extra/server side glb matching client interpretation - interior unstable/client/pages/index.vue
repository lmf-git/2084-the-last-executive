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
let playerPosition = { x: 0, y: 5, z: 10 };
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
let lastPlanePosition = new THREE.Vector3();
let lastPlaneRotation = new THREE.Quaternion();

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
  const speed = 0.25;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  
  // Get camera direction for movement
  camera.getWorldDirection(forward);
  right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
  
  forward.y = 0;
  forward.normalize();
  right.normalize();

  let moved = false;
  const forceMultiplier = 30;
  
  // If player is on plane, handle movement relative to plane with full rotation support
  if (isOnPlane.value && planeRigidBody && planeGltfScene) {
    // Keep player dynamic for proper physics
    if (playerRigidBody.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
      const currentPos = playerRigidBody.translation();
      
      // Convert back to dynamic if needed
      world.removeRigidBody(playerRigidBody);
      
      const dynamicDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(currentPos.x, currentPos.y, currentPos.z)
        .lockRotations()
        .setLinearDamping(5.0) // Higher damping when on plane
        .setCcdEnabled(true);
      playerRigidBody = world.createRigidBody(dynamicDesc);
      
      // Recreate collider
      const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.8, 0.4)
        .setFriction(3.0) // Higher friction on plane
        .setRestitution(0.0)
        .setCollisionGroups(0xFFFFFFFF);
      playerCollider = world.createCollider(playerColliderDesc, playerRigidBody);
    }
    
    const currentPlanePos = planeGltfScene.position.clone();
    const currentPlaneRot = planeGltfScene.quaternion.clone();
    const planeVelocity = planeRigidBody.linvel();
    const planeAngularVel = planeRigidBody.angvel();
    
    // Initialize relative position if needed
    if (!planeRelativePosition) {
      planeRelativePosition = new THREE.Vector3();
      const playerWorldPos = playerMesh.position.clone();
      const planeInverse = currentPlaneRot.clone().invert();
      planeRelativePosition.copy(playerWorldPos).sub(currentPlanePos);
      planeRelativePosition.applyQuaternion(planeInverse);
      console.log('Established relative position on plane:', planeRelativePosition);
    }
    
    // Get plane's local axes
    const planeRight = new THREE.Vector3(1, 0, 0);
    const planeUp = new THREE.Vector3(0, 1, 0);
    const planeForward = new THREE.Vector3(0, 0, -1);
    
    // Transform to world space
    planeRight.applyQuaternion(currentPlaneRot);
    planeUp.applyQuaternion(currentPlaneRot);
    planeForward.applyQuaternion(currentPlaneRot);
    
    // Calculate movement direction in world space
    const movementDir = new THREE.Vector3();
    
    // Use world space movement for consistency
    if (keys.w) movementDir.add(forward);
    if (keys.s) movementDir.sub(forward);
    if (keys.a) movementDir.sub(right);
    if (keys.d) movementDir.add(right);
    
    // Apply movement in local plane space
    if (movementDir.length() > 0) {
      movementDir.normalize();
      movementDir.multiplyScalar(speed);
      
      // Project movement onto plane surface
      const movementOnPlane = movementDir.clone();
      const dotUp = movementOnPlane.dot(planeUp);
      movementOnPlane.sub(planeUp.clone().multiplyScalar(dotUp));
      
      // Calculate current world position
      let currentWorldPos = planeRelativePosition.clone();
      currentWorldPos.applyQuaternion(currentPlaneRot);
      currentWorldPos.add(currentPlanePos);
      
      // Check for walls in movement direction before moving
      const playerRadius = 0.5; // Slightly larger than capsule radius for buffer
      const wallCheckDistance = playerRadius + speed * 2; // Check ahead
      
      // Cast ray in movement direction from current position
      const rayOrigin = {
        x: currentWorldPos.x,
        y: currentWorldPos.y + 0.5, // Cast from middle of player
        z: currentWorldPos.z
      };
      
      const rayDirection = {
        x: movementOnPlane.x,
        y: movementOnPlane.y,
        z: movementOnPlane.z
      };
      
      // Normalize ray direction
      const rayDirLength = Math.sqrt(rayDirection.x**2 + rayDirection.y**2 + rayDirection.z**2);
      if (rayDirLength > 0) {
        rayDirection.x /= rayDirLength;
        rayDirection.y /= rayDirLength;
        rayDirection.z /= rayDirLength;
      }
      
      const ray = new RAPIER.Ray(rayOrigin, rayDirection);
      const filterFlags = RAPIER.QueryFilterFlags.EXCLUDE_COLLIDER;
      const wallHit = world.castRay(ray, wallCheckDistance, true, filterFlags, 0xFFFFFFFF, playerCollider);
      
      // Only move if no wall detected or wall is far enough
      if (!wallHit || wallHit.toi > playerRadius) {
        // Safe to move - update relative position
        const planeInverse = currentPlaneRot.clone().invert();
        const localMovement = movementOnPlane.clone();
        localMovement.applyQuaternion(planeInverse);
        
        planeRelativePosition.add(localMovement);
        moved = true;
      } else {
        // Wall detected - try sliding along it
        if (wallHit) {
          const hitPoint = ray.pointAt(wallHit.toi);
          const normal = world.castRayAndGetNormal(ray, wallHit.toi, true, filterFlags, 0xFFFFFFFF, playerCollider);
          
          if (normal) {
            // Calculate slide direction
            const wallNormal = new THREE.Vector3(normal.normal.x, normal.normal.y, normal.normal.z);
            const slideDir = movementOnPlane.clone();
            const dot = slideDir.dot(wallNormal);
            slideDir.sub(wallNormal.multiplyScalar(dot));
            
            // Try moving along the wall
            if (slideDir.length() > 0.01) {
              const planeInverse = currentPlaneRot.clone().invert();
              const localSlide = slideDir.clone();
              localSlide.applyQuaternion(planeInverse);
              
              planeRelativePosition.add(localSlide);
              moved = true;
            }
          }
        }
      }
    }
    
    // Calculate desired world position from relative position
    let targetWorldPos = planeRelativePosition.clone();
    targetWorldPos.applyQuaternion(currentPlaneRot);
    targetWorldPos.add(currentPlanePos);
    
    // Enhanced floor attachment with single raycast
    const rayOrigin = {
      x: targetWorldPos.x,
      y: targetWorldPos.y + 2, // Start ray well above player
      z: targetWorldPos.z
    };
    
    const rayDir = planeUp.clone().multiplyScalar(-1);
    const rayDirection = { x: rayDir.x, y: rayDir.y, z: rayDir.z };
    
    const ray = new RAPIER.Ray(rayOrigin, rayDirection);
    const maxDistance = 5.0;
    
    const filterFlags = RAPIER.QueryFilterFlags.EXCLUDE_COLLIDER;
    const hit = world.castRayAndGetNormal(ray, maxDistance, true, filterFlags, 0xFFFFFFFF, playerCollider);
    
    let floorNormal = null;
    if (hit && hit.collider.handle === floorMeshColliderHandle) {
      const capsuleHalfHeight = 0.8;
      const capsuleRadius = 0.4;
      const totalHeight = capsuleHalfHeight + capsuleRadius;
      
      const hitPoint = ray.pointAt(hit.toi);
      floorNormal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
      
      // Position player exactly on floor
      targetWorldPos.x = hitPoint.x;
      targetWorldPos.y = hitPoint.y;
      targetWorldPos.z = hitPoint.z;
      
      const offsetAlongNormal = floorNormal.clone().multiplyScalar(totalHeight);
      targetWorldPos.add(offsetAlongNormal);
      
      // Update relative position
      const planeInverse = currentPlaneRot.clone().invert();
      planeRelativePosition.copy(targetWorldPos).sub(currentPlanePos);
      planeRelativePosition.applyQuaternion(planeInverse);
    }
    
    // Calculate velocity to match plane movement exactly
    const currentPos = playerRigidBody.translation();
    const positionDelta = {
      x: targetWorldPos.x - currentPos.x,
      y: targetWorldPos.y - currentPos.y,
      z: targetWorldPos.z - currentPos.z
    };
    
    // Base velocity matches plane
    let finalVelocity = {
      x: planeVelocity.x,
      y: planeVelocity.y,
      z: planeVelocity.z
    };
    
    // Add tangential velocity from rotation
    if (planeAngularVel) {
      const radiusVector = targetWorldPos.clone().sub(currentPlanePos);
      const angularVelVector = new THREE.Vector3(planeAngularVel.x, planeAngularVel.y, planeAngularVel.z);
      const tangentialVel = angularVelVector.clone().cross(radiusVector);
      
      finalVelocity.x += tangentialVel.x;
      finalVelocity.y += tangentialVel.y;
      finalVelocity.z += tangentialVel.z;
    }
    
    // Add correction velocity to reach target position
    const correctionStrength = 10; // How strongly to correct position
    finalVelocity.x += positionDelta.x * correctionStrength;
    finalVelocity.y += positionDelta.y * correctionStrength;
    finalVelocity.z += positionDelta.z * correctionStrength;
    
    // Apply downward force to stick to floor
    if (floorNormal) {
      const stickingForce = 30;
      const downForce = floorNormal.clone().multiplyScalar(-stickingForce);
      finalVelocity.x += downForce.x;
      finalVelocity.y += downForce.y;
      finalVelocity.z += downForce.z;
    }
    
    // Set velocity and let physics handle the position
    playerRigidBody.setLinvel(finalVelocity, true);
    
    // Orient player to floor normal
    if (floorNormal) {
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(up, floorNormal);
      playerRigidBody.setRotation(quaternion, true);
    }
    
  } else {
    // Convert back to dynamic when not on plane
    if (playerRigidBody.bodyType() !== RAPIER.RigidBodyType.Dynamic) {
      const currentPos = playerRigidBody.translation();
      const currentRot = playerRigidBody.rotation();
      
      // Remove and recreate as dynamic
      world.removeRigidBody(playerRigidBody);
      
      const dynamicDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(currentPos.x, currentPos.y, currentPos.z)
        .lockRotations()
        .setLinearDamping(3.0)
        .setCcdEnabled(true);
      playerRigidBody = world.createRigidBody(dynamicDesc);
      
      // Recreate collider
      const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.8, 0.4)
        .setFriction(2.0)
        .setRestitution(0.0)
        .setCollisionGroups(0xFFFFFFFF);
      playerCollider = world.createCollider(playerColliderDesc, playerRigidBody);
      
      console.log('Converted player back to dynamic');
    }
    
    // Normal ground movement
    planeRelativePosition = null;
    
    const currentVel = playerRigidBody.linvel();
    playerRigidBody.setLinvel({ x: currentVel.x * 0.8, y: currentVel.y, z: currentVel.z * 0.8 }, true);
    
    if (keys.w) {
      playerRigidBody.applyImpulse({ x: forward.x * forceMultiplier, y: 0, z: forward.z * forceMultiplier }, true);
      moved = true;
    }
    if (keys.s) {
      playerRigidBody.applyImpulse({ x: -forward.x * forceMultiplier, y: 0, z: -forward.z * forceMultiplier }, true);
      moved = true;
    }
    if (keys.a) {
      playerRigidBody.applyImpulse({ x: -right.x * forceMultiplier, y: 0, z: -right.z * forceMultiplier }, true);
      moved = true;
    }
    if (keys.d) {
      playerRigidBody.applyImpulse({ x: right.x * forceMultiplier, y: 0, z: right.z * forceMultiplier }, true);
      moved = true;
    }
    
    // Reset rotation when on normal ground
    playerRigidBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  }
  
  // Jump with space - keep as dynamic for jump
  if (keys.space && isOnPlane.value) {
    const groundInfo = detectGround();
    if (groundInfo.hit && groundInfo.distance < 1.5) {
      // Apply jump impulse
      const jumpForce = 50;
      const planeUp = new THREE.Vector3(0, 1, 0);
      planeUp.applyQuaternion(planeGltfScene.quaternion);
      
      const jumpVector = planeUp.multiplyScalar(jumpForce);
      playerRigidBody.applyImpulse({ x: jumpVector.x, y: jumpVector.y, z: jumpVector.z }, true);
      
      // Clear relative position to allow free jump
      planeRelativePosition = null;
      isOnPlane.value = false; // Temporarily not on plane during jump
      
      console.log('Jumped off plane');
    }
  } else if (keys.space && !isOnPlane.value) {
    // Normal jump when not on plane
    const groundInfo = detectGround();
    if (groundInfo.hit && groundInfo.distance < 1.5) {
      playerRigidBody.applyImpulse({ x: 0, y: 50, z: 0 }, true);
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
  
  const filterFlags = RAPIER.QueryFilterFlags.EXCLUDE_COLLIDER;
  const hit = world.castRayAndGetNormal(ray, maxDistance, true, filterFlags, 0xFFFFFFFF, playerCollider);
  
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

function checkPlayerOnPlane() {
  // Use ray casting to detect if we're standing on the plane's Floor collider
  const groundInfo = detectGround();
  
  const wasOnPlane = isOnPlane.value;
  isOnPlane.value = false;
  
  if (groundInfo.hit && groundInfo.distance < 2.0) { // More generous distance check
    // Check if the collider we're standing on is specifically the Floor mesh collider
    const handlesMatch = groundInfo.colliderHandle === floorMeshColliderHandle;
    
    if (floorMeshColliderHandle !== undefined && handlesMatch) {
      isOnPlane.value = true;
      
      if (!wasOnPlane) {
        console.log("🛫 Player stepped on plane's Floor! Establishing relative position...");
        
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
  } else if (wasOnPlane) {
    // Player left the plane (too far from floor)
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
  renderer.setSize(window.innerWidth, window.innerHeight);

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
    .setCcdEnabled(true);
  
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
    gltf.scene.traverse((child) => {
      console.log(`Checking mesh: ${child.name}, type: ${child.type}`);
      
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