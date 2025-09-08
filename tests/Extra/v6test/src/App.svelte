<script>
  import TestComponent from './components/TestComponent.svelte'
  import SimpleDemo from './components/SimpleDemo.svelte'
  import NestedPhysicsDemo from './components/NestedPhysicsDemo.svelte'
  
  console.log('App.svelte loading...')
</script>

<main>
  <h1>Nested Physics World Demo</h1>
  <TestComponent />
  <SimpleDemo />
  <NestedPhysicsDemo />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #000;
    color: #fff;
    font-family: 'Courier New', monospace;
    overflow: hidden;
  }

  main {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  h1 {
    text-align: center;
    margin: 10px 0;
    font-size: 24px;
    color: #00ff88;
    text-shadow: 0 0 10px #00ff88;
  }

  .simulation-container {
    flex: 1;
    display: flex;
    position: relative;
  }

  :global(*) {
    box-sizing: border-box;
  }
</style>