<script>
  import { onMount } from 'svelte'
  
  console.log('SimpleDemo script loading...')
  
  let initialized = $state(false)
  
  onMount(() => {
    console.log('SimpleDemo mounting...')
    setTimeout(() => {
      initialized = true
      console.log('SimpleDemo initialized')
    }, 1000)
  })
</script>

{#if !initialized}
  <div class="loading">
    <h3>Simple Demo Initializing...</h3>
  </div>
{:else}
  <div class="demo">
    <h3>Simple Demo Working!</h3>
    <p>This proves the basic Svelte structure works.</p>
  </div>
{/if}

<style>
  .loading, .demo {
    padding: 20px;
    background: #111;
    color: #fff;
    margin: 10px 0;
  }
</style>