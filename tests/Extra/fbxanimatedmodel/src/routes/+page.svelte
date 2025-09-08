<script>
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CCDIKSolver } from 'three/examples/jsm/animation/CCDIKSolver.js'
import { onMount } from 'svelte'
import RAPIER from '@dimforge/rapier3d-compat'

let canvas = $state()
let scene = $state()
let camera = $state()
let renderer = $state()
let mixer = $state()
let animations = $state([])
let currentAction = $state()
let model = $state()
let isLoading = $state(true)
let world = $state()
let skinnedMesh = $state()
let skeleton = $state()
let bones = $state([])
let joints = $state([])
let currentMode = $state('animation') // 'animation', 'ik', 'ragdoll'
let rapierLoaded = $state(false)
let bodyParts = $state({})
let bodyPartRigidBodies = $state({})
let modelScale = 1.0
let ikSolver = $state()
let ikTargets = $state([])

let clock = new THREE.Clock()
let animationFrame
let originalBoneMatrices = new Map()
let savedBoneState = new Map()

function initThreeJS() {
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x222222)
  
  camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.1, 1000)
  camera.position.set(0, 2, 5)
  
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(800, 600)
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  
  const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
  scene.add(ambientLight)
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(10, 10, 5)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  scene.add(directionalLight)
  
  // Add visual ground plane
  const groundGeometry = new THREE.PlaneGeometry(10, 10)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 })
  const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.y = -2
  groundMesh.receiveShadow = true
  scene.add(groundMesh)
}

function loadModel() {
  const loader = new GLTFLoader()
  
  loader.load(
    '/model.glb',
    (gltf) => {
      model = gltf.scene
      scene.add(model)
      
      const box = new THREE.Box3().setFromObject(model)
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      
      const maxDim = Math.max(size.x, size.y, size.z)
      modelScale = 2 / maxDim
      model.scale.multiplyScalar(modelScale)
      
      model.position.sub(center.multiplyScalar(modelScale))
      
      animations = gltf.animations
      if (animations.length > 0) {
        mixer = new THREE.AnimationMixer(model)
        playAnimation(0)
      }
      
      // Enable shadows on the model
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true
          child.receiveShadow = true
        }
      })
      
      setupSkinnedMesh()
      isLoading = false
    },
    undefined,
    (error) => {
      console.error('Error loading model:', error)
      isLoading = false
    }
  )
}

async function initPhysics() {
  await RAPIER.init()
  world = new RAPIER.World(new RAPIER.Vector3(0.0, -9.81, 0.0))
  
  // Create ground plane physics body
  const groundBodyDesc = RAPIER.RigidBodyDesc.fixed()
    .setTranslation(0.0, -2.0, 0.0)
  const groundBody = world.createRigidBody(groundBodyDesc)
  
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(5.0, 0.1, 5.0)
  world.createCollider(groundColliderDesc, groundBody)
  
  rapierLoaded = true
}

function setupSkinnedMesh() {
  model.traverse((child) => {
    if (child.isSkinnedMesh) {
      skinnedMesh = child
      skeleton = child.skeleton
      bones = skeleton.bones
      
      // Store original bone positions, rotations, and scales
      bones.forEach(bone => {
        originalBoneMatrices.set(bone.uuid, {
          position: bone.position.clone(),
          quaternion: bone.quaternion.clone(),
          scale: bone.scale.clone(),
          matrixWorld: bone.matrixWorld.clone()
        })
      })
      
      // Identify anatomical body parts
      identifyBodyParts()
      
      // Setup IK system
      setupIK()
      
      console.log(`Found skinned mesh with ${bones.length} bones`)
      console.log('Body parts:', bodyParts)
      return
    }
  })
}

