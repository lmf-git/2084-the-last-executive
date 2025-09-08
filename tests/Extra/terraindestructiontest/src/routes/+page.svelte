<script>
	import SphericalPlanet from '$lib/SphericalPlanet.svelte';
</script>

<SphericalPlanet />

<div class="controls">
	<h2>Ultra-Smooth Planet Destruction</h2>
	<p>Click to create craters with water flow</p>
	<p>1024-segment sphere for maximum detail</p>
	<p>Water flows naturally to fill gaps and level out</p>
</div>

<style>
	.controls {
		position: absolute;
		top: 20px;
		left: 20px;
		background: rgba(0, 0, 0, 0.7);
		color: white;
		padding: 15px;
		border-radius: 8px;
		font-family: Arial, sans-serif;
		max-width: 300px;
	}
	
	.controls h2 {
		margin: 0 0 10px 0;
		font-size: 18px;
	}
	
	.controls p {
		margin: 5px 0;
		font-size: 14px;
	}
</style>
