<script>
  import { onMount } from 'svelte'
  import * as BABYLON from '@babylonjs/core'
  import '@babylonjs/loaders'
  import * as GUI from '@babylonjs/gui'
  
  import { Ragdoll, defaultRagdollConfig } from './lib/ragdoll.js'
  import { setupShooting } from './lib/shooting.js'

  let canvas = $state()
  let engine = $state()
  let scene = $state()
  let ragdoll = $state()
  let inputMap = $state({})
  let isWalking = $state(false)
  let walkDirection = $state(new BABYLON.Vector3())
  let currentAnimationPlaying = $state(null)

  function createButton(id, text, top) {
    const button = GUI.Button.CreateSimpleButton(id, text)
    button.width = 0.2
    button.height = "50px"
    button.color = "white"
    button.background = "green"
    button.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
    button.top = top
    return button
  }

  function setupKeyboardControls(scene, mesh, skeleton, camera) {
    const speed = 0.1

    // Keyboard input handling
    scene.onKeyboardObservable.add((kbInfo) => {
      switch (kbInfo.type) {
        case BABYLON.KeyboardEventTypes.KEYDOWN:
          inputMap[kbInfo.event.key.toLowerCase()] = true
          break
        case BABYLON.KeyboardEventTypes.KEYUP:
          inputMap[kbInfo.event.key.toLowerCase()] = false
          break
      }
    })

    // Movement update loop
    scene.registerBeforeRender(() => {
      if (ragdoll && ragdoll.ragdollMode) return

      const forward = camera.getForwardRay().direction
      const right = BABYLON.Vector3.Cross(forward, BABYLON.Vector3.Up()).normalize()

      walkDirection.setAll(0, 0, 0)
      let moving = false

      if (inputMap['w']) {
        walkDirection.addInPlace(forward)
        moving = true
      }
      if (inputMap['s']) {
        walkDirection.subtractInPlace(forward)
        moving = true
      }
      if (inputMap['a']) {
        walkDirection.subtractInPlace(right)
        moving = true
      }
      if (inputMap['d']) {
        walkDirection.addInPlace(right)
        moving = true
      }

      if (moving) {
        walkDirection.normalize()
        walkDirection.scaleInPlace(speed)
        walkDirection.y = 0
        mesh.position.addInPlace(walkDirection)
        const angle = Math.atan2(walkDirection.x, walkDirection.z)
        mesh.rotation.y = angle

        if (currentAnimationPlaying !== 'walk') {
          scene.stopAllAnimations()
          scene.beginAnimation(skeleton, 0, 100, true, 2.0) // Faster animation for walking feel
          currentAnimationPlaying = 'walk'
          ragdoll.setBoxSyncEnabled(false)
          isWalking = true
        }
      } else if (currentAnimationPlaying !== 'idle') {
        scene.stopAllAnimations()
        scene.beginAnimation(skeleton, 0, 100, true, 1.0) // Normal speed for idle
        currentAnimationPlaying = 'idle'
        ragdoll.setBoxSyncEnabled(true)
        isWalking = false
      }
    })
  }

  function createScene() {
    engine.enableOfflineSupport = false
    BABYLON.Animation.AllowMatricesInterpolation = true
    scene = new BABYLON.Scene(engine)

    scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.OimoJSPlugin())

    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2, 155, new BABYLON.Vector3(0, 40, 0), scene)
    camera.attachControl(canvas, true)
    camera.lowerRadiusLimit = 20
    camera.upperRadiusLimit = 200
    camera.wheelDeltaPercentage = 0.01

    new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene)
    
    BABYLON.SceneLoader.ImportMesh("", "./scenes/Dude/", "dude.babylon", scene, function (newMeshes, _, skeletons) {
      const skeleton = skeletons[0]

      // Ensure materials and textures are properly loaded
      for (const mesh of newMeshes) {
        if (mesh.material) {
          mesh.material.markDirty()
          if (mesh.material.diffuseTexture) {
            mesh.material.diffuseTexture.updateSamplingMode(BABYLON.Texture.LINEAR_LINEAR)
          }
        }
      }

      const helper = scene.createDefaultEnvironment()
      helper.setMainColor(BABYLON.Color3.Gray())
      helper.ground.position.y = 0

      // Create floor physics - positioned at ground level
      const floorBoxSize = 200
      const floorBox = BABYLON.MeshBuilder.CreateBox("FLOOR", { size: floorBoxSize}, scene)
      floorBox.position.y = -floorBoxSize/2 // Position floor physics box properly
      floorBox.physicsImpostor = new BABYLON.PhysicsImpostor(floorBox, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, restitution: 0.2 }, scene)
      floorBox.visibility = 0 // Hide the physics box

      // Initialize ragdoll
      ragdoll = new Ragdoll(skeleton, newMeshes[0], defaultRagdollConfig, false, true, 0, false)
      ragdoll.boneOffsetAxis = new BABYLON.Vector3(1, 0, 0)
      ragdoll.init()
    
      // Check available animations
      console.log("Available animation ranges:", skeleton.getAnimationRanges())
      console.log("Total animation frames:", skeleton.bones[0]._animation?.getKeys()?.length || "No animation data")
      
      // Start with the full animation loop
      scene.beginAnimation(skeleton, 0, 100, true, 1.0)
      currentAnimationPlaying = 'idle'

      // Setup keyboard controls
      setupKeyboardControls(scene, newMeshes[0], skeleton, camera)

      // Setup UI
      const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("button", true, scene)
      const buttonRagdoll = createButton("buttonRagdoll", "Ragdoll on/off", "10px")
      const buttonShowBoxes = createButton("buttonBoxes", "Show/hide boxes", "70px")
      advancedTexture.addControl(buttonRagdoll)
      advancedTexture.addControl(buttonShowBoxes)

      buttonRagdoll.onPointerClickObservable.add(() => {
        if (ragdoll.ragdollMode) {
          ragdoll.ragdollOff()
          ragdoll.setBoxSyncEnabled(true) // Re-enable bone sync
          scene.beginAnimation(skeleton, 0, 19, true, 1.0)
          isWalking = false
        } else {
          scene.stopAnimation(ragdoll.skeleton)
          ragdoll.setBoxSyncEnabled(false) // Disable bone sync in ragdoll mode
          ragdoll.ragdoll()
        }
      })

      buttonShowBoxes.onPointerClickObservable.add(() => {
        ragdoll.toggleShowBoxes()
      })

      // Setup shooting
      setupShooting(scene, camera, ragdoll, newMeshes)

      engine.hideLoadingUI()
    })    
    
    return scene
  }

  onMount(async () => {
    // Import OIMO and the plugin
    const OIMO = await import('oimo')
    await import('@babylonjs/core/Physics/Plugins/oimoJSPlugin')
    
    // Make OIMO globally available
    window.OIMO = OIMO.default || OIMO
    
    engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
    
    createScene()
    
    engine.runRenderLoop(() => {
      scene.render()
    })

    const handleResize = () => {
      engine.resize()
    }
    
    window.addEventListener("resize", handleResize)

    return () => {
      window.removeEventListener("resize", handleResize)
      if (ragdoll) {
        ragdoll.dispose()
      }
      if (engine) {
        engine.dispose()
      }
    }
  })
</script>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }

  canvas {
    width: 100%;
    height: 100vh;
    display: block;
  }
</style>

<canvas bind:this={canvas}></canvas>