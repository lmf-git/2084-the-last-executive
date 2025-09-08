<script>
  import { onMount } from 'svelte'
  import * as BABYLON from '@babylonjs/core'
  import { SceneLoader } from '@babylonjs/core'
  import * as GUI from '@babylonjs/gui'
  import '@babylonjs/loaders' // Import loaders to support .babylon files
  import * as OIMO from 'oimo'
  
  // Make OIMO available globally for Babylon.js
  window.OIMO = OIMO

  let canvas
  let engine, scene, camera
  let ragdoll

  onMount(() => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    
    engine = new BABYLON.Engine(canvas, true)
    
    const createScene = () => {
      engine.enableOfflineSupport = false
      BABYLON.Animation.AllowMatricesInterpolation = true
      scene = new BABYLON.Scene(engine)

      // Enable physics with Oimo
      const physicsPlugin = new BABYLON.OimoJSPlugin()
      scene.enablePhysics(new BABYLON.Vector3(0, -9, 0), physicsPlugin)

      // Camera
      camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 2, 155, new BABYLON.Vector3(0, 40, 0), scene)
      camera.attachControl(canvas, true)
      camera.lowerRadiusLimit = 20
      camera.upperRadiusLimit = 200
      camera.wheelDeltaPercentage = 0.01

      // Lighting
      const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene)

      // GUI
      const advancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI("button", true, scene)
      
      function createButton(id, text, top) {
        let button = GUI.Button.CreateSimpleButton(id, text)
        button.width = 0.2
        button.height = "50px"
        button.color = "white"
        button.background = "green"
        button.verticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
        button.top = top
        return button
      }

      const buttonRagdoll = createButton("buttonRagdoll", "Ragdoll on/off", "10px")
      const buttonShowBoxes = createButton("buttonBoxes", "Show/hide boxes", "70px")
      advancedTexture.addControl(buttonRagdoll)
      advancedTexture.addControl(buttonShowBoxes)

      // Create a test box to verify the scene is working
      const testBox = BABYLON.MeshBuilder.CreateBox("testBox", {size: 2}, scene)
      testBox.position.y = 1
      testBox.material = new BABYLON.StandardMaterial("testMat", scene)
      testBox.material.diffuseColor = new BABYLON.Color3(1, 0, 0)
      
      console.log("Test box created, attempting to load dude.babylon...")
      
      // Load dude model with correct path and bone configuration
      BABYLON.SceneLoader.ImportMesh("", "./", "dude.babylon", scene, (newMeshes, particleSystems, skeletons) => {
        console.log("Dude model loaded successfully")
        const skeleton = skeletons[0]

        const helper = scene.createDefaultEnvironment()
        helper.setMainColor(BABYLON.Color3.Gray())
        helper.ground.position.y += 0.01

        const floorBoxSize = 200
        let floorBox = BABYLON.MeshBuilder.CreateBox("FLOOR", { size: floorBoxSize}, scene)
        floorBox.position.y = -floorBoxSize/2
        floorBox.physicsImpostor = new BABYLON.PhysicsImpostor(floorBox, BABYLON.PhysicsImpostor.BoxImpostor, { mass: 0, restitution: 0 }, scene)

        // Fetch and eval ragdoll.js
        fetch("https://raw.githubusercontent.com/jongomez/ragdoll.js/main/ragdoll.js")
        .then((response) => response.text())
        .then((text) => {
          eval(text)
          
          let config = [
            { bones: ["bone0"], size: 1}, // root - near the hips
            { bones: ["bone1"], size: 7, min: 1, max: 1}, // hips - near the root. min = 1 and max = 1 will make the boxes stand still - like a lock joint. 
            { bones: ["bone5"], size: 6, min: -20, max: 20}, // chest
            { bones: ["bone7"], size: 6, boxOffset: 4, min: -45, max: 45}, // head
            { bones: ["bone13", "bone32"], size: 6, boxOffset: 6, rotationAxis: BABYLON.Axis.Z, min: -30, max: 30}, // upper arms
            { bones: ["bone14", "bone33"], size: 6, boxOffset: 6, rotationAxis: BABYLON.Axis.Y, min: -30, max: 30}, // forearms
            { bones: ["bone50", "bone54"], size: 8, boxOffset: 8, rotationAxis: BABYLON.Axis.Z, min: -40, max: 40}, // thighs
            { bones: ["bone51", "bone55"], size: 8, boxOffset: 8}, // shins
            { bones: ["bone52", "bone56"], size: 6, min: 1, max: 1} // feet. min = 1 and max = 1 will make the boxes stand still - like a lock joint.
          ]

          const jointCollisions = false
          const showBoxes = true
          const mainPivotSphereSize = 0
          const disableBoxBoneSync = false
          
          ragdoll = new Ragdoll(skeleton, newMeshes[0], config, jointCollisions, showBoxes, mainPivotSphereSize, disableBoxBoneSync)
          ragdoll.boneOffsetAxis = new BABYLON.Vector3(1,0,0)
          ragdoll.init()

          let animationFunc = () => {scene.beginAnimation(skeletons[0], 0, 100, true, 1.0)}
          animationFunc()

          buttonRagdoll.onPointerClickObservable.add(() => {
            if (ragdoll.ragdollMode) {
              animationFunc()
              ragdoll.ragdollOff()
            } else {
              scene.stopAnimation(ragdoll.skeleton)
              ragdoll.ragdoll()
            }
          })

          buttonShowBoxes.onPointerClickObservable.add(() => {
            ragdoll.toggleShowBoxes()
          })

          engine.hideLoadingUI()
        })
      })

      return scene
    }

    scene = createScene()

    // Render loop
    engine.runRenderLoop(() => {
      scene.render()
    })

    // Handle resize
    const handleResize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      engine.resize()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      engine.dispose()
    }
  })
</script>

<main>
  <canvas bind:this={canvas}></canvas>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #000;
  }

  canvas {
    width: 100vw;
    height: 100vh;
    display: block;
  }
</style>