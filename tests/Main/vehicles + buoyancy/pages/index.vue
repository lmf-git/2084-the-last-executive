<template>
  <div id="game-container">
    <div class="crosshair"></div>
    <div class="ui-overlay">
      <div>Position: {{ playerPosition }}</div>
      <div>Vehicle: {{ attachedVehicle || 'None' }}</div>
      <div>WASD: Move | Mouse: Look | Space: Jump</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, onUnmounted } from 'vue'

const playerPosition = ref('0, 0, 0')
const attachedVehicle = ref(null)

onMounted(() => {
  initGame()
})

async function initGame() {
  const { GameManager } = await import('~/composables/GameManager')
  const gameManager = new GameManager()
  
  gameManager.onPlayerMove = (position) => {
    playerPosition.value = `${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`
  }
  
  gameManager.onVehicleAttach = (vehicleName) => {
    attachedVehicle.value = vehicleName
  }
  
  gameManager.onVehicleDetach = () => {
    attachedVehicle.value = null
  }
  
  await gameManager.init()
}
</script>

<style>
:global(body) {
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: Arial, sans-serif;
}

:global(#game-container) {
  width: 100vw;
  height: 100vh;
  position: relative;
}

:global(.crosshair) {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 20px;
  height: 20px;
  pointer-events: none;
  z-index: 1000;
}

:global(.crosshair::before),
:global(.crosshair::after) {
  content: '';
  position: absolute;
  background: white;
  border: 1px solid black;
}

:global(.crosshair::before) {
  width: 20px;
  height: 2px;
  top: 9px;
  left: 0;
}

:global(.crosshair::after) {
  width: 2px;
  height: 20px;
  top: 0;
  left: 9px;
}

:global(.ui-overlay) {
  position: absolute;
  top: 10px;
  left: 10px;
  color: white;
  font-size: 14px;
  z-index: 1000;
  text-shadow: 1px 1px 2px black;
}
</style>