function identifyBodyParts() {
  // Reset bodyParts to only the essential ones
  bodyParts = {
    torso: null,
    leftUpperArm: null,
    rightUpperArm: null
  }
  
  console.log('=== SIMPLIFIED BONE IDENTIFICATION ===')
  
  // Step 1: Find torso/spine - this is the most important
  bodyParts.torso = bones.find(bone => {
    const name = bone.name.toLowerCase()
    // Look for very specific spine or torso bones, avoid detailed spine segments
    return (name === 'spine' || name === 'torso' || name === 'root' || 
            name === 'spine1' || name === 'spine_01' || name === 'mixamorig:spine' ||
            name.includes('root') || name.includes('hip'))
  })
  
  console.log('Found torso bone:', bodyParts.torso ? bodyParts.torso.name : 'NONE')
  
  // Step 2: Find ONLY the main arm bones - avoid fingers, hands, detailed segments
  bones.forEach(bone => {
    const name = bone.name.toLowerCase()
    
    // Left upper arm - be very specific to avoid finger bones
    if ((name.includes('left') || name.includes('l_')) && 
        name.includes('arm') && !name.includes('lower') && !name.includes('fore') &&
        !name.includes('hand') && !name.includes('finger') && !name.includes('thumb')) {
      if (!bodyParts.leftUpperArm) {
        bodyParts.leftUpperArm = bone
        console.log('Found left upper arm:', bone.name)
      }
    }
    
    // Right upper arm - be very specific to avoid finger bones  
    else if ((name.includes('right') || name.includes('r_')) && 
             name.includes('arm') && !name.includes('lower') && !name.includes('fore') &&
             !name.includes('hand') && !name.includes('finger') && !name.includes('thumb')) {
      if (!bodyParts.rightUpperArm) {
        bodyParts.rightUpperArm = bone
        console.log('Found right upper arm:', bone.name)
      }
    }
  })
  
  // If no arms found, try shoulder bones as fallback
  if (!bodyParts.leftUpperArm || !bodyParts.rightUpperArm) {
    bones.forEach(bone => {
      const name = bone.name.toLowerCase()
      
      if (!bodyParts.leftUpperArm && (name.includes('left') || name.includes('l_')) && 
          name.includes('shoulder')) {
        bodyParts.leftUpperArm = bone
        console.log('Using left shoulder as arm:', bone.name)
      }
      
      if (!bodyParts.rightUpperArm && (name.includes('right') || name.includes('r_')) && 
          name.includes('shoulder')) {
        bodyParts.rightUpperArm = bone
        console.log('Using right shoulder as arm:', bone.name)
      }
    })
  }
  
  console.log('Final body parts:')
  console.log('- Torso:', bodyParts.torso ? bodyParts.torso.name : 'MISSING')
  console.log('- Left arm:', bodyParts.leftUpperArm ? bodyParts.leftUpperArm.name : 'MISSING')
  console.log('- Right arm:', bodyParts.rightUpperArm ? bodyParts.rightUpperArm.name : 'MISSING')
}

