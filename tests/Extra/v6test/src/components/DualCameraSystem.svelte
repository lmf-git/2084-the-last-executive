<script>
  import { onMount } from 'svelte'
  import * as THREE from 'three'
  import { gameState, translateProxyToReal } from '../stores/gameState.svelte.js'
  import { physicsManager } from '../physics/PhysicsManager.js'
  
  let realWorldCanvas = $state()
  let interiorCanvas = $state()
  let realWorldScene, interiorScene
  let realWorldCamera, interiorCamera
  let realWorldRenderer, interiorRenderer
  let animationId
  
  let playerMesh, playerProxyMesh
  let shipMeshes = new Map()
  let stationMeshes = new Map()
  let initialized = $state(false)
  let physicsReady = $state(false)
  
  onMount(async () => {
    console.log('Initializing physics...')
    await physicsManager.init()
    physicsReady = true
    console.log('Physics ready')
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId)
      }
      realWorldRenderer?.dispose()
      interiorRenderer?.dispose()
      physicsManager.dispose()
    }
  })

  // Reactive initialization when both physics and canvases are ready
  $effect(() => {
    if (physicsReady && realWorldCanvas && interiorCanvas && !initialized) {
      console.log('Initializing scenes...')
      
      try {
        setupRealWorldScene()
        console.log('Real world scene setup')
        
        setupInteriorScene()
        console.log('Interior scene setup')
        
        initialized = true
        animate()
        console.log('Animation started')
      } catch (error) {
        console.error('Failed to initialize scenes:', error)
      }
    }
  })
  
  function setupRealWorldScene() {
    realWorldScene = new THREE.Scene()
    realWorldScene.background = new THREE.Color(0x000011)
    
    realWorldCamera = new THREE.PerspectiveCamera(75, 400/300, 0.1, 1000)
    realWorldCamera.position.set(0, 10, 15)
    realWorldCamera.lookAt(0, 0, 0)
    
    realWorldRenderer = new THREE.WebGLRenderer({ canvas: realWorldCanvas, antialias: true })
    realWorldRenderer.setSize(400, 300)
    realWorldRenderer.shadowMap.enabled = true
    realWorldRenderer.shadowMap.type = THREE.PCFSoftShadowMap
    
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5)
    realWorldScene.add(ambientLight)
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 5, 5)
    realWorldScene.add(directionalLight)
    
    createPlayerMesh()
    createSpaceObjects()
  }
  
  function setupInteriorScene() {
    interiorScene = new THREE.Scene()
    interiorScene.background = new THREE.Color(0x222222)
    
    interiorCamera = new THREE.PerspectiveCamera(75, 400/300, 0.1, 100)
    interiorCamera.position.set(0, 3, 8)
    interiorCamera.lookAt(0, 2, 0)
    
    interiorRenderer = new THREE.WebGLRenderer({ canvas: interiorCanvas, antialias: true })
    interiorRenderer.setSize(400, 300)
    interiorRenderer.shadowMap.enabled = true
    interiorRenderer.shadowMap.type = THREE.PCFSoftShadowMap
    
    const ambientLight = new THREE.AmbientLight(0x404040, 0.8)
    interiorScene.add(ambientLight)
    
    const pointLight = new THREE.PointLight(0xffffff, 1, 50)
    pointLight.position.set(0, 5, 0)
    interiorScene.add(pointLight)
    
    createProxyPlayerMesh()
  }
  
  function createPlayerMesh() {
    const geometry = new THREE.SphereGeometry(0.5, 16, 16)
    const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 })
    playerMesh = new THREE.Mesh(geometry, material)
    realWorldScene.add(playerMesh)
  }
  
  function createProxyPlayerMesh() {
    const geometry = new THREE.SphereGeometry(0.3, 16, 16)
    const material = new THREE.MeshPhongMaterial({ 
      color: gameState.player.isKinematic ? 0x0088ff : 0x00ff00 
    })
    playerProxyMesh = new THREE.Mesh(geometry, material)
    interiorScene.add(playerProxyMesh)
  }
  
  function createSpaceObjects() {
    const shipGeometry = new THREE.BoxGeometry(4, 2, 8)
    const shipMaterial = new THREE.MeshPhongMaterial({ color: 0x888888 })
    
    const stationGeometry = new THREE.CylinderGeometry(6, 6, 4, 8)
    const stationMaterial = new THREE.MeshPhongMaterial({ color: 0x666666 })
    
    for (const [id, ship] of gameState.ships) {
      const mesh = new THREE.Mesh(shipGeometry, shipMaterial)
      mesh.position.copy(ship.position)
      realWorldScene.add(mesh)
      shipMeshes.set(id, mesh)
    }
    
    for (const [id, station] of gameState.dockingStations) {
      const mesh = new THREE.Mesh(stationGeometry, stationMaterial)
      mesh.position.copy(station.position)
      realWorldScene.add(mesh)
      stationMeshes.set(id, mesh)
    }
  }
  
  function updateInteriorEnvironment() {
    if (!gameState.currentInterior) return
    
    while (interiorScene.children.length > 3) {
      interiorScene.remove(interiorScene.children[3])
    }
    
    if (gameState.currentInterior.type === 'ship') {
      createShipInterior()
    } else if (gameState.currentInterior.type === 'station') {
      createStationInterior()
    }
  }
  
  function createShipInterior() {
    const walls = [
      { pos: [0, 2, -4], size: [8, 4, 0.2] },
      { pos: [0, 2, 4], size: [8, 4, 0.2] },
      { pos: [-4, 2, 0], size: [0.2, 4, 8] },
      { pos: [4, 2, 0], size: [0.2, 4, 8] },
      { pos: [0, 0, 0], size: [8, 0.2, 8] },
      { pos: [0, 4, 0], size: [8, 0.2, 8] }
    ]
    
    walls.forEach(wall => {
      const geometry = new THREE.BoxGeometry(...wall.size)
      const material = new THREE.MeshPhongMaterial({ color: 0x444444 })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(...wall.pos)
      interiorScene.add(mesh)
    })
    
    const controlsGeometry = new THREE.BoxGeometry(2, 1, 0.5)
    const controlsMaterial = new THREE.MeshPhongMaterial({ color: 0x008888 })
    const controlsMesh = new THREE.Mesh(controlsGeometry, controlsMaterial)
    controlsMesh.position.set(0, 1, -3)
    interiorScene.add(controlsMesh)
  }
  
  function createStationInterior() {
    const floorGeometry = new THREE.CylinderGeometry(5, 5, 0.2, 8)
    const floorMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.position.y = 0
    interiorScene.add(floor)
    
    const ceilingGeometry = new THREE.CylinderGeometry(5, 5, 0.2, 8)
    const ceiling = new THREE.Mesh(ceilingGeometry, floorMaterial)
    ceiling.position.y = 4
    interiorScene.add(ceiling)
    
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const x = Math.cos(angle) * 4.5
      const z = Math.sin(angle) * 4.5
      
      const wallGeometry = new THREE.BoxGeometry(1, 4, 0.2)
      const wall = new THREE.Mesh(wallGeometry, floorMaterial)
      wall.position.set(x, 2, z)
      wall.rotation.y = angle
      interiorScene.add(wall)
    }
  }
  
  function animate() {
    if (!initialized) return
    
    animationId = requestAnimationFrame(animate)
    
    if (physicsManager.initialized) {
      physicsManager.step(1/60)
    }
    
    updatePlayerPosition()
    updateCameras()
    
    if (gameState.activeViews.interior && gameState.currentInterior) {
      updateInteriorEnvironment()
      updateProxyPlayerMaterial()
    }
    
    if (realWorldRenderer && realWorldScene && realWorldCamera) {
      realWorldRenderer.render(realWorldScene, realWorldCamera)
    }
    
    if (gameState.activeViews.interior && interiorRenderer && interiorScene && interiorCamera) {
      interiorRenderer.render(interiorScene, interiorCamera)
    }
  }
  
  function updatePlayerPosition() {
    if (playerMesh) {
      playerMesh.position.copy(gameState.player.position)
    }
    
    if (playerProxyMesh && gameState.player.currentContainer) {
      playerProxyMesh.position.copy(gameState.player.proxyPosition)
    }
  }
  
  function updateProxyPlayerMaterial() {
    if (playerProxyMesh) {
      playerProxyMesh.material.color.setHex(
        gameState.player.isKinematic ? 0x0088ff : 0x00ff00
      )
    }
  }
  
  function updateCameras() {
    if (gameState.player.currentContainer) {
      realWorldCamera.position.copy(playerMesh.position)
      realWorldCamera.position.y += 5
      realWorldCamera.position.z += 10
      realWorldCamera.lookAt(playerMesh.position)
      
      if (gameState.activeViews.interior) {
        interiorCamera.position.copy(gameState.player.proxyPosition)
        interiorCamera.position.y += 2
        interiorCamera.position.z += 3
        
        const lookTarget = new THREE.Vector3()
        lookTarget.copy(gameState.player.proxyPosition)
        lookTarget.z -= 1
        interiorCamera.lookAt(lookTarget)
      }
    } else {
      realWorldCamera.position.copy(gameState.player.position)
      realWorldCamera.position.y += 5
      realWorldCamera.position.z += 10
      realWorldCamera.lookAt(gameState.player.position)
    }
  }
