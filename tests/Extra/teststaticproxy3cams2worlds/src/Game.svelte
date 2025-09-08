<script>
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import RAPIER from '@dimforge/rapier3d-compat';
  
  let canvas = $state();
  let exteriorScene, interiorScene, stationScene, exteriorCamera, interiorCamera, stationCamera, renderer;
  let exteriorWorld, interiorWorld, stationWorld, exteriorEventQueue, interiorEventQueue, stationEventQueue;
  let playerBody, playerCollider;
  let interiorPlayerBody, interiorPlayerCollider;
  let stationPlayerBody, stationPlayerCollider;
  let shipBody, shipCollider;
  let shipEntrySensor, stationEntrySensor;
  // Multi-ship station support - IMPLEMENTED
  let stationShipBodies = []; // Array of ship bodies docked in station  
  let stationShipProxies = []; // Array of ship visual proxies in station interior
  let activeShipIndex = 0; // Which ship player is currently in
  let nextShipId = 0; // For generating unique ship IDs
  // This allows: player exits ship A → walks in station → enters ship B
  
  // Compatibility layer - these point to the active ship
  let stationShipBody, stationShipProxy;
  let stationBody, stationCollider;
  let isInsideShip = $state(false);
  let isInsideStation = $state(false);
  let isShipDocked = $state(false);
  let prevIsShipDocked = $state(false);
  let prevIsShipInDockingBay = $state(false);
  // Ship docking is now immediate like player entry - no transition states needed
  let shipInteriorProxy, stationInteriorProxy;
  
  // Proxy-aware state management system
  // Represents the nested hierarchy: Exterior -> Station -> Ship
  let playerProxyContext = $state({
    activeWorld: 'exterior', // 'exterior' | 'station' | 'ship'
    hierarchy: [], // Array representing nesting: [] = exterior, ['station'] = in station, ['station', 'ship'] = in docked ship
    activePhysicsBody: null, // Current physics body being used
    lastTransition: Date.now()
  });
  
  // Derived states based on proxy context
  let isInExterior = $derived(playerProxyContext.activeWorld === 'exterior');
  let isInStation = $derived(playerProxyContext.activeWorld === 'station');
  let isInShip = $derived(playerProxyContext.activeWorld === 'ship');
  let isInDockedShip = $derived(playerProxyContext.hierarchy.includes('station') && playerProxyContext.hierarchy.includes('ship'));
  let transitionProgress = $state(0); // 0 = fully outside, 1 = fully inside
  let isTransitioning = $state(false);
  let isExiting = $state(false);
  let isEntering = $state(false);
  let pendingShipEntry = $state(false);
  // Ship dimensions - constants used throughout
  const SHIP_WIDTH = 20;
  const SHIP_HEIGHT = 6;
  const SHIP_LENGTH = 30;
  const WALL_THICKNESS = 0.4;
  const DOOR_WIDTH = 4;
  const DOOR_HEIGHT = 4;
  
  // Station dimensions - constants used throughout  
  const STATION_WIDTH = 200;
  const STATION_HEIGHT = 60;
  const STATION_LENGTH = 250;
  const STATION_WALL_THICKNESS = 2.0;

  let pendingStationEntry = $state(false);
  let pendingShipDocking = $state(false);
  let lastUndockTime = $state(0); // Cooldown to prevent immediate re-docking
  let lastShipExitToStationTime = $state(0); // Cooldown to prevent station re-entry after ship exit
  let lastShipExitToExteriorTime = $state(0); // Cooldown to prevent ship re-entry after ship exit to exterior
  let lastStationEntryTime = $state(0); // Prevent immediate exit after station entry
  let pendingShipEntryFromStation = $state(false); // Deferred ship entry from station
  let isFirstPerson = $state(false);
  let isPointerLocked = $state(false);
  let mouseX = 0;
  let mouseY = 0;
  let cameraRotation = { yaw: 0, pitch: 0 };
  
  // Smooth rotation transition system
  let rotationTransition = $state({
    active: false,
    startYaw: 0,
    startPitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    progress: 0,
    duration: 1000 // 1 second transition
  });
  
  // Function to start smooth rotation transition
  function startRotationTransition(targetYaw, targetPitch, duration = 1000) {
    rotationTransition.active = true;
    rotationTransition.startYaw = cameraRotation.yaw;
    rotationTransition.startPitch = cameraRotation.pitch;
    rotationTransition.targetYaw = targetYaw;
    rotationTransition.targetPitch = targetPitch;
    rotationTransition.progress = 0;
    rotationTransition.duration = duration;
    console.log('🔄 Starting rotation transition:', {
      from: { yaw: rotationTransition.startYaw, pitch: rotationTransition.startPitch },
      to: { yaw: targetYaw, pitch: targetPitch },
      duration
    });
  }
  
  // Function to update rotation transition
  function updateRotationTransition(deltaTime) {
    if (!rotationTransition.active) return;
    
    rotationTransition.progress += deltaTime;
    const t = Math.min(rotationTransition.progress / rotationTransition.duration, 1);
    
    // Smooth easing function (ease-out)
    const eased = 1 - Math.pow(1 - t, 3);
    
    // Interpolate rotation
    cameraRotation.yaw = rotationTransition.startYaw + (rotationTransition.targetYaw - rotationTransition.startYaw) * eased;
    cameraRotation.pitch = rotationTransition.startPitch + (rotationTransition.targetPitch - rotationTransition.startPitch) * eased;
    
    // End transition when complete
    if (t >= 1) {
      rotationTransition.active = false;
      cameraRotation.yaw = rotationTransition.targetYaw;
      cameraRotation.pitch = rotationTransition.targetPitch;
      console.log('✅ Rotation transition complete');
    }
  }
  
  onMount(async () => {
    await RAPIER.init();
    
    // Create separate scenes for exterior, ship interior, and station interior
    exteriorScene = new THREE.Scene();
    exteriorScene.background = new THREE.Color(0x87CEEB);
    exteriorScene.fog = new THREE.Fog(0x87CEEB, 10, 1000);
    
    interiorScene = new THREE.Scene();
    interiorScene.background = new THREE.Color(0x222222); // Dark ship interior background
    
    stationScene = new THREE.Scene();
    stationScene.background = new THREE.Color(0x333333); // Station interior background
    
    exteriorCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    exteriorCamera.position.set(0, 5, 10);
    
    interiorCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    interiorCamera.position.set(0, 4, 25); // Zoomed out more for better overview
    interiorCamera.lookAt(0, 1.5, 0); // Set fixed angle looking forward - never change this
    
    stationCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    stationCamera.position.set(0, 80, 200); // Zoomed out much more for better overview
    
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    
    // Exterior scene lighting
    const exteriorAmbientLight = new THREE.AmbientLight(0xffffff, 0.6);
    exteriorScene.add(exteriorAmbientLight);
    
    const exteriorDirectionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    exteriorDirectionalLight.position.set(10, 20, 10);
    exteriorDirectionalLight.castShadow = true;
    exteriorDirectionalLight.shadow.camera.near = 0.1;
    exteriorDirectionalLight.shadow.camera.far = 100;
    exteriorDirectionalLight.shadow.camera.left = -50;
    exteriorDirectionalLight.shadow.camera.right = 50;
    exteriorDirectionalLight.shadow.camera.top = 50;
    exteriorDirectionalLight.shadow.camera.bottom = -50;
    exteriorScene.add(exteriorDirectionalLight);
    
    // Interior scene lighting
    const interiorAmbientLight = new THREE.AmbientLight(0xffffff, 0.4);
    interiorScene.add(interiorAmbientLight);
    
    // Station scene lighting
    const stationAmbientLight = new THREE.AmbientLight(0xffffff, 0.5);
    stationScene.add(stationAmbientLight);
    
    const stationDirectionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
    stationDirectionalLight.position.set(5, 10, 5);
    stationScene.add(stationDirectionalLight);
    
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    exteriorWorld = new RAPIER.World(gravity);
    exteriorEventQueue = new RAPIER.EventQueue(true);
    
    interiorWorld = new RAPIER.World(gravity);
    interiorEventQueue = new RAPIER.EventQueue(true);
    
    stationWorld = new RAPIER.World(gravity);
    stationEventQueue = new RAPIER.EventQueue(true);
    
    createGround();
    createPlayer();
    createShip();
    createDockingStation();
    
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    
    animate();
    
    return () => {
      window.removeEventListener('resize', onWindowResize);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  });
  
  function createGround() {
    const groundGeometry = new THREE.BoxGeometry(2000, 1, 2000);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.receiveShadow = true;
    groundMesh.position.y = -0.5;
    exteriorScene.add(groundMesh);
    
    const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(0, -0.5, 0);
    const groundBody = exteriorWorld.createRigidBody(groundBodyDesc);
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(1000, 0.5, 1000);
    exteriorWorld.createCollider(groundColliderDesc, groundBody);
  }
  
  let playerMesh;
  let movement = { forward: false, backward: false, left: false, right: false, jump: false };
  let shipMovement = { forward: false, backward: false, left: false, right: false, up: false, down: false };
  let stationMovement = { forward: false, backward: false, left: false, right: false, up: false, down: false };
  let isGrounded = $state(false);
  let jumpPressed = false;
  let canJump = true;
  
  // Proxy context management functions
  function updatePlayerProxyContext(newWorld, newHierarchy, newPhysicsBody) {
    console.log(`🌍 Proxy context transition: ${playerProxyContext.activeWorld} -> ${newWorld}`, {
      oldHierarchy: playerProxyContext.hierarchy,
      newHierarchy: newHierarchy,
      timestamp: Date.now()
    });
    
    playerProxyContext.activeWorld = newWorld;
    playerProxyContext.hierarchy = [...newHierarchy];
    playerProxyContext.activePhysicsBody = newPhysicsBody;
    playerProxyContext.lastTransition = Date.now();
    
    // Update legacy state flags for compatibility
    isInsideShip = newWorld === 'ship';
    isInsideStation = newWorld === 'station' || newHierarchy.includes('station');
  }
  
  function enterExteriorWorld(physicsBody) {
    updatePlayerProxyContext('exterior', [], physicsBody);
  }
  
  function enterStationWorld(physicsBody) {
    updatePlayerProxyContext('station', ['station'], physicsBody);
  }
  
  function enterShipFromExteriorContext(physicsBody) {
    updatePlayerProxyContext('ship', ['ship'], physicsBody);
  }
  
  function enterShipFromStationContext(physicsBody) {
    updatePlayerProxyContext('ship', ['station', 'ship'], physicsBody);
  }
  
  function exitToStation(physicsBody) {
    updatePlayerProxyContext('station', ['station'], physicsBody);
  }
  
  function exitToExterior(physicsBody) {
    updatePlayerProxyContext('exterior', [], physicsBody);
  }
  
  // Physics-based proxy detection system
  function detectActiveProxyFromPhysics() {
    let activeWorld = 'exterior';
    let hierarchy = [];
    let activePhysicsBody = playerBody;
    
    // Check which physics body is actually at a reasonable position (not hidden)
    try {
      const exteriorPos = playerBody?.translation();
      const stationPos = stationPlayerBody?.translation();
      const interiorPos = interiorPlayerBody?.translation();
      
      // Determine active physics body based on which one is at a reasonable position
      if (interiorPos && interiorPos.y > -50) {
        // Interior player is active (not at initialization position -100)
        activeWorld = 'ship';
        activePhysicsBody = interiorPlayerBody;
        
        // Check if ship is docked to determine hierarchy
        if (isShipDocked) {
          hierarchy = ['station', 'ship'];
        } else {
          hierarchy = ['ship'];
        }
      } else if (stationPos && stationPos.y > -150) {
        // Station player is active (not at initialization position -200)
        activeWorld = 'station';
        hierarchy = ['station'];
        activePhysicsBody = stationPlayerBody;
      } else if (exteriorPos && exteriorPos.y > -10) {
        // Exterior player is active
        activeWorld = 'exterior';
        hierarchy = [];
        activePhysicsBody = playerBody;
      }
      
      // Only update if there's an actual change AND not during transitions
      // This prevents the detection from interfering with ongoing transitions
      if (activeWorld !== playerProxyContext.activeWorld && !isTransitioning && !isEntering && !isExiting) {
        console.log(`🔍 Physics-based proxy detection: ${playerProxyContext.activeWorld} -> ${activeWorld}`);
        updatePlayerProxyContext(activeWorld, hierarchy, activePhysicsBody);
      }
      
    } catch (error) {
      console.warn('Error in physics-based proxy detection:', error);
    }
  }
  
  // Debug HUD reactive states
  let playerPosition = $state({ x: 0, y: 0, z: 0 });
  let playerVelocity = $state({ x: 0, y: 0, z: 0 });
  let currentWorld = $derived(playerProxyContext.activeWorld === 'ship' ? 'Ship Interior' : 
                            (playerProxyContext.activeWorld === 'station' ? 'Station Interior' : 'Exterior'));
  let shipWorld = $derived(isShipDocked ? 'Station Interior' : 'Exterior');
  let proxyHierarchy = $derived(playerProxyContext.hierarchy.join(' > ') || 'exterior');
  let movementStatus = $derived(isGrounded ? 'Grounded' : 'Falling');
  let fps = $state(0);
  let frameCount = 0;
  let lastFpsTime = 0;
  
  function createPlayer() {
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    
    const capsuleGeometry = new THREE.CapsuleGeometry(capsuleRadius, capsuleHeight, 4, 8);
    // Translate geometry so capsule rotates around its base (feet) instead of center
    capsuleGeometry.translate(0, capsuleHeight / 2, 0);
    const capsuleMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    playerMesh = new THREE.Mesh(capsuleGeometry, capsuleMaterial);
    playerMesh.castShadow = true;
    playerMesh.position.set(0, 3, 25);
    exteriorScene.add(playerMesh);
    
    const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 3, 25)
      .setCanSleep(false)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0)
      .lockRotations();
    playerBody = exteriorWorld.createRigidBody(playerBodyDesc);
    
    // Initialize proxy context to exterior world
    enterExteriorWorld(playerBody);
    
    const playerColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setFriction(0.8)
      .setRestitution(0.1);
    playerCollider = exteriorWorld.createCollider(playerColliderDesc, playerBody);
    
    // Create interior player body - will be positioned when entering ship
    const interiorPlayerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, -100, 0) // Start way below ground (inactive until entering ship)
      .setCanSleep(false)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0)
      .lockRotations();
    interiorPlayerBody = interiorWorld.createRigidBody(interiorPlayerBodyDesc);
    
    const interiorPlayerColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setFriction(0.8)
      .setRestitution(0.1);
    interiorPlayerCollider = interiorWorld.createCollider(interiorPlayerColliderDesc, interiorPlayerBody);
    
    // Create station player body - will be positioned when entering station
    const stationPlayerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, -200, 0) // Start way below ground (inactive until entering station)
      .setCanSleep(false)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0)
      .lockRotations();
    stationPlayerBody = stationWorld.createRigidBody(stationPlayerBodyDesc);
    
    const stationPlayerColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setFriction(0.8)
      .setRestitution(0.1);
    stationPlayerCollider = stationWorld.createCollider(stationPlayerColliderDesc, stationPlayerBody);
  }
  
  let shipMesh;
  let shipInteriorMesh;
  let debugPlayerMesh;
  
  function createShip() {
    const shipGroup = new THREE.Group();
    
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    
    // Floor
    const floorGeometry = new THREE.BoxGeometry(SHIP_WIDTH, WALL_THICKNESS, SHIP_LENGTH);
    const floorMesh = new THREE.Mesh(floorGeometry, hullMaterial);
    floorMesh.castShadow = true;
    floorMesh.receiveShadow = true;
    floorMesh.position.set(0, WALL_THICKNESS / 2, 0);
    shipGroup.add(floorMesh);
    
    // Ceiling
    const ceilingGeometry = new THREE.BoxGeometry(SHIP_WIDTH, WALL_THICKNESS, SHIP_LENGTH);
    const ceilingMesh = new THREE.Mesh(ceilingGeometry, hullMaterial);
    ceilingMesh.position.set(0, SHIP_HEIGHT - STATION_WALL_THICKNESS / 2, 0);
    shipGroup.add(ceilingMesh);
    
    // Left wall
    const leftWallGeometry = new THREE.BoxGeometry(WALL_THICKNESS, SHIP_HEIGHT, SHIP_LENGTH);
    const leftWallMesh = new THREE.Mesh(leftWallGeometry, hullMaterial);
    leftWallMesh.position.set(-SHIP_WIDTH / 2 + WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0);
    shipGroup.add(leftWallMesh);
    
    // Right wall
    const rightWallGeometry = new THREE.BoxGeometry(WALL_THICKNESS, SHIP_HEIGHT, SHIP_LENGTH);
    const rightWallMesh = new THREE.Mesh(rightWallGeometry, hullMaterial);
    rightWallMesh.position.set(SHIP_WIDTH / 2 - WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0);
    shipGroup.add(rightWallMesh);
    
    // Back wall
    const backWallGeometry = new THREE.BoxGeometry(SHIP_WIDTH, SHIP_HEIGHT, WALL_THICKNESS);
    const backWallMesh = new THREE.Mesh(backWallGeometry, hullMaterial);
    backWallMesh.position.set(0, SHIP_HEIGHT / 2, -SHIP_LENGTH / 2 + WALL_THICKNESS / 2);
    shipGroup.add(backWallMesh);
    
    // Front wall with door opening (bigger door)
    const DOOR_WIDTH = 4;
    const DOOR_HEIGHT = 4;
    
    const frontWallLeft = new THREE.Mesh(
      new THREE.BoxGeometry((SHIP_WIDTH - DOOR_WIDTH) / 2, SHIP_HEIGHT, WALL_THICKNESS),
      hullMaterial
    );
    frontWallLeft.position.set(-(SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    shipGroup.add(frontWallLeft);
    
    const frontWallRight = new THREE.Mesh(
      new THREE.BoxGeometry((SHIP_WIDTH - DOOR_WIDTH) / 2, SHIP_HEIGHT, WALL_THICKNESS),
      hullMaterial
    );
    frontWallRight.position.set((SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    shipGroup.add(frontWallRight);
    
    const frontWallTop = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_WIDTH, SHIP_HEIGHT - DOOR_HEIGHT, WALL_THICKNESS),
      hullMaterial
    );
    frontWallTop.position.set(0, SHIP_HEIGHT - (SHIP_HEIGHT - DOOR_HEIGHT) / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    shipGroup.add(frontWallTop);
    
    // Deck on top
    const deckGeometry = new THREE.BoxGeometry(SHIP_WIDTH - 1, WALL_THICKNESS, SHIP_LENGTH - 2);
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const deckMesh = new THREE.Mesh(deckGeometry, deckMaterial);
    deckMesh.position.y = SHIP_HEIGHT + WALL_THICKNESS / 2;
    shipGroup.add(deckMesh);
    
    shipMesh = shipGroup;
    shipMesh.position.set(0, 0, 0);
    exteriorScene.add(shipMesh);
    
    const shipBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 6, 0) // Start above ground (adjusted for new floor position)
      .setCanSleep(false)
      .setLinearDamping(0.5)
      .setAngularDamping(2.0);
    shipBody = exteriorWorld.createRigidBody(shipBodyDesc);
    
    // Create ship colliders
    createShipColliders(shipBody);
    
    // Create interior world physics (stationary ship interior)
    createInteriorPhysics(SHIP_WIDTH, SHIP_HEIGHT, SHIP_LENGTH, WALL_THICKNESS, DOOR_WIDTH, DOOR_HEIGHT);
    
    createShipInterior();
  }

  function createShipColliders(body) {
    // Use global constants
    
    // Ship structure colliders
    const floorCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, WALL_THICKNESS / 2, SHIP_LENGTH / 2)
      .setTranslation(0, WALL_THICKNESS / 2, 0);
    exteriorWorld.createCollider(floorCollider, body);
    
    const ceilingCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, WALL_THICKNESS / 2, SHIP_LENGTH / 2)
      .setTranslation(0, SHIP_HEIGHT - WALL_THICKNESS / 2, 0);
    exteriorWorld.createCollider(ceilingCollider, body);
    
    const leftWallCollider = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, SHIP_HEIGHT / 2, SHIP_LENGTH / 2)
      .setTranslation(-SHIP_WIDTH / 2 + WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0);
    exteriorWorld.createCollider(leftWallCollider, body);
    
    const rightWallCollider = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, SHIP_HEIGHT / 2, SHIP_LENGTH / 2)
      .setTranslation(SHIP_WIDTH / 2 - WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0);
    exteriorWorld.createCollider(rightWallCollider, body);
    
    const backWallCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, SHIP_HEIGHT / 2, WALL_THICKNESS / 2)
      .setTranslation(0, SHIP_HEIGHT / 2, -SHIP_LENGTH / 2 + WALL_THICKNESS / 2);
    exteriorWorld.createCollider(backWallCollider, body);
    
    // Front wall colliders (with door opening)
    const frontWallLeftCollider = RAPIER.ColliderDesc.cuboid((SHIP_WIDTH - DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, WALL_THICKNESS / 2)
      .setTranslation(-(SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    exteriorWorld.createCollider(frontWallLeftCollider, body);
    
    const frontWallRightCollider = RAPIER.ColliderDesc.cuboid((SHIP_WIDTH - DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, WALL_THICKNESS / 2)
      .setTranslation((SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    exteriorWorld.createCollider(frontWallRightCollider, body);
    
    const frontWallTopCollider = RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2, (SHIP_HEIGHT - DOOR_HEIGHT) / 2, WALL_THICKNESS / 2)
      .setTranslation(0, SHIP_HEIGHT - (SHIP_HEIGHT - DOOR_HEIGHT) / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    exteriorWorld.createCollider(frontWallTopCollider, body);
    
    // Create ship entry sensor for player detection in exterior world - reasonable sensor at door threshold
    const shipEntrySensorCollider = RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2 - 0.5, DOOR_HEIGHT / 2 - 0.5, 0.3)
      .setTranslation(0, DOOR_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS - 0.5)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    shipEntrySensor = exteriorWorld.createCollider(shipEntrySensorCollider, body);
  }
  
  function createInteriorPhysics(SHIP_WIDTH, SHIP_HEIGHT, SHIP_LENGTH, WALL_THICKNESS, DOOR_WIDTH, DOOR_HEIGHT) {
    // Create stationary interior physics world at origin
    // Floor positioned at y = WALL_THICKNESS/2 to match visual floor
    const interiorFloorBody = interiorWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, WALL_THICKNESS / 2, 0)
    );
    const interiorFloorCollider = RAPIER.ColliderDesc.cuboid(
      SHIP_WIDTH / 2 - WALL_THICKNESS, 
      WALL_THICKNESS / 2, 
      SHIP_LENGTH / 2 - WALL_THICKNESS
    );
    interiorWorld.createCollider(interiorFloorCollider, interiorFloorBody);

    // Ceiling positioned at y = SHIP_HEIGHT - WALL_THICKNESS/2 to match visual ceiling
    const interiorCeilingBody = interiorWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, SHIP_HEIGHT - WALL_THICKNESS / 2, 0)
    );
    const interiorCeilingCollider = RAPIER.ColliderDesc.cuboid(
      SHIP_WIDTH / 2 - WALL_THICKNESS, 
      WALL_THICKNESS / 2, 
      SHIP_LENGTH / 2 - WALL_THICKNESS
    );
    interiorWorld.createCollider(interiorCeilingCollider, interiorCeilingBody);

    // Create sensor to detect when player enters door area in interior world
    const interiorDoorSensorBody = interiorWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, DOOR_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS)
    );
    const interiorDoorSensorCollider = RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2, DOOR_HEIGHT / 2, WALL_THICKNESS / 2)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    interiorWorld.createCollider(interiorDoorSensorCollider, interiorDoorSensorBody);
    
    console.log('Created interior floor at y:', WALL_THICKNESS / 2, 'size:', {
      width: SHIP_WIDTH - WALL_THICKNESS * 2,
      height: WALL_THICKNESS,
      length: SHIP_LENGTH - WALL_THICKNESS * 2
    });
    
    // Interior walls
    const interiorLeftWallBody = interiorWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-SHIP_WIDTH / 2 + WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0));
    const interiorLeftWallCollider = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, SHIP_HEIGHT / 2, SHIP_LENGTH / 2);
    interiorWorld.createCollider(interiorLeftWallCollider, interiorLeftWallBody);
    
    const interiorRightWallBody = interiorWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(SHIP_WIDTH / 2 - WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0));
    const interiorRightWallCollider = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, SHIP_HEIGHT / 2, SHIP_LENGTH / 2);
    interiorWorld.createCollider(interiorRightWallCollider, interiorRightWallBody);
    
    const interiorBackWallBody = interiorWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, SHIP_HEIGHT / 2, -SHIP_LENGTH / 2 + WALL_THICKNESS / 2));
    const interiorBackWallCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, SHIP_HEIGHT / 2, WALL_THICKNESS / 2);
    interiorWorld.createCollider(interiorBackWallCollider, interiorBackWallBody);
    
    // Front walls with door opening
    const interiorFrontLeftWallBody = interiorWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-(SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2));
    const interiorFrontLeftWallCollider = RAPIER.ColliderDesc.cuboid((SHIP_WIDTH - DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, WALL_THICKNESS / 2);
    interiorWorld.createCollider(interiorFrontLeftWallCollider, interiorFrontLeftWallBody);
    
    const interiorFrontRightWallBody = interiorWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2));
    const interiorFrontRightWallCollider = RAPIER.ColliderDesc.cuboid((SHIP_WIDTH - DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, WALL_THICKNESS / 2);
    interiorWorld.createCollider(interiorFrontRightWallCollider, interiorFrontRightWallBody);
    
    const interiorFrontTopWallBody = interiorWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, SHIP_HEIGHT - (SHIP_HEIGHT - DOOR_HEIGHT) / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2));
    const interiorFrontTopWallCollider = RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2, (SHIP_HEIGHT - DOOR_HEIGHT) / 2, WALL_THICKNESS / 2);
    interiorWorld.createCollider(interiorFrontTopWallCollider, interiorFrontTopWallBody);
  }
  
  function createShipInterior() {
    shipInteriorProxy = new THREE.Group();
    
    // Use actual ship dimensions for consistency
    
    // Interior lighting
    const interiorLight = new THREE.PointLight(0xffffff, 0.8, 20);
    interiorLight.position.set(0, SHIP_HEIGHT / 2, 0);
    shipInteriorProxy.add(interiorLight);
    
    // No visual floor - physics floor is invisible
    
    // Interior walls (visual markers)
    const interiorWallMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x666666,
      wireframe: true, // Make ship interior wireframe for better visibility
      roughness: 0.6
    });
    
    // Clean interior without furniture for now
    
    // Add interior wall outlines to show actual boundaries
    const wallOutlineMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x444444,
      transparent: true,
      opacity: 0.3
    });
    
    // Left wall outline
    const leftWallOutline = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_THICKNESS, SHIP_HEIGHT - WALL_THICKNESS, SHIP_LENGTH - WALL_THICKNESS),
      wallOutlineMaterial
    );
    leftWallOutline.position.set(-SHIP_WIDTH / 2 + WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0);
    shipInteriorProxy.add(leftWallOutline);
    
    // Right wall outline
    const rightWallOutline = new THREE.Mesh(
      new THREE.BoxGeometry(WALL_THICKNESS, SHIP_HEIGHT - WALL_THICKNESS, SHIP_LENGTH - WALL_THICKNESS),
      wallOutlineMaterial
    );
    rightWallOutline.position.set(SHIP_WIDTH / 2 - WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0);
    shipInteriorProxy.add(rightWallOutline);
    
    // Back wall outline
    const backWallOutline = new THREE.Mesh(
      new THREE.BoxGeometry(SHIP_WIDTH - WALL_THICKNESS, SHIP_HEIGHT - WALL_THICKNESS, WALL_THICKNESS),
      wallOutlineMaterial
    );
    backWallOutline.position.set(0, SHIP_HEIGHT / 2, -SHIP_LENGTH / 2 + WALL_THICKNESS / 2);
    shipInteriorProxy.add(backWallOutline);
    
    // Ship interior floor mesh - matches physics collider position
    const interiorFloorGeometry = new THREE.BoxGeometry(SHIP_WIDTH - WALL_THICKNESS * 2, WALL_THICKNESS, SHIP_LENGTH - WALL_THICKNESS * 2);
    const interiorFloorMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const interiorFloorMesh = new THREE.Mesh(interiorFloorGeometry, interiorFloorMaterial);
    interiorFloorMesh.position.set(0, WALL_THICKNESS / 2, 0); // Match physics collider position
    interiorFloorMesh.receiveShadow = true;
    shipInteriorProxy.add(interiorFloorMesh);
    
    // Create debug player capsule representation for interior scene
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const debugCapsuleGeometry = new THREE.CapsuleGeometry(capsuleRadius, capsuleHeight, 4, 8);
    // Translate geometry so capsule rotates around its base (feet) instead of center
    debugCapsuleGeometry.translate(0, capsuleHeight / 2, 0);
    const debugCapsuleMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x00ff00, 
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    debugPlayerMesh = new THREE.Mesh(debugCapsuleGeometry, debugCapsuleMaterial);
    debugPlayerMesh.visible = false; // Hidden until player enters ship
    interiorScene.add(debugPlayerMesh);
    
    shipInteriorProxy.visible = false;
    interiorScene.add(shipInteriorProxy);
  }
  
  let stationMesh;
  let debugStationPlayerMesh;
  
  function createDockingStation() {
    const stationGroup = new THREE.Group();
    const dockingBayWidth = 60;
    const dockingBayHeight = 30;
    const dockingBayDepth = 80;
    
    const stationMaterial = new THREE.MeshStandardMaterial({ color: 0x555555 });
    
    // Main station hull - hollow box
    // Floor
    const floorGeometry = new THREE.BoxGeometry(STATION_WIDTH, STATION_WALL_THICKNESS, STATION_LENGTH);
    const floorMesh = new THREE.Mesh(floorGeometry, stationMaterial);
    floorMesh.castShadow = true;
    floorMesh.receiveShadow = true;
    floorMesh.position.set(0, STATION_WALL_THICKNESS / 2, 0);
    stationGroup.add(floorMesh);
    
    // Ceiling
    const ceilingMesh = new THREE.Mesh(floorGeometry, stationMaterial);
    ceilingMesh.position.set(0, STATION_HEIGHT - STATION_WALL_THICKNESS / 2, 0);
    stationGroup.add(ceilingMesh);
    
    // Walls (with docking bay opening)
    // Left wall
    const leftWallGeometry = new THREE.BoxGeometry(STATION_WALL_THICKNESS, STATION_HEIGHT, STATION_LENGTH);
    const leftWallMesh = new THREE.Mesh(leftWallGeometry, stationMaterial);
    leftWallMesh.position.set(-STATION_WIDTH / 2 + STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0);
    stationGroup.add(leftWallMesh);
    
    // Right wall
    const rightWallMesh = new THREE.Mesh(leftWallGeometry, stationMaterial);
    rightWallMesh.position.set(STATION_WIDTH / 2 - STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0);
    stationGroup.add(rightWallMesh);
    
    // Back wall
    const backWallGeometry = new THREE.BoxGeometry(STATION_WIDTH, STATION_HEIGHT, STATION_WALL_THICKNESS);
    const backWallMesh = new THREE.Mesh(backWallGeometry, stationMaterial);
    backWallMesh.position.set(0, STATION_HEIGHT / 2, -STATION_LENGTH / 2 + STATION_WALL_THICKNESS / 2);
    stationGroup.add(backWallMesh);
    
    // Front wall with docking bay opening
    const frontWallLeft = new THREE.Mesh(
      new THREE.BoxGeometry((STATION_WIDTH - dockingBayWidth) / 2, STATION_HEIGHT, STATION_WALL_THICKNESS),
      stationMaterial
    );
    frontWallLeft.position.set(-(STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    stationGroup.add(frontWallLeft);
    
    const frontWallRight = new THREE.Mesh(
      new THREE.BoxGeometry((STATION_WIDTH - dockingBayWidth) / 2, STATION_HEIGHT, STATION_WALL_THICKNESS),
      stationMaterial
    );
    frontWallRight.position.set((STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    stationGroup.add(frontWallRight);
    
    const frontWallTop = new THREE.Mesh(
      new THREE.BoxGeometry(dockingBayWidth, STATION_HEIGHT - dockingBayHeight, STATION_WALL_THICKNESS),
      stationMaterial
    );
    frontWallTop.position.set(0, STATION_HEIGHT - (STATION_HEIGHT - dockingBayHeight) / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    stationGroup.add(frontWallTop);
    
    stationMesh = stationGroup;
    // Position station in line with ship spawn, further back (ship door faces +Z, so put station at -Z) 
    stationMesh.position.set(0, 30, -200); // In line with ship spawn, further back
    exteriorScene.add(stationMesh);
    
    // Create station physics body as dynamic with gravity and physics
    const stationBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 30, -200)
      .setCanSleep(false)
      .setLinearDamping(0.8)
      .setAngularDamping(2.0);
    stationBody = exteriorWorld.createRigidBody(stationBodyDesc);
    
    // Station colliders - full structure for proper physics
    // Floor
    const stationFloorCollider = RAPIER.ColliderDesc.cuboid(STATION_WIDTH / 2, STATION_WALL_THICKNESS / 2, STATION_LENGTH / 2)
      .setTranslation(0, STATION_WALL_THICKNESS / 2, 0);
    exteriorWorld.createCollider(stationFloorCollider, stationBody);
    
    // Ceiling  
    const stationCeilingCollider = RAPIER.ColliderDesc.cuboid(STATION_WIDTH / 2, STATION_WALL_THICKNESS / 2, STATION_LENGTH / 2)
      .setTranslation(0, STATION_HEIGHT - STATION_WALL_THICKNESS / 2, 0);
    exteriorWorld.createCollider(stationCeilingCollider, stationBody);
    
    // Left wall
    const stationLeftWallCollider = RAPIER.ColliderDesc.cuboid(STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, STATION_LENGTH / 2)
      .setTranslation(-STATION_WIDTH / 2 + STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0);
    exteriorWorld.createCollider(stationLeftWallCollider, stationBody);
    
    // Right wall
    const stationRightWallCollider = RAPIER.ColliderDesc.cuboid(STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, STATION_LENGTH / 2)
      .setTranslation(STATION_WIDTH / 2 - STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0);
    exteriorWorld.createCollider(stationRightWallCollider, stationBody);
    
    // Back wall
    const stationBackWallCollider = RAPIER.ColliderDesc.cuboid(STATION_WIDTH / 2, STATION_HEIGHT / 2, STATION_WALL_THICKNESS / 2)
      .setTranslation(0, STATION_HEIGHT / 2, -STATION_LENGTH / 2 + STATION_WALL_THICKNESS / 2);
    exteriorWorld.createCollider(stationBackWallCollider, stationBody);
    
    // Front walls (with docking bay opening)
    const stationFrontLeftCollider = RAPIER.ColliderDesc.cuboid((STATION_WIDTH - dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_WALL_THICKNESS / 2)
      .setTranslation(-(STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    exteriorWorld.createCollider(stationFrontLeftCollider, stationBody);
    
    const stationFrontRightCollider = RAPIER.ColliderDesc.cuboid((STATION_WIDTH - dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_WALL_THICKNESS / 2)
      .setTranslation((STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    exteriorWorld.createCollider(stationFrontRightCollider, stationBody);
    
    const stationFrontTopCollider = RAPIER.ColliderDesc.cuboid(dockingBayWidth / 2, (STATION_HEIGHT - dockingBayHeight) / 2, STATION_WALL_THICKNESS / 2)
      .setTranslation(0, STATION_HEIGHT - (STATION_HEIGHT - dockingBayHeight) / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    exteriorWorld.createCollider(stationFrontTopCollider, stationBody);
    
    
    
    // Create player entry sensor for direct station access - small sensor just inside docking bay
    const stationEntrySensorCollider = RAPIER.ColliderDesc.cuboid(dockingBayWidth / 2 - 2.0, dockingBayHeight / 2 - 2.0, 1.0)
      .setTranslation(0, dockingBayHeight / 2, STATION_LENGTH / 2 - 2.0)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    stationEntrySensor = exteriorWorld.createCollider(stationEntrySensorCollider, stationBody);
    
    createStationInterior();
  }
  
  // Ship visual proxies now handled in stationShipProxies array

  function createStationInterior() {
    stationInteriorProxy = new THREE.Group();
    
    
    // Station interior lighting
    const stationInteriorLight = new THREE.PointLight(0xffffff, 1.2, 150);
    stationInteriorLight.position.set(0, STATION_HEIGHT / 2, 0);
    stationInteriorProxy.add(stationInteriorLight);
    
    // Add additional lights for better visibility
    const frontLight = new THREE.PointLight(0xffffff, 0.8, 100);
    frontLight.position.set(0, STATION_HEIGHT / 2, STATION_LENGTH / 3);
    stationInteriorProxy.add(frontLight);
    
    const backLight = new THREE.PointLight(0xffffff, 0.8, 100);
    backLight.position.set(0, STATION_HEIGHT / 2, -STATION_LENGTH / 3);
    stationInteriorProxy.add(backLight);
    
    // Create visual walls for station interior
    const interiorWallMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x666666, 
      wireframe: true // Make station interior wireframe for better visibility
    });
    
    // Floor
    const floorGeometry = new THREE.BoxGeometry(STATION_WIDTH - STATION_WALL_THICKNESS, STATION_WALL_THICKNESS, STATION_LENGTH - STATION_WALL_THICKNESS);
    const floorMesh = new THREE.Mesh(floorGeometry, interiorWallMaterial);
    floorMesh.position.y = STATION_WALL_THICKNESS / 2;
    stationInteriorProxy.add(floorMesh);
    
    // Ceiling (partial to show it's a hangar)
    const ceilingGeometry = new THREE.BoxGeometry(STATION_WIDTH - STATION_WALL_THICKNESS, STATION_WALL_THICKNESS, STATION_LENGTH - STATION_WALL_THICKNESS);
    const ceilingMesh = new THREE.Mesh(ceilingGeometry, interiorWallMaterial);
    ceilingMesh.position.y = STATION_HEIGHT - STATION_WALL_THICKNESS / 2;
    stationInteriorProxy.add(ceilingMesh);
    
    // Left wall
    const leftWallGeometry = new THREE.BoxGeometry(STATION_WALL_THICKNESS, STATION_HEIGHT, STATION_LENGTH);
    const leftWallMesh = new THREE.Mesh(leftWallGeometry, interiorWallMaterial);
    leftWallMesh.position.set(-STATION_WIDTH / 2 + STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0);
    stationInteriorProxy.add(leftWallMesh);
    
    // Right wall
    const rightWallGeometry = new THREE.BoxGeometry(STATION_WALL_THICKNESS, STATION_HEIGHT, STATION_LENGTH);
    const rightWallMesh = new THREE.Mesh(rightWallGeometry, interiorWallMaterial);
    rightWallMesh.position.set(STATION_WIDTH / 2 - STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0);
    stationInteriorProxy.add(rightWallMesh);
    
    // Back wall
    const backWallGeometry = new THREE.BoxGeometry(STATION_WIDTH, STATION_HEIGHT, STATION_WALL_THICKNESS);
    const backWallMesh = new THREE.Mesh(backWallGeometry, interiorWallMaterial);
    backWallMesh.position.set(0, STATION_HEIGHT / 2, -STATION_LENGTH / 2 + STATION_WALL_THICKNESS / 2);
    stationInteriorProxy.add(backWallMesh);
    
    // Front wall with docking bay opening (partial walls around opening)
    const dockingBayWidth = 60;
    const dockingBayHeight = 30;
    
    // Front wall sections around docking bay
    const frontWallLeft = new THREE.Mesh(
      new THREE.BoxGeometry((STATION_WIDTH - dockingBayWidth) / 2, STATION_HEIGHT, STATION_WALL_THICKNESS),
      interiorWallMaterial
    );
    frontWallLeft.position.set(-(STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    stationInteriorProxy.add(frontWallLeft);
    
    const frontWallRight = new THREE.Mesh(
      new THREE.BoxGeometry((STATION_WIDTH - dockingBayWidth) / 2, STATION_HEIGHT, STATION_WALL_THICKNESS),
      interiorWallMaterial
    );
    frontWallRight.position.set((STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    stationInteriorProxy.add(frontWallRight);
    
    const frontWallTop = new THREE.Mesh(
      new THREE.BoxGeometry(dockingBayWidth, STATION_HEIGHT - dockingBayHeight, STATION_WALL_THICKNESS),
      interiorWallMaterial
    );
    frontWallTop.position.set(0, STATION_HEIGHT - (STATION_HEIGHT - dockingBayHeight) / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2);
    stationInteriorProxy.add(frontWallTop);
    
    
    // Create ship proxy for station interior view
    createStationShipProxy();
    
    // Create debug player mesh for station
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const debugCapsuleGeometry = new THREE.CapsuleGeometry(capsuleRadius, capsuleHeight, 4, 8);
    // Translate geometry so capsule rotates around its base (feet) instead of center
    debugCapsuleGeometry.translate(0, capsuleHeight / 2, 0);
    const debugCapsuleMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xff0000, 
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    debugStationPlayerMesh = new THREE.Mesh(debugCapsuleGeometry, debugCapsuleMaterial);
    debugStationPlayerMesh.visible = false;
    stationScene.add(debugStationPlayerMesh);
    
    // Create station interior physics
    createStationPhysics(STATION_WIDTH, STATION_HEIGHT, STATION_LENGTH, STATION_WALL_THICKNESS);
    
    stationInteriorProxy.visible = false;
    stationScene.add(stationInteriorProxy);
  }
  
  function createStationPhysics(STATION_WIDTH, STATION_HEIGHT, STATION_LENGTH, WALL_THICKNESS) {
    // Station interior floor
    const stationFloorBody = stationWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, STATION_WALL_THICKNESS / 2, 0)
    );
    const stationFloorCollider = RAPIER.ColliderDesc.cuboid(
      STATION_WIDTH / 2, 
      STATION_WALL_THICKNESS / 2, 
      STATION_LENGTH / 2
    ).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    stationWorld.createCollider(stationFloorCollider, stationFloorBody);
    
    // Station interior walls
    const stationLeftWallBody = stationWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-STATION_WIDTH / 2 + STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0));
    const stationLeftWallCollider = RAPIER.ColliderDesc.cuboid(STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, STATION_LENGTH / 2);
    stationWorld.createCollider(stationLeftWallCollider, stationLeftWallBody);
    
    const stationRightWallBody = stationWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(STATION_WIDTH / 2 - STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, 0));
    const stationRightWallCollider = RAPIER.ColliderDesc.cuboid(STATION_WALL_THICKNESS / 2, STATION_HEIGHT / 2, STATION_LENGTH / 2);
    stationWorld.createCollider(stationRightWallCollider, stationRightWallBody);
    
    // Station interior back wall
    const stationBackWallBody = stationWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, STATION_HEIGHT / 2, -STATION_LENGTH / 2 + STATION_WALL_THICKNESS / 2));
    const stationBackWallCollider = RAPIER.ColliderDesc.cuboid(STATION_WIDTH / 2, STATION_HEIGHT / 2, STATION_WALL_THICKNESS / 2);
    stationWorld.createCollider(stationBackWallCollider, stationBackWallBody);
    
    // Station interior front walls (with docking bay opening)
    const dockingBayWidth = 60, dockingBayHeight = 30;
    
    // Front left wall section
    const stationFrontLeftWallBody = stationWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(-(STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2));
    const stationFrontLeftWallCollider = RAPIER.ColliderDesc.cuboid((STATION_WIDTH - dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_WALL_THICKNESS / 2);
    stationWorld.createCollider(stationFrontLeftWallCollider, stationFrontLeftWallBody);
    
    // Front right wall section
    const stationFrontRightWallBody = stationWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((STATION_WIDTH + dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2));
    const stationFrontRightWallCollider = RAPIER.ColliderDesc.cuboid((STATION_WIDTH - dockingBayWidth) / 4, STATION_HEIGHT / 2, STATION_WALL_THICKNESS / 2);
    stationWorld.createCollider(stationFrontRightWallCollider, stationFrontRightWallBody);
    
    // Front top wall section (above docking bay opening)
    const stationFrontTopWallBody = stationWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, STATION_HEIGHT - (STATION_HEIGHT - dockingBayHeight) / 2, STATION_LENGTH / 2 - STATION_WALL_THICKNESS / 2));
    const stationFrontTopWallCollider = RAPIER.ColliderDesc.cuboid(dockingBayWidth / 2, (STATION_HEIGHT - dockingBayHeight) / 2, STATION_WALL_THICKNESS / 2);
    stationWorld.createCollider(stationFrontTopWallCollider, stationFrontTopWallBody);
    
    // Station interior ceiling
    const stationCeilingBody = stationWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, STATION_HEIGHT - STATION_WALL_THICKNESS / 2, 0)
    );
    const stationCeilingCollider = RAPIER.ColliderDesc.cuboid(
      STATION_WIDTH / 2, 
      STATION_WALL_THICKNESS / 2, 
      STATION_LENGTH / 2
    );
    stationWorld.createCollider(stationCeilingCollider, stationCeilingBody);
    
    console.log('Created station interior physics');
    
    // Create first ship physics body in station world (initially inactive)
    // This creates space for the first ship - more ships will be added when they dock
    createStationShip(0); // Create ship at index 0
    
    // Initialize compatibility variables to point to the first ship
    stationShipBody = stationShipBodies[0];
    stationShipProxy = stationShipProxies[0];
  }
  
  // Creates a ship physics body and visual proxy for the station at the given index
  function createStationShip(shipIndex) {
    // Calculate ship position within station (spread ships out to prevent overlap)
    const shipSpacing = 50; // Space between ships in Z direction
    const baseZ = -50; // Base Z position for first ship
    const shipZ = baseZ - (shipIndex * shipSpacing);
    
    console.log(`Creating station ship ${shipIndex} at Z=${shipZ}`);
    
    // Create ship physics body in station world (initially inactive)
    const stationShipBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, -300, 0) // Start way below (inactive until ship docks)
      .setCanSleep(false)
      .setLinearDamping(0.5)
      .setAngularDamping(2.0);
    const stationShipBody = stationWorld.createRigidBody(stationShipBodyDesc);
    
    // Create compound ship colliders in station world (same as exterior with door opening)
    // Ship floor in station (positioned to align with station floor for seamless walking)
    const shipFloorInStationCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, WALL_THICKNESS / 2, SHIP_LENGTH / 2)
      .setTranslation(0, WALL_THICKNESS / 2, 0) // Match exterior world ship floor position
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS); // Enable collision events for debugging
    stationWorld.createCollider(shipFloorInStationCollider, stationShipBody);
    
    // Ship ceiling in station (match exterior world positioning)
    const shipCeilingInStationCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, WALL_THICKNESS / 2, SHIP_LENGTH / 2)
      .setTranslation(0, SHIP_HEIGHT - WALL_THICKNESS / 2, 0); // Match exterior world ceiling position
    stationWorld.createCollider(shipCeilingInStationCollider, stationShipBody);
    
    // Ship left wall in station (match exterior world positioning)
    const shipLeftWallInStationCollider = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, SHIP_HEIGHT / 2, SHIP_LENGTH / 2)
      .setTranslation(-SHIP_WIDTH / 2 + WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0); // Match exterior world wall position
    stationWorld.createCollider(shipLeftWallInStationCollider, stationShipBody);
    
    // Ship right wall in station (match exterior world positioning)  
    const shipRightWallInStationCollider = RAPIER.ColliderDesc.cuboid(WALL_THICKNESS / 2, SHIP_HEIGHT / 2, SHIP_LENGTH / 2)
      .setTranslation(SHIP_WIDTH / 2 - WALL_THICKNESS / 2, SHIP_HEIGHT / 2, 0); // Match exterior world wall position
    stationWorld.createCollider(shipRightWallInStationCollider, stationShipBody);
    
    // Ship back wall in station (match exterior world positioning)
    const shipBackWallInStationCollider = RAPIER.ColliderDesc.cuboid(SHIP_WIDTH / 2, SHIP_HEIGHT / 2, WALL_THICKNESS / 2)
      .setTranslation(0, SHIP_HEIGHT / 2, -SHIP_LENGTH / 2 + WALL_THICKNESS / 2); // Match exterior world back wall position
    stationWorld.createCollider(shipBackWallInStationCollider, stationShipBody);
    
    // Ship front wall colliders in station (with door opening, match exterior world positioning)
    const shipFrontWallLeftInStationCollider = RAPIER.ColliderDesc.cuboid((SHIP_WIDTH - DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, WALL_THICKNESS / 2)
      .setTranslation(-(SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2); // Match exterior world front wall position
    stationWorld.createCollider(shipFrontWallLeftInStationCollider, stationShipBody);
    
    const shipFrontWallRightInStationCollider = RAPIER.ColliderDesc.cuboid((SHIP_WIDTH - DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, WALL_THICKNESS / 2)
      .setTranslation((SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2); // Match exterior world front wall position
    stationWorld.createCollider(shipFrontWallRightInStationCollider, stationShipBody);
    
    const shipFrontWallTopInStationCollider = RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2, (SHIP_HEIGHT - DOOR_HEIGHT) / 2, WALL_THICKNESS / 2)
      .setTranslation(0, SHIP_HEIGHT - (SHIP_HEIGHT - DOOR_HEIGHT) / 2, SHIP_LENGTH / 2 - WALL_THICKNESS / 2); // Match exterior world front wall top position
    stationWorld.createCollider(shipFrontWallTopInStationCollider, stationShipBody);
    
    // Create ship entry sensor for station world - allows player to enter ship from station
    const shipStationEntrySensorCollider = RAPIER.ColliderDesc.cuboid(DOOR_WIDTH / 2 - 0.5, DOOR_HEIGHT / 2 - 0.5, 0.3)
      .setTranslation(0, DOOR_HEIGHT / 2, SHIP_LENGTH / 2 - WALL_THICKNESS - 0.5)
      .setSensor(true)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    stationWorld.createCollider(shipStationEntrySensorCollider, stationShipBody);
    
    // Store ship body in array
    stationShipBodies[shipIndex] = stationShipBody;
    
    // Create visual proxy for this ship
    createStationShipProxy(shipIndex);
    
    // Initialize compatibility layer for the first ship
    if (shipIndex === 0) {
      updateActiveShip(0);
    }
    
    return stationShipBody;
  }
  
  function createStationShipProxy(shipIndex = 0) {
    // Create a copy of the ship for display in the station interior
    const shipGroup = new THREE.Group();
    
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x444444 });
    
    // Floor (matched exactly to physics collider position)
    const floorGeometry = new THREE.BoxGeometry(SHIP_WIDTH, WALL_THICKNESS, SHIP_LENGTH);
    const floorMesh = new THREE.Mesh(floorGeometry, hullMaterial);
    floorMesh.castShadow = true;
    floorMesh.receiveShadow = true;
    // Physics collider is at Y=-WALL_THICKNESS to align with station floor, visual mesh center matches
    floorMesh.position.set(0, -WALL_THICKNESS, 0); 
    shipGroup.add(floorMesh);
    
    // Ceiling (matched exactly to physics collider position)  
    const ceilingGeometry = new THREE.BoxGeometry(SHIP_WIDTH, WALL_THICKNESS, SHIP_LENGTH);
    const ceilingMesh = new THREE.Mesh(ceilingGeometry, hullMaterial);
    // Physics collider is at Y=SHIP_HEIGHT-WALL_THICKNESS, visual mesh center matches
    ceilingMesh.position.set(0, SHIP_HEIGHT - WALL_THICKNESS, 0);
    shipGroup.add(ceilingMesh);
    
    // Left wall (matched exactly to physics collider position)
    const leftWallGeometry = new THREE.BoxGeometry(WALL_THICKNESS, SHIP_HEIGHT, SHIP_LENGTH);
    const leftWallMesh = new THREE.Mesh(leftWallGeometry, hullMaterial);
    // Physics collider is at Y=SHIP_HEIGHT/2-WALL_THICKNESS, visual mesh center matches
    leftWallMesh.position.set(-SHIP_WIDTH / 2 + WALL_THICKNESS / 2, SHIP_HEIGHT / 2 - WALL_THICKNESS, 0);
    shipGroup.add(leftWallMesh);
    
    // Right wall (matched exactly to physics collider position)
    const rightWallMesh = new THREE.Mesh(leftWallGeometry, hullMaterial);
    rightWallMesh.position.set(SHIP_WIDTH / 2 - WALL_THICKNESS / 2, SHIP_HEIGHT / 2 - WALL_THICKNESS, 0);
    shipGroup.add(rightWallMesh);
    
    // Back wall (matched exactly to physics collider position)
    const backWallGeometry = new THREE.BoxGeometry(SHIP_WIDTH, SHIP_HEIGHT, WALL_THICKNESS);
    const backWallMesh = new THREE.Mesh(backWallGeometry, hullMaterial);
    backWallMesh.position.set(0, SHIP_HEIGHT / 2 - WALL_THICKNESS, -SHIP_LENGTH / 2 + WALL_THICKNESS / 2);
    shipGroup.add(backWallMesh);
    
    // Front wall with door opening (adjusted for floor at Y=0)
    const DOOR_WIDTH = 4;  
    const DOOR_HEIGHT = 4;
    
    const frontWallLeft = new THREE.Mesh(
      new THREE.BoxGeometry((SHIP_WIDTH - DOOR_WIDTH) / 2, SHIP_HEIGHT, WALL_THICKNESS),
      hullMaterial
    );
    frontWallLeft.position.set(-(SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2 - WALL_THICKNESS, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    shipGroup.add(frontWallLeft);
    
    const frontWallRight = new THREE.Mesh(
      new THREE.BoxGeometry((SHIP_WIDTH - DOOR_WIDTH) / 2, SHIP_HEIGHT, WALL_THICKNESS),
      hullMaterial
    );
    frontWallRight.position.set((SHIP_WIDTH + DOOR_WIDTH) / 4, SHIP_HEIGHT / 2 - WALL_THICKNESS, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    shipGroup.add(frontWallRight);
    
    const frontWallTop = new THREE.Mesh(
      new THREE.BoxGeometry(DOOR_WIDTH, SHIP_HEIGHT - DOOR_HEIGHT, WALL_THICKNESS),
      hullMaterial
    );
    // Matched exactly to physics collider position  
    frontWallTop.position.set(0, SHIP_HEIGHT - (SHIP_HEIGHT - DOOR_HEIGHT) / 2 - WALL_THICKNESS, SHIP_LENGTH / 2 - WALL_THICKNESS / 2);
    shipGroup.add(frontWallTop);
    
    // Deck on top
    const deckGeometry = new THREE.BoxGeometry(SHIP_WIDTH - 1, WALL_THICKNESS, SHIP_LENGTH - 2);
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const deckMesh = new THREE.Mesh(deckGeometry, deckMaterial);
    deckMesh.position.y = SHIP_HEIGHT + WALL_THICKNESS / 2;
    shipGroup.add(deckMesh);
    
    // Store ship proxy in array
    stationShipProxies[shipIndex] = shipGroup;
    shipGroup.visible = false; // Hidden until ship docks
    stationScene.add(shipGroup);
    
    console.log(`Created station ship proxy ${shipIndex}`);
  }
  
  // Helper functions for multi-ship system
  function getActiveStationShip() {
    return stationShipBodies[activeShipIndex];
  }
  
  function getActiveStationShipProxy() {
    return stationShipProxies[activeShipIndex];
  }
  
  function findClosestStationShip(playerPos) {
    // Find the closest ship to the player in the station
    let closestIndex = 0;
    let closestDistance = Infinity;
    
    for (let i = 0; i < stationShipBodies.length; i++) {
      if (stationShipBodies[i]) {
        const shipPos = stationShipBodies[i].translation();
        const distance = Math.sqrt(
          Math.pow(playerPos.x - shipPos.x, 2) + 
          Math.pow(playerPos.y - shipPos.y, 2) + 
          Math.pow(playerPos.z - shipPos.z, 2)
        );
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = i;
        }
      }
    }
    
    return closestIndex;
  }
  
  function updateActiveShip(newActiveIndex) {
    activeShipIndex = newActiveIndex;
    // Update compatibility layer
    stationShipBody = stationShipBodies[activeShipIndex];
    stationShipProxy = stationShipProxies[activeShipIndex];
    console.log(`Active ship changed to index ${activeShipIndex}`);
  }
  
  function handleKeyDown(event) {
    switch(event.key.toLowerCase()) {
      case 'w': movement.forward = true; break;
      case 's': movement.backward = true; break;
      case 'a': movement.left = true; break;
      case 'd': movement.right = true; break;
      case ' ': 
        if (!jumpPressed && canJump) {
          movement.jump = true;
          jumpPressed = true;
        }
        break;
      case 'arrowup': 
        shipMovement.forward = true; 
        console.log('Arrow UP pressed - forward thrust');
        break;
      case 'arrowdown': 
        shipMovement.backward = true; 
        console.log('Arrow DOWN pressed - backward thrust');
        break;
      case 'arrowleft': 
        shipMovement.left = true; 
        console.log('Arrow LEFT pressed - left yaw');
        break;
      case 'arrowright': 
        shipMovement.right = true; 
        console.log('Arrow RIGHT pressed - right yaw');
        break;
      case 'q': 
        shipMovement.up = true; 
        console.log('Q pressed');
        break;
      case 'e': 
        shipMovement.down = true; 
        console.log('E pressed');
        break;
      // Ship movement controls (TFGH) - only when player is inside ship
      case 't':
        if (isInsideShip) {
          shipMovement.forward = true;
          console.log('T pressed - ship forward');
        }
        break;
      case 'g':
        if (isInsideShip) {
          shipMovement.backward = true;
          console.log('G pressed - ship backward');
        }
        break;
      case 'f':
        if (isInsideShip) {
          shipMovement.left = true;
          console.log('F pressed - ship left');
        }
        break;
      case 'h':
        if (isInsideShip) {
          shipMovement.right = true;
          console.log('H pressed - ship right');
        }
        break;
      case 'r':
        if (isInsideShip) {
          shipMovement.down = true;
          console.log('R pressed - ship down');
        }
        break;
      case 'y':
        if (isInsideShip) {
          shipMovement.up = true;
          console.log('Y pressed - ship up');
        }
        break;
      // Station movement controls (IKJL) - only when player is inside station
      case 'i':
        if (isInsideStation) {
          stationMovement.forward = true;
          console.log('I pressed - station forward');
        }
        break;
      case 'k':
        if (isInsideStation) {
          stationMovement.backward = true;
          console.log('K pressed - station backward');
        }
        break;
      case 'j':
        if (isInsideStation) {
          stationMovement.left = true;
          console.log('J pressed - station left');
        }
        break;
      case 'l':
        if (isInsideStation) {
          stationMovement.right = true;
          console.log('L pressed - station right');
        }
        break;
      case 'o':
        isFirstPerson = !isFirstPerson;
        console.log('Camera switched to:', isFirstPerson ? 'First Person' : 'Third Person');
        
        // Reset mouse look rotation when switching to first person
        if (isFirstPerson && !isPointerLocked) {
          cameraRotation.yaw = 0;
          cameraRotation.pitch = 0;
        }
        
        // Exit pointer lock when switching to third person
        if (!isFirstPerson && isPointerLocked) {
          document.exitPointerLock();
        }
        break;
      case 'escape':
        if (isPointerLocked) {
          document.exitPointerLock();
        }
        break;
      case 'x':
        // Exit station (temporary key for testing)
        if (isInsideStation) {
          console.log('X pressed - exiting station');
          exitStation();
        }
        break;
    }
  }
  
  function handleClick() {
    if (!isPointerLocked) {
      // Request pointer lock when clicking in any world (exterior, ship, or station)
      canvas.requestPointerLock();
    }
  }

  function handlePointerLockChange() {
    isPointerLocked = document.pointerLockElement === canvas;
    console.log('Pointer lock:', isPointerLocked ? 'ON' : 'OFF');
    
    // Reset camera rotation when exiting pointer lock to prevent glitches
    if (!isPointerLocked) {
      cameraRotation.yaw = 0;
      cameraRotation.pitch = 0;
    }
  }

  function handleMouseMove(event) {
    if (!isPointerLocked) return;
    
    const sensitivity = 0.002;
    const deltaX = event.movementX * sensitivity;
    const deltaY = event.movementY * sensitivity;
    
    // Update camera rotation for both modes
    cameraRotation.yaw -= deltaX; // Invert X for correct left/right aiming
    cameraRotation.pitch -= deltaY;
    
    // Clamp vertical rotation to prevent over-rotation
    cameraRotation.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRotation.pitch));
    
    // Keep yaw in reasonable bounds (optional, helps prevent numerical drift)
    while (cameraRotation.yaw > Math.PI) cameraRotation.yaw -= 2 * Math.PI;
    while (cameraRotation.yaw < -Math.PI) cameraRotation.yaw += 2 * Math.PI;
    
    // Player capsule rotation is handled visually through the mesh, not physics body
    // The physics body stays upright for stability while aiming direction is visual
  }

  function handleKeyUp(event) {
    switch(event.key.toLowerCase()) {
      case 'w': movement.forward = false; break;
      case 's': movement.backward = false; break;
      case 'a': movement.left = false; break;
      case 'd': movement.right = false; break;
      case ' ': 
        movement.jump = false;
        jumpPressed = false;
        break;
      case 'arrowup': shipMovement.forward = false; break;
      case 'arrowdown': shipMovement.backward = false; break;
      case 'arrowleft': shipMovement.left = false; break;
      case 'arrowright': shipMovement.right = false; break;
      case 'q': shipMovement.up = false; break;
      case 'e': shipMovement.down = false; break;
      // Ship movement controls (TFGH + RY)
      case 't': shipMovement.forward = false; break;
      case 'g': shipMovement.backward = false; break;
      case 'f': shipMovement.left = false; break;
      case 'h': shipMovement.right = false; break;
      case 'r': shipMovement.down = false; break;
      case 'y': shipMovement.up = false; break;
      // Station movement controls (IKJL)
      case 'i': stationMovement.forward = false; break;
      case 'k': stationMovement.backward = false; break;
      case 'j': stationMovement.left = false; break;
      case 'l': stationMovement.right = false; break;
    }
  }
  
  
  function immediateEnterInterior() {
    if (isEntering || isInsideShip) return; // Prevent multiple calls and double entry
    isEntering = true;
    console.log('Instant entry to interior - converting dynamic to kinematic');
    
    // Additional safety check - ensure we have valid bodies
    if (!playerBody || !playerCollider || !interiorPlayerBody) {
      console.error('Invalid player bodies during entry');
      isEntering = false;
      return;
    }
    
    // Get current exterior state
    const currentExteriorPos = playerBody.translation();
    const currentExteriorVel = playerBody.linvel();
    const shipPos = shipBody.translation();
    const shipRot = shipBody.rotation();
    const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
    
    // Calculate relative position inside ship (exterior pos - ship pos, rotated by inverse ship rotation)
    const worldRelativePos = new THREE.Vector3(
      currentExteriorPos.x - shipPos.x,
      currentExteriorPos.y - shipPos.y, 
      currentExteriorPos.z - shipPos.z
    );
    
    // Apply inverse ship rotation to get interior relative position
    const shipQuatInverse = shipQuat.clone().invert();
    worldRelativePos.applyQuaternion(shipQuatInverse);
    
    console.log('Interior relative position:', worldRelativePos);
    
    // Natural entry - let sensor collision determine when to switch to interior physics
    console.log('Proceeding with natural interior entry at position:', worldRelativePos);
    
    // Use natural Y position from the transformation
    
    // Create new kinematic body FIRST at current exterior position
    const kinematicBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(currentExteriorPos.x, currentExteriorPos.y, currentExteriorPos.z);
    const newKinematicBody = exteriorWorld.createRigidBody(kinematicBodyDesc);
    
    // Create new collider for kinematic body - make it a sensor to avoid physics interactions
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const newColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setSensor(true); // Sensor mode - no collision response, just detection
    const newCollider = exteriorWorld.createCollider(newColliderDesc, newKinematicBody);
    
    console.log('New kinematic body and collider created');
    
    // Remove old dynamic body and collider safely
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true); // Wake up neighbors
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    // Switch to new kinematic body
    playerBody = newKinematicBody;
    playerCollider = newCollider;
    
    // Set interior player to the natural relative position
    interiorPlayerBody.setTranslation({ 
      x: worldRelativePos.x, 
      y: worldRelativePos.y, 
      z: worldRelativePos.z 
    }, true);
    
    // Transform velocity to interior coordinate system
    const interiorVel = new THREE.Vector3(currentExteriorVel.x, currentExteriorVel.y, currentExteriorVel.z);
    interiorVel.applyQuaternion(shipQuatInverse);
    interiorPlayerBody.setLinvel({ x: interiorVel.x, y: interiorVel.y, z: interiorVel.z }, true);
    
    console.log('Instantly entered interior - kinematic body type:', playerBody.bodyType());
    console.log('Interior player position:', interiorPlayerBody.translation());
    console.log('Interior player velocity:', interiorPlayerBody.linvel());
    
    // Reset entering flag
    isEntering = false;
  }

  function enterShip() {
    console.log('Seamlessly entering ship - switching to interior physics control');
    
    // Update proxy context first
    enterShipFromExteriorContext(interiorPlayerBody);
    
    // Preserve camera rotation when entering ship (removed reset for FPS continuity)
    
    // Get current exterior player state
    const currentExteriorPos = playerBody.translation();
    const currentExteriorVel = playerBody.linvel();
    const shipPos = shipBody.translation();
    const shipRot = shipBody.rotation();
    
    // Get ship rotation as quaternion
    const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
    
    // Calculate player position relative to ship
    const relativePos = new THREE.Vector3(
      currentExteriorPos.x - shipPos.x,
      currentExteriorPos.y - shipPos.y,
      currentExteriorPos.z - shipPos.z
    );
    
    // Apply inverse ship rotation to get ship-local position
    relativePos.applyQuaternion(shipQuat.clone().invert());
    
    console.log('Switching control - relative position (rotation-corrected):', relativePos);
    
    // Convert exterior player to kinematic (synchronized by interior simulation)
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true);
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    const kinematicPlayerBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(currentExteriorPos.x, currentExteriorPos.y, currentExteriorPos.z);
    playerBody = exteriorWorld.createRigidBody(kinematicPlayerBodyDesc);
    
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const kinematicPlayerColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setSensor(true); // Sensor mode - no collision response with ship
    playerCollider = exteriorWorld.createCollider(kinematicPlayerColliderDesc, playerBody);
    
    // Set interior player to relative position and maintain velocity
    interiorPlayerBody.setTranslation({ 
      x: relativePos.x, 
      y: relativePos.y, 
      z: relativePos.z 
    }, true);
    interiorPlayerBody.setLinvel({ x: currentExteriorVel.x, y: currentExteriorVel.y, z: currentExteriorVel.z }, true);
    
    console.log('Interior player taking control at:', interiorPlayerBody.translation());
    console.log('Expected relative position should be:', relativePos);
    console.log('Ship position was:', shipPos);
    console.log('Exterior position was:', currentExteriorPos);
    
    // Verify the position was set correctly
    setTimeout(() => {
      console.log('Interior player position after frame:', interiorPlayerBody.translation());
    }, 100);
  }
  
  function startEnterTransition() {
    if (isTransitioning) return;
    console.log('Starting ship entry transition');
    
    isTransitioning = true;
    transitionProgress = 0;
    
    // Immediately position interior player body at correct location to avoid glitch
    const currentExteriorPos = playerBody.translation();
    const shipPos = shipBody.translation();
    const shipRot = shipBody.rotation();
    
    // Get ship rotation as quaternion
    const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
    
    // Calculate player position relative to ship
    const relativePos = new THREE.Vector3(
      currentExteriorPos.x - shipPos.x,
      currentExteriorPos.y - shipPos.y,
      currentExteriorPos.z - shipPos.z
    );
    
    // Apply inverse ship rotation to get ship-local position
    relativePos.applyQuaternion(shipQuat.clone().invert());
    
    console.log('Pre-positioning interior player at relative (rotation-corrected):', relativePos);
    
    // Set interior player to correct position immediately
    interiorPlayerBody.setTranslation({ 
      x: relativePos.x, 
      y: relativePos.y, 
      z: relativePos.z 
    }, true);
    interiorPlayerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
  
  function startExitTransition() {
    if (isTransitioning) return;
    console.log('Starting ship exit transition');
    
    isTransitioning = true;
    transitionProgress = 1;
  }
  
  function updateTransition(deltaTime) {
    const transitionSpeed = 2.0; // Transition duration in seconds
    
    if (!isInsideShip && transitionProgress < 1) {
      // Entering ship
      transitionProgress += deltaTime / transitionSpeed;
      console.log('Entering transition progress:', transitionProgress);
      if (transitionProgress >= 1) {
        transitionProgress = 1;
        finishEnterTransition();
      }
    } else if (isInsideShip && transitionProgress > 0) {
      // Exiting ship
      transitionProgress -= deltaTime / transitionSpeed;
      console.log('Exiting transition progress:', transitionProgress);
      if (transitionProgress <= 0) {
        transitionProgress = 0;
        finishExitTransition();
      }
    }
  }
  
  function finishEnterTransition() {
    console.log('Finishing ship entry');
    isTransitioning = false;
    enterShip();
  }
  
  function finishExitTransition() {
    console.log('Finishing ship exit - calling exitShip()');
    console.log('isInsideShip before exit:', isInsideShip);
    console.log('Player body type before exit:', playerBody.bodyType());
    isTransitioning = false;
    exitShip();
    console.log('isInsideShip after exit:', isInsideShip);
    console.log('Player body type after exit:', playerBody.bodyType());
  }

  function checkStationAutoExit() {
    // Prevent multiple exit calls - check proxy context
    if (isExiting || playerProxyContext.activeWorld !== 'station') return;
    
    const stationPos = stationPlayerBody.translation();
    const stationVel = stationPlayerBody.linvel();
    // Use global constants
    const dockingBayOpeningZ = STATION_LENGTH / 2 - WALL_THICKNESS / 2; // Front opening position
    
    // More restrictive exit detection - player must be clearly exiting through docking bay
    const wellBeyondOpening = stationPos.z > dockingBayOpeningZ + 2; // Must be 2 units past the opening
    const strongExitMomentum = stationVel.z > 2.0; // Strong forward movement
    const inDockingBayWidth = Math.abs(stationPos.x) < 30; // Within docking bay width (60/2)
    const inDockingBayHeight = stationPos.y < 30; // Below docking bay ceiling height
    
    if (wellBeyondOpening && strongExitMomentum && inDockingBayWidth && inDockingBayHeight) {
      console.log('STATION EXIT TRIGGERED - Player clearly exiting through docking bay:', { stationPos, stationVel, dockingBayOpeningZ });
      
      // Lock exit to prevent multiple calls
      isExiting = true;
      
      console.log('IMMEDIATE STATION EXIT - NO DELAYS');
      exitStation();
    }
  }

  function checkAutoExit() {
    // Prevent multiple exit calls - check proxy context instead of legacy flag
    if (isExiting || playerProxyContext.activeWorld !== 'ship') return;
    
    const interiorPos = interiorPlayerBody.translation();
    const interiorVel = interiorPlayerBody.linvel();
    // Use global constants
    const doorZ = SHIP_LENGTH / 2 - 0.4; // Front door position (14.6)
    
    // Exit detection aligned with ship visual boundaries 
    const beyondShipBounds = interiorPos.z > doorZ + 0.5; // Exit when clearly outside ship
    const exitMomentum = interiorVel.z > 0.5; // Light forward movement
    const inDoorWidth = Math.abs(interiorPos.x) < 3; // Wider door width tolerance
    
    if (beyondShipBounds && exitMomentum && inDoorWidth) {
      console.log('INSTANT EXIT TRIGGERED - Player clearly exiting:', { interiorPos, interiorVel, doorZ });
      
      // Lock exit to prevent multiple calls
      isExiting = true;
      
      console.log('IMMEDIATE EXIT - NO DELAYS');
      
      // Check if ship is docked - if so, exit to station instead of exterior
      if (isShipDocked) {
        console.log('Ship is docked - exiting to station instead of exterior');
        exitShip(); // This function already handles docked ship case
      } else {
        immediateExitToExterior();
      }
    }
  }
  
  function immediateExitToExterior() {
    // Check if ship is actually currently docked (real-time position check)
    let shipCurrentlyDocked = false;
    if (isShipDocked) {
      // Ship marked as docked - verify it's still in station bounds
      const stationShipPos = stationShipBody.translation();
      shipCurrentlyDocked = Math.abs(stationShipPos.x) < (STATION_WIDTH/2 - STATION_WALL_THICKNESS) && 
                           stationShipPos.y > 0 && stationShipPos.y < STATION_HEIGHT &&
                           Math.abs(stationShipPos.z) < (STATION_LENGTH/2 - STATION_WALL_THICKNESS);
    }
    
    // Safety check - only block exterior exit if ship is actually currently docked
    if (shipCurrentlyDocked) {
      console.log('❌ BLOCKING exterior exit - ship currently in station, calling exitShip() instead');
      exitShip();
      return;
    } else if (isShipDocked || playerProxyContext.hierarchy.includes('station')) {
      console.log('🔄 Ship undocked during player interior time - allowing direct exterior exit');
    }
    
    console.log('Seamless exit - switching from kinematic to dynamic, preserving natural position');
    
    // Get current interior state
    const currentInteriorPos = interiorPlayerBody.translation();
    const currentInteriorVel = interiorPlayerBody.linvel();
    const shipPos = shipBody.translation();
    const shipRot = shipBody.rotation();
    const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
    
    // Transform interior position to world coordinates naturally
    const relativePos = new THREE.Vector3(currentInteriorPos.x, currentInteriorPos.y, currentInteriorPos.z);
    relativePos.applyQuaternion(shipQuat);
    
    const exteriorX = shipPos.x + relativePos.x;
    // Ensure player is above ground (minimum Y of 1.5 for capsule height)
    const exteriorY = Math.max(shipPos.y + relativePos.y, 1.5);
    const exteriorZ = shipPos.z + relativePos.z;
    
    console.log('Converting kinematic body to dynamic at natural position:', { exteriorX, exteriorY, exteriorZ });
    console.log('Ship position:', shipPos);
    console.log('Relative position after rotation:', relativePos);
    
    // Create new dynamic body at the actual transformed position
    const dynamicBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(exteriorX, exteriorY, exteriorZ)
      .setCanSleep(false)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0)
      .lockRotations();
    const newDynamicBody = exteriorWorld.createRigidBody(dynamicBodyDesc);
    
    // Create new collider for dynamic body immediately
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const newColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setFriction(0.8)
      .setRestitution(0.1);
    const newCollider = exteriorWorld.createCollider(newColliderDesc, newDynamicBody);
    
    console.log('New dynamic body and collider created simultaneously');
    
    // Now remove old kinematic body and collider safely
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true);
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    // Switch to new body/collider atomically
    playerBody = newDynamicBody;
    playerCollider = newCollider;
    
    // Update proxy context to exterior immediately after switching bodies
    exitToExterior(playerBody);
    
    // Transform velocity to world coordinates naturally
    const exitVel = new THREE.Vector3(currentInteriorVel.x, currentInteriorVel.y, currentInteriorVel.z);
    exitVel.applyQuaternion(shipQuat);
    
    // Apply the transformed velocity with a small upward component to prevent floor clipping
    const safeExitVel = {
      x: exitVel.x,
      y: Math.max(exitVel.y, 0.5), // Ensure slight upward velocity
      z: exitVel.z
    };
    playerBody.setLinvel(safeExitVel, true);
    
    // Apply a small upward impulse to help clear any floor collision
    playerBody.applyImpulse({ x: 0, y: 0.5, z: 0 }, true);
    
    // Verify the collider is solid (not a sensor)
    console.log('Player collider created:', playerCollider ? 'Yes' : 'No');
    console.log('Player collider is sensor:', playerCollider?.isSensor());
    console.log('Player body type:', playerBody.bodyType());
    
    // Hide interior player body to prevent physics conflicts
    interiorPlayerBody.setTranslation({ x: 0, y: -100, z: 0 }, true);
    interiorPlayerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    
    // No cooldown needed - physics-based system handles re-entry naturally
    // lastShipExitToExteriorTime = Date.now(); // Removed cooldown
    
    // Switch state - handled by physics-based detection
    isExiting = false;
    
    // Force a physics step to ensure proper collision detection
    exteriorWorld.timestep = 1/60;
    exteriorWorld.step(exteriorEventQueue);
    
    console.log('Exit to exterior complete - player body at:', playerBody.translation());
    
    console.log('Seamlessly switched to dynamic body - type:', playerBody.bodyType());
    console.log('Natural exit position:', playerBody.translation());
    console.log('Natural exit velocity:', playerBody.linvel());
    console.log('New collider handle:', newCollider.handle);
  }
  
  function immediateEnterStation() {
    if (isEntering || isInsideStation) return; // Prevent multiple calls and double entry
    isEntering = true;
    console.log('Direct station entry - converting player to station physics');
    
    // Update proxy context for station entry
    enterStationWorld(stationPlayerBody);
    
    // Preserve camera rotation when entering station (removed reset for FPS continuity)
    
    // Additional safety check - ensure we have valid bodies
    if (!playerBody || !playerCollider || !stationPlayerBody) {
      console.error('Invalid player bodies during station entry');
      isEntering = false;
      return;
    }
    
    // Get current exterior state
    const currentExteriorPos = playerBody.translation();
    const currentExteriorVel = playerBody.linvel();
    const stationPos = stationBody.translation();
    
    // Calculate relative position inside station (exterior pos - station pos)
    const relativeX = currentExteriorPos.x - stationPos.x;
    const relativeY = currentExteriorPos.y - stationPos.y;
    const relativeZ = currentExteriorPos.z - stationPos.z;
    
    console.log('Station entry at relative position:', { relativeX, relativeY, relativeZ });
    
    // Create kinematic body for exterior representation
    const kinematicBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(currentExteriorPos.x, currentExteriorPos.y, currentExteriorPos.z);
    const newKinematicBody = exteriorWorld.createRigidBody(kinematicBodyDesc);
    
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const newColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setSensor(true); // Sensor mode - no collision response
    const newCollider = exteriorWorld.createCollider(newColliderDesc, newKinematicBody);
    
    // Remove old dynamic body safely
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true);
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    // Switch to kinematic body
    playerBody = newKinematicBody;
    playerCollider = newCollider;
    lastStationEntryTime = Date.now(); // Prevent immediate exit detection
    
    // Set station player to relative position
    stationPlayerBody.setTranslation({ 
      x: relativeX, 
      y: relativeY, 
      z: relativeZ 
    }, true);
    stationPlayerBody.setLinvel({ x: currentExteriorVel.x, y: currentExteriorVel.y, z: currentExteriorVel.z }, true);
    
    console.log('Entered station - station player position:', stationPlayerBody.translation());
    
    // Check if ship needs auto re-docking when player enters station
    if (!isShipDocked) {
      const shipPos = shipBody.translation();
      const shipRelativeToStation = {
        x: shipPos.x - stationPos.x,
        y: shipPos.y - stationPos.y,
        z: shipPos.z - stationPos.z
      };
      
      const dockingBayWidth = 60, dockingBayHeight = 30;
      // Use global constants
      // Check if ship is in docking bay area
      const isShipInDockingBay = Math.abs(shipRelativeToStation.x) < dockingBayWidth/2 && 
                                shipRelativeToStation.y > 0 && shipRelativeToStation.y < dockingBayHeight &&
                                shipRelativeToStation.z > STATION_LENGTH/2 - 40 && shipRelativeToStation.z < STATION_LENGTH/2;
      
      if (isShipInDockingBay) {
        console.log('Ship found inside docking bay on station entry - auto re-docking');
        smoothDockShip();
      }
    }
    
    // Reset entering flag
    isEntering = false;
  }
  
  function startShipDockingTransition() {
    if (isShipDocked) return;
    console.log('Starting immediate ship docking - seamless like player ship entry');
    
    // Skip transition system - dock immediately like player entry
    smoothDockShip();
  }

  // Ship docking transition functions removed - now using immediate docking like player entry

  function smoothDockShip() {
    if (isShipDocked) return; // Prevent multiple docking calls
    
    console.log('Seamlessly docking ship - switching to station physics control');
    isShipDocked = true;
    
    // Get current ship state
    const currentShipPos = shipBody.translation();
    const currentShipVel = shipBody.linvel();
    const currentShipRot = shipBody.rotation();
    const stationPos = stationBody.translation();
    const stationRot = stationBody.rotation();
    
    // Calculate relative position inside station (ship pos - station pos)  
    // Preserve actual ship position for seamless transition
    const relativeX = currentShipPos.x - stationPos.x;
    const relativeY = currentShipPos.y - stationPos.y; // Preserve actual Y position
    const relativeZ = currentShipPos.z - stationPos.z;
    
    // Apply inverse station rotation for interior coordinates (except Y which is floor-aligned)
    const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
    const stationQuatInverse = stationQuat.clone().invert();
    const relativePosXZ = new THREE.Vector3(relativeX, 0, relativeZ);
    relativePosXZ.applyQuaternion(stationQuatInverse);
    
    // Keep Y coordinate for proper floor alignment, only rotate X and Z
    const relativePos = new THREE.Vector3(relativePosXZ.x, relativeY, relativePosXZ.z);
    
    console.log('Switching control - relative position:', { x: relativePos.x.toFixed(2), y: relativePos.y.toFixed(2), z: relativePos.z.toFixed(2) });
    
    // Convert exterior ship to kinematic (synchronized by station simulation)
    const numColliders = shipBody.numColliders();
    for (let i = numColliders - 1; i >= 0; i--) {
      const collider = shipBody.collider(i);
      if (collider) {
        exteriorWorld.removeCollider(collider, true);
      }
    }
    
    exteriorWorld.removeRigidBody(shipBody);
    
    const kinematicShipBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(currentShipPos.x, currentShipPos.y, currentShipPos.z)
      .setRotation(currentShipRot);
    shipBody = exteriorWorld.createRigidBody(kinematicShipBodyDesc);
    
    // Reactivate station ship body as dynamic
    stationShipBody.setBodyType(RAPIER.RigidBodyType.Dynamic);
    
    // Set station ship to relative position and maintain velocity
    stationShipBody.setTranslation({ x: relativePos.x, y: relativePos.y, z: relativePos.z }, true);
    stationShipBody.setLinvel({ x: currentShipVel.x, y: currentShipVel.y, z: currentShipVel.z }, true);
    
    console.log('Ship docked at station-relative position:', { x: relativePos.x, y: relativePos.y, z: relativePos.z });
    console.log('Ship Y position preserved at:', relativePos.y.toFixed(2), '(seamless transition)');
    
    // Transform ship rotation to station-relative coordinates
    const shipQuat = new THREE.Quaternion(currentShipRot.x, currentShipRot.y, currentShipRot.z, currentShipRot.w);
    const stationRelativeRotation = shipQuat.multiply(stationQuatInverse);
    stationShipBody.setRotation({
      x: stationRelativeRotation.x,
      y: stationRelativeRotation.y, 
      z: stationRelativeRotation.z,
      w: stationRelativeRotation.w
    }, true);
    
    // Show ship proxy in station interior
    if (stationShipProxy) {
      stationShipProxy.visible = true;
    }
    
    console.log('Station ship taking control at:', stationShipBody.translation());
  }

  function dockShip() {
    if (isShipDocked) return; // Prevent multiple docking calls
    
    console.log('Ship docking - converting exterior ship to kinematic, activating station ship physics');
    
    // Get current ship state
    const currentShipPos = shipBody.translation();
    const currentShipVel = shipBody.linvel();
    const currentShipRot = shipBody.rotation();
    const stationPos = stationBody.translation();
    
    // Calculate actual relative position inside station (preserve current position)
    // Transform from exterior world coordinates to station interior coordinates
    const relativeX = currentShipPos.x - stationPos.x;
    const relativeY = currentShipPos.y - stationPos.y; // Preserve actual Y for seamless transition
    const relativeZ = currentShipPos.z - stationPos.z;
    
    console.log('Ship docking at station interior position:', { relativeX, relativeY, relativeZ });
    console.log('Station interior bounds: Floor Y=1, Ceiling Y=59, Walls X=±99, Z=±124');
    console.log('Ship body type before docking:', shipBody.bodyType());
    
    // Convert exterior ship to kinematic (synchronized by station simulation)
    // First, remove all colliders attached to the ship
    const numColliders = shipBody.numColliders();
    for (let i = numColliders - 1; i >= 0; i--) {
      const collider = shipBody.collider(i);
      if (collider) {
        exteriorWorld.removeCollider(collider, true);
      }
    }
    
    exteriorWorld.removeRigidBody(shipBody);
    
    // Create new kinematic ship body in exterior world
    const kinematicShipBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(currentShipPos.x, currentShipPos.y, currentShipPos.z)
      .setRotation(currentShipRot);
    shipBody = exteriorWorld.createRigidBody(kinematicShipBodyDesc);
    
    // Re-add ship colliders to kinematic body (kinematic bodies still need colliders for collision detection)
    createShipColliders(shipBody);
    
    // Activate ship physics in station world
    // First, ensure station ship body is dynamic (it might be kinematic from previous undocking)
    stationShipBody.setBodyType(RAPIER.RigidBodyType.Dynamic);
    
    // Clear any accumulated forces/impulses and reset physics state
    stationShipBody.resetForces(true);
    stationShipBody.resetTorques(true);
    
    // Set clean position, rotation, and velocity
    stationShipBody.setTranslation({ x: relativeX, y: relativeY, z: relativeZ }, true);
    stationShipBody.setRotation(currentShipRot, true);
    
    // Apply reduced velocity to prevent weird momentum carryover
    const velocityDamping = 0.5; // Reduce velocity for smoother docking
    stationShipBody.setLinvel({ 
      x: currentShipVel.x * velocityDamping, 
      y: currentShipVel.y * velocityDamping, 
      z: currentShipVel.z * velocityDamping 
    }, true);
    stationShipBody.setAngvel({ x: 0, y: 0, z: 0 }, true); // Clear angular velocity for stability
    
    // Log the ship body and its sensors for debugging
    console.log('Station ship body activated at:', stationShipBody.translation());
    console.log('Station ship body has', stationShipBody.numColliders(), 'colliders');
    for (let i = 0; i < stationShipBody.numColliders(); i++) {
      const collider = stationShipBody.collider(i);
      console.log(`  Collider ${i}: isSensor=${collider.isSensor()}, translation=`, collider.translation());
    }
    
    isShipDocked = true;
    
    console.log('Ship docked successfully - exterior kinematic, station dynamic');
    console.log('Station ship body position:', stationShipBody.translation());
    console.log('Station interior bounds: Floor Y=1, Ceiling Y=59, Left X=-99, Right X=99, Front Z=124, Back Z=-124');
    console.log('Ship should be within these bounds to collide with station walls/floors');
    
    // Show ship proxy in station interior
    if (stationShipProxy) {
      stationShipProxy.visible = true;
      console.log('Station ship proxy made visible');
    }
    
    // If player is inside ship, they need to know the ship is now docked
    if (isInsideShip) {
      console.log('Player in ship during docking - ship now controlled by station physics');  
    }
  }
  
  function undockShip() {
    if (!isShipDocked) return;
    
    console.log('Seamlessly undocking ship - switching to exterior physics control');
    isShipDocked = false;
    
    // Get current ship state from station world (transform back to exterior coordinates)
    const stationShipPos = stationShipBody.translation();
    const stationShipRot = stationShipBody.rotation();
    const stationShipVel = stationShipBody.linvel();
    const stationShipAngVel = stationShipBody.angvel();
    const stationPos = stationBody.translation();
    
    // Transform station-relative position back to world coordinates
    // Apply proper coordinate transformation considering station rotation
    const stationRot = stationBody.rotation();
    const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
    const relativePos = new THREE.Vector3(stationShipPos.x, stationShipPos.y, stationShipPos.z);
    relativePos.applyQuaternion(stationQuat);
    
    const worldX = stationPos.x + relativePos.x;
    const worldY = stationPos.y + relativePos.y;
    const worldZ = stationPos.z + relativePos.z;
    
    // Convert kinematic ship back to dynamic body (exact ship exit pattern)
    console.log('Removing kinematic body...');
    const numColliders = shipBody.numColliders();
    for (let i = numColliders - 1; i >= 0; i--) {
      const collider = shipBody.collider(i);
      if (collider) {
        exteriorWorld.removeCollider(collider, true);
      }
    }
    exteriorWorld.removeRigidBody(shipBody);
    
    console.log('Creating new dynamic body at:', { x: worldX, y: worldY, z: worldZ });
    
    // Transform rotation from station space to world space
    const stationQuat4 = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
    const shipQuat = new THREE.Quaternion(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
    const worldRotation = stationQuat4.multiply(shipQuat);
    
    const dynamicShipBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(worldX, worldY, worldZ)
      .setRotation({ x: worldRotation.x, y: worldRotation.y, z: worldRotation.z, w: worldRotation.w })
      .setCanSleep(false)
      .setLinearDamping(0.5)
      .setAngularDamping(2.0);
    shipBody = exteriorWorld.createRigidBody(dynamicShipBodyDesc);
    
    console.log('New dynamic body created with handle:', shipBody.handle);
    console.log('Body type is now:', shipBody.bodyType());
    
    // Clear residual velocity for clean undocking (let physics take over naturally)
    // Transform velocity to world coordinates if needed, or clear for clean slate
    const transformedVel = new THREE.Vector3(stationShipVel.x, stationShipVel.y, stationShipVel.z);
    transformedVel.applyQuaternion(stationQuat);
    
    // Apply minimal velocity to prevent physics instability, but reduce momentum carryover
    const dampingFactor = 0.3; // Reduce carried momentum significantly
    shipBody.setLinvel({ 
      x: transformedVel.x * dampingFactor, 
      y: transformedVel.y * dampingFactor, 
      z: transformedVel.z * dampingFactor 
    }, true);
    shipBody.setAngvel({ 
      x: stationShipAngVel.x * dampingFactor, 
      y: stationShipAngVel.y * dampingFactor, 
      z: stationShipAngVel.z * dampingFactor 
    }, true);
    
    // Recreate ship colliders using same function as initial creation
    createShipColliders(shipBody);
    console.log('✅ Ship colliders recreated after undocking - count:', shipBody.numColliders());
    
    console.log('Exterior ship taking control at:', shipBody.translation());
    console.log('Ship body type:', shipBody.bodyType());
    console.log('Ship body handle:', shipBody.handle);
    
    // Ship physics body created with colliders (removed detailed logs)
    
    // Clear any residual forces to ensure clean physics state
    shipBody.resetForces(true);
    shipBody.resetTorques(true);
    
    // Deactivate station ship physics - move far away and make it kinematic to stop physics
    stationShipBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased);
    
    // Clear all forces and reset physics state before deactivating
    stationShipBody.resetForces(true);
    stationShipBody.resetTorques(true);
    
    stationShipBody.setTranslation({ x: 0, y: -1000, z: 0 }, true);
    stationShipBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    stationShipBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    
    // Hide ship proxy in station interior
    if (stationShipProxy) {
      stationShipProxy.visible = false;
      console.log('Station ship proxy hidden');
    }
    
    // Ship undocking complete (removed position tracking logs)
    
    // Set undock cooldown to prevent immediate re-docking
    lastUndockTime = Date.now();
    // Undock cooldown set
  }

  function exitShip() {
    console.log('=== PLAYER EXITING SHIP ===');
    
    // Reset ship movement when player exits to prevent continued movement
    shipMovement = { forward: false, backward: false, left: false, right: false, up: false, down: false };
    console.log('Ship movement reset - ship should stop moving');
    
    console.log('Current proxy context:', playerProxyContext);
    console.log('Ship docking status check: isShipDocked =', isShipDocked);
    console.log('Ship exterior body position:', shipBody.translation());
    if (stationShipBody) {
      console.log('Station ship body position:', stationShipBody.translation());
    }
    console.log('Player current location: isInsideStation =', isInsideStation);
    
    // Remove explicit state setting - will be handled by proxy context updates
    
    // Get current interior player state
    const currentInteriorPos = interiorPlayerBody.translation();
    const currentInteriorVel = interiorPlayerBody.linvel();
    
    // Determine exit context - if ship is docked, use that status directly
    // When docked, ship is in station world, not exterior world
    let isShipInsideStation = false;
    
    if (isShipDocked) {
      // Ship is docked - use station physics position to check bounds
      const stationShipPos = stationShipBody.translation();
      // Station interior bounds in station world coordinates
      isShipInsideStation = Math.abs(stationShipPos.x) < (STATION_WIDTH/2 - STATION_WALL_THICKNESS) && 
                           stationShipPos.y > 0 && stationShipPos.y < STATION_HEIGHT &&
                           Math.abs(stationShipPos.z) < (STATION_LENGTH/2 - STATION_WALL_THICKNESS);
      
      console.log('Ship is docked - checking station world position:', stationShipPos);
      console.log('  Is ship inside station bounds (station world):', isShipInsideStation);
    } else {
      // Ship not docked - check exterior world position
      const shipPos = shipBody.translation();
      const stationPos = stationBody.translation();
      const relativeToStation = {
        x: shipPos.x - stationPos.x,
        y: shipPos.y - stationPos.y,
        z: shipPos.z - stationPos.z
      };
      
      // Station bounds in exterior world
      isShipInsideStation = Math.abs(relativeToStation.x) < (STATION_WIDTH/2 - STATION_WALL_THICKNESS) && 
                           relativeToStation.y > STATION_WALL_THICKNESS && relativeToStation.y < (STATION_HEIGHT - STATION_WALL_THICKNESS) &&
                           Math.abs(relativeToStation.z) < (STATION_LENGTH/2 - STATION_WALL_THICKNESS);
      
      console.log('Ship not docked - checking exterior world position:', shipPos);
      console.log('  Station world pos:', stationPos);
      console.log('  Ship relative to station:', relativeToStation);
      console.log('  Is ship inside station bounds (exterior):', isShipInsideStation);
    }
    
    console.log('  Docking status (isShipDocked):', isShipDocked);
    
    // Use position context for exit decision
    // Only exit to station if ship is CURRENTLY docked or inside station bounds
    // Don't use proxy hierarchy as it reflects past state, not current position
    
    if (isShipDocked || isShipInsideStation) {
      console.log('Ship is inside station - player entering station interior');
      console.log('Exit reason: isShipDocked=' + isShipDocked + ', isShipInsideStation=' + isShipInsideStation);
      
      // Update proxy context to station
      exitToStation(stationPlayerBody);
      
      // Ensure ship physics is active in station world if not already
      if (!isShipDocked) {
        console.log('Ship was inside station but not marked as docked - activating station physics');
        // Quick dock the ship to activate station physics
        const stationRot = stationBody.rotation();
        const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
        const stationQuatInverse = stationQuat.clone().invert();
        
        // Convert ship position to station-relative coordinates preserving actual position  
        // Use actual Y position for seamless transition
        const worldRelativePos = new THREE.Vector3(
          relativeToStation.x, relativeToStation.y, relativeToStation.z
        );
        // Only rotate X and Z, keep Y fixed for floor alignment
        const worldRelativePosXZ = new THREE.Vector3(relativeToStation.x, 0, relativeToStation.z);
        worldRelativePosXZ.applyQuaternion(stationQuatInverse);
        worldRelativePos.x = worldRelativePosXZ.x;
        worldRelativePos.z = worldRelativePosXZ.z;
        
        // Activate ship physics in station world
        stationShipBody.setTranslation({ x: worldRelativePos.x, y: worldRelativePos.y, z: worldRelativePos.z }, true);
        stationShipBody.setRotation(shipBody.rotation(), true);
        stationShipBody.setLinvel(shipBody.linvel(), true);
        
        isShipDocked = true;
        console.log('Ship physics activated in station world at:', worldRelativePos);
        
        // Show ship proxy in station interior
        if (stationShipProxy) {
          stationShipProxy.visible = true;
          console.log('Station ship proxy made visible');
        }
      }
      
      // Get station physics body position
      const stationShipPos = stationShipBody.translation();
      const stationShipRot = stationShipBody.rotation();
      const shipQuat = new THREE.Quaternion(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
      
      // Transform player position from ship interior to station interior
      // More natural transition - keep relative position but ensure safe placement
      const relativePos = new THREE.Vector3(currentInteriorPos.x, currentInteriorPos.y, currentInteriorPos.z);
      relativePos.applyQuaternion(shipQuat);
      
      // Position player naturally relative to ship, with safe floor placement
      const naturalX = stationShipPos.x + relativePos.x;
      const naturalZ = stationShipPos.z + relativePos.z;
      
      // For Y, preserve natural position relative to ship for seamless transition
      // Don't force floor alignment - let player exit at their natural position
      const naturalY = stationShipPos.y + relativePos.y;
      
      // Safety check: ensure player doesn't end up below station floor
      const minStationY = STATION_WALL_THICKNESS / 2 + 0.5; // Minimum safe Y in station
      const finalY = Math.max(naturalY, minStationY); // Use natural Y but ensure above floor
      
      if (finalY !== naturalY) {
        console.warn('Player exit Y adjusted from', naturalY.toFixed(2), 'to', finalY.toFixed(2), 'for station floor safety');
      }
      
      const stationPlayerPos = {
        x: naturalX,
        y: finalY,
        z: naturalZ
      };
      
      console.log('Ship position in station:', { x: stationShipPos.x.toFixed(2), y: stationShipPos.y.toFixed(2), z: stationShipPos.z.toFixed(2) });
      console.log('Player positioned at:', { x: naturalX.toFixed(2), y: finalY.toFixed(2), z: naturalZ.toFixed(2) });
      console.log('Player relative pos in ship:', { x: relativePos.x.toFixed(2), y: relativePos.y.toFixed(2), z: relativePos.z.toFixed(2) });
      
      // Set station player body position
      stationPlayerBody.setTranslation(stationPlayerPos, true);
      stationPlayerBody.setLinvel({ x: currentInteriorVel.x, y: currentInteriorVel.y, z: currentInteriorVel.z }, true);
      
      // Ensure station player collider is properly active for collision detection
      if (stationPlayerCollider) {
        console.log('🔍 Station player collider exists - handle:', stationPlayerCollider.handle);
      } else {
        console.warn('⚠️ Station player collider missing after ship-to-station exit!');
      }
      
      console.log('Player entered station at:', stationPlayerPos);
      
      // Debug: Check player collision state after ship-to-station exit
      console.log('🔍 Player state after ship-to-station exit:', {
        stationPlayerBodyExists: !!stationPlayerBody,
        stationPlayerBodyType: stationPlayerBody?.bodyType(),
        playerProxyContext: playerProxyContext.activeWorld,
        hierarchy: playerProxyContext.hierarchy
      });
      
      // Update exterior player body to match station position to prevent collision re-entry
      // Convert station-relative position back to world coordinates
      const stationWorldPos = stationBody.translation();
      const exteriorPlayerPos = {
        x: stationWorldPos.x + stationPlayerPos.x,
        y: stationWorldPos.y + stationPlayerPos.y,
        z: stationWorldPos.z + stationPlayerPos.z
      };
      
      // Update exterior kinematic player body to match
      if (playerBody) {
        playerBody.setTranslation(exteriorPlayerPos, true);
        console.log('Updated exterior player body to match station position:', exteriorPlayerPos);
      }
      
      // Hide interior player mesh
      interiorPlayerBody.setTranslation({ x: 0, y: -100, z: 0 }, true);
      interiorPlayerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      
      // No cooldown needed - physics-based system handles re-entry naturally  
      // lastShipExitToStationTime = Date.now(); // Removed cooldown
      
      // Reset exiting flag - critical for allowing ship re-entry in station
      isExiting = false;
      
      return; // Exit early - we're in station now
    }
    
    // Not docked - normal exit to exterior
    console.log('Exiting ship to exterior');
    
    // Update proxy context to exterior
    exitToExterior(playerBody);
    
    const currentShipPos = shipBody.translation();
    
    // Calculate exterior world position with ship rotation
    const shipRot = shipBody.rotation();
    const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
    
    // Apply ship rotation to interior relative position
    const relativePos = new THREE.Vector3(currentInteriorPos.x, currentInteriorPos.y, currentInteriorPos.z);
    relativePos.applyQuaternion(shipQuat);
    
    // Exit player at a safe position outside the ship (front door area)
    const safeExitOffset = new THREE.Vector3(0, 1, 18); // In front of ship, above ground
    safeExitOffset.applyQuaternion(shipQuat);
    
    const exteriorX = currentShipPos.x + safeExitOffset.x;
    const exteriorY = Math.max(currentShipPos.y + safeExitOffset.y, 2); // Ensure above ground
    const exteriorZ = currentShipPos.z + safeExitOffset.z;
    
    console.log('Switching control - exterior position:', { exteriorX, exteriorY, exteriorZ });
    
    // Convert kinematic player back to dynamic body at current position
    console.log('Removing kinematic body...');
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true);
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    console.log('Creating new dynamic body at:', { exteriorX, exteriorY, exteriorZ });
    const dynamicPlayerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(exteriorX, exteriorY, exteriorZ)
      .setCanSleep(false)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0)
      .lockRotations();
    playerBody = exteriorWorld.createRigidBody(dynamicPlayerBodyDesc);
    
    console.log('New dynamic body created with handle:', playerBody.handle);
    console.log('Body type is now:', playerBody.bodyType());
    
    // Maintain velocity from interior simulation
    playerBody.setLinvel({ x: currentInteriorVel.x, y: currentInteriorVel.y, z: currentInteriorVel.z }, true);
    
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const dynamicPlayerColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setFriction(0.8)
      .setRestitution(0.1);
    playerCollider = exteriorWorld.createCollider(dynamicPlayerColliderDesc, playerBody);
    
    console.log('Exterior player taking control at:', playerBody.translation());
    console.log('Player body type:', playerBody.bodyType());
    console.log('Player body handle:', playerBody.handle);
    console.log('Player collider created:', playerCollider ? 'Yes' : 'No');
    console.log('Player collider handle:', playerCollider.handle);
    
    // Verify body is properly added to world
    console.log('Exterior world bodies count:', exteriorWorld.bodies.len());
    console.log('Exterior world colliders count:', exteriorWorld.colliders.len());
    
    // Force a small upward impulse to test collision
    playerBody.applyImpulse({ x: 0, y: 1, z: 0 }, true);
    
    // Test that player body is responsive
    setTimeout(() => {
      console.log('Player position after 100ms:', playerBody.translation());
      console.log('Player velocity:', playerBody.linvel());
      console.log('Player is grounded:', isGrounded);
    }, 100);
  }
  
  function enterShipFromStation() {
    // Check if we're already in the process of entering or already in a ship from station
    if (isEntering || playerProxyContext.activeWorld === 'ship') return; // Prevent multiple calls and double entry
    isEntering = true;
    console.log('🚀 ENTERING SHIP FROM STATION - NESTED STATIC PROXY TRANSITION');
    console.log('  Before proxy context:', playerProxyContext);
    
    // Preserve camera rotation when entering ship from station (removed reset for FPS continuity)
    
    // Update proxy context for nested ship entry
    enterShipFromStationContext(interiorPlayerBody);
    console.log('  After proxy context:', playerProxyContext);
    console.log('  Should now render ship interior view only');
    
    // Get current station player state
    const currentStationPos = stationPlayerBody.translation();
    const currentStationVel = stationPlayerBody.linvel();
    
    // Get ship position in station world
    const stationShipPos = stationShipBody.translation();
    const stationShipRot = stationShipBody.rotation();
    const shipQuat = new THREE.Quaternion(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
    
    // Calculate player position relative to ship
    const relativePos = new THREE.Vector3(
      currentStationPos.x - stationShipPos.x,
      currentStationPos.y - stationShipPos.y,
      currentStationPos.z - stationShipPos.z
    );
    
    // Apply inverse ship rotation to get ship-local position
    relativePos.applyQuaternion(shipQuat.clone().invert());
    
    // Set interior player position
    interiorPlayerBody.setTranslation({
      x: relativePos.x,
      y: relativePos.y,
      z: relativePos.z
    }, true);
    interiorPlayerBody.setLinvel({ x: currentStationVel.x, y: currentStationVel.y, z: currentStationVel.z }, true);
    
    // Convert exterior player body to kinematic (same as normal ship entry)
    // Remove existing dynamic body and collider
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true);
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    // Get current exterior ship position for kinematic body
    const currentShipPos = shipBody.translation();
    const currentShipRot = shipBody.rotation();
    
    // Create new kinematic body at ship position (player follows ship)
    const kinematicBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(currentShipPos.x, currentShipPos.y, currentShipPos.z);
    const newKinematicBody = exteriorWorld.createRigidBody(kinematicBodyDesc);
    
    // Create sensor collider for kinematic body
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const newColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setSensor(true);
    const newCollider = exteriorWorld.createCollider(newColliderDesc, newKinematicBody);
    
    // Switch to new kinematic body (same as normal ship entry)
    playerBody = newKinematicBody;
    playerCollider = newCollider;
    
    console.log('Exterior player body converted to kinematic and follows ship');
    
    // Hide station player
    stationPlayerBody.setTranslation({ x: 0, y: -200, z: 0 }, true);
    stationPlayerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    
    console.log('Player entered ship from station at interior position:', relativePos);
    console.log('Player now in ship interior world, exterior body follows ship kinematically');
    
    // Reset entering flag
    isEntering = false;
  }
  
  function exitStation() {
    console.log('=== PLAYER EXITING STATION ===');
    console.log('Current proxy context:', playerProxyContext);
    
    // Update proxy context to exterior
    exitToExterior(playerBody);
    
    // Get current station player state
    const currentStationPos = stationPlayerBody.translation();
    const currentStationVel = stationPlayerBody.linvel();
    const stationPos = stationBody.translation();
    
    // Calculate exterior world position
    const stationRot = stationBody.rotation();
    const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
    
    // Transform player's actual station interior position to world coordinates
    const relativePos = new THREE.Vector3(currentStationPos.x, currentStationPos.y, currentStationPos.z);
    relativePos.applyQuaternion(stationQuat);
    
    // Exit player at their actual world position (where they were when they triggered the exit)
    const exteriorX = stationPos.x + relativePos.x;
    const exteriorY = Math.max(stationPos.y + relativePos.y, 2); // Ensure above ground (ground at -0.5)
    const exteriorZ = stationPos.z + relativePos.z;
    
    console.log('Player exiting station from interior pos:', { x: currentStationPos.x.toFixed(2), y: currentStationPos.y.toFixed(2), z: currentStationPos.z.toFixed(2) });
    console.log('Transformed to world pos:', { x: exteriorX.toFixed(2), y: exteriorY.toFixed(2), z: exteriorZ.toFixed(2) });
    
    console.log('Switching control - exterior position:', { exteriorX, exteriorY, exteriorZ });
    
    // Convert kinematic player back to dynamic body at current position (exact ship exit pattern)
    console.log('Removing kinematic body...');
    if (playerCollider) {
      exteriorWorld.removeCollider(playerCollider, true);
    }
    if (playerBody) {
      exteriorWorld.removeRigidBody(playerBody);
    }
    
    console.log('Creating new dynamic body at:', { exteriorX, exteriorY, exteriorZ });
    const dynamicPlayerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(exteriorX, exteriorY, exteriorZ)
      .setCanSleep(false)
      .setLinearDamping(2.0)
      .setAngularDamping(5.0)
      .lockRotations();
    playerBody = exteriorWorld.createRigidBody(dynamicPlayerBodyDesc);
    
    console.log('New dynamic body created with handle:', playerBody.handle);
    console.log('Body type is now:', playerBody.bodyType());
    
    // Maintain velocity from station interior simulation
    playerBody.setLinvel({ x: currentStationVel.x, y: currentStationVel.y, z: currentStationVel.z }, true);
    
    const capsuleRadius = 0.5;
    const capsuleHeight = 1.5;
    const dynamicPlayerColliderDesc = RAPIER.ColliderDesc.capsule(capsuleHeight / 2, capsuleRadius)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setFriction(0.8)
      .setRestitution(0.1);
    playerCollider = exteriorWorld.createCollider(dynamicPlayerColliderDesc, playerBody);
    
    console.log('Exterior player taking control at:', playerBody.translation());
    console.log('Player body type:', playerBody.bodyType());
    console.log('Player body handle:', playerBody.handle);
    console.log('Player collider created:', playerCollider ? 'Yes' : 'No');
    console.log('Player collider handle:', playerCollider.handle);
    
    // Verify body is properly added to world
    console.log('Exterior world bodies count:', exteriorWorld.bodies.len());
    console.log('Exterior world colliders count:', exteriorWorld.colliders.len());
    
    // Force a small upward impulse to test collision (exact ship exit pattern)
    playerBody.applyImpulse({ x: 0, y: 1, z: 0 }, true);
    
    // Move station player out of the way
    stationPlayerBody.setTranslation({ x: 0, y: -200, z: 0 }, true);
    stationPlayerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    
    // Note: No cooldown needed for station exit - player should be able to re-enter station immediately
    // lastShipExitToStationTime is only set when exiting ship to station, not when exiting station to exterior
    
    // Test that player body is responsive
    setTimeout(() => {
      console.log('Player position after 100ms:', playerBody.translation());
      console.log('Player velocity:', playerBody.linvel());
      console.log('Player is grounded:', isGrounded);
    }, 100);
    
    // IMPORTANT: Do NOT undock ship when player exits station
    // Ship docking/undocking should be independent of player location
    // The ship stays docked as long as it's physically in the docking bay
    console.log('Player exiting station - ship docking remains independent of player state');
    console.log('Ship docking status: isShipDocked =', isShipDocked);
    
    if (isShipDocked) {
      console.log('Ship remains docked in station - player location does not affect ship docking');
    }
    
    // Reset exiting flag
    isExiting = false;
  }
  
  function checkGrounded() {
    try {
      if (isInsideShip && interiorPlayerBody) {
        const playerPos = interiorPlayerBody.translation();
        if (!playerPos) return;
        
        const rayStart = { x: playerPos.x, y: playerPos.y - 0.65, z: playerPos.z };
        const rayDir = { x: 0, y: -1, z: 0 };
        const rayLength = 0.3;
        
        const ray = new RAPIER.Ray(rayStart, rayDir);
        const hit = interiorWorld.castRay(ray, rayLength, true);
        
        isGrounded = hit !== null;
        
        // Debug interior physics (only every 60 frames to avoid spam)
        if (false && Math.random() < 0.016) { // Disabled debug logging
          console.log('Interior raycast:', {
            playerPos,
            rayStart,
            rayLength,
            hit: hit !== null,
            hitDistance: hit ? hit.toi : null,
            numBodies: interiorWorld.bodies.len(),
            numColliders: interiorWorld.colliders.len(),
            playerVelocity: interiorPlayerBody.linvel()
          });
        }
      } else if (!isInsideShip && playerBody) {
        const playerPos = playerBody.translation();
        if (!playerPos) return;
        
        const rayStart = { x: playerPos.x, y: playerPos.y - 0.65, z: playerPos.z };
        const rayDir = { x: 0, y: -1, z: 0 };
        const rayLength = 0.3;
        
        const ray = new RAPIER.Ray(rayStart, rayDir);
        const hit = exteriorWorld.castRay(ray, rayLength, true);
        
        isGrounded = hit !== null;
      }
    } catch (error) {
      console.warn('Error checking grounded state:', error);
      isGrounded = false;
    }
  }
  
  function updatePlayer(deltaTime) {
    const groundSpeed = 4;
    const airSpeed = 1.5; // Slower movement in air
    const jumpSpeed = 7;
    
    try {
      checkGrounded();
      
      let velocity, currentPlayerBody;
      
      if (isInsideShip) {
        currentPlayerBody = interiorPlayerBody;
        velocity = interiorPlayerBody.linvel();
      } else if (isInsideStation) {
        currentPlayerBody = stationPlayerBody;
        velocity = stationPlayerBody.linvel();
      } else {
        currentPlayerBody = playerBody;
        velocity = playerBody.linvel();
      }
      
      // Safety check - make sure we have valid physics bodies
      if (!currentPlayerBody || !velocity) {
        console.warn('Invalid player body or velocity, skipping update');
        return;
      }
    
    // Reset canJump when grounded
    if (isGrounded && velocity.y < 1.0) {
      canJump = true;
    }
    
    let moveX = 0;
    let moveZ = 0;
    
    if (movement.forward) moveZ -= 1;
    if (movement.backward) moveZ += 1;
    if (movement.left) moveX -= 1;
    if (movement.right) moveX += 1;
    
    if (moveX !== 0 || moveZ !== 0) {
      const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= length;
      moveZ /= length;
    }
    
    // Transform movement direction based on camera rotation when pointer locked (all worlds)
    if (isPointerLocked) {
      // Use negative yaw to match the visual capsule rotation direction
      const playerYaw = -cameraRotation.yaw;
      const cos = Math.cos(playerYaw);
      const sin = Math.sin(playerYaw);
      const rotatedX = moveX * cos - moveZ * sin;
      const rotatedZ = moveX * sin + moveZ * cos;
      moveX = rotatedX;
      moveZ = rotatedZ;
    }
    
    // Use different speed based on grounded state
    const currentSpeed = isGrounded ? groundSpeed : airSpeed;
    const impulse = { x: moveX * currentSpeed * deltaTime * 30, y: 0, z: moveZ * currentSpeed * deltaTime * 30 };
    
    // Only allow jump when grounded, can jump, and not already moving upward significantly
    if (movement.jump && isGrounded && canJump && velocity.y < 1.0) {
      impulse.y = jumpSpeed;
      canJump = false; // Prevent multiple jumps until grounded again
      movement.jump = false; // Reset jump to prevent continuous jumping
    }
    
    currentPlayerBody.applyImpulse(impulse, true);
    
    // Debug station player movement
    if (isInsideStation && (impulse.x !== 0 || impulse.z !== 0)) {
      // Movement impulse applied (removed verbose log)
    }
    
    const pos = currentPlayerBody.translation();
    
    // Update player mesh position and sync kinematic body if inside ship
    if (isInsideShip) {
      // Only show debug player mesh if interior body is at a reasonable position (not at init position)
      if (pos.y > -50) { // Interior body was initialized at y: -100, so wait until properly positioned
        debugPlayerMesh.position.set(pos.x, pos.y, pos.z);
        // Apply aiming rotation when pointer locked
        if (isPointerLocked) {
          debugPlayerMesh.rotation.y = -cameraRotation.yaw;
        }
        debugPlayerMesh.visible = true;
      } else {
        debugPlayerMesh.visible = false;
      }
      
      let exteriorPos;
      
      // Get ship rotation for camera calculations (needed in both docked and free-flying cases)
      const shipRot = (isShipDocked && stationShipBody) ? stationShipBody.rotation() : shipBody.rotation();
      
      if (isShipDocked && stationShipBody) {
        // Transform interior player position through station world to exterior world
        // Step 1: Transform interior position to station world coordinates
        const stationShipPos = stationShipBody.translation();
        const stationShipRot = stationShipBody.rotation();
        const stationShipQuat = new THREE.Quaternion(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
        
        const relativePos = new THREE.Vector3(pos.x, pos.y, pos.z);
        relativePos.applyQuaternion(stationShipQuat);
        
        const stationWorldPos = new THREE.Vector3(
          stationShipPos.x + relativePos.x,
          stationShipPos.y + relativePos.y,
          stationShipPos.z + relativePos.z
        );
        
        // Step 2: Transform station world coordinates to exterior world coordinates
        const stationPos = stationBody.translation();
        const stationRot = stationBody.rotation();
        const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
        
        stationWorldPos.applyQuaternion(stationQuat);
        
        exteriorPos = {
          x: stationPos.x + stationWorldPos.x,
          y: stationPos.y + stationWorldPos.y,
          z: stationPos.z + stationWorldPos.z
        };
      } else {
        // Direct transformation to exterior world coordinates
        const shipPos = shipBody.translation();
        const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
        
        const relativePos = new THREE.Vector3(pos.x, pos.y, pos.z);
        relativePos.applyQuaternion(shipQuat);
        
        exteriorPos = {
          x: shipPos.x + relativePos.x,
          y: shipPos.y + relativePos.y,
          z: shipPos.z + relativePos.z
        };
      }
      
      playerBody.setNextKinematicTranslation(exteriorPos);
      
      // Use appropriate rotation based on ship location
      const targetRotation = (isShipDocked && stationShipBody) ? stationShipBody.rotation() : shipBody.rotation();
      playerBody.setNextKinematicRotation(targetRotation);
      
      // Position and rotate player mesh in real world interior (translated from static proxy)
      playerMesh.position.set(exteriorPos.x, exteriorPos.y, exteriorPos.z);
      playerMesh.quaternion.set(targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w);
      
      // Interior camera has fixed position for overview
      interiorCamera.position.set(0, 4, 25);
      interiorCamera.lookAt(0, 1.5, 0);
      
      // Exterior camera follows real world player representation when inside ship
      if (isFirstPerson) {
        // First person - camera at player head position with ship-relative orientation
        // Position camera at head height relative to ship's up direction
        const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
        const shipUpOffset = new THREE.Vector3(0, 1.5, 0).applyQuaternion(shipQuat);
        exteriorCamera.position.set(
          exteriorPos.x + shipUpOffset.x, 
          exteriorPos.y + shipUpOffset.y, 
          exteriorPos.z + shipUpOffset.z
        );
        
        // Camera should be oriented relative to ship's coordinate system
        // Player feels upright relative to ship floor, not world floor
        const mouseLookEuler = new THREE.Euler(cameraRotation.pitch, cameraRotation.yaw, 0, 'YXZ');
        const mouseLookQuat = new THREE.Quaternion().setFromEuler(mouseLookEuler);
        
        // Combine ship rotation with mouse look: ship orientation first, then mouse look
        const combinedQuat = shipQuat.clone().multiply(mouseLookQuat);
        exteriorCamera.quaternion.copy(combinedQuat);
      } else {
        // Third person - camera much further behind and above player
        exteriorCamera.position.set(exteriorPos.x, exteriorPos.y + 15, exteriorPos.z + 30);
        exteriorCamera.lookAt(exteriorPos.x, exteriorPos.y + 1, exteriorPos.z);
      }
    } else if (isInsideStation) {
      // Player is inside station
      // Show debug station player mesh if positioned correctly
      if (pos.y > -150) { // Station body was initialized at y: -200
        debugStationPlayerMesh.position.set(pos.x, pos.y, pos.z);
        // Apply aiming rotation when pointer locked
        if (isPointerLocked) {
          debugStationPlayerMesh.rotation.y = -cameraRotation.yaw;
        }
        debugStationPlayerMesh.visible = true;
      } else {
        debugStationPlayerMesh.visible = false;
      }
      
      // Sync exterior kinematic body with station interior dynamic body position
      // Transform station interior position to exterior world coordinates
      const stationPos = stationBody.translation();
      const stationRot = stationBody.rotation();
      const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
      
      // Apply station rotation to interior relative position
      const relativePos = new THREE.Vector3(pos.x, pos.y, pos.z);
      relativePos.applyQuaternion(stationQuat);
      
      const exteriorPos = {
        x: stationPos.x + relativePos.x,
        y: stationPos.y + relativePos.y,
        z: stationPos.z + relativePos.z
      };
      
      playerBody.setNextKinematicTranslation(exteriorPos);
      playerBody.setNextKinematicRotation(stationRot);
      
      // Position and rotate player mesh in real world
      playerMesh.position.set(exteriorPos.x, exteriorPos.y, exteriorPos.z);
      playerMesh.quaternion.set(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
      
      // Station camera follows player with mouse look
      if (isFirstPerson) {
        // First person station interior view - camera at proxy player position with mouse look
        stationCamera.position.set(pos.x, pos.y + 1.5, pos.z);
        
        // Apply mouse look rotation directly in station interior space
        const mouseLookEuler = new THREE.Euler(cameraRotation.pitch, cameraRotation.yaw, 0, 'YXZ');
        const mouseLookQuat = new THREE.Quaternion().setFromEuler(mouseLookEuler);
        stationCamera.quaternion.copy(mouseLookQuat);
      } else {
        // Third person station interior view - fixed camera (further back for large station)
        stationCamera.position.set(0, 100, 220);
        stationCamera.lookAt(0, 20, 0);
      }
      
      // Exterior camera follows real world player representation when inside station
      if (isFirstPerson) {
        // First person - camera at player head position with station-relative orientation
        const stationUpOffset = new THREE.Vector3(0, 1.5, 0).applyQuaternion(stationQuat);
        exteriorCamera.position.set(
          exteriorPos.x + stationUpOffset.x, 
          exteriorPos.y + stationUpOffset.y, 
          exteriorPos.z + stationUpOffset.z
        );
        
        // Camera should be oriented relative to station's coordinate system
        const mouseLookEuler = new THREE.Euler(cameraRotation.pitch, cameraRotation.yaw, 0, 'YXZ');
        const mouseLookQuat = new THREE.Quaternion().setFromEuler(mouseLookEuler);
        
        // Combine station rotation with mouse look
        const combinedQuat = stationQuat.clone().multiply(mouseLookQuat);
        exteriorCamera.quaternion.copy(combinedQuat);
      } else {
        // Third person - camera behind and above player
        exteriorCamera.position.set(exteriorPos.x, exteriorPos.y + 15, exteriorPos.z + 30);
        exteriorCamera.lookAt(exteriorPos.x, exteriorPos.y + 1, exteriorPos.z);
      }
    } else {
      // Position player mesh for exterior view
      playerMesh.position.set(pos.x, pos.y, pos.z);
      
      // Apply aiming rotation to player mesh for both first and third person modes
      if (isPointerLocked) {
        playerMesh.rotation.y = -cameraRotation.yaw; // Negate for correct direction
      }
      
      // Hide debug player mesh when outside
      debugPlayerMesh.visible = false;
      
      // Update cameras - exterior camera follows player position
      if (isFirstPerson) {
        // First person - camera at player head position with mouse look
        exteriorCamera.position.set(pos.x, pos.y + 1.5, pos.z);
        
        // Apply mouse look rotation directly (no ship rotation interference outside)
        const mouseLookEuler = new THREE.Euler(cameraRotation.pitch, cameraRotation.yaw, 0, 'YXZ');
        const mouseLookQuat = new THREE.Quaternion().setFromEuler(mouseLookEuler);
        exteriorCamera.quaternion.copy(mouseLookQuat);
      } else {
        // Third person - camera behind and above player, following capsule rotation
        if (isPointerLocked) {
          // Position camera relative to player's rotation
          const distance = 30;
          const height = 15;
          const playerYaw = -cameraRotation.yaw; // Match player mesh rotation
          
          const cameraX = pos.x + Math.sin(playerYaw) * distance;
          const cameraZ = pos.z + Math.cos(playerYaw) * distance;
          
          exteriorCamera.position.set(cameraX, pos.y + height, cameraZ);
          exteriorCamera.lookAt(pos.x, pos.y + 1, pos.z);
        } else {
          // Default third person position when not pointer locked
          exteriorCamera.position.set(pos.x, pos.y + 15, pos.z + 30);
          exteriorCamera.lookAt(pos.x, pos.y + 1, pos.z);
        }
      }
    }
    
    // Universal FPS camera positioning - overrides world-specific camera positioning when in FPS mode
    if (isFirstPerson && isPointerLocked) {
      // Get current active player position in exterior world coordinates
      let worldPos;
      
      if (isInsideShip) {
        // Player inside ship - use the exterior world position calculated for ship
        const interiorPos = interiorPlayerBody.translation();
        
        if (isShipDocked && stationShipBody) {
          // Ship is docked - transform through station coordinates
          const stationShipPos = stationShipBody.translation();
          const stationShipRot = stationShipBody.rotation();
          const stationShipQuat = new THREE.Quaternion(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
          
          const relativePos = new THREE.Vector3(interiorPos.x, interiorPos.y, interiorPos.z);
          relativePos.applyQuaternion(stationShipQuat);
          
          const stationWorldPos = new THREE.Vector3(
            stationShipPos.x + relativePos.x,
            stationShipPos.y + relativePos.y,
            stationShipPos.z + relativePos.z
          );
          
          const stationPos = stationBody.translation();
          const stationRot = stationBody.rotation();
          const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
          
          stationWorldPos.applyQuaternion(stationQuat);
          
          worldPos = {
            x: stationPos.x + stationWorldPos.x,
            y: stationPos.y + stationWorldPos.y,
            z: stationPos.z + stationWorldPos.z
          };
        } else {
          // Ship is free-flying - direct transformation
          const shipPos = shipBody.translation();
          const shipRot = shipBody.rotation();
          const shipQuat = new THREE.Quaternion(shipRot.x, shipRot.y, shipRot.z, shipRot.w);
          
          const relativePos = new THREE.Vector3(interiorPos.x, interiorPos.y, interiorPos.z);
          relativePos.applyQuaternion(shipQuat);
          
          worldPos = {
            x: shipPos.x + relativePos.x,
            y: shipPos.y + relativePos.y,
            z: shipPos.z + relativePos.z
          };
        }
      } else if (isInsideStation) {
        // Player inside station - transform station coordinates to world coordinates
        const stationPlayerPos = stationPlayerBody.translation();
        const stationPos = stationBody.translation();
        const stationRot = stationBody.rotation();
        const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
        
        const relativePos = new THREE.Vector3(stationPlayerPos.x, stationPlayerPos.y, stationPlayerPos.z);
        relativePos.applyQuaternion(stationQuat);
        
        worldPos = {
          x: stationPos.x + relativePos.x,
          y: stationPos.y + relativePos.y,
          z: stationPos.z + relativePos.z
        };
      } else {
        // Player in exterior world - use position directly
        const exteriorPos = playerBody.translation();
        worldPos = {
          x: exteriorPos.x,
          y: exteriorPos.y,
          z: exteriorPos.z
        };
      }
      
      // Position exterior camera at player's world position with FPS mouse look
      exteriorCamera.position.set(worldPos.x, worldPos.y + 1.5, worldPos.z);
      
      // Apply mouse look rotation directly in world space
      const mouseLookEuler = new THREE.Euler(cameraRotation.pitch, cameraRotation.yaw, 0, 'YXZ');
      const mouseLookQuat = new THREE.Quaternion().setFromEuler(mouseLookEuler);
      exteriorCamera.quaternion.copy(mouseLookQuat);
    }
    
    // Update debug states
    playerPosition = { x: Math.round(pos.x * 100) / 100, y: Math.round(pos.y * 100) / 100, z: Math.round(pos.z * 100) / 100 };
    playerVelocity = { x: Math.round(velocity.x * 100) / 100, y: Math.round(velocity.y * 100) / 100, z: Math.round(velocity.z * 100) / 100 };
    
    } catch (error) {
      console.warn('Error updating player:', error);
    }
  }
  
  
  function updateShip(deltaTime) {
    const thrustPower = 500; // Reduced thrust power for better control
    const liftPower = 600; // Reduced lift power for better control
    const torquePower = 300; // Reduced torque power for better control
    
    try {
    
    // If ship is docked, use station physics instead of exterior physics
    if (isShipDocked) {
      // Always update exterior kinematic ship to match station physics
      const stationShipPos = stationShipBody.translation();
      const stationShipRot = stationShipBody.rotation();
      const stationPos = stationBody.translation();
      const stationRot = stationBody.rotation();
      
      // Ship position tracking (removed random debug logs)
      
      // Convert station-relative position to world position (same logic as player sync)
      const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
      
      // Apply station rotation to ship's relative position
      const relativeShipPos = new THREE.Vector3(stationShipPos.x, stationShipPos.y, stationShipPos.z);
      relativeShipPos.applyQuaternion(stationQuat);
      
      const worldShipPos = {
        x: stationPos.x + relativeShipPos.x,
        y: stationPos.y + relativeShipPos.y,
        z: stationPos.z + relativeShipPos.z
      };
      
      // Update exterior kinematic ship position
      shipBody.setTranslation(worldShipPos, true);
      shipBody.setRotation(stationShipRot, true);
      
      // Ship position sync (removed random debug logs)
      
      // Update ship mesh to match
      shipMesh.position.set(worldShipPos.x, worldShipPos.y, worldShipPos.z);
      shipMesh.quaternion.set(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
      
      // If player is trying to move the ship while docked, apply forces to station physics body
      const isMovingShip = shipMovement.forward || shipMovement.backward || 
                          shipMovement.left || shipMovement.right || 
                          shipMovement.up || shipMovement.down;
      
      if (isMovingShip && isInsideShip) {
        // Applying ship movement forces (removed verbose log)
        
        // Use station ship body for physics simulation
        const stationShipRotation = stationShipBody.rotation();
        const stationShipQuat = new THREE.Quaternion(stationShipRotation.x, stationShipRotation.y, stationShipRotation.z, stationShipRotation.w);
        
        // Forward/backward thrust in ship's local direction
        let thrustZ = 0;
        if (shipMovement.forward) {
          thrustZ -= 1;
        }
        if (shipMovement.backward) {
          thrustZ += 1;
        }
        
        if (thrustZ !== 0) {
          const dockedShipThrustPower = 500; // Match exterior ship thrust power
          const forwardVector = new THREE.Vector3(0, 0, thrustZ).applyQuaternion(stationShipQuat);
          const thrustForce = {
            x: forwardVector.x * dockedShipThrustPower,
            y: forwardVector.y * dockedShipThrustPower,
            z: forwardVector.z * dockedShipThrustPower
          };
          // Use only force for smoother, more controllable movement
          stationShipBody.addForce(thrustForce, true);
        }
        
        // Vertical movement
        let verticalThrust = 0;
        if (shipMovement.up) {
          verticalThrust += 1;
        }
        if (shipMovement.down) {
          verticalThrust -= 1;
        }
        
        if (verticalThrust !== 0) {
          const dockedShipLiftPower = 600; // Match exterior ship lift power
          const liftForce = { x: 0, y: verticalThrust * dockedShipLiftPower, z: 0 };
          const liftImpulse = { x: 0, y: verticalThrust * dockedShipLiftPower * deltaTime, z: 0 };
          stationShipBody.addForce(liftForce, true);
          stationShipBody.applyImpulse(liftImpulse, true);
        }
        
        // Yaw rotation
        let yawTorque = 0;
        if (shipMovement.left) {
          yawTorque += 1;
        }
        if (shipMovement.right) {
          yawTorque -= 1;
        }
        
        if (yawTorque !== 0) {
          const dockedShipTorquePower = 300; // Match exterior ship torque power
          const torqueForce = { x: 0, y: yawTorque * dockedShipTorquePower, z: 0 };
          const torqueImpulse = { x: 0, y: yawTorque * dockedShipTorquePower * deltaTime, z: 0 };
          stationShipBody.addTorque(torqueForce, true);
          stationShipBody.applyTorqueImpulse(torqueImpulse, true);
        }
        
        // Check if ship has moved outside station boundaries - if so, automatically undock
        const currentStationShipPos = stationShipBody.translation();
        // Use global constants
        const stationBounds = {
          minX: -STATION_WIDTH/2, maxX: STATION_WIDTH/2,
          minY: 1, maxY: STATION_HEIGHT - 1,  
          minZ: -STATION_LENGTH/2, maxZ: STATION_LENGTH/2
        };
        
        const isOutsideStation = 
          currentStationShipPos.x < stationBounds.minX || currentStationShipPos.x > stationBounds.maxX ||
          currentStationShipPos.y < stationBounds.minY || currentStationShipPos.y > stationBounds.maxY ||
          currentStationShipPos.z < stationBounds.minZ || currentStationShipPos.z > stationBounds.maxZ;
        
        if (isOutsideStation) {
          console.log('SHIP OUTSIDE STATION BOUNDS - Auto-undocking:', currentStationShipPos);
          console.log('Station bounds:', stationBounds);
          undockShip();
          return; // Exit early since we just undocked
        }
      }
      return; // Skip exterior physics when docked
    }
    
    // Get ship's current rotation to apply thrust in local direction
    const shipRotation = shipBody.rotation();
    const shipQuat = new THREE.Quaternion(shipRotation.x, shipRotation.y, shipRotation.z, shipRotation.w);
    
    // Forward/backward thrust in ship's local forward direction
    let thrustZ = 0;
    if (shipMovement.forward) {
      thrustZ -= 1;
      console.log('Applying forward thrust');
    }
    if (shipMovement.backward) {
      thrustZ += 1;
      console.log('Applying backward thrust');
    }
    
    if (thrustZ !== 0) {
      const forwardVector = new THREE.Vector3(0, 0, thrustZ).applyQuaternion(shipQuat);
      
      // Use only force for smoother, more controllable movement
      const thrustForce = {
        x: forwardVector.x * thrustPower,
        y: forwardVector.y * thrustPower,
        z: forwardVector.z * thrustPower
      };
      
      // Apply only force for better control
      shipBody.addForce(thrustForce, true);
      
      // Ship velocity updated
    }
    
    // Vertical movement (Q/E for external flight, R/Y for interior piloting)
    let verticalThrust = 0;
    if (shipMovement.up) {
      verticalThrust += 1;
      // console.log('Applying upward thrust');
    }
    if (shipMovement.down) {
      verticalThrust -= 1;
      // console.log('Applying downward thrust');
    }
    
    if (verticalThrust !== 0) {
      // Use more moderate vertical forces
      const verticalPower = isInsideShip ? 400 : liftPower; // Gentler when piloted from inside
      const liftForce = { x: 0, y: verticalThrust * verticalPower, z: 0 };
      
      // Use only force for smoother control
      shipBody.addForce(liftForce, true);
    }
    
    // Yaw rotation (left/right arrows)
    let yawTorque = 0;
    if (shipMovement.left) {
      yawTorque += 1;
      console.log('Applying left yaw');
    }
    if (shipMovement.right) {
      yawTorque -= 1;
      console.log('Applying right yaw');
    }
    
    if (yawTorque !== 0) {
      const torqueForce = { x: 0, y: yawTorque * torquePower, z: 0 };
      const torqueImpulse = { x: 0, y: yawTorque * torquePower * deltaTime, z: 0 };
      
      console.log('Applying torque - Force:', torqueForce, 'Impulse:', torqueImpulse);
      console.log('Ship rotation before torque:', shipBody.rotation());
      
      // Apply both torque and torque impulse
      shipBody.addTorque(torqueForce, true);
      shipBody.applyTorqueImpulse(torqueImpulse, true);
      
      console.log('Ship angular velocity after torque:', shipBody.angvel());
    }
    
    // Update ship mesh position and rotation to match physics (only if not docked)
    if (!isShipDocked) {
      const pos = shipBody.translation();
      const rot = shipBody.rotation();
      shipMesh.position.set(pos.x, pos.y, pos.z);
      shipMesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
    // Note: When docked, ship mesh is updated in updateShip() from station physics
    
    // Interior proxy always stays at origin (static)
    if (isInsideShip) {
      shipInteriorProxy.position.set(0, 0, 0);
      // Interior camera positioning is now handled in updatePlayer() for FPS support
    }
    
    } catch (error) {
      console.warn('Error updating ship:', error);
    }
  }
  
  function updateStation(deltaTime) {
    const thrustPower = 3000; // Strong thrust power for large station
    const liftPower = 3500; // Strong lift power for large station  
    const torquePower = 1500; // Strong torque power for large station
    
    try {
    
    // Get station's current rotation to apply thrust in local direction
    const stationRotation = stationBody.rotation();
    const stationQuat = new THREE.Quaternion(stationRotation.x, stationRotation.y, stationRotation.z, stationRotation.w);
    
    // Forward/backward thrust in station's local forward direction
    let thrustZ = 0;
    if (stationMovement.forward) {
      thrustZ -= 1;
      console.log('Applying station forward thrust');
    }
    if (stationMovement.backward) {
      thrustZ += 1;
      console.log('Applying station backward thrust');
    }
    
    if (thrustZ !== 0) {
      const forwardVector = new THREE.Vector3(0, 0, thrustZ).applyQuaternion(stationQuat);
      
      const thrustForce = {
        x: forwardVector.x * thrustPower,
        y: forwardVector.y * thrustPower,
        z: forwardVector.z * thrustPower
      };
      const thrustImpulse = {
        x: forwardVector.x * thrustPower * deltaTime,
        y: forwardVector.y * thrustPower * deltaTime,
        z: forwardVector.z * thrustPower * deltaTime
      };
      
      console.log('Applying station thrust - Force:', thrustForce, 'Impulse:', thrustImpulse);
      
      stationBody.addForce(thrustForce, true);
      stationBody.applyImpulse(thrustImpulse, true);
    }
    
    // Yaw rotation (left/right)
    let yawTorque = 0;
    if (stationMovement.left) {
      yawTorque += 1;
      console.log('Applying station left yaw');
    }
    if (stationMovement.right) {
      yawTorque -= 1;
      console.log('Applying station right yaw');
    }
    
    if (yawTorque !== 0) {
      const torqueForce = { x: 0, y: yawTorque * torquePower, z: 0 };
      const torqueImpulse = { x: 0, y: yawTorque * torquePower * deltaTime, z: 0 };
      
      console.log('Applying station torque - Force:', torqueForce, 'Impulse:', torqueImpulse);
      
      stationBody.addTorque(torqueForce, true);
      stationBody.applyTorqueImpulse(torqueImpulse, true);
    }
    
    // Update station mesh position and rotation to match physics
    const pos = stationBody.translation();
    const rot = stationBody.rotation();
    stationMesh.position.set(pos.x, pos.y, pos.z);
    stationMesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    
    // Station interior proxy always stays at origin (static)
    stationInteriorProxy.position.set(0, 0, 0);
    
    // Update ship proxy position in station interior if ship is docked
    if (isShipDocked && stationShipProxy) {
      // Use station physics position for ship proxy (physics calculated in station world)
      const stationShipPos = stationShipBody.translation();
      const stationShipRot = stationShipBody.rotation();
      
      stationShipProxy.position.set(stationShipPos.x, stationShipPos.y, stationShipPos.z);
      stationShipProxy.quaternion.set(stationShipRot.x, stationShipRot.y, stationShipRot.z, stationShipRot.w);
      
      // Minimal alignment check (removed verbose logging)
      
      // Check if ship is positioned correctly relative to station floor
      if (stationShipPos.y < 1.0) {
        console.log('  ⚠️  WARNING: Ship physics body is below station floor! Should be at Y≥1.4');
      }
      if (Math.abs(stationShipPos.y - stationShipProxy.position.y) > 0.1) {
        console.log('  ⚠️  WARNING: Physics body and visual proxy Y positions do not match!');
      }
      
      if (!stationShipProxy.visible) {
        console.log('WARNING: Station ship proxy not visible but should be!');
        console.log('Ship proxy position:', stationShipProxy.position);
        console.log('Station ship body position:', stationShipPos);
      }
    }
    
    } catch (error) {
      console.warn('Error updating station:', error);
    }
  }
  
  let lastTime = 0;
  
  function animate(currentTime = 0) {
    requestAnimationFrame(animate);
    
    const deltaTime = Math.min((currentTime - lastTime) / 1000, 1/30);
    lastTime = currentTime;
    
    // Update FPS
    frameCount++;
    if (currentTime - lastFpsTime >= 1000) {
      fps = Math.round(frameCount * 1000 / (currentTime - lastFpsTime));
      frameCount = 0;
      lastFpsTime = currentTime;
    }
    
    if (deltaTime > 0) {
      try {
        // Step exterior world with proper timestep
        exteriorWorld.timestep = deltaTime;
        exteriorWorld.step(exteriorEventQueue);
        
        // Process exterior collision events for ship entry detection and station interactions
        exteriorEventQueue.drainCollisionEvents((handle1, handle2, started) => {
          if (started) {
            try {
              const collider1 = exteriorWorld.getCollider(handle1);
              const collider2 = exteriorWorld.getCollider(handle2);
              
              // Safety check - ensure colliders are valid
              if (!collider1 || !collider2 || !playerCollider) return;
              
              // Check ship entry (player to ship door sensor) - only in exterior world
              if (!isInsideShip && !isInsideStation && !isExiting && !isTransitioning && !isEntering && (collider1 === playerCollider || collider2 === playerCollider)) {
                const otherCollider = collider1 === playerCollider ? collider2 : collider1;
                
                // Debug: Check sensor collision detection
                if (otherCollider && otherCollider.isSensor()) {
                  console.log('🔍 Player hitting sensor after undock:', {
                    isSensor: true,
                    sensorType: otherCollider === shipEntrySensor ? 'ship' : (otherCollider === stationEntrySensor ? 'station' : 'unknown'),
                    isShipSensor: otherCollider === shipEntrySensor,
                    isStationSensor: otherCollider === stationEntrySensor,
                    shipBodyExists: !!shipBody,
                    shipBodyHandle: shipBody?.handle,
                    otherColliderParentHandle: otherCollider.parent()?.handle,
                    playerConditions: { isInsideShip, isInsideStation, isExiting, isTransitioning, isEntering }
                  });
                }
                
                // Check if colliding with ship door sensor (immediate entry) - use more robust detection
                const isShipSensor = (otherCollider === shipEntrySensor) || 
                                   (otherCollider?.parent()?.handle === shipBody?.handle && otherCollider?.isSensor());
                if (isShipSensor) {
                  const playerPos = playerBody.translation();
                  console.log('SHIP ENTRY DETECTED - Deferring entry until after physics step:', playerPos);
                  pendingShipEntry = true;
                  // Clear any pending station entry since ship entry takes priority
                  if (pendingStationEntry) {
                    console.log('Cancelling pending station entry - ship entry takes priority');
                    pendingStationEntry = false;
                  }
                }
                
                // Check if colliding with station entry sensor (immediate entry) - use direct reference
                // Only trigger if ship entry is not already pending
                if (otherCollider === stationEntrySensor && !isInsideStation && !pendingShipEntry) {
                  const playerPos = playerBody.translation();
                  console.log('STATION ENTRY DETECTED - Deferring entry until after physics step:', playerPos);
                  pendingStationEntry = true;
                }
              }
              
            } catch (error) {
              console.warn('Error processing exterior collision events:', error);
            }
          }
        });
        
        // Step interior world with proper timestep
        interiorWorld.timestep = deltaTime;
        interiorWorld.step(interiorEventQueue);
        
        // Step station world with proper timestep
        stationWorld.timestep = deltaTime;
        stationWorld.step(stationEventQueue);
        
        // Check for automatic exit based on momentum and clear path
        if (playerProxyContext.activeWorld === 'ship' && !isTransitioning) {
          checkAutoExit();
        }
        
        if (playerProxyContext.activeWorld === 'station' && !isTransitioning) {
          checkStationAutoExit();
        }
        
        // Process interior collision events for sensor detection
        interiorEventQueue.drainCollisionEvents(() => {
          // Remove sensor-based exit detection - now using momentum + raycast system
        });
        
        
        // Process station collision events  
        stationEventQueue.drainCollisionEvents((handle1, handle2, started) => {
          // Get colliders from handles
          const collider1 = stationWorld.getCollider(handle1);
          const collider2 = stationWorld.getCollider(handle2);
          
          // Debug all station collision events with detailed logging
          const isPlayerInvolved = stationPlayerCollider && (collider1 === stationPlayerCollider || collider2 === stationPlayerCollider);
          const collider1IsPlayer = collider1 === stationPlayerCollider;
          const collider2IsPlayer = collider2 === stationPlayerCollider;
          
          if (isPlayerInvolved) {
            console.log('🚪 Station collision event with player:', 
              'started:', started,
              'collider1IsPlayer:', collider1IsPlayer,
              'collider2IsPlayer:', collider2IsPlayer, 
              'proxyContext:', playerProxyContext.activeWorld,
              'stationPlayerColliderExists:', !!stationPlayerCollider
            );
          }
          
          if (!started) return; // Only process collision start events
          
          try {
            // Safety check - ensure colliders are valid
            if (!collider1 || !collider2) return;
            
            // Check for ship entry from station
            const isPlayerCollision = stationPlayerCollider && (collider1 === stationPlayerCollider || collider2 === stationPlayerCollider);
            if (isPlayerCollision) {
              const otherCollider = collider1 === stationPlayerCollider ? collider2 : collider1;
              const playerPos = stationPlayerBody.translation();
              
              // Log every collision to help debug
              console.log('Station player collision detected with:', {
                otherColliderExists: !!otherCollider,
                otherColliderIsSensor: otherCollider?.isSensor(),
                otherColliderParent: otherCollider?.parent(),
                stationShipBody: stationShipBody,
                parentIsStationShip: otherCollider?.parent() === stationShipBody
              });
              
              // Debug all player collisions in station
              console.log('🔍 Player collision in station:', {
                playerPos: { x: playerPos.x.toFixed(2), y: playerPos.y.toFixed(2), z: playerPos.z.toFixed(2) },
                isShipCollider: otherCollider?.parent() === stationShipBody,
                isSensor: otherCollider?.isSensor(),
                conditions: { isInsideStation, isShipDocked, isInsideShip, isTransitioning, isExiting, isEntering }
              });
              
              // Debug ship sensor detection specifically
              if (otherCollider?.parent() === stationShipBody) {
                const shipPos = stationShipBody.translation();
                console.log('🔍 Player hitting ship in station:', {
                  isSensor: otherCollider?.isSensor(),
                  playerPos: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
                  shipPos: { x: shipPos.x, y: shipPos.y, z: shipPos.z },
                  distance: Math.sqrt((playerPos.x - shipPos.x)**2 + (playerPos.z - shipPos.z)**2),
                  conditions: { isInsideStation, isShipDocked, isInsideShip, isTransitioning, isExiting, isEntering }
                });
              }
              
              // Check ship entry conditions from station
              
              // Use proxy context to check if player is in station but not yet in ship
              const canEnterShipFromStation = playerProxyContext.activeWorld === 'station' && 
                                             isShipDocked && 
                                             !isTransitioning && 
                                             !isExiting && 
                                             !isEntering;
              
              if (canEnterShipFromStation) {
                // Check if player hit ship entry sensor in station world
                if (otherCollider?.parent() === stationShipBody && otherCollider?.isSensor()) {
                  console.log('🚀 Ship entry sensor triggered from station - entering ship');
                  console.log('  Current proxy context:', playerProxyContext);
                  pendingShipEntryFromStation = true;
                } else {
                  console.log('❌ Ship sensor not detected:', {
                    otherColliderExists: !!otherCollider,
                    parentMatches: otherCollider?.parent() === stationShipBody,
                    isSensor: otherCollider?.isSensor()
                  });
                }
              } else {
                console.log('❌ Cannot enter ship - conditions not met');
              }
            }
          } catch (error) {
            console.warn('Error processing station collision events:', error);
          }
        });
        
        // Update transition progress
        if (isTransitioning) {
          updateTransition(deltaTime);
        }
        
        // Ship docking is now immediate - no transition updates needed
        
        // Process deferred entry actions after all physics steps are complete
        if (pendingShipEntry && !isEntering) {
          pendingShipEntry = false;
          // Clear any pending station entry since ship entry takes priority
          if (pendingStationEntry) {
            console.log('Clearing pending station entry - ship entry being processed');
            pendingStationEntry = false;
          }
          console.log('PROCESSING DEFERRED SHIP ENTRY');
          immediateEnterInterior();
        }
        
        if (pendingStationEntry && !isEntering) {
          pendingStationEntry = false;
          console.log('PROCESSING DEFERRED STATION ENTRY');
          immediateEnterStation();
        }
        
        if (pendingShipDocking && !isShipDocked) {
          pendingShipDocking = false;
          console.log('PROCESSING DEFERRED SHIP DOCKING');
          startShipDockingTransition();
        }
        
        // Position-based ship docking/undocking check (runs every frame)
        let shipPos, shipRelativeToStation, isShipInDockingBay;
        const stationPos = stationBody.translation();
        // Station interior bounds - use full interior space, not just docking bay entrance
        // Use global constants
            
        if (isShipDocked) {
          // When docked, use station ship body position (already in station coordinates)
          const stationShipPos = stationShipBody.translation();
          shipRelativeToStation = {
            x: stationShipPos.x,
            y: stationShipPos.y,
            z: stationShipPos.z
          };
          
          // Convert to world coordinates for consistency (though not needed for bounds check)
          const stationRot = stationBody.rotation();
          const stationQuat = new THREE.Quaternion(stationRot.x, stationRot.y, stationRot.z, stationRot.w);
          const relativeShipPos = new THREE.Vector3(stationShipPos.x, stationShipPos.y, stationShipPos.z);
          relativeShipPos.applyQuaternion(stationQuat);
          
          shipPos = {
            x: stationPos.x + relativeShipPos.x,
            y: stationPos.y + relativeShipPos.y,
            z: stationPos.z + relativeShipPos.z
          };
        } else {
          // When not docked, use exterior ship body position
          shipPos = shipBody.translation();
          shipRelativeToStation = {
            x: shipPos.x - stationPos.x,
            y: shipPos.y - stationPos.y,
            z: shipPos.z - stationPos.z
          };
        }
        
        // Use consistent docking bay bounds regardless of docked state
        // Focus on the actual docking bay entrance area, not the full station interior
        const dockingBayWidth = 60; // Width of docking bay opening
        const dockingBayHeight = 30; // Height of docking bay opening
        const dockingBayDepth = 40; // How deep into station counts as "docked"
        
        let xInBounds, yInBounds, zInBounds;
        
        if (isShipDocked) {
          // When docked, use generous interior bounds to prevent oscillation
          xInBounds = Math.abs(shipRelativeToStation.x) < (STATION_WIDTH/2 - STATION_WALL_THICKNESS);
          yInBounds = shipRelativeToStation.y > 0 && shipRelativeToStation.y < STATION_HEIGHT;
          zInBounds = Math.abs(shipRelativeToStation.z) < (STATION_LENGTH/2 - STATION_WALL_THICKNESS);
        } else {
          // When not docked, use focused docking bay entrance detection
          xInBounds = Math.abs(shipRelativeToStation.x) < dockingBayWidth/2;
          yInBounds = shipRelativeToStation.y > (STATION_WALL_THICKNESS - 1.0) && shipRelativeToStation.y < dockingBayHeight;
          zInBounds = shipRelativeToStation.z > (STATION_LENGTH/2 - dockingBayDepth) && shipRelativeToStation.z < (STATION_LENGTH/2 + 5);
        }
        
        isShipInDockingBay = xInBounds && yInBounds && zInBounds;
        
        // Debug docking detection every few frames when ship is near station
        const distanceToStation = Math.sqrt(
          shipRelativeToStation.x * shipRelativeToStation.x + 
          shipRelativeToStation.y * shipRelativeToStation.y + 
          shipRelativeToStation.z * shipRelativeToStation.z
        );
        // Update previous state tracking
        prevIsShipDocked = isShipDocked;
        prevIsShipInDockingBay = isShipInDockingBay;
        
        // Reduced logging - only show status changes
        if (frameCount % 120 === 0 && distanceToStation < 150) { // Every 2 seconds when near station
          console.log('🚢 Ship status:', isShipDocked ? 'DOCKED' : (isShipInDockingBay ? 'IN DOCKING BAY' : 'EXTERIOR'));
        }
        
        
        if (!isShipDocked && !pendingShipDocking) {
          // Ship docking logic
          const currentTime = Date.now();
          const timeSinceUndock = currentTime - lastUndockTime;
          
          // Check if ship should dock with minimal cooldown (rely on natural physics for spacing)
          if (timeSinceUndock > 200 && isShipInDockingBay) { // 0.2 second cooldown to prevent frame-based oscillation
            console.log('SHIP DOCKING DETECTED (position-based) - Deferring docking until after physics step');
            pendingShipDocking = true;
          }
        } else if (isShipDocked) {
          // Ship undocking logic - use generous buffer to prevent oscillation
          const undockBuffer = 15.0; // Large buffer to prevent immediate undocking after docking
          
          const xOutOfBounds = Math.abs(shipRelativeToStation.x) > (STATION_WIDTH/2 - STATION_WALL_THICKNESS + undockBuffer);
          const yOutOfBounds = shipRelativeToStation.y < (STATION_WALL_THICKNESS - 0.1 - undockBuffer) || shipRelativeToStation.y > (STATION_HEIGHT - STATION_WALL_THICKNESS + 0.1 + undockBuffer);
          const zOutOfBounds = Math.abs(shipRelativeToStation.z) > (STATION_LENGTH/2 - STATION_WALL_THICKNESS + undockBuffer);
          
          if (xOutOfBounds || yOutOfBounds || zOutOfBounds) {
            console.log('SHIP UNDOCKING DETECTED (position-based) - Ship moved outside generous docking bounds');
            console.log('  Ship station-relative pos:', { x: shipRelativeToStation.x.toFixed(2), y: shipRelativeToStation.y.toFixed(2), z: shipRelativeToStation.z.toFixed(2) });
            console.log('  Generous bounds: X±' + (STATION_WIDTH/2 - STATION_WALL_THICKNESS + undockBuffer).toFixed(1) + 
                       ', Y(' + (STATION_WALL_THICKNESS - undockBuffer).toFixed(1) + ' to ' + (STATION_HEIGHT - STATION_WALL_THICKNESS + undockBuffer).toFixed(1) + 
                       '), Z±' + (STATION_LENGTH/2 - STATION_WALL_THICKNESS + undockBuffer).toFixed(1));
            console.log('  Out of bounds check: X=' + xOutOfBounds + ', Y=' + yOutOfBounds + ', Z=' + zOutOfBounds);
            undockShip();
          }
        }

        // Position-based ship entry detection disabled - rely only on sensor-based detection
        // The sensor attached to the ship body will handle entry detection more accurately

        // Position-based ship entry detection from station disabled - rely only on sensor-based detection
        
        // Position-based station exit detection (similar to ship exit logic)
        // Add small delay after entry to prevent immediate exit
        const timeSinceStationEntry = Date.now() - (lastStationEntryTime || 0);
        if (isInsideStation && !isInsideShip && !isExiting && !isTransitioning && !isEntering && timeSinceStationEntry > 500) {
          const stationPlayerPos = stationPlayerBody.translation();
          const stationPos = stationBody.translation();
          
          // Check if player is outside station bounds (station interior bounds: ±99 X, 1-59 Y, ±124 Z)
          const relativeToStation = {
            x: stationPlayerPos.x,  // Station interior is at origin, so position is relative
            y: stationPlayerPos.y,
            z: stationPlayerPos.z
          };
          
          // Station interior bounds (larger than ship)
          // Use global constants - full interior dimensions
          const isPlayerOutsideStationBounds = Math.abs(relativeToStation.x) > STATION_WIDTH/2 || 
                                               relativeToStation.y < -5 || relativeToStation.y > STATION_HEIGHT ||
                                               Math.abs(relativeToStation.z) > STATION_LENGTH/2;
          
          // Debug logging for station exit (less frequent)
          if (frameCount % 120 === 0) { // Every 2 seconds
            console.log('🚪 Position-based station exit check:');
            console.log('  Player pos in station:', {x: relativeToStation.x.toFixed(2), y: relativeToStation.y.toFixed(2), z: relativeToStation.z.toFixed(2)});
            console.log('  Station bounds (W×H×L):', STATION_WIDTH, '×', STATION_HEIGHT, '×', STATION_LENGTH);
            console.log('  Outside bounds?', {
              xOut: Math.abs(relativeToStation.x) > STATION_WIDTH/2,
              yOut: relativeToStation.y < -5 || relativeToStation.y > STATION_HEIGHT,
              zOut: Math.abs(relativeToStation.z) > STATION_LENGTH/2,
              overall: isPlayerOutsideStationBounds
            });
          }
          
          if (isPlayerOutsideStationBounds) {
            console.log('🎯 STATION EXIT DETECTED (position-based):');
            console.log('  Player outside station bounds, switching to exterior world');
            exitStation();
          }
        }
        
        if (pendingShipEntryFromStation && !isEntering) {
          pendingShipEntryFromStation = false;
          enterShipFromStation();
        }
        
        
        // Update physics-based proxy detection
        detectActiveProxyFromPhysics();
        
        updatePlayer(deltaTime);
        updateShip(deltaTime);
        updateStation(deltaTime);
        
      } catch (error) {
        console.error('Critical physics error:', error);
        // Skip this frame to prevent cascade failures
        return;
      }
    }
    
    // Always render triple view - all world cameras always visible
    renderTripleView();
  }
  
  function renderShipInteriorView() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update camera aspect ratio for full screen
    interiorCamera.aspect = width / height;
    interiorCamera.updateProjectionMatrix();
    
    // Full screen ship interior view
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.clear();
    
    // Show only ship interior proxy
    shipMesh.visible = false;
    stationMesh.visible = false;
    shipInteriorProxy.visible = true;
    stationInteriorProxy.visible = false;
    
    // Show debug player mesh based on interior position
    const interiorPos = interiorPlayerBody.translation();
    if (interiorPos.y > -50) {
      debugPlayerMesh.position.set(interiorPos.x, interiorPos.y, interiorPos.z);
      // Apply aiming rotation when pointer locked
      if (isPointerLocked) {
        debugPlayerMesh.rotation.y = -cameraRotation.yaw;
      }
      debugPlayerMesh.visible = true;
    } else {
      debugPlayerMesh.visible = false;
    }
    
    // Interior camera stays fixed for overview
    interiorCamera.position.set(0, 4, 25);
    interiorCamera.lookAt(0, 1.5, 0);
    
    renderer.render(interiorScene, interiorCamera);
  }
  
  function renderStationInteriorView() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update camera aspect ratio for full screen
    stationCamera.aspect = width / height;
    stationCamera.updateProjectionMatrix();
    
    // Full screen station interior view
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    renderer.clear();
    
    // Show only station interior proxy
    shipMesh.visible = false;
    stationMesh.visible = false;
    shipInteriorProxy.visible = false;
    stationInteriorProxy.visible = true;
    
    // Show station ship proxy if docked
    if (stationShipProxy) {
      stationShipProxy.visible = isShipDocked;
    }
    
    // Show debug station player mesh based on station position
    const stationPos = stationPlayerBody.translation();
    if (stationPos.y > -50) {
      debugStationPlayerMesh.position.set(stationPos.x, stationPos.y, stationPos.z);
      debugStationPlayerMesh.visible = true;
    } else {
      debugStationPlayerMesh.visible = false;
    }
    
    renderer.render(stationScene, stationCamera);
  }

  function renderTripleView() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    // Update camera aspect ratios for 1/3 width viewports
    const viewportAspect = (width / 3) / height;
    exteriorCamera.aspect = viewportAspect;
    exteriorCamera.updateProjectionMatrix();
    interiorCamera.aspect = viewportAspect;
    interiorCamera.updateProjectionMatrix();
    stationCamera.aspect = viewportAspect;
    stationCamera.updateProjectionMatrix();
    
    // Clear the entire screen
    renderer.setScissorTest(false);
    renderer.clear();
    
    // Left viewport - Exterior world
    renderer.setViewport(0, 0, width / 3, height);
    renderer.setScissor(0, 0, width / 3, height);
    renderer.setScissorTest(true);
    
    // Show exterior ship and station, hide interior proxies
    shipMesh.visible = true;
    stationMesh.visible = true;
    shipInteriorProxy.visible = false;
    stationInteriorProxy.visible = false;
    // Always show player mesh in exterior world (positioned correctly whether inside or outside ship/station)
    playerMesh.visible = true;
    
    renderer.render(exteriorScene, exteriorCamera);
    
    // Middle viewport - Ship Interior world view
    renderer.setViewport(width / 3, 0, width / 3, height);
    renderer.setScissor(width / 3, 0, width / 3, height);
    
    // Context-aware rendering for middle viewport
    // When player is in ship (whether docked or not), show ship interior
    // When player is just in station (not in ship), this viewport still shows ship for reference
    const showShipInteriorInMiddle = playerProxyContext.activeWorld === 'ship' || !isInsideStation;
    
    shipMesh.visible = false;
    stationMesh.visible = false;
    shipInteriorProxy.visible = showShipInteriorInMiddle;
    stationInteriorProxy.visible = !showShipInteriorInMiddle;
    
    // Show debug player mesh based on context
    const interiorPos = interiorPlayerBody.translation();
    const shouldShowDebugPlayer = (playerProxyContext.activeWorld === 'ship' || (isTransitioning && transitionProgress > 0.3)) && interiorPos.y > -50;
    
    if (shouldShowDebugPlayer) {
      debugPlayerMesh.position.set(interiorPos.x, interiorPos.y, interiorPos.z);
      debugPlayerMesh.visible = true;
    } else {
      debugPlayerMesh.visible = false;
    }
    
    // Render the appropriate scene based on what we're showing
    if (showShipInteriorInMiddle) {
      renderer.render(interiorScene, interiorCamera);
    } else {
      renderer.render(stationScene, stationCamera);
    }
    
    // Right viewport - Station Interior world view (ALWAYS shows station)
    renderer.setViewport(2 * width / 3, 0, width / 3, height);
    renderer.setScissor(2 * width / 3, 0, width / 3, height);
    
    // Always show station interior in the right viewport
    shipMesh.visible = false;
    stationMesh.visible = false;
    shipInteriorProxy.visible = false;
    stationInteriorProxy.visible = true;
    
    // Show debug station player mesh only if player is in station (not in docked ship)
    const stationPos = stationPlayerBody.translation();
    const shouldShowStationPlayer = playerProxyContext.activeWorld === 'station' && stationPos.y > -150;
    
    if (shouldShowStationPlayer) {
      debugStationPlayerMesh.position.set(stationPos.x, stationPos.y, stationPos.z);
      debugStationPlayerMesh.visible = true;
    } else {
      debugStationPlayerMesh.visible = false;
    }
    
    // Show docked ship proxy in station view if ship is docked
    if (stationShipProxy) {
      stationShipProxy.visible = isShipDocked;
    }
    
    renderer.render(stationScene, stationCamera);
    
    // Reset viewport and scissor
    renderer.setViewport(0, 0, width, height);
    renderer.setScissorTest(false);
    
    // Restore visibility for next frame
    playerMesh.visible = true;
    shipMesh.visible = true;
    stationMesh.visible = true;
  }
  
  function onWindowResize() {
    // Update aspect ratio for triple screen (third width)
    exteriorCamera.aspect = (window.innerWidth / 3) / window.innerHeight;
    exteriorCamera.updateProjectionMatrix();
    interiorCamera.aspect = (window.innerWidth / 3) / window.innerHeight;
    interiorCamera.updateProjectionMatrix();
    stationCamera.aspect = (window.innerWidth / 3) / window.innerHeight;
    stationCamera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
</script>

<canvas bind:this={canvas}></canvas>

<div class="ui">
  <p>WASD: Move | Space: Jump | Arrow Keys: Fly Ship | Q/E: Up/Down | O: Toggle Camera | Click: Pointer Lock | ESC: Exit Lock</p>
  <p>TFGH + RY: Ship Movement (when inside ship) | IKJL: Station Movement (when inside station)</p>
  <p>Status: {isInsideShip ? (isShipDocked ? 'Inside Ship (Docked in Station)' : 'Inside Ship (Free Flight)') : isInsideStation ? 'Inside Station' : 'Outside/Exterior World'}</p>
  <p>Ship Status: {isShipDocked ? 'Docked in Station' : 'Free Flight'}</p>
  <p>Transitions: {isTransitioning ? 'Player Transitioning' : ''} {isEntering ? 'Entering' : ''} {isExiting ? 'Exiting' : ''}</p>
  <p>Movement: {movementStatus}</p>
  <p>Camera: {isFirstPerson ? 'First Person' : 'Third Person'} | Pointer Lock: {isPointerLocked ? 'ON' : 'OFF'}</p>
</div>

<div class="camera-labels">
  <div class="camera-label left">Exterior World</div>
  <div class="camera-label center">Ship Interior</div>
  <div class="camera-label right">Station Interior</div>
</div>

<div class="debug-hud">
  <h3>Debug Info</h3>
  <div class="debug-row">
    <span class="label">FPS:</span>
    <span class="value">{fps}</span>
  </div>
  <div class="debug-row">
    <span class="label">World:</span>
    <span class="value">{currentWorld}</span>
  </div>
  <div class="debug-row">
    <span class="label">Position:</span>
    <span class="value">({playerPosition.x}, {playerPosition.y}, {playerPosition.z})</span>
  </div>
  <div class="debug-row">
    <span class="label">Velocity:</span>
    <span class="value">({playerVelocity.x}, {playerVelocity.y}, {playerVelocity.z})</span>
  </div>
  <div class="debug-row">
    <span class="label">Movement:</span>
    <span class="value">{movementStatus}</span>
  </div>
  <div class="debug-row">
    <span class="label">Ship World:</span>
    <span class="value">{shipWorld}</span>
  </div>
  <div class="debug-row">
    <span class="label">Can Jump:</span>
    <span class="value">{canJump ? 'Yes' : 'No'}</span>
  </div>
  <div class="debug-row">
    <span class="label">Jump Pressed:</span>
    <span class="value">{jumpPressed ? 'Yes' : 'No'}</span>
  </div>
  <div class="debug-row">
    <span class="label">Inside Ship:</span>
    <span class="value">{isInsideShip ? 'YES' : 'NO'}</span>
  </div>
  <div class="debug-row">
    <span class="label">Proxy Hierarchy:</span>
    <span class="value">{proxyHierarchy}</span>
  </div>
  <div class="debug-row">
    <span class="label">Active World:</span>
    <span class="value">{playerProxyContext.activeWorld}</span>
  </div>
</div>

<!-- Crosshair for FPS mode -->
{#if isFirstPerson && isPointerLocked}
<div class="crosshair">
  <div class="crosshair-dot"></div>
  <div class="crosshair-lines">
    <div class="crosshair-line horizontal"></div>
    <div class="crosshair-line vertical"></div>
  </div>
</div>
{/if}

<style>
  canvas {
    display: block;
  }
  
  .ui {
    position: absolute;
    top: 10px;
    left: 10px;
    color: white;
    font-family: Arial, sans-serif;
    text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
    z-index: 1000;
  }
  
  .ui p {
    margin: 5px 0;
  }
  
  .debug-hud {
    position: absolute;
    top: 10px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 15px;
    border-radius: 8px;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    min-width: 250px;
    z-index: 1000;
  }
  
  .debug-hud h3 {
    margin: 0 0 10px 0;
    color: #00ff00;
    font-size: 14px;
    text-align: center;
  }
  
  .debug-row {
    display: flex;
    justify-content: space-between;
    margin: 4px 0;
    padding: 2px 0;
    border-bottom: 1px solid #333;
  }
  
  .debug-row:last-child {
    border-bottom: none;
  }
  
  .label {
    color: #888;
    font-weight: bold;
  }
  
  .value {
    color: #fff;
    text-align: right;
  }
  
  .camera-labels {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 40px;
    pointer-events: none;
    z-index: 100;
  }
  
  .camera-label {
    position: absolute;
    top: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 5px 15px;
    border-radius: 15px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
  }
  
  .camera-label.left {
    left: 20px;
    color: #ffaa00;
  }
  
  .camera-label.center {
    left: 50%;
    transform: translateX(-50%);
    color: #00ff00;
  }
  
  .camera-label.right {
    right: 20px;
    color: #00aaff;
  }
  
  .crosshair {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 1000;
    pointer-events: none;
  }
  
  .crosshair-dot {
    width: 4px;
    height: 4px;
    background: rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
  }
  
  .crosshair-lines {
    position: relative;
  }
  
  .crosshair-line {
    background: rgba(255, 255, 255, 0.6);
    position: absolute;
    box-shadow: 0 0 1px rgba(0, 0, 0, 0.8);
  }
  
  .crosshair-line.horizontal {
    width: 20px;
    height: 1px;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
  
  .crosshair-line.vertical {
    width: 1px;
    height: 20px;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
</style>