function setupIK() {
  if (!skinnedMesh) {
    console.warn('No skinned mesh found for IK setup')
    return
  }
  
  console.log('=== SETTING UP IK SYSTEM ===')
  console.log('Available body parts:', Object.keys(bodyParts).filter(key => bodyParts[key]).length)
  console.log('Total bones in skeleton:', bones.length)
  
  // Create visual IK targets (spheres for hands)
  const leftHandTarget = new THREE.Object3D()
  const rightHandTarget = new THREE.Object3D()
  
  // Create visible spheres for IK targets (bigger for easier interaction)
  const targetGeometry = new THREE.SphereGeometry(0.1 * modelScale, 12, 12)
  const leftTargetMaterial = new THREE.MeshLambertMaterial({ 
    color: 0xff3333, 
    transparent: true, 
    opacity: 0.9
  })
  const rightTargetMaterial = new THREE.MeshLambertMaterial({ 
    color: 0x3333ff, 
    transparent: true, 
    opacity: 0.9
  })
  
  const leftSphere = new THREE.Mesh(targetGeometry, leftTargetMaterial)
  const rightSphere = new THREE.Mesh(targetGeometry, rightTargetMaterial)
  
  leftHandTarget.add(leftSphere)
  rightHandTarget.add(rightSphere)
  
  // Position targets near the arm bones
  if (bodyParts.leftUpperArm) {
    bodyParts.leftUpperArm.getWorldPosition(leftHandTarget.position)
    leftHandTarget.position.x -= 0.4 * modelScale // Move target away from body
    leftHandTarget.position.y += 0.1 * modelScale
  } else {
    leftHandTarget.position.set(-0.5 * modelScale, 0.5 * modelScale, 0.2 * modelScale)
  }
  
  if (bodyParts.rightUpperArm) {
    bodyParts.rightUpperArm.getWorldPosition(rightHandTarget.position)
    rightHandTarget.position.x += 0.4 * modelScale // Move target away from body
    rightHandTarget.position.y += 0.1 * modelScale
  } else {
    rightHandTarget.position.set(0.5 * modelScale, 0.5 * modelScale, 0.2 * modelScale)
  }
  
  // Add targets to scene but hide them initially (only show in IK mode)
  leftHandTarget.visible = false
  rightHandTarget.visible = false
  scene.add(leftHandTarget)
  scene.add(rightHandTarget)
  
  // Create simple IK chains with just the main arm bones
  const ikChains = []
  
  console.log('=== CREATING SIMPLIFIED IK CHAINS ===')
  
  // Create simple left arm IK - just use the main arm bone itself
  if (bodyParts.leftUpperArm) {
    const armIndex = bones.findIndex(b => b === bodyParts.leftUpperArm)
    
    if (armIndex !== -1) {
      console.log(`Creating simple left arm IK: ${bodyParts.leftUpperArm.name}`)
      ikChains.push({
        target: 0, // Left hand target
        effector: armIndex,
        links: [
          { 
            index: armIndex,
            limitation: new THREE.Vector3(1, 1, 1)
          }
        ]
      })
    }
  }
  
  // Create simple right arm IK - just use the main arm bone itself  
  if (bodyParts.rightUpperArm) {
    const armIndex = bones.findIndex(b => b === bodyParts.rightUpperArm)
    
    if (armIndex !== -1) {
      console.log(`Creating simple right arm IK: ${bodyParts.rightUpperArm.name}`)
      ikChains.push({
        target: 1, // Right hand target
        effector: armIndex,
        links: [
          { 
            index: armIndex,
            limitation: new THREE.Vector3(1, 1, 1)
          }
        ]
      })
    }
  }
  
  console.log(`Total IK chains created: ${ikChains.length}`)
  
  // Create IK solver with proper configuration
  if (ikChains.length > 0) {
    console.log(`Creating IK solver with ${ikChains.length} chains`)
    console.log('IK chains configuration:', ikChains)
    
    try {
      // Validate IK chains before creating solver
      const validChains = ikChains.filter(chain => {
        const hasValidLinks = chain.links && chain.links.length > 0
        const hasValidIndices = chain.links.every(link => 
          link.index !== undefined && link.index >= 0 && link.index < bones.length
        )
        if (!hasValidLinks || !hasValidIndices) {
          console.warn('Invalid IK chain found:', chain)
          return false
        }
        return true
      })
      
      if (validChains.length > 0) {
        console.log(`Creating IK solver with ${validChains.length} valid chains`)
        ikSolver = new CCDIKSolver(skinnedMesh, validChains)
        ikTargets = [leftHandTarget, rightHandTarget]
        console.log('IK solver created successfully')
        
        // Test the solver
        if (ikSolver.update) {
          console.log('IK solver has update method - ready to use')
        } else {
          console.warn('IK solver missing update method')
        }
      } else {
        console.warn('No valid IK chains after validation')
        ikSolver = null
      }
    } catch (error) {
      console.error('Failed to create IK solver:', error)
      console.error('Error details:', error.message, error.stack)
      ikSolver = null
    }
  } else {
    console.warn('No IK chains could be created - check bone identification')
    
    // As a last resort, try to create a simple test chain with first two bones
    if (bones.length >= 2) {
      console.log('Attempting last-resort IK chain with first two bones...')
      try {
        const testChain = [{
          target: 0,
          effector: 1,
          links: [
            { index: 0, limitation: new THREE.Vector3(1, 1, 1) },
            { index: 1, limitation: new THREE.Vector3(1, 1, 1) }
          ]
        }]
        
        ikSolver = new CCDIKSolver(skinnedMesh, testChain)
        ikTargets = [leftHandTarget]
        console.log('Emergency IK solver created with first two bones')
      } catch (error) {
        console.error('Even emergency IK solver failed:', error)
        ikSolver = null
      }
    }
  }
}

