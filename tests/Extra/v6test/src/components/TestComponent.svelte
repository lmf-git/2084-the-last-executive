<script>
  console.log('TestComponent loading...')
  
  let message = $state('Test component is working!')
  
  console.log('TestComponent script executed')
</script>

<div>
  <h2>Test Component</h2>
  <p>{message}</p>
</div>

<style>
  div {
    padding: 20px;
    background: #222;
    color: #fff;
  }
</style>