</script>

{#if !physicsReady || !initialized}
  <div class="loading">
    <h3>{!physicsReady ? 'Initializing Physics Engine...' : 'Setting up 3D Scenes...'}</h3>
    <div class="loading-spinner"></div>
  </div>
{:else}
  <div class="camera-container">
    <div class="camera-view">
      <h3>Real World View</h3>
      <canvas bind:this={realWorldCanvas}></canvas>
      <div class="status">
        Player Mode: {gameState.player.isKinematic ? 'Kinematic' : 'Dynamic'}
      </div>
    </div>
    
    {#if gameState.activeViews.interior}
      <div class="camera-view">
        <h3>Interior View</h3>
        <canvas bind:this={interiorCanvas}></canvas>
        <div class="status">
          Interior: {gameState.currentInterior?.type || 'None'}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .camera-container {
    display: flex;
    gap: 20px;
    padding: 20px;
    background: #111;
  }
  
  .camera-view {
    border: 2px solid #333;
    border-radius: 8px;
    padding: 10px;
    background: #222;
  }
  
  .camera-view h3 {
    color: #fff;
    margin: 0 0 10px 0;
    font-size: 14px;
  }
  
  canvas {
    display: block;
    border: 1px solid #555;
    width: 400px;
    height: 300px;
    background: #000;
  }
  
  .status {
    color: #aaa;
    font-size: 12px;
    margin-top: 5px;
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 400px;
    color: #fff;
  }

  .loading h3 {
    margin-bottom: 20px;
    color: #00ff88;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 4px solid #333;
    border-top: 4px solid #00ff88;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
</style>