function createRagdoll() {
  if (!rapierLoaded || !skeleton) return
  
  bodyPartRigidBodies = {}
  joints = []
  
  // Update bone world matrices first
  skeleton.calculateInverses()
  model.updateMatrixWorld(true)
  
  // Create physics bodies for each body part
  Object.entries(bodyParts).forEach(([partName, bone]) => {
    if (bone) {
      const worldPosition = new THREE.Vector3()
      const worldQuaternion = new THREE.Quaternion()
      const worldScale = new THREE.Vector3()
      
      bone.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale)
      
      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPosition.x, worldPosition.y, worldPosition.z)
        .setRotation({ x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w })
        .setLinearDamping(0.5) // Add damping to reduce chaotic movement
        .setAngularDamping(0.5)
      
      const rigidBody = world.createRigidBody(rigidBodyDesc)
      
      // Create smaller, more conservative colliders
      const colliderDesc = createBodyPartCollider(partName)
      world.createCollider(colliderDesc, rigidBody)
      
      bodyPartRigidBodies[partName] = rigidBody
    }
  })
  
  // Create joints with proper anatomical limits
  createAnatomicalJoints()
}

function createBodyPartCollider(partName) {
  // Scale colliders based on model scale  
  const scale = modelScale
  
  switch (partName) {
    case 'torso':
      return RAPIER.ColliderDesc.cuboid(0.15 * scale, 0.25 * scale, 0.1 * scale)
    case 'leftUpperArm':
    case 'rightUpperArm':
      return RAPIER.ColliderDesc.cuboid(0.05 * scale, 0.15 * scale, 0.05 * scale)
    default:
      return RAPIER.ColliderDesc.cuboid(0.04 * scale, 0.04 * scale, 0.04 * scale)
  }
}

function createAnatomicalJoints() {
  // Scale distances based on model scale
  const scale = modelScale
  
  console.log('=== CREATING SIMPLIFIED RAGDOLL JOINTS ===')
  
  // Only create simple connections between main body parts
  const jointConnections = [
    // Arms to torso (shoulders) - only if these body parts exist
    { parent: 'torso', child: 'leftUpperArm', distance: 0.25 * scale },
    { parent: 'torso', child: 'rightUpperArm', distance: 0.25 * scale }
  ]
  
  jointConnections.forEach(connection => {
    const parentBody = bodyPartRigidBodies[connection.parent]
    const childBody = bodyPartRigidBodies[connection.child]
    
    if (parentBody && childBody) {
      console.log(`Creating joint: ${connection.parent} -> ${connection.child}`)
      createLimitedJoint(parentBody, childBody)
      createDistanceConstraint(parentBody, childBody, connection.distance)
    } else {
      console.log(`Skipping joint: ${connection.parent} -> ${connection.child} (missing bodies)`)
    }
  })
  
  console.log(`Total joints created: ${joints.length}`)
}

function createLimitedJoint(parentBody, childBody) {
  // Use a simple ball joint (spherical) for stable connections
  const anchor1 = new RAPIER.Vector3(0.0, 0.0, 0.0)
  const anchor2 = new RAPIER.Vector3(0.0, 0.0, 0.0)
  
  // Create spherical joint with correct RAPIER API
  try {
    const jointDesc = RAPIER.JointDesc.ball(anchor1, anchor2)
    const joint = world.createImpulseJoint(jointDesc, parentBody, childBody, true)
    joints.push(joint)
  } catch (error) {
    console.warn('Failed to create ball joint:', error)
    // Fallback: create a simple connection without joint constraints
  }
}

