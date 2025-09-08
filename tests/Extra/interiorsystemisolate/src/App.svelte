<script>
  import { onMount, onDestroy } from 'svelte';
  import { NestedPhysicsSimulation } from './lib/NestedPhysicsSimulation.js';

  let canvas;
  let simulation;
  let stats = $state({
    isRunning: false,
    isPaused: false,
    frameCount: 0,
    entityCount: 0,
    rootEntityCount: 0,
    activeTransitions: 0
  });

  let entities = $state({
    worldCarrier: null,
    smallCarrier: null,
    vehicle: null,
    player: null
  });

  onMount(async () => {
    try {
      // Initialize simulation
      simulation = new NestedPhysicsSimulation(canvas, {
        debug: true
      });
      
      await simulation.initialize();
      
      // Set up event listeners
      simulation.on('simulationUpdate', (data) => {
        stats = simulation.getSimulationStats();
      });
      
      simulation.on('exampleHierarchyCreated', (data) => {
        entities = { ...data };
      });
      
      // Create example hierarchy
      const hierarchy = simulation.createExampleHierarchy();
      
      // Start simulation
      simulation.start();
      
    } catch (error) {
      console.error('Failed to initialize simulation:', error);
    }
  });

  onDestroy(() => {
    if (simulation) {
      simulation.dispose();
    }
  });

  function togglePause() {
    if (!simulation) return;
    
    if (stats.isPaused) {
      simulation.resume();
    } else {
      simulation.pause();
    }
  }

  function restart() {
    if (!simulation) return;
    
    simulation.stop();
    simulation.dispose();
    
    // Reinitialize
    setTimeout(async () => {
      simulation = new NestedPhysicsSimulation(canvas);
      await simulation.initialize();
      simulation.createExampleHierarchy();
      simulation.start();
    }, 100);
  }

  async function testPlayerTransition() {
    if (!entities.player || !entities.smallCarrier) return;
    
    try {
      // Move player from vehicle to small carrier deck
      await entities.player.exitVehicle();
      
      // Wait a moment, then move to world carrier
      setTimeout(async () => {
        await simulation.transitionManager.transferEntity(
          entities.player.id,
          entities.worldCarrier.id,
          {
            motionPreservation: 'preserve_relative',
            smoothTransition: true,
            transitionDuration: 1.0
          }
        );
      }, 2000);
      
    } catch (error) {
      console.error('Transition failed:', error);
    }
  }

  async function testVehicleTransition() {
    if (!entities.vehicle || !entities.worldCarrier) return;
    
    try {
      // Undock vehicle from small carrier
      await entities.smallCarrier.undockVehicle(entities.vehicle);
      
      // Wait, then dock to world carrier
      setTimeout(async () => {
        await entities.worldCarrier.dockVehicle(entities.vehicle, 'flight_deck');
      }, 3000);
      
    } catch (error) {
      console.error('Vehicle transition failed:', error);
    }
  }
</script>

<style>
  .container {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .canvas-container {
    flex: 1;
    position: relative;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .controls {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 15px;
    border-radius: 5px;
    font-family: monospace;
    font-size: 12px;
  }

  .stats {
    margin-bottom: 15px;
  }

  .buttons {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  button {
    padding: 8px 12px;
    background: #333;
    color: white;
    border: 1px solid #555;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }

  button:hover {
    background: #555;
  }

  button:disabled {
    background: #222;
    color: #666;
    cursor: not-allowed;
  }
</style>

<div class="container">
  <div class="canvas-container">
    <canvas bind:this={canvas}></canvas>
    
    <div class="controls">
      <div class="stats">
        <div>Status: {stats.isRunning ? (stats.isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED'}</div>
        <div>Frame: {stats.frameCount}</div>
        <div>Entities: {stats.entityCount}</div>
        <div>Root Entities: {stats.rootEntityCount}</div>
        <div>Active Transitions: {stats.activeTransitions}</div>
      </div>
      
      <div class="buttons">
        <button onclick={togglePause} disabled={!stats.isRunning}>
          {stats.isPaused ? 'Resume' : 'Pause'}
        </button>
        
        <button onclick={restart}>
          Restart
        </button>
        
        <button onclick={testPlayerTransition} disabled={!entities.player}>
          Test Player Transition
        </button>
        
        <button onclick={testVehicleTransition} disabled={!entities.vehicle}>
          Test Vehicle Transition
        </button>
      </div>
    </div>
  </div>
</div>