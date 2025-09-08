<script>
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import RAPIER from '@dimforge/rapier3d-compat';
  import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js';
  import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
  
  let container;
  let scene, camera, renderer, world;
  let ragdoll = {};
  let clock = new THREE.Clock();
  let isRagdollMode = false;
  let animationTime = 0;
  let ragdollTransitionTime = 0; // Track time since entering ragdoll mode
  let capsuleCollider;
  let ikTarget = { position: new THREE.Vector3(2, 4, 0) };
  let ikTargetLeft = { position: new THREE.Vector3(-2, 4, 0) };
  let targetMesh, targetMeshLeft, arrowHelper, arrowHelperLeft;
  let mouse = new THREE.Vector2();
  let raycaster = new THREE.Raycaster();
  let isDragging = false;
  let isDraggingLeft = false;
  let skinnedMesh, skeleton, bones;
  let ikSolver;
  let fbxModel = null;
  let modelTextures = {};
  let animationMixer = null;
  let originalAnimationClip = null;
  let currentAnimationAction = null;
  
  // Physics bodies for ragdoll mode - small invisible colliders at bone centers
  // FBX skinned mesh provides all visuals, capsule is 1.8 tall centered at Y=0.9
  let bodyParts = {
    // Physics cubes in CENTER of each bone segment - scaled to fit character height
    head: { pos: [0, 1.6, 0], size: [0.08, 0.08, 0.08], isBoneCenter: true },
    torso: { pos: [0, 1.1, 0], size: [0.1, 0.1, 0.1], isBoneCenter: true },
    leftUpperArm: { pos: [-0.25, 1.2, 0], size: [0.06, 0.06, 0.06], isBoneCenter: true },
    rightUpperArm: { pos: [0.25, 1.2, 0], size: [0.06, 0.06, 0.06], isBoneCenter: true },
    leftLowerArm: { pos: [-0.25, 0.8, 0], size: [0.05, 0.05, 0.05], isBoneCenter: true },
    rightLowerArm: { pos: [0.25, 0.8, 0], size: [0.05, 0.05, 0.05], isBoneCenter: true },
    leftUpperLeg: { pos: [-0.12, 0.7, 0], size: [0.07, 0.07, 0.07], isBoneCenter: true },
    rightUpperLeg: { pos: [0.12, 0.7, 0], size: [0.07, 0.07, 0.07], isBoneCenter: true },
    leftLowerLeg: { pos: [-0.12, 0.3, 0], size: [0.06, 0.06, 0.06], isBoneCenter: true },
    rightLowerLeg: { pos: [0.12, 0.3, 0], size: [0.06, 0.06, 0.06], isBoneCenter: true }
  };
  
  // Animation and IK pose functions
  function resetPose() {
    if (!bones) return;
    
    // Reset only the bones that might have been modified, don't touch the skeleton globally
    const bonesToReset = [
      bones.find(b => b.name === 'upperarm_l'),
      bones.find(b => b.name === 'upperarm_r'), 
      bones.find(b => b.name === 'lowerarm_l'),
      bones.find(b => b.name === 'lowerarm_r'),
      bones.find(b => b.name === 'head'),
      bones.find(b => b.name === 'spine_01')
    ];
    
    bonesToReset.forEach(bone => {
      if (bone) {
        bone.rotation.set(0, 0, 0);
      }
    });
    
    console.log('Reset bone rotations to neutral');
  }
  
  function setPose(poseType) {
    if (!bones || !skeleton || !skinnedMesh) return;
    
    // Don't call skeleton.pose() as it interferes with the model scale
    // Instead, just modify bone rotations directly from their current state
    
    // Define poses by manipulating bone rotations in local space only
    const headBone = bones.find(b => b.name === 'head');
    const neckBone = bones.find(b => b.name === 'neck_01');
    const leftUpperArm = bones.find(b => b.name === 'upperarm_l');
    const rightUpperArm = bones.find(b => b.name === 'upperarm_r');
    const leftLowerArm = bones.find(b => b.name === 'lowerarm_l');
    const rightLowerArm = bones.find(b => b.name === 'lowerarm_r');
    const spineBase = bones.find(b => b.name === 'spine_01');
    const spineMid = bones.find(b => b.name === 'spine_02');
    const spineTop = bones.find(b => b.name === 'spine_03');
    
    // First reset only the bones we're going to modify
    const bonesToReset = [leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm, headBone, spineBase];
    bonesToReset.forEach(bone => {
      if (bone) {
        bone.rotation.set(0, 0, 0);
        bone.position.copy(bone.userData.bindPosition || bone.position);
      }
    });
    
    // Apply poses with controlled rotations - work in bone local space
    switch (poseType) {
      case 'wave':
        if (rightUpperArm) rightUpperArm.rotateX(-0.3).rotateZ(0.8);
        if (rightLowerArm) rightLowerArm.rotateZ(0.5);
        if (leftUpperArm) leftUpperArm.rotateZ(-0.2);
        break;
        
      case 'reach':
        if (leftUpperArm) leftUpperArm.rotateX(-1.0).rotateZ(-0.3);
        if (rightUpperArm) rightUpperArm.rotateX(-1.0).rotateZ(0.3);
        if (leftLowerArm) leftLowerArm.rotateZ(-0.2);
        if (rightLowerArm) rightLowerArm.rotateZ(0.2);
        break;
        
      case 'surrender':
        if (leftUpperArm) leftUpperArm.rotateX(-1.2).rotateZ(-0.8);
        if (rightUpperArm) rightUpperArm.rotateX(-1.2).rotateZ(0.8);
        if (leftLowerArm) leftLowerArm.rotateZ(-0.5);
        if (rightLowerArm) rightLowerArm.rotateZ(0.5);
        break;
        
      case 'tpose':
        if (leftUpperArm) leftUpperArm.rotateZ(-1.0);
        if (rightUpperArm) rightUpperArm.rotateZ(1.0);
        // Lower arms stay at 0 (already reset)
        break;
        
      case 'cross':
        if (leftUpperArm) leftUpperArm.rotateZ(0.5);
        if (rightUpperArm) rightUpperArm.rotateZ(-0.5);
        if (leftLowerArm) leftLowerArm.rotateZ(0.3);
        if (rightLowerArm) rightLowerArm.rotateZ(-0.3);
        break;
        
      case 'point':
        if (rightUpperArm) rightUpperArm.rotateZ(1.0);
        if (leftUpperArm) leftUpperArm.rotateZ(-0.1);
        // Right lower arm stays at 0
        break;
        
      case 'dance':
        if (leftUpperArm) leftUpperArm.rotateX(-0.5).rotateZ(-0.8);
        if (rightUpperArm) rightUpperArm.rotateX(-0.5).rotateZ(0.8);
        if (spineBase) spineBase.rotateY(0.1);
        if (headBone) headBone.rotateY(-0.2);
        break;
    }
    
    console.log(`Set pose: ${poseType}`);
  }
  
  function playOriginalAnimation() {
    if (!animationMixer || !originalAnimationClip) {
      console.log('No animation mixer or clip available');
      return;
    }
    
    // Stop current animation
    if (currentAnimationAction) {
      currentAnimationAction.stop();
    }
    
    // Play original animation
    currentAnimationAction = animationMixer.clipAction(originalAnimationClip);
    currentAnimationAction.loop = THREE.LoopRepeat;
    currentAnimationAction.play();
    
    console.log('Playing original animation:', originalAnimationClip.name);
  }
  
  function stopAnimation() {
    if (currentAnimationAction) {
      currentAnimationAction.stop();
      currentAnimationAction = null;
      console.log('Stopped animation');
    }
    
    // Reset to bind pose
    resetPose();
  }

  onMount(async () => {
    await RAPIER.init();
    initThreeJS();
    initRapier();
    createRagdoll();
    animate();
    
    // Add keyboard listener for ragdoll toggle
    window.addEventListener('keydown', handleKeyPress);
    
    // Add mouse controls for IK target
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
  });
  
  function handleKeyPress(event) {
    if (event.key.toLowerCase() === 'r') {
      toggleRagdollMode();
    }
  }
  
  function onMouseDown(event) {
    if (isRagdollMode) return;
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersectsRight = raycaster.intersectObjects([targetMesh, arrowHelper], true);
    const intersectsLeft = raycaster.intersectObjects([targetMeshLeft, arrowHelperLeft], true);
    
    if (intersectsRight.length > 0) {
      isDragging = true;
    } else if (intersectsLeft.length > 0) {
      isDraggingLeft = true;
    }
  }
  
  function onMouseMove(event) {
    if ((!isDragging && !isDraggingLeft) || isRagdollMode) return;
    
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    // Cast ray to an invisible plane at z=0
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersect = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersect);
    
    if (intersect) {
      if (isDragging) {
        ikTarget.position.copy(intersect);
        ikTarget.position.z = 0; // Keep in 2D plane
        
        // Clamp to reasonable bounds for right arm
        ikTarget.position.x = Math.max(-1, Math.min(3, ikTarget.position.x));
        ikTarget.position.y = Math.max(1, Math.min(6, ikTarget.position.y));
      } else if (isDraggingLeft) {
        ikTargetLeft.position.copy(intersect);
        ikTargetLeft.position.z = 0; // Keep in 2D plane
        
        // Clamp to reasonable bounds for left arm
        ikTargetLeft.position.x = Math.max(-3, Math.min(1, ikTargetLeft.position.x));
        ikTargetLeft.position.y = Math.max(1, Math.min(6, ikTargetLeft.position.y));
      }
      
      updateIKTargetVisualization();
    }
  }
  
  function onMouseUp() {
    isDragging = false;
    isDraggingLeft = false;
  }
  
  function updateIKTargetVisualization() {
    targetMesh.position.copy(ikTarget.position);
    targetMeshLeft.position.copy(ikTargetLeft.position);
    arrowHelper.position.copy(ikTarget.position);
    arrowHelperLeft.position.copy(ikTargetLeft.position);
  }
  
  function toggleRagdollMode() {
    isRagdollMode = !isRagdollMode;
    
    if (isRagdollMode) {
      ragdollTransitionTime = 0; // Reset transition timer
      // Switch to ragdoll mode
      // 1. Disable capsule collider completely
      if (capsuleCollider && capsuleCollider.isValid()) {
        world.removeCollider(capsuleCollider, false);
      }
      
      // 2. Disable all colliders attached to capsule
      Object.values(ragdoll.jointColliders).forEach(collider => {
        if (collider && collider.isValid()) {
          world.removeCollider(collider, false);
        }
      });
      
      // 3. Enable ragdoll bodies and set their positions to match current mesh positions
      Object.entries(ragdoll.jointBodies).forEach(([name, body]) => {
        const mesh = ragdoll.meshes[name];
        if (mesh) {
          // Get world position of mesh
          const worldPos = new THREE.Vector3();
          mesh.getWorldPosition(worldPos);
          
          // Gently transition to ragdoll - clear any existing velocities
          body.setTranslation({ x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true); // Zero linear velocity
          body.setAngvel({ x: 0, y: 0, z: 0 }, true); // Zero angular velocity
          
          // Set to dynamic mode
          body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
          
          // Apply very gentle upward impulse to counteract gravity shock
          body.applyImpulse({ x: 0, y: 0.05, z: 0 }, true);
        }
      });
      
      // 4. Enable ragdoll joints - joints are enabled by setting body types to Dynamic
      
      // 5. Disable capsule physics completely
      ragdoll.bodies.capsule.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      
    } else {
      // Switch to IK mode
      // 1. Re-create capsule collider
      const capsuleColliderDesc = RAPIER.ColliderDesc.capsule(2.0, 0.6)
        .setCollisionGroups(0x00010001);
      capsuleCollider = world.createCollider(capsuleColliderDesc, ragdoll.bodies.capsule);
      
      // 2. Re-create colliders attached to capsule for bone centers only
      const boneCenterParts = {
        head: { pos: [0, 5.2, 0], size: [0.15, 0.15, 0.15] },
        torso: { pos: [0, 3.5, 0], size: [0.3, 0.8, 0.2] },
        leftUpperArm: { pos: [-0.7, 4.0, 0], size: [0.12, 0.12, 0.12] },
        rightUpperArm: { pos: [0.7, 4.0, 0], size: [0.12, 0.12, 0.12] },
        leftLowerArm: { pos: [-1.2, 3.0, 0], size: [0.1, 0.1, 0.1] },
        rightLowerArm: { pos: [1.2, 3.0, 0], size: [0.1, 0.1, 0.1] },
        leftUpperLeg: { pos: [-0.3, 1.4, 0], size: [0.15, 0.15, 0.15] },
        rightUpperLeg: { pos: [0.3, 1.4, 0], size: [0.15, 0.15, 0.15] },
        leftLowerLeg: { pos: [-0.3, 0.4, 0], size: [0.12, 0.12, 0.12] },
        rightLowerLeg: { pos: [0.3, 0.4, 0], size: [0.12, 0.12, 0.12] }
      };
      
      Object.entries(boneCenterParts).forEach(([name, part]) => {
        const offsetFromCapsule = [
          part.pos[0] - 0,
          part.pos[1] - 4.0, // Updated for new capsule height
          part.pos[2] - 0
        ];
        
        const colliderDesc = RAPIER.ColliderDesc.cuboid(...part.size)
          .setTranslation(...offsetFromCapsule)
          .setCollisionGroups(0x00020001);
        ragdoll.jointColliders[name] = world.createCollider(colliderDesc, ragdoll.bodies.capsule);
      });
      
      // 3. Disable ragdoll bodies
      Object.values(ragdoll.jointBodies).forEach(body => {
        body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      });
      
      // 4. Disable ragdoll joints - joints are disabled by setting body types to Fixed
      
      // 5. Enable capsule physics
      ragdoll.bodies.capsule.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    }
  }
  
  function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 2, 0);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(-10, 20, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);
    
    // Ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90EE90 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // IK Target visualizations - Right arm (red)
    const targetGeometry = new THREE.SphereGeometry(0.1, 8, 6);
    const targetMaterial = new THREE.MeshBasicMaterial({ color: 0xFF0000, transparent: true, opacity: 0.8 });
    targetMesh = new THREE.Mesh(targetGeometry, targetMaterial);
    targetMesh.position.copy(ikTarget.position);
    scene.add(targetMesh);
    
    // Left arm target (blue)
    const targetMaterialLeft = new THREE.MeshBasicMaterial({ color: 0x0000FF, transparent: true, opacity: 0.8 });
    targetMeshLeft = new THREE.Mesh(targetGeometry, targetMaterialLeft);
    targetMeshLeft.position.copy(ikTargetLeft.position);
    scene.add(targetMeshLeft);
    
    // Debug axes for targets (XYZ gizmo)
    const axesHelper = new THREE.AxesHelper(0.3);
    axesHelper.position.copy(ikTarget.position);
    scene.add(axesHelper);
    arrowHelper = axesHelper;
    
    const axesHelperLeft = new THREE.AxesHelper(0.3);
    axesHelperLeft.position.copy(ikTargetLeft.position);
    scene.add(axesHelperLeft);
    arrowHelperLeft = axesHelperLeft;
  }
  
  function initRapier() {
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    world = new RAPIER.World(gravity);
    
    // Ground - collides with everything
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(50.0, 0.1, 50.0)
      .setCollisionGroups(0x00010003); // Group 1, collides with groups 1 and 2
    world.createCollider(groundColliderDesc);
  }
  
  function loadTextures() {
    const textureLoader = new THREE.TextureLoader();
    const textureNames = ['dif', 'gloss', 'mask01', 'mask02', 'norm'];
    
    textureNames.forEach(name => {
      textureLoader.load(
        `/tex/rp_carla_rigged_001_${name}.jpg`, 
        (texture) => {
          console.log(`Loaded texture: ${name}`);
          modelTextures[name] = texture;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.flipY = false; // FBX models typically need this
        },
        undefined,
        (error) => {
          console.error(`Failed to load texture ${name}:`, error);
        }
      );
    });
  }

  function applyTexturesToModel(model) {
    model.traverse((child) => {
      if (child.isMesh) {
        console.log('Found mesh:', child.name, 'Material:', child.material.type);
        
        // Apply diffuse texture if available
        if (modelTextures.dif) {
          child.material.map = modelTextures.dif;
          child.material.needsUpdate = true;
          console.log('Applied diffuse texture to', child.name);
        }
        
        // Apply normal map if available
        if (modelTextures.norm) {
          child.material.normalMap = modelTextures.norm;
          child.material.needsUpdate = true;
          console.log('Applied normal map to', child.name);
        }
        
        // Apply gloss map as specular map if available
        if (modelTextures.gloss) {
          child.material.specularMap = modelTextures.gloss;
          child.material.needsUpdate = true;
          console.log('Applied gloss texture to', child.name);
        }
        
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  function createSkinnedMesh() {
    // Load textures first
    loadTextures();
    
    // Load FBX model
    const fbxLoader = new FBXLoader();
    console.log('Starting FBX model loading...');
    fbxLoader.load('/model.fbx', (model) => {
      console.log('FBX model loaded successfully:', model);
      fbxModel = model;
      
      // Scale and position the model properly
      model.scale.setScalar(0.01); // Adjust scale as needed
      model.position.set(0, 0, 0); // Position so feet are at ground level (Y=0)
      
      console.log('Model bones found:', model.getObjectByProperty('type', 'SkinnedMesh')?.skeleton?.bones?.length || 0);
      
      // Apply textures to model materials
      applyTexturesToModel(model);
      
      // Extract skeleton from loaded model - check for SkinnedMesh
      let foundSkinnedMesh = false;
      model.traverse((child) => {
        console.log('Traversing child:', child.type, child.name, 'isSkinnedMesh:', child.isSkinnedMesh);
        
        if (child.isSkinnedMesh) {
          console.log('Found SkinnedMesh:', child.name, 'with skeleton bones:', child.skeleton.bones.length);
          skinnedMesh = child;
          skeleton = child.skeleton;
          bones = skeleton.bones;
          foundSkinnedMesh = true;
          
          // Set up animation mixer and store original animations
          if (model.animations && model.animations.length > 0) {
            console.log('Found animations:', model.animations.length, '- setting up mixer');
            animationMixer = new THREE.AnimationMixer(model);
            
            // Store the first animation as the original
            originalAnimationClip = model.animations[0];
            console.log('Stored original animation:', originalAnimationClip.name, 'duration:', originalAnimationClip.duration);
            
            // Log all available animations
            model.animations.forEach((animation, index) => {
              console.log(`Animation ${index}: ${animation.name} (${animation.duration}s)`);
            });
            
            // Reset skeleton to bind pose initially
            if (child.skeleton) {
              child.skeleton.pose(); // Reset to bind/rest pose
              console.log('Reset skeleton to bind pose');
            }
          }
          
          // Set up IK solver with model's bones
          setupIKFromModel();
        }
      });
      
      if (foundSkinnedMesh) {
        scene.add(model);
        console.log('Rigged FBX model added to scene successfully with', bones.length, 'bones');
      } else {
        console.warn('No SkinnedMesh found in rigged FBX model, using fallback');
        createFallbackSkeleton();
      }
    }, 
    (progress) => {
      console.log('FBX loading progress:', progress);
    },
    (error) => {
      console.error('Error loading FBX:', error);
      // Fallback to wireframe system
      createFallbackSkeleton();
    });
  }
  
  function setupIKFromModel() {
    console.log('Setting up IK from model bones:', bones.map(b => b.name));
    
    // Find relevant bones by name for IK setup
    const findBoneByName = (name) => bones.find(bone => 
      bone.name.toLowerCase().includes(name.toLowerCase())
    );
    
    // Based on console output, the bones are named: hand_l, hand_r, lowerarm_l, lowerarm_r, upperarm_l, upperarm_r
    const leftHandBone = findBoneByName('hand_l');
    const rightHandBone = findBoneByName('hand_r');
    const leftForearmBone = findBoneByName('lowerarm_l');
    const rightForearmBone = findBoneByName('lowerarm_r');
    const leftUpperArmBone = findBoneByName('upperarm_l');
    const rightUpperArmBone = findBoneByName('upperarm_r');
    
    console.log('Found bones:', {
      leftHand: leftHandBone?.name,
      rightHand: rightHandBone?.name,
      leftForearm: leftForearmBone?.name,
      rightForearm: rightForearmBone?.name,
      leftUpperArm: leftUpperArmBone?.name,
      rightUpperArm: rightUpperArmBone?.name
    });
    
    if (leftHandBone && rightHandBone && leftForearmBone && rightForearmBone && leftUpperArmBone && rightUpperArmBone) {
      const iks = [
        {
          target: bones.indexOf(rightHandBone),
          effector: bones.indexOf(rightHandBone),
          links: [
            { index: bones.indexOf(rightForearmBone), limitation: new THREE.Vector3(1, 1, 1) },
            { index: bones.indexOf(rightUpperArmBone), limitation: new THREE.Vector3(1, 1, 1) }
          ]
        },
        {
          target: bones.indexOf(leftHandBone),
          effector: bones.indexOf(leftHandBone),
          links: [
            { index: bones.indexOf(leftForearmBone), limitation: new THREE.Vector3(1, 1, 1) },
            { index: bones.indexOf(leftUpperArmBone), limitation: new THREE.Vector3(1, 1, 1) }
          ]
        }
      ];
      
      ikSolver = new CCDIKSolver(skinnedMesh, iks);
      console.log('IK solver created successfully');
      
      // Create physics bodies based on actual bone positions
      createPhysicsFromBones();
    } else {
      console.warn('Could not find all required arm bones for IK setup, trying with available bones');
      // Even if we can't find all bones, we might still be able to create some IK chains
      createPhysicsFromBones();
    }
  }
  
  function createPhysicsFromBones() {
    if (!bones || bones.length === 0) {
      console.warn('No bones available, using fallback physics');
      return;
    }
    
    console.log('Creating physics bodies from bone positions');
    
    // Map bone names to physics body parts based on actual FBX bone names
    const boneMapping = {
      'head': bones.find(b => b.name === 'head'),
      'torso': bones.find(b => b.name === 'spine_02' || b.name === 'spine_01' || b.name === 'spine_03'),
      'leftUpperArm': bones.find(b => b.name === 'upperarm_l'),
      'rightUpperArm': bones.find(b => b.name === 'upperarm_r'),
      'leftLowerArm': bones.find(b => b.name === 'lowerarm_l'),
      'rightLowerArm': bones.find(b => b.name === 'lowerarm_r'),
      'leftUpperLeg': bones.find(b => b.name === 'thigh_l'),
      'rightUpperLeg': bones.find(b => b.name === 'thigh_r'),
      'leftLowerLeg': bones.find(b => b.name === 'calf_l'),
      'rightLowerLeg': bones.find(b => b.name === 'calf_r')
    };
    
    console.log('Bone mapping:', Object.keys(boneMapping).map(key => ({ key, bone: boneMapping[key]?.name })));
    
    // Update bodyParts with actual bone positions
    Object.keys(boneMapping).forEach(partName => {
      const bone = boneMapping[partName];
      if (bone && bodyParts[partName]) {
        // Get world position of bone
        bone.updateMatrixWorld();
        const worldPos = new THREE.Vector3();
        worldPos.setFromMatrixPosition(bone.matrixWorld);
        
        // Update bodyParts position
        bodyParts[partName].pos = [worldPos.x, worldPos.y, worldPos.z];
        console.log(`Updated ${partName} position from bone ${bone.name}:`, bodyParts[partName].pos);
      }
    });
  }
  
  function createFallbackSkeleton() {
    // Fallback to original wireframe system if FBX loading fails
    bones = [];
    
    const rootBone = new THREE.Bone();
    rootBone.name = 'root';
    bones.push(rootBone);
    
    const spineBone = new THREE.Bone();
    spineBone.name = 'spine';
    spineBone.position.set(0, 4.8, 0);
    rootBone.add(spineBone);
    bones.push(spineBone);
    
    // Create minimal skeleton for IK
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshBasicMaterial({ visible: false });
    skinnedMesh = new THREE.Mesh(geometry, material);
    skinnedMesh.position.set(0, 2.4, 0);
    scene.add(skinnedMesh);
  }

  function createRagdoll() {
    ragdoll.bodies = {};
    ragdoll.meshes = {};
    ragdoll.joints = [];
    
    // Create skinned mesh for IK mode
    createSkinnedMesh();
    
    // Main capsule body (represents the character's main collision volume)  
    const capsuleBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.75, 0) // Position capsule center to fit character better (height=1.5, so bottom at Y=0)
      .lockRotations(); // Lock rotation to prevent tipping over
    const capsuleBody = world.createRigidBody(capsuleBodyDesc);
    
    // Capsule sized to closely fit the character model (height=1.5, radius=0.3)
    const capsuleColliderDesc = RAPIER.ColliderDesc.capsule(0.75, 0.3)
      .setCollisionGroups(0x00010001); // Group 1, collides with group 1 (ground)
    capsuleCollider = world.createCollider(capsuleColliderDesc, capsuleBody);
    
    // Store capsule body reference
    ragdoll.bodies.capsule = capsuleBody;
    
    // Add debug capsule mesh to visualize collision bounds (optional - can be removed)
    const debugCapsuleGeometry = new THREE.CapsuleGeometry(0.3, 1.5, 8, 16);
    const debugCapsuleMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00, 
      wireframe: true, 
      transparent: true, 
      opacity: 0.3 
    });
    const debugCapsuleMesh = new THREE.Mesh(debugCapsuleGeometry, debugCapsuleMaterial);
    debugCapsuleMesh.position.set(0, 0.75, 0); // Match capsule body position
    scene.add(debugCapsuleMesh);
    ragdoll.meshes.debugCapsule = debugCapsuleMesh;
    
    // Use global bodyParts (updated by FBX model bones if available)
    
    // Create bodies and meshes
    ragdoll.jointBodies = {}; // Separate bodies for ragdoll mode
    ragdoll.jointColliders = {}; // Colliders attached to capsule
    
    for (const [name, part] of Object.entries(bodyParts)) {
      const geometry = new THREE.BoxGeometry(part.size[0] * 2, part.size[1] * 2, part.size[2] * 2);
      
      if (part.isBoneCenter) {
        // Create invisible colliders attached to capsule (for IK mode)
        const offsetFromCapsule = [
          part.pos[0] - 0,
          part.pos[1] - 0.9, // Updated for capsule position at Y=0.9
          part.pos[2] - 0
        ];
        
        const colliderDesc = RAPIER.ColliderDesc.cuboid(...part.size)
          .setTranslation(...offsetFromCapsule)
          .setCollisionGroups(0x00020001); // Group 2, collides only with ground
        ragdoll.jointColliders[name] = world.createCollider(colliderDesc, capsuleBody);
        
        // Create invisible ragdoll physics body for this bone center
        const ragdollBodyDesc = RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...part.pos);
        const ragdollBody = world.createRigidBody(ragdollBodyDesc);
        ragdollBody.setBodyType(RAPIER.RigidBodyType.Fixed, true); // Disabled initially
        
        const ragdollColliderDesc = RAPIER.ColliderDesc.cuboid(...part.size)
          .setCollisionGroups(0x00020001); // Group 2, collides with ground only
        world.createCollider(ragdollColliderDesc, ragdollBody);
        
        // Store physics body for ragdoll mode
        ragdoll.jointBodies[name] = ragdollBody;
        
        // No visual mesh - FBX model provides all visuals
      }
    }
    
    // Store capsule body reference
    ragdoll.bodies.capsule = capsuleBody;
    
    // Connect physics bodies with proper joint positions based on FBX bone centers
    const connections = [
      // Head to torso (neck joint)
      { body1: 'torso', body2: 'head', anchor1: [0, 0.1, 0], anchor2: [0, -0.08, 0], type: 'neck' },
      
      // Arms - shoulders connect torso to upper arms, elbows connect arm segments
      { body1: 'torso', body2: 'leftUpperArm', anchor1: [-0.3, 0.05, 0], anchor2: [0, 0.03, 0], type: 'shoulder' },
      { body1: 'torso', body2: 'rightUpperArm', anchor1: [0.3, 0.05, 0], anchor2: [0, 0.03, 0], type: 'shoulder' },
      { body1: 'leftUpperArm', body2: 'leftLowerArm', anchor1: [0, -0.03, 0], anchor2: [0, 0.025, 0], type: 'elbow' },
      { body1: 'rightUpperArm', body2: 'rightLowerArm', anchor1: [0, -0.03, 0], anchor2: [0, 0.025, 0], type: 'elbow' },
      
      // Legs - hips connect torso to upper legs, knees connect leg segments  
      { body1: 'torso', body2: 'leftUpperLeg', anchor1: [-0.1, -0.1, 0], anchor2: [0, 0.035, 0], type: 'hip' },
      { body1: 'torso', body2: 'rightUpperLeg', anchor1: [0.1, -0.1, 0], anchor2: [0, 0.035, 0], type: 'hip' },
      { body1: 'leftUpperLeg', body2: 'leftLowerLeg', anchor1: [0, -0.035, 0], anchor2: [0, 0.03, 0], type: 'knee' },
      { body1: 'rightUpperLeg', body2: 'rightLowerLeg', anchor1: [0, -0.035, 0], anchor2: [0, 0.03, 0], type: 'knee' }
    ];
    
    // Create joints for ragdoll mode with proper limits and damping
    ragdoll.ragdollJoints = [];
    connections.forEach((connection) => {
      const body1 = ragdoll.jointBodies[connection.body1];
      const body2 = ragdoll.jointBodies[connection.body2];
      
      if (body1 && body2) {
        const params = RAPIER.JointData.spherical(
          new RAPIER.Vector3(...connection.anchor1),
          new RAPIER.Vector3(...connection.anchor2)
        );
        
        const jointHandle = world.createImpulseJoint(params, body1, body2, false); // Disabled initially
        
        // Configure joint properties with limits and damping based on joint type
        const joint = world.getImpulseJoint(jointHandle);
        if (joint) {
          // Basic joint configuration - disable contacts between connected bodies
          joint.setContactsEnabled(false);
          
          // Store joint type for manual constraint application
          joint.userData = { 
            jointType: connection.type,
            body1Name: connection.body1,
            body2Name: connection.body2
          };
          
          // Note: We'll apply manual constraints in the physics update loop
          // since advanced joint limits aren't available in this Rapier version
        }
        
        ragdoll.ragdollJoints.push(jointHandle);
      }
    });
    
    // Start in IK mode - capsule is kinematic (no physics), joint bodies are fixed
    ragdoll.bodies.capsule.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    ragdoll.bodies.capsule.setTranslation({ x: 0, y: 0.75, z: 0 }, true); // Keep at exact position
  }
  
  function updateWireframesToBones() {
    if (!bones || !skeleton) return;
    
    // If we have the FBX model, update its skeleton directly
    if (fbxModel && skinnedMesh && skeleton) {
      // The FBX model's skeleton will automatically update the visual mesh
      // when bones are modified by IK or physics
      skeleton.bones.forEach(bone => {
        bone.updateMatrixWorld();
      });
      
      // Update skinned mesh
      if (skinnedMesh.skeleton) {
        skinnedMesh.skeleton.update();
      }
    } else if (ragdoll.meshes) {
      // Fallback to wireframe system
      bones.forEach((bone, index) => {
        bone.updateMatrixWorld();
        const worldPosition = new THREE.Vector3();
        bone.getWorldPosition(worldPosition);
        
        // Map bones to wireframe meshes (fallback system)
        const boneToWireframe = {
          2: 'headWireframe',
          1: 'torsoWireframe',
          4: 'leftUpperArmWireframe',
          5: 'leftLowerArmWireframe',
          7: 'rightUpperArmWireframe',
          8: 'rightLowerArmWireframe'
        };
        
        const wireframeName = boneToWireframe[index];
        if (wireframeName && ragdoll.meshes[wireframeName]) {
          ragdoll.meshes[wireframeName].position.copy(worldPosition);
          
          const worldQuaternion = new THREE.Quaternion();
          bone.getWorldQuaternion(worldQuaternion);
          ragdoll.meshes[wireframeName].quaternion.copy(worldQuaternion);
        }
      });
    }
  }
  
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    animationTime += delta;
    
    if (!isRagdollMode) {
      // IK/Animation mode - animate the character
      animateIK();
    }
    
    // Step physics
    world.step();
    
    if (isRagdollMode) {
      // Track transition time for gentler ragdoll entry
      ragdollTransitionTime += delta;
      
      // Apply realistic joint constraints and damping
      ragdoll.ragdollJoints.forEach(jointHandle => {
        const joint = world.getImpulseJoint(jointHandle);
        if (joint && joint.userData) {
          const { jointType, body1Name, body2Name } = joint.userData;
          const body1 = ragdoll.jointBodies[body1Name];
          const body2 = ragdoll.jointBodies[body2Name];
          
          if (body1 && body2 && body1.bodyType() === RAPIER.RigidBodyType.Dynamic && body2.bodyType() === RAPIER.RigidBodyType.Dynamic) {
            const pos1 = body1.translation();
            const pos2 = body2.translation();
            const vel1 = body1.linvel();
            const vel2 = body2.linvel();
            const angVel1 = body1.angvel();
            const angVel2 = body2.angvel();
            
            // Calculate relative position
            const relativePos = {
              x: pos2.x - pos1.x,
              y: pos2.y - pos1.y, 
              z: pos2.z - pos1.z
            };
            
            let applyConstraints = false;
            let dampingFactor = 0.95;
            
            switch (jointType) {
              case 'neck':
                // Head can look around but limited rotation - more natural range
                const neckDist = Math.sqrt(relativePos.x * relativePos.x + relativePos.z * relativePos.z);
                const neckAngle = Math.atan2(neckDist, relativePos.y);
                if (neckAngle > Math.PI / 4 || relativePos.y < 0.15) { // 45 degree max tilt, closer connection
                  applyConstraints = true;
                  dampingFactor = 0.92; // Less damping for more responsive movement
                }
                break;
                
              case 'shoulder':
                // Shoulders - strong constraints to prevent going through torso
                const shoulderAngleY = Math.atan2(relativePos.x, relativePos.y);
                const shoulderAngleZ = Math.atan2(Math.abs(relativePos.z), relativePos.y);
                const shoulderDist = Math.sqrt(relativePos.x * relativePos.x + relativePos.y * relativePos.y + relativePos.z * relativePos.z);
                // Prevent arms from going through torso (strong angle limits)
                if (Math.abs(shoulderAngleY) > Math.PI / 3 || shoulderAngleZ > Math.PI / 4 || shoulderDist > 0.6) {
                  applyConstraints = true;
                  dampingFactor = 0.75; // Strong damping to prevent clipping
                }
                break;
                
              case 'elbow':
                // Elbows - strict one-way bending, strong limits
                const elbowAngleY = Math.atan2(-relativePos.y, Math.abs(relativePos.x));
                const elbowAngleZ = Math.atan2(Math.abs(relativePos.z), Math.abs(relativePos.x));
                // Strong constraints: only bend in one direction, prevent hyperextension
                if (elbowAngleY < 0 || elbowAngleY > Math.PI * 0.6 || elbowAngleZ > Math.PI / 6) {
                  applyConstraints = true;
                  dampingFactor = 0.70; // Strong damping for tight elbow control
                }
                break;
                
              case 'hip':
                // Hips - prevent legs from going through torso
                const hipAngleX = Math.atan2(Math.abs(relativePos.x), relativePos.y);
                const hipAngleZ = Math.atan2(Math.abs(relativePos.z), relativePos.y);
                // Tighter hip limits to prevent leg clipping through torso
                if (hipAngleX > Math.PI / 4 || hipAngleZ > Math.PI / 6 || relativePos.y > 0.15) {
                  applyConstraints = true;
                  dampingFactor = 0.75; // Strong damping to prevent clipping
                }
                break;
                
              case 'knee':
                // Knees only bend forward - natural walking range
                const kneeAngle = Math.atan2(-relativePos.y, Math.abs(relativePos.z));
                if (kneeAngle < 0 || kneeAngle > Math.PI * 0.7) { // 0 to 126 degrees (more realistic)
                  applyConstraints = true;
                  dampingFactor = 0.90; // Less damping for more natural movement
                }
                break;
            }
            
            // Apply soft damping based on joint behavior
            if (applyConstraints) {
              // Apply extra damping during transition to prevent explosive movements
              let finalDampingFactor = dampingFactor;
              if (ragdollTransitionTime < 1.5) {
                const transitionBoost = Math.max(0, (1.5 - ragdollTransitionTime) / 1.5);
                finalDampingFactor = dampingFactor * (1.0 - 0.3 * transitionBoost); // Up to 30% more damping
              }
              
              body2.setLinvel({ 
                x: vel2.x * finalDampingFactor, 
                y: vel2.y * finalDampingFactor, 
                z: vel2.z * finalDampingFactor 
              }, true);
              body2.setAngvel({ 
                x: angVel2.x * finalDampingFactor, 
                y: angVel2.y * finalDampingFactor, 
                z: angVel2.z * finalDampingFactor 
              }, true);
            }
            
            // Apply extra damping during ragdoll transition to prevent explosive behavior
            let universalDamping = 0.9995;
            if (ragdollTransitionTime < 2.0) {
              // Extra damping for first 2 seconds of ragdoll mode
              const transitionFactor = Math.max(0, (2.0 - ragdollTransitionTime) / 2.0);
              universalDamping = 0.985 + (0.0145 * (1.0 - transitionFactor)); // Lerp from 0.985 to 0.9995
            }
            body1.setLinvel({ 
              x: vel1.x * universalDamping, 
              y: vel1.y * universalDamping, 
              z: vel1.z * universalDamping 
            }, true);
            body1.setAngvel({ 
              x: angVel1.x * universalDamping, 
              y: angVel1.y * universalDamping, 
              z: angVel1.z * universalDamping 
            }, true);
            
            body2.setLinvel({ 
              x: vel2.x * universalDamping, 
              y: vel2.y * universalDamping, 
              z: vel2.z * universalDamping 
            }, true);
            body2.setAngvel({ 
              x: angVel2.x * universalDamping, 
              y: angVel2.y * universalDamping, 
              z: angVel2.z * universalDamping 
            }, true);
          }
        }
      });
      
      // In ragdoll mode, update wireframe meshes to match their physics bodies
      // Bone center cubes stay as visual markers only
      for (const [name, body] of Object.entries(ragdoll.jointBodies)) {
        const translation = body.translation();
        const rotation = body.rotation();
        
        if (body.bodyType() === RAPIER.RigidBodyType.Dynamic) {
          // Update wireframe mesh (which has the physics body)
          const wireframeMesh = ragdoll.meshes[name];
          if (wireframeMesh) {
            wireframeMesh.position.set(translation.x, translation.y, translation.z);
            wireframeMesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
          }
        }
      }
      
      // Update bone center cubes to follow their corresponding wireframe physics bodies
      const wireframeToCenter = {
        'headWireframe': 'head',
        'torsoWireframe': 'torso', 
        'leftUpperArmWireframe': 'leftUpperArm',
        'rightUpperArmWireframe': 'rightUpperArm',
        'leftLowerArmWireframe': 'leftLowerArm',
        'rightLowerArmWireframe': 'rightLowerArm',
        'leftUpperLegWireframe': 'leftUpperLeg',
        'rightUpperLegWireframe': 'rightUpperLeg',
        'leftLowerLegWireframe': 'leftLowerLeg',
        'rightLowerLegWireframe': 'rightLowerLeg'
      };
      
      for (const [wireframeName, centerName] of Object.entries(wireframeToCenter)) {
        const wireframeBody = ragdoll.jointBodies[wireframeName];
        const centerMesh = ragdoll.meshes[centerName];
        
        if (wireframeBody && centerMesh && wireframeBody.bodyType() === RAPIER.RigidBodyType.Dynamic) {
          const translation = wireframeBody.translation();
          centerMesh.position.set(translation.x, translation.y, translation.z);
        }
      }
      
      // In ragdoll mode, show the FBX model with physics simulation
      if (fbxModel) fbxModel.visible = true;
    } else {
      // In IK mode, show the FBX model with IK animation
      if (fbxModel) fbxModel.visible = true;
    }
    
    renderer.render(scene, camera);
  }
  
  function animateIK() {
    if (!bones || !skeleton || !ikSolver) return;
    
    // Simple breathing/idle animation
    const breathe = Math.sin(animationTime * 2) * 0.05;
    const sway = Math.sin(animationTime * 0.5) * 0.1;
    
    // Move capsule and skinned mesh
    ragdoll.bodies.capsule.setTranslation({ x: sway, y: 3.0 + breathe, z: 0 }, true);
    if (skinnedMesh) {
      skinnedMesh.position.set(sway, 1.0 + breathe, 0);
    }
    
    // Set IK targets for both hands using CCDIKSolver
    // Convert world positions to local positions relative to the skinned mesh
    const localRightTarget = ikTarget.position.clone().sub(skinnedMesh.position);
    const localLeftTarget = ikTargetLeft.position.clone().sub(skinnedMesh.position);
    
    // Update IK targets for the solver
    if (ikSolver.iks && ikSolver.iks.length >= 2) {
      // Right arm target (first IK chain)
      const rightTargetBone = bones[ikSolver.iks[0].target];
      if (rightTargetBone) {
        rightTargetBone.position.copy(localRightTarget);
      }
      
      // Left arm target (second IK chain)  
      const leftTargetBone = bones[ikSolver.iks[1].target];
      if (leftTargetBone) {
        leftTargetBone.position.copy(localLeftTarget);
      }
    }
    
    // Update the IK solver
    ikSolver.update();
    
    // Update animation mixer if playing animations
    if (animationMixer && currentAnimationAction) {
      animationMixer.update(deltaTime);
    }
    
    // Update wireframe meshes to follow bone positions
    updateWireframesToBones();
    
    // Keep character in neutral pose when no animations are playing
    
    // Update FBX model and debug capsule to match physics capsule
    const capsulePos = ragdoll.bodies.capsule.translation();
    if (fbxModel) {
      // Capsule center is at Y=0.75, capsule height=1.5, so bottom is at Y=0
      // Position model feet exactly at ground level (Y=0)
      fbxModel.position.set(capsulePos.x, capsulePos.y - 0.75, capsulePos.z);
    }
    
    // Update debug capsule position
    if (ragdoll.meshes.debugCapsule) {
      ragdoll.meshes.debugCapsule.position.set(capsulePos.x, capsulePos.y, capsulePos.z);
    }
    
    // In IK mode, keep capsule perfectly stable
    if (!isRagdollMode) {
      // Kinematic mode - no physics affecting the capsule
      if (ragdoll.bodies.capsule && ragdoll.bodies.capsule.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
        ragdoll.bodies.capsule.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
      // Keep capsule at exact position - no bouncing
      if (ragdoll.bodies.capsule) {
        ragdoll.bodies.capsule.setTranslation({ x: capsulePos.x, y: 0.75, z: capsulePos.z }, true);
      }
    } else {
      // Ragdoll mode - add damping to reduce physics bouncing
      if (ragdoll.bodies.capsule) {
        ragdoll.bodies.capsule.setLinearDamping(1.2);
        ragdoll.bodies.capsule.setAngularDamping(1.0);
      }
    }
  }
  
  // Handle window resize
  function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
</script>

<svelte:window on:resize={handleResize} />

<div bind:this={container} class="scene-container"></div>

<div class="controls">
  <div class="mode-indicator">
    Mode: {isRagdollMode ? 'Ragdoll' : 'Skinned Mesh IK'}
    {#if !isRagdollMode}
      <br/>Drag red sphere for right arm, blue sphere for left arm
    {/if}
  </div>
  <button on:click={toggleRagdollMode}>
    {isRagdollMode ? 'Switch to IK' : 'Switch to Ragdoll'} (R)
  </button>
  {#if isRagdollMode}
    <button on:click={() => {
      // Push head (main joint) with reduced force
      if (ragdoll.jointBodies.head) {
        ragdoll.jointBodies.head.applyImpulse({ x: Math.random() * 2 - 1, y: 2, z: Math.random() * 2 - 1 }, true);
      }
    }}>
      Push Ragdoll
    </button>
    <button on:click={() => {
      // Add gentle impulse to head
      if (ragdoll.jointBodies.head) {
        ragdoll.jointBodies.head.applyImpulse({ x: Math.random() * 2 - 1, y: 2, z: Math.random() * 2 - 1 }, true);
      }
    }}>
      Push Head
    </button>
  {/if}
  <button on:click={() => location.reload()}>Reset</button>
  
  <!-- IK Animation Test Buttons -->
  {#if !isRagdollMode}
    <div style="margin-top: 15px; padding: 10px; background: rgba(0,0,0,0.7); border-radius: 4px;">
      <div style="color: white; font-size: 12px; margin-bottom: 8px;">IK Animation Tests:</div>
      
      <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px;">
        <button on:click={resetPose} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Reset Pose
        </button>
        
        <button on:click={() => setPose('wave')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Wave
        </button>
        
        <button on:click={() => setPose('reach')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Reach Up
        </button>
        
        <button on:click={() => setPose('surrender')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Surrender
        </button>
      </div>
      
      <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px;">
        <button on:click={() => setPose('tpose')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          T-Pose
        </button>
        
        <button on:click={() => setPose('cross')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Cross Arms
        </button>
        
        <button on:click={() => setPose('point')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Point
        </button>
        
        <button on:click={() => setPose('dance')} style="padding: 4px 8px; font-size: 12px; background: #666;">
          Dance
        </button>
      </div>
      
      <div style="display: flex; gap: 5px;">
        <button on:click={playOriginalAnimation} style="padding: 4px 8px; font-size: 12px; background: #006600;">
          Play Original
        </button>
        
        <button on:click={stopAnimation} style="padding: 4px 8px; font-size: 12px; background: #660000;">
          Stop Anim
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .scene-container {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
  }
  
  .controls {
    position: absolute;
    top: 20px;
    left: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  
  .mode-indicator {
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
  }
  
  button {
    padding: 10px 20px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
  }
  
  button:hover {
    background: #45a049;
  }
</style>