function createDistanceConstraint(parentBody, childBody, distance) {
  // Simplified rope joint to prevent excessive stretching
  const anchor1 = new RAPIER.Vector3(0.0, 0.0, 0.0)
  const anchor2 = new RAPIER.Vector3(0.0, 0.0, 0.0)
  
  try {
    // Create a rope joint with maximum distance using correct API
    const jointDesc = RAPIER.JointDesc.rope(distance, anchor1, anchor2)
    const ropeJoint = world.createImpulseJoint(jointDesc, parentBody, childBody, true)
    joints.push(ropeJoint)
  } catch (error) {
    console.warn('Rope joint creation failed:', error)
    // Fallback: just use the ball joint without distance constraint
  }
}

function saveBoneState() {
  // Save current bone transformations before ragdoll
  if (!bones) return
  
  bones.forEach(bone => {
    savedBoneState.set(bone.uuid, {
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone()
    })
  })
  
  // Also update world matrices to ensure accuracy
  if (model) {
    model.updateMatrixWorld(true)
  }
  if (skeleton) {
    skeleton.calculateInverses()
  }
}

function restoreBoneState() {
  // Restore bone transformations after ragdoll
  if (!bones) return
  
  bones.forEach(bone => {
    const saved = savedBoneState.get(bone.uuid)
    const original = originalBoneMatrices.get(bone.uuid)
    
    if (saved) {
      // Use saved state from before mode switch
      bone.position.copy(saved.position)
      bone.quaternion.copy(saved.quaternion)
      bone.scale.copy(saved.scale)
    } else if (original) {
      // Fallback to original bind pose
      bone.position.copy(original.position)
      bone.quaternion.copy(original.quaternion)
      bone.scale.copy(original.scale)
    }
  })
  
  // Force complete matrix update
  if (model) {
    model.updateMatrixWorld(true)
  }
  if (skeleton) {
    skeleton.calculateInverses()
  }
  if (skinnedMesh) {
    skinnedMesh.updateMatrixWorld(true)
  }
}

function toggleMode() {
  if (currentMode === 'animation') {
    switchToIKMode()
  } else if (currentMode === 'ik') {
    switchToRagdollMode()
  } else if (currentMode === 'ragdoll') {
    switchToAnimationMode()
  }
}

function switchToAnimationMode() {
  console.log('Switching to Animation mode')
  
  // Clean up ragdoll if active
  if (currentMode === 'ragdoll') {
    cleanupRagdoll()
  }
  
  // Hide IK targets in animation mode
  if (ikTargets) {
    ikTargets.forEach(target => {
      if (target) target.visible = false
    })
  }
  
  // Always restore bone state when entering animation mode
  restoreBoneState()
  
  currentMode = 'animation'
  
  // Start animations
  if (model && animations.length > 0) {
    mixer = new THREE.AnimationMixer(model)
    playAnimation(0)
  }
}

function switchToIKMode() {
  console.log('Switching to IK mode')
  
  // Clean up ragdoll if active
  if (currentMode === 'ragdoll') {
    cleanupRagdoll()
  }
  
  // Save current bone state (only from animation mode)
  if (currentMode === 'animation') {
    saveBoneState()
  }
  
  // Stop animations
  if (currentAction) {
    currentAction.stop()
    currentAction = null
  }
  if (mixer) {
    mixer.stopAllAction()
    mixer.uncacheRoot(model)
  }
  
  // Show IK targets only in IK mode
  if (ikTargets) {
    ikTargets.forEach(target => {
      if (target) target.visible = true
    })
  }
  
  currentMode = 'ik'
  
  // Reset bone state to neutral before IK
  restoreBoneState()
}

