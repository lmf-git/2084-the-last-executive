<script>
  import { onMount } from 'svelte'
  // import * as THREE from 'three'
  // import { nestedPhysics } from '../physics/NestedPhysics.js'
  
  let worldCanvas = $state()
  let localCanvas = $state()
  let initialized = $state(false)
  
  console.log('NestedPhysicsDemo script loading...')
  // console.log('Imported nestedPhysics:', nestedPhysics)
  
  let worldScene, localScene
  let worldCamera, localCamera
  let worldRenderer, localRenderer
  let animationId
  
  let playerMesh, playerProxyMesh, vehicleMesh
  let keys = {}
  
  onMount(async () => {
    console.log('NestedPhysicsDemo mounting...')
    console.log('nestedPhysics object:', nestedPhysics)
    
    try {
      console.log('About to call nestedPhysics.init()')
      await nestedPhysics.init()
      console.log('Nested physics initialized successfully')
    } catch (error) {
      console.error('Failed to initialize nested physics:', error)
      console.error('Error details:', error)
      return
    }
    
    const handleKeyDown = (e) => { 
      keys[e.code] = true 
      console.log('Key pressed:', e.code)
    }
    const handleKeyUp = (e) => { keys[e.code] = false }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      if (animationId) cancelAnimationFrame(animationId)
      worldRenderer?.dispose()
      localRenderer?.dispose()
      nestedPhysics.dispose()
    }
  })
  
  $effect(() => {
    console.log('Effect running:', {
      physicsInit: nestedPhysics.initialized,
      worldCanvas: !!worldCanvas,
      localCanvas: !!localCanvas,
      initialized
    })
    
    if (nestedPhysics.initialized && worldCanvas && localCanvas && !initialized) {
      console.log('Setting up scenes...')
      setupScenes()
      initialized = true
      animate()
      console.log('Scenes initialized and animation started')
    }
  })
  
  function setupScenes() {
    // World scene
    worldScene = new THREE.Scene()
    worldScene.background = new THREE.Color(0x001122)
    
    worldCamera = new THREE.PerspectiveCamera(75, 400/300, 0.1, 1000)
    worldCamera.position.set(0, 20, 35)
    console.log('World camera initial position:', worldCamera.position)
    
    worldRenderer = new THREE.WebGLRenderer({ canvas: worldCanvas })
    worldRenderer.setSize(400, 300)
    
    // Local scene
    localScene = new THREE.Scene()
    localScene.background = new THREE.Color(0x332211)
    
    localCamera = new THREE.PerspectiveCamera(75, 400/300, 0.1, 100)
    localCamera.position.set(0, 5, 8)
    
    localRenderer = new THREE.WebGLRenderer({ canvas: localCanvas })
    localRenderer.setSize(400, 300)
    
    // Lighting
    const worldLight = new THREE.DirectionalLight(0xffffff, 1)
    worldLight.position.set(10, 10, 5)
    worldScene.add(worldLight)
    worldScene.add(new THREE.AmbientLight(0x404040, 0.4))
    
    const localLight = new THREE.PointLight(0xffffff, 1, 50)
    localLight.position.set(0, 4, 2)
    localScene.add(localLight)
    localScene.add(new THREE.AmbientLight(0x404040, 0.6))
    
    createMeshes()
  }
  
  function createMeshes() {
    // Player in world
    const playerGeometry = new THREE.SphereGeometry(0.5, 16, 16)
    const playerMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00 })
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial)
    worldScene.add(playerMesh)
    
    // Player proxy in local
    playerProxyMesh = new THREE.Mesh(playerGeometry, playerMaterial)
    localScene.add(playerProxyMesh)
    
    // Ship
    const vehicleGeometry = new THREE.BoxGeometry(8, 4, 12)
    const vehicleMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x666666, 
      transparent: true, 
      opacity: 0.7 
    })
    vehicleMesh = new THREE.Mesh(vehicleGeometry, vehicleMaterial)
    vehicleMesh.position.set(15, 0, 0)  // Moved further out
    worldScene.add(vehicleMesh)
    
    // Docking Station
    const stationGeometry = new THREE.CylinderGeometry(6, 6, 6, 8)
    const stationMaterial = new THREE.MeshPhongMaterial({ 
      color: 0x444444, 
      transparent: true, 
      opacity: 0.8 
    })
    const stationMesh = new THREE.Mesh(stationGeometry, stationMaterial)
    stationMesh.position.set(-20, 0, 0)  // Opposite side from ship
    worldScene.add(stationMesh)
    
    // Ship interior walls (with door opening on the left side)
    const wallMaterial = new THREE.MeshPhongMaterial({ color: 0x444444 })
    const walls = [
      { pos: [0, 0, -0.2], size: [4, 2, 0.2] },     // Back wall
      { pos: [0, 0, 6.2], size: [4, 2, 0.2] },      // Front wall  
      { pos: [-4.2, 0, 1], size: [0.2, 2, 1] },     // Left wall (partial - door opening)
      { pos: [-4.2, 0, 5], size: [0.2, 2, 1] },     // Left wall (partial - door opening)
      { pos: [4.2, 0, 3], size: [0.2, 2, 3] },      // Right wall (full)
      { pos: [0, -0.2, 3], size: [4, 0.2, 3] }      // Floor
    ]
    
    walls.forEach(wall => {
      const wallGeometry = new THREE.BoxGeometry(...wall.size)
      const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial)
      wallMesh.position.set(...wall.pos)
      localScene.add(wallMesh)
    })
    
    // Ground
    const groundGeometry = new THREE.PlaneGeometry(100, 100)
    const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x228844 })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -1
    worldScene.add(ground)
  }
  
  function updateMovement() {
    const force = { x: 0, y: 0, z: 0 }
    const strength = 15
    const jumpStrength = 5  // Much weaker jump force
    
    if (keys['KeyW']) force.z -= strength
    if (keys['KeyS']) force.z += strength
    if (keys['KeyA']) force.x -= strength
    if (keys['KeyD']) force.x += strength
    if (keys['Space']) force.y += jumpStrength
    
    if (force.x || force.y || force.z) {
      nestedPhysics.applyPlayerForce(force)
    }
    
    // Exit vehicle
    if (keys['KeyE'] && nestedPhysics.player?.isInVehicle) {
      nestedPhysics.exitVehicle()
    }
  }
  
  function animate() {
    if (!initialized) return
    
    animationId = requestAnimationFrame(animate)
    
    updateMovement()
    nestedPhysics.step()
    
    // Debug logging every 60 frames
    if (animationId % 60 === 0) {
      console.log('Animation running, player pos:', nestedPhysics.getPlayerWorldPosition())
    }
    
    // Update player mesh positions
    const worldPos = nestedPhysics.getPlayerWorldPosition()
    playerMesh.position.copy(worldPos)
    
    if (nestedPhysics.player?.isInVehicle) {
      const localPos = nestedPhysics.getPlayerLocalPosition()
      playerProxyMesh.position.copy(localPos)
      playerProxyMesh.material.color.setHex(0x0088ff) // Blue when in vehicle
    } else {
      playerProxyMesh.material.color.setHex(0x00ff00) // Green when outside
    }
    
    // Update cameras to follow player (zoomed out more)
    worldCamera.position.x = worldPos.x
    worldCamera.position.y = worldPos.y + 20
    worldCamera.position.z = worldPos.z + 35
    worldCamera.lookAt(worldPos)
    
    if (nestedPhysics.player?.isInVehicle) {
      const localPos = nestedPhysics.getPlayerLocalPosition()
      localCamera.position.x = localPos.x
      localCamera.position.y = localPos.y + 3
      localCamera.position.z = localPos.z + 5
      localCamera.lookAt(localPos)
    }
    
    // Render
    worldRenderer.render(worldScene, worldCamera)
    if (nestedPhysics.player?.isInVehicle) {
      localRenderer.render(localScene, localCamera)
    }
  }
