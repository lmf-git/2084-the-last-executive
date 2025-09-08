<script>
  import { onMount } from 'svelte'
  import { 
    gameState, 
    enterContainer, 
    exitContainer, 
    createShip, 
    createDockingStation,
    nestShipInContainer
  } from '../stores/gameState.svelte.js'
  import { physicsManager } from '../physics/PhysicsManager.js'
  
  let keys = {}
  let forceStrength = 10
  
  onMount(() => {
    const waitForPhysics = setInterval(() => {
      if (physicsManager.initialized) {
        clearInterval(waitForPhysics)
        initializeWorld()
      }
    }, 100)
    
    const handleKeyDown = (e) => {
      keys[e.code] = true
    }
    
    const handleKeyUp = (e) => {
      keys[e.code] = false
    }
    
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    const gameLoop = setInterval(updatePlayer, 16)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      clearInterval(gameLoop)
      clearInterval(waitForPhysics)
    }
  })
  
  function initializeWorld() {
    createShip('ship1', { x: 10, y: 0, z: 0 }, { type: 'ship' })
    createShip('ship2', { x: -15, y: 0, z: 5 }, { type: 'ship' })
    createDockingStation('station1', { x: 0, y: 0, z: -20 }, { type: 'station' })
    
    nestShipInContainer('ship2', 'station1', 'station')
  }
  
  function updatePlayer() {
    if (!physicsManager.initialized) return

    const force = { x: 0, y: 0, z: 0 }
    
    if (keys['KeyW']) force.z -= forceStrength
    if (keys['KeyS']) force.z += forceStrength
    if (keys['KeyA']) force.x -= forceStrength
    if (keys['KeyD']) force.x += forceStrength
    if (keys['KeyQ']) force.y += forceStrength
    if (keys['KeyE']) force.y -= forceStrength

    if (force.x !== 0 || force.y !== 0 || force.z !== 0) {
      physicsManager.applyPlayerForce(force)
    }
  }
  
  function checkProximityAndEnter() {
    if (gameState.player.currentContainer) return
    
    const playerPos = gameState.player.position
    const threshold = 4
    
    for (const [id, ship] of gameState.ships) {
      const distance = Math.sqrt(
        Math.pow(playerPos.x - ship.position.x, 2) +
        Math.pow(playerPos.y - ship.position.y, 2) +
        Math.pow(playerPos.z - ship.position.z, 2)
      )
      
      if (distance < threshold) {
        if (enterContainer(id, 'ship')) {
          physicsManager.switchPlayerToKinematic()
          physicsManager.resetProxyPlayerPosition()
          physicsManager.createInteriorColliders('ship')
        }
        return
      }
    }
    
    for (const [id, station] of gameState.dockingStations) {
      const distance = Math.sqrt(
        Math.pow(playerPos.x - station.position.x, 2) +
        Math.pow(playerPos.y - station.position.y, 2) +
        Math.pow(playerPos.z - station.position.z, 2)
      )
      
      if (distance < threshold) {
        if (enterContainer(id, 'station')) {
          physicsManager.switchPlayerToKinematic()
          physicsManager.resetProxyPlayerPosition()
          physicsManager.createInteriorColliders('station')
        }
        return
      }
    }
  }
  
  function handleExit() {
    if (gameState.player.currentContainer) {
      const container = gameState.player.currentContainer
      
      if (container.type === 'ship') {
        const ship = gameState.ships.get(container.id)
        if (ship?.isNested && ship.parentContainer) {
          exitContainer()
          if (enterContainer(ship.parentContainer.id, ship.parentContainer.type)) {
            physicsManager.resetProxyPlayerPosition()
            physicsManager.createInteriorColliders(ship.parentContainer.type)
          }
        } else {
          exitContainer()
          physicsManager.switchPlayerToDynamic()
        }
      } else {
        exitContainer()
        physicsManager.switchPlayerToDynamic()
      }
    }
  }
  
  function switchToShip(shipId) {
    if (!gameState.player.currentContainer) return
    
    const currentContainer = gameState.player.currentContainer
    const targetShip = gameState.ships.get(shipId)
    
    if (!targetShip) return
    
    if (currentContainer.type === 'station') {
      const station = gameState.dockingStations.get(currentContainer.id)
      if (station?.containedEntities.has(shipId)) {
        exitContainer()
        if (enterContainer(shipId, 'ship')) {
          physicsManager.resetProxyPlayerPosition()
          physicsManager.createInteriorColliders('ship')
        }
      }
    }
  }