function switchToRagdollMode() {
  if (!rapierLoaded) {
    console.warn('Physics not ready, skipping ragdoll mode')
    switchToAnimationMode()
    return
  }
  
  console.log('Switching to Ragdoll mode')
  
  // Hide IK targets in ragdoll mode
  if (ikTargets) {
    ikTargets.forEach(target => {
      if (target) target.visible = false
    })
  }
  
  // Save current bone state if not already saved
  if (currentMode === 'animation') {
    saveBoneState()
  }
  
  // Stop animations if running
  if (currentAction) {
    currentAction.stop()
    currentAction = null
  }
  if (mixer) {
    mixer.stopAllAction()
    mixer.uncacheRoot(model)
  }
  
  currentMode = 'ragdoll'
  createRagdoll()
}

function cleanupRagdoll() {
  // Remove rigid bodies
  Object.values(bodyPartRigidBodies).forEach(body => {
    if (body) world.removeRigidBody(body)
  })
  
  // Remove joints
  joints.forEach(joint => {
    if (joint) world.removeImpulseJoint(joint, true)
  })
  
  bodyPartRigidBodies = {}
  joints = []
}

function updateRagdoll() {
  if (currentMode !== 'ragdoll' || !world) return
  
  world.step()
  
  // Apply physics transforms very conservatively to minimize distortion
  Object.entries(bodyParts).forEach(([partName, bone]) => {
    const rigidBody = bodyPartRigidBodies[partName]
    
    if (bone && rigidBody) {
      const translation = rigidBody.translation()
      const rotation = rigidBody.rotation()
      
      const targetQuaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
      
      // Apply rotations very gently to prevent accumulative distortion
      bone.quaternion.slerp(targetQuaternion, 0.3)
      
      // Only torso gets position updates to maintain overall structure
      if (partName === 'torso') {
        const targetPosition = new THREE.Vector3(translation.x, translation.y, translation.z)
        bone.position.lerp(targetPosition, 0.2)
      }
    }
  })
}

function playAnimation(index) {
  // Only play animations in animation mode
  if (currentMode !== 'animation') return
  if (!mixer || !animations[index]) return
  
  if (currentAction) {
    currentAction.fadeOut(0.2)
  }
  
  currentAction = mixer.clipAction(animations[index])
  currentAction.reset().fadeIn(0.2).play()
}

function animate() {
  animationFrame = requestAnimationFrame(animate)
  
  const delta = clock.getDelta()
  
  if (currentMode === 'animation') {
    // ONLY update animations in animation mode - NO IK!
    if (mixer) {
      mixer.update(delta)
    }
    // IK should NOT run in animation mode
  } else if (currentMode === 'ik') {
    // Only update IK in IK mode, no animations
    if (ikSolver) {
      ikSolver.update()
    }
  } else if (currentMode === 'ragdoll') {
    // Only update ragdoll physics
    updateRagdoll()
  }
  
  if (renderer && scene && camera) {
    renderer.render(scene, camera)
  }
}

let isDragging = false
let previousMousePosition = { x: 0, y: 0 }
let draggedIKTarget = null
let raycaster = new THREE.Raycaster()
let mouseVector = new THREE.Vector2()

function onMouseDown(event) {
  // Check if we're clicking on an IK target first (in IK mode)
  if (currentMode === 'ik' && ikTargets && ikTargets.length > 0) {
    const rect = canvas.getBoundingClientRect()
    mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    
    raycaster.setFromCamera(mouseVector, camera)
    const intersects = raycaster.intersectObjects(ikTargets, true)
    
    if (intersects.length > 0) {
      // Found an IK target
      draggedIKTarget = intersects[0].object.parent
      console.log('Dragging IK target:', draggedIKTarget)
      event.preventDefault()
      return
    }
  }
  
  // Disable model rotation dragging - only allow in animation mode
  if (currentMode === 'animation') {
    isDragging = true
    previousMousePosition = { x: event.clientX, y: event.clientY }
  }
}