</script>

{#if !initialized}
  <div class="loading">
    <h3>Initializing Nested Physics...</h3>
  </div>
{:else}
  <div class="demo-container">
    <div class="view">
      <h3>World View</h3>
      <canvas bind:this={worldCanvas}></canvas>
      <div class="status">
        Mode: {nestedPhysics.player?.isInVehicle ? 'Inside Vehicle (Kinematic + Local Proxy)' : 'World (Dynamic)'}
      </div>
    </div>
    
    <div class="view">
      <h3>Local Proxy View</h3>
      <canvas bind:this={localCanvas}></canvas>
      <div class="status">
        {nestedPhysics.player?.isInVehicle ? 'Local Physics Active' : 'Inactive - Outside Vehicle'}
      </div>
    </div>
    
    <div class="controls">
      <h3>Controls</h3>
      <p><strong>WASD:</strong> Move</p>
      <p><strong>Space:</strong> Jump (reduced power)</p>
      <p><strong>E:</strong> Exit Vehicle</p>
      <p><strong>Auto-enter:</strong> Walk near ship (gray box) or station (dark cylinder)</p>
      
      <div class="info">
        <h4>Current Status:</h4>
        <p>In Vehicle: {nestedPhysics.player?.isInVehicle ? 'YES' : 'NO'}</p>
        <p>Vehicle: {nestedPhysics.player?.currentVehicle || 'None'}</p>
        <p>World Pos: {nestedPhysics.getPlayerWorldPosition().toArray().map(n => n.toFixed(1)).join(', ')}</p>
        {#if nestedPhysics.player?.isInVehicle}
          <p>Local Pos: {nestedPhysics.getPlayerLocalPosition().toArray().map(n => n.toFixed(1)).join(', ')}</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .loading {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 400px;
    color: #fff;
  }

  .demo-container {
    display: flex;
    gap: 20px;
    padding: 20px;
    background: #000;
    color: #fff;
    font-family: monospace;
    min-height: 100vh;
  }

  .view {
    display: flex;
    flex-direction: column;
  }

  .view h3 {
    margin: 0 0 10px 0;
    color: #00ff88;
  }

  canvas {
    border: 1px solid #444;
    width: 400px;
    height: 300px;
  }

  .status {
    margin-top: 10px;
    padding: 5px;
    background: #222;
    border-radius: 4px;
    font-size: 12px;
  }

  .controls {
    min-width: 200px;
    background: #111;
    padding: 15px;
    border-radius: 8px;
    height: fit-content;
  }

  .controls h3 {
    margin: 0 0 10px 0;
    color: #ffaa00;
  }

  .controls p {
    margin: 5px 0;
    font-size: 12px;
  }

  .info {
    margin-top: 15px;
    padding-top: 15px;
    border-top: 1px solid #333;
  }

  .info h4 {
    margin: 0 0 8px 0;
    color: #88aaff;
  }

  .info p {
    margin: 3px 0;
    font-size: 11px;
  }
</style>