</script>

<div class="controls-panel">
  <div class="section">
    <h3>Movement Controls</h3>
    <p>WASD: Move horizontally</p>
    <p>Q/E: Move up/down</p>
    <p>Current Position: {JSON.stringify(gameState.player.position)}</p>
    {#if gameState.player.currentContainer}
      <p>Proxy Position: {JSON.stringify(gameState.player.proxyPosition)}</p>
    {/if}
  </div>
  
  <div class="section">
    <h3>Interaction</h3>
    <button on:click={checkProximityAndEnter} disabled={!!gameState.player.currentContainer}>
      Enter Nearby Container
    </button>
    <button on:click={handleExit} disabled={!gameState.player.currentContainer}>
      Exit Container
    </button>
  </div>
  
  <div class="section">
    <h3>Status</h3>
    <p>Player Mode: <span class="status-{gameState.player.isKinematic ? 'kinematic' : 'dynamic'}">
      {gameState.player.isKinematic ? 'Kinematic' : 'Dynamic'}
    </span></p>
    <p>Current Container: {gameState.player.currentContainer?.id || 'None'}</p>
    <p>Container Type: {gameState.player.currentContainer?.type || 'None'}</p>
  </div>
  
  {#if gameState.player.currentContainer?.type === 'station'}
    <div class="section">
      <h3>Available Ships</h3>
      {#each [...gameState.ships.entries()] as [shipId, ship]}
        {#if ship.parentContainer?.id === gameState.player.currentContainer.id}
          <button on:click={() => switchToShip(shipId)}>
            Enter {shipId}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
  
  <div class="section">
    <h3>World Objects</h3>
    <div class="object-list">
      <h4>Ships:</h4>
      {#each [...gameState.ships.entries()] as [id, ship]}
        <div class="object-item">
          {id}: {JSON.stringify(ship.position)}
          {#if ship.isNested}
            <span class="nested">(nested in {ship.parentContainer.id})</span>
          {/if}
        </div>
      {/each}
      
      <h4>Stations:</h4>
      {#each [...gameState.dockingStations.entries()] as [id, station]}
        <div class="object-item">
          {id}: {JSON.stringify(station.position)}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .controls-panel {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 300px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid #444;
    border-radius: 8px;
    padding: 15px;
    color: white;
    font-family: monospace;
    font-size: 12px;
    max-height: 80vh;
    overflow-y: auto;
  }
  
  .section {
    margin-bottom: 15px;
    padding-bottom: 10px;
    border-bottom: 1px solid #333;
  }
  
  .section:last-child {
    border-bottom: none;
  }
  
  .section h3 {
    margin: 0 0 8px 0;
    color: #88ff88;
    font-size: 14px;
  }
  
  .section h4 {
    margin: 8px 0 4px 0;
    color: #ffff88;
    font-size: 12px;
  }
  
  .section p {
    margin: 4px 0;
    line-height: 1.4;
  }
  
  button {
    background: #333;
    border: 1px solid #555;
    color: white;
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    margin: 2px;
    font-size: 11px;
  }
  
  button:hover:not(:disabled) {
    background: #444;
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .status-kinematic {
    color: #88bbff;
    font-weight: bold;
  }
  
  .status-dynamic {
    color: #88ff88;
    font-weight: bold;
  }
  
  .object-list {
    max-height: 150px;
    overflow-y: auto;
  }
  
  .object-item {
    margin: 2px 0;
    padding: 2px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
  }
  
  .nested {
    color: #ffaa88;
    font-style: italic;
  }
</style>