function onMouseMove(event) {
  // Handle IK target dragging
  if (draggedIKTarget) {
    const rect = canvas.getBoundingClientRect()
    mouseVector.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouseVector.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    
    raycaster.setFromCamera(mouseVector, camera)
    
    // Project mouse position onto a plane at the target's current distance
    const distance = camera.position.distanceTo(draggedIKTarget.position)
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -distance + 2) // Offset for better control
    const intersection = new THREE.Vector3()
    
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      draggedIKTarget.position.copy(intersection)
    } else {
      // Fallback: move along ray at fixed distance
      const newPosition = new THREE.Vector3()
      newPosition.copy(raycaster.ray.direction)
      newPosition.multiplyScalar(distance * 0.8) // Slightly closer for better control
      newPosition.add(raycaster.ray.origin)
      draggedIKTarget.position.copy(newPosition)
    }
    
    event.preventDefault()
    return
  }
  
  // Model rotation behavior (only in animation mode)
  if (!isDragging || !model || currentMode !== 'animation') return
  
  const deltaMove = {
    x: event.clientX - previousMousePosition.x,
    y: event.clientY - previousMousePosition.y
  }
  
  model.rotation.y += deltaMove.x * 0.01
  model.rotation.x += deltaMove.y * 0.01
  
  previousMousePosition = { x: event.clientX, y: event.clientY }
}

function onMouseUp() {
  isDragging = false
  draggedIKTarget = null
}

function onWheel(event) {
  if (!camera) return
  
  const delta = event.deltaY * 0.01
  camera.position.z += delta
  camera.position.z = Math.max(1, Math.min(10, camera.position.z))
}

function onKeyDown(event) {
  if (event.code === 'KeyR') {
    toggleMode()
  }
}

onMount(async () => {
  await initPhysics()
  initThreeJS()
  loadModel()
  animate()
  
  window.addEventListener('keydown', onKeyDown)
  
  return () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
    }
    window.removeEventListener('keydown', onKeyDown)
  }
})
</script>

<svelte:head>
  <title>3D Model Viewer</title>
</svelte:head>

<main>
  <h1>3D Model Viewer</h1>
  
  <div class="viewer">
    <canvas 
      bind:this={canvas}
      onmousedown={onMouseDown}
      onmousemove={onMouseMove}
      onmouseup={onMouseUp}
      onwheel={onWheel}
    ></canvas>
    
    {#if isLoading}
      <div class="loading">Loading model...</div>
    {/if}
    
    <div class="mode-indicator">
      Mode: {currentMode === 'animation' ? 'Animation' : currentMode === 'ik' ? 'Skinned Mesh IK' : 'Ragdoll Physics'}
      {#if currentMode === 'ik'}
        <br>
        <strong>Click and drag</strong> red sphere (right arm) or blue sphere (left arm)
      {:else if currentMode === 'animation'}
        <br>
        Drag to rotate model | Scroll to zoom
      {:else}
        <br>
        Scroll to zoom
      {/if}
      <br>
      Press 'R' to cycle modes
    </div>
    
    {#if animations.length > 0 && currentMode === 'animation'}
      <div class="controls">
        <h4>Animations</h4>
        {#each animations as animation, index}
          <button onclick={() => playAnimation(index)}>
            {animation.name || `Animation ${index + 1}`}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</main>

<style>
  main {
    padding: 20px;
    font-family: system-ui, sans-serif;
    text-align: center;
  }
  
  .viewer {
    position: relative;
    display: inline-block;
  }
  
  canvas {
    border: 1px solid #ccc;
    cursor: grab;
  }
  
  canvas:active {
    cursor: grabbing;
  }
  
  .loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    padding: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    border-radius: 4px;
  }
  
  .mode-indicator {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 15px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1.4;
  }
  
  .controls {
    position: absolute;
    top: 100px;
    right: 10px;
    background: rgba(0, 0, 0, 0.8);
    padding: 10px;
    border-radius: 4px;
    color: white;
  }
  
  .controls button {
    display: block;
    width: 100%;
    margin-bottom: 5px;
    padding: 8px 12px;
    background: #007acc;
    color: white;
    border: none;
    border-radius: 3px;
    cursor: pointer;
  }
  
  .controls button:hover {
    background: #005999;
  }
</style>