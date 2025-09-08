export const gameState = $state({
  player: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    isKinematic: false,
    currentContainer: null,
    proxyPosition: { x: 0, y: 0, z: 0 },
    realWorldRigidBody: null,
    proxyRigidBody: null
  },
  physics: {
    realWorld: null,
    proxy: null,
    initialized: false
  },
  ships: new Map(),
  dockingStations: new Map(),
  activeViews: {
    realWorld: true,
    interior: false
  },
  currentInterior: null
})

export function createShip(id, position, interior) {
  gameState.ships.set(id, {
    id,
    position,
    interior,
    containedEntities: new Set(),
    isNested: false,
    parentContainer: null
  })
}

export function createDockingStation(id, position, interior) {
  gameState.dockingStations.set(id, {
    id,
    position,
    interior,
    containedEntities: new Set(),
    dockedShips: new Set()
  })
}

export function enterContainer(containerId, containerType) {
  const container = containerType === 'ship' 
    ? gameState.ships.get(containerId)
    : gameState.dockingStations.get(containerId)
  
  if (!container) return false
  
  gameState.player.currentContainer = { id: containerId, type: containerType }
  gameState.currentInterior = container.interior
  gameState.activeViews.interior = true
  
  container.containedEntities.add('player')
  
  gameState.player.proxyPosition = { x: 0, y: 2, z: 0 }
  
  return true
}

export function exitContainer() {
  if (!gameState.player.currentContainer) return false
  
  const { id, type } = gameState.player.currentContainer
  const container = type === 'ship' 
    ? gameState.ships.get(id)
    : gameState.dockingStations.get(id)
  
  if (container) {
    container.containedEntities.delete('player')
  }
  
  gameState.player.currentContainer = null
  gameState.currentInterior = null
  gameState.activeViews.interior = false
  
  return true
}

export function nestShipInContainer(shipId, containerId, containerType) {
  const ship = gameState.ships.get(shipId)
  const container = containerType === 'ship'
    ? gameState.ships.get(containerId)
    : gameState.dockingStations.get(containerId)
  
  if (!ship || !container) return false
  
  ship.isNested = true
  ship.parentContainer = { id: containerId, type: containerType }
  container.containedEntities.add(shipId)
  
  return true
}

export function translateProxyToReal(proxyPos, containerId, containerType) {
  const container = containerType === 'ship'
    ? gameState.ships.get(containerId)
    : gameState.dockingStations.get(containerId)
  
  if (!container) return proxyPos
  
  return {
    x: container.position.x + proxyPos.x,
    y: container.position.y + proxyPos.y,
    z: container.position.z + proxyPos.z
  }
}