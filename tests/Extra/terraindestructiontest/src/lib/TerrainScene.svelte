<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';

	let canvas = $state();
	let scene, camera, renderer, terrain, water;
	let mouse = { x: 0, y: 0 };
	let raycaster = new THREE.Raycaster();
	let destructionRadius = 5;

	onMount(() => {
		init();
		animate();
		
		return () => {
			if (renderer) {
				renderer.dispose();
			}
		};
	});

	function init() {
		// Scene setup
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x87CEEB);

		// Camera setup
		camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
		camera.position.set(0, 20, 30);
		camera.lookAt(0, 0, 0);

		// Renderer setup
		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		// Lighting
		const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
		scene.add(ambientLight);

		const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
		directionalLight.position.set(50, 50, 50);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.width = 2048;
		directionalLight.shadow.mapSize.height = 2048;
		scene.add(directionalLight);

		// Create terrain
		createTerrain();
		
		// Create water
		createWater();

		// Event listeners
		window.addEventListener('resize', onWindowResize);
		canvas.addEventListener('mousemove', onMouseMove);
		canvas.addEventListener('click', onMouseClick);
	}

	function createTerrain() {
		const radius = 15;
		const widthSegments = 64;
		const heightSegments = 32;
		
		const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);

		// Generate height data for planet surface
		const vertices = geometry.attributes.position.array;
		const originalVertices = [...vertices];
		
		for (let i = 0; i < vertices.length; i += 3) {
			const x = vertices[i];
			const y = vertices[i + 1];
			const z = vertices[i + 2];
			
			// Normalize to get position on sphere
			const length = Math.sqrt(x * x + y * y + z * z);
			const nx = x / length;
			const ny = y / length;
			const nz = z / length;
			
			// Generate terrain height using noise
			const noise1 = Math.sin(nx * 8) * Math.cos(ny * 8) * Math.sin(nz * 8);
			const noise2 = Math.sin(nx * 16) * Math.cos(ny * 16) * Math.sin(nz * 16) * 0.5;
			const noise3 = Math.sin(nx * 32) * Math.cos(ny * 32) * Math.sin(nz * 32) * 0.25;
			
			const heightVariation = (noise1 + noise2 + noise3) * 2;
			const newRadius = radius + heightVariation;
			
			vertices[i] = nx * newRadius;
			vertices[i + 1] = ny * newRadius;
			vertices[i + 2] = nz * newRadius;
		}

		geometry.computeVertexNormals();

		const material = new THREE.MeshLambertMaterial({
			color: 0x228B22,
			wireframe: false
		});

		terrain = new THREE.Mesh(geometry, material);
		terrain.receiveShadow = true;
		terrain.userData.radius = radius;
		terrain.userData.originalVertices = [...originalVertices];
		
		scene.add(terrain);
	}

	function createWater() {
		const waterLevel = 14.8; // Water level relative to planet center
		const widthSegments = 64;
		const heightSegments = 32;
		
		const geometry = new THREE.SphereGeometry(15, widthSegments, heightSegments);

		const material = new THREE.MeshPhongMaterial({
			color: 0x006994,
			transparent: true,
			opacity: 0.8,
			shininess: 100
		});

		water = new THREE.Mesh(geometry, material);
		water.userData.waterLevel = waterLevel;
		water.userData.originalVertices = [...geometry.attributes.position.array];
		
		// Initialize water based on terrain
		updateWaterBasedOnTerrain();
		
		scene.add(water);
	}

	function onWindowResize() {
		camera.aspect = window.innerWidth / window.innerHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(window.innerWidth, window.innerHeight);
	}

	function onMouseMove(event) {
		mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
		mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
	}

	function onMouseClick(event) {
		raycaster.setFromCamera(mouse, camera);
		
		// Check terrain intersection
		const terrainIntersects = raycaster.intersectObject(terrain);
		if (terrainIntersects.length > 0) {
			const point = terrainIntersects[0].point;
			destroyTerrain(point);
		}

		// Check water intersection
		const waterIntersects = raycaster.intersectObject(water);
		if (waterIntersects.length > 0) {
			const point = waterIntersects[0].point;
			displaceWater(point);
		}
	}

	function destroyTerrain(point) {
		const geometry = terrain.geometry;
		const vertices = geometry.attributes.position.array;
		const radius = terrain.userData.radius;

		for (let i = 0; i < vertices.length; i += 3) {
			const x = vertices[i];
			const y = vertices[i + 1];
			const z = vertices[i + 2];
			
			// Calculate distance between current vertex and impact point
			const distance = Math.sqrt(
				(x - point.x) ** 2 + 
				(y - point.y) ** 2 + 
				(z - point.z) ** 2
			);

			if (distance < destructionRadius) {
				const factor = 1 - (distance / destructionRadius);
				
				// Move vertex inward toward planet center
				const length = Math.sqrt(x * x + y * y + z * z);
				const nx = x / length;
				const ny = y / length;
				const nz = z / length;
				
				const craterDepth = factor * 3;
				const newRadius = length - craterDepth;
				
				vertices[i] = nx * newRadius;
				vertices[i + 1] = ny * newRadius;
				vertices[i + 2] = nz * newRadius;
			}
		}

		geometry.attributes.position.needsUpdate = true;
		geometry.computeVertexNormals();
		
		// Update water based on terrain changes
		updateWaterBasedOnTerrain();
	}

	function updateWaterBasedOnTerrain() {
		const waterGeometry = water.geometry;
		const waterVertices = waterGeometry.attributes.position.array;
		const originalWaterVertices = water.userData.originalVertices;
		const terrainVertices = terrain.geometry.attributes.position.array;
		const waterLevel = water.userData.waterLevel;

		// For each water vertex, check the terrain height in that direction
		for (let i = 0; i < waterVertices.length; i += 3) {
			const origX = originalWaterVertices[i];
			const origY = originalWaterVertices[i + 1];
			const origZ = originalWaterVertices[i + 2];
			
			// Normalize to get direction from planet center
			const length = Math.sqrt(origX * origX + origY * origY + origZ * origZ);
			const nx = origX / length;
			const ny = origY / length;
			const nz = origZ / length;
			
			// Find the closest terrain height in this direction
			let closestTerrainRadius = 0;
			let minAngularDistance = Infinity;
			
			for (let j = 0; j < terrainVertices.length; j += 3) {
				const terrainX = terrainVertices[j];
				const terrainY = terrainVertices[j + 1];
				const terrainZ = terrainVertices[j + 2];
				
				// Normalize terrain vertex
				const terrainLength = Math.sqrt(terrainX * terrainX + terrainY * terrainY + terrainZ * terrainZ);
				const terrainNx = terrainX / terrainLength;
				const terrainNy = terrainY / terrainLength;
				const terrainNz = terrainZ / terrainLength;
				
				// Calculate angular distance
				const dotProduct = nx * terrainNx + ny * terrainNy + nz * terrainNz;
				const angularDistance = Math.acos(Math.max(-1, Math.min(1, dotProduct)));
				
				if (angularDistance < minAngularDistance) {
					minAngularDistance = angularDistance;
					closestTerrainRadius = terrainLength;
				}
			}
			
			// If terrain is below water level, show water at water level
			// If terrain is above water level, hide water by moving it to planet center
			if (closestTerrainRadius < waterLevel) {
				// Show water at fixed water level
				waterVertices[i] = nx * waterLevel;
				waterVertices[i + 1] = ny * waterLevel;
				waterVertices[i + 2] = nz * waterLevel;
			} else {
				// Hide water by moving it to the planet center (invisible)
				waterVertices[i] = 0;
				waterVertices[i + 1] = 0;
				waterVertices[i + 2] = 0;
			}
		}
		
		waterGeometry.attributes.position.needsUpdate = true;
		waterGeometry.computeVertexNormals();
	}

	function displaceWater(point) {
		const geometry = water.geometry;
		const vertices = geometry.attributes.position.array;
		const originalVertices = water.userData.originalVertices;
		const time = Date.now() * 0.001;
		const radius = water.userData.radius;

		for (let i = 0; i < vertices.length; i += 3) {
			const x = vertices[i];
			const y = vertices[i + 1];
			const z = vertices[i + 2];
			
			const distance = Math.sqrt(
				(x - point.x) ** 2 + 
				(y - point.y) ** 2 + 
				(z - point.z) ** 2
			);

			if (distance < destructionRadius * 2) {
				const factor = 1 - (distance / (destructionRadius * 2));
				const wave = Math.sin(time * 5 - distance * 0.1) * factor;
				
				// Create ripple effect by expanding/contracting the water sphere
				const length = Math.sqrt(x * x + y * y + z * z);
				const nx = x / length;
				const ny = y / length;
				const nz = z / length;
				
				const newRadius = radius + wave * 0.5;
				
				vertices[i] = nx * newRadius;
				vertices[i + 1] = ny * newRadius;
				vertices[i + 2] = nz * newRadius;
			}
		}

		geometry.attributes.position.needsUpdate = true;
		geometry.computeVertexNormals();
	}

	function animate() {
		requestAnimationFrame(animate);
		
		// Rotate camera around planet
		const time = Date.now() * 0.0005;
		camera.position.x = Math.cos(time) * 50;
		camera.position.z = Math.sin(time) * 50;
		camera.lookAt(0, 0, 0);
		
		// Animate water waves while respecting terrain-based water visibility
		const waterTime = Date.now() * 0.001;
		const waterGeometry = water.geometry;
		const waterVertices = waterGeometry.attributes.position.array;
		const waterLevel = water.userData.waterLevel;

		for (let i = 0; i < waterVertices.length; i += 3) {
			const currentX = waterVertices[i];
			const currentY = waterVertices[i + 1];
			const currentZ = waterVertices[i + 2];
			
			// Skip hidden water vertices (at origin)
			if (currentX === 0 && currentY === 0 && currentZ === 0) {
				continue;
			}
			
			// Get current radius and normalize
			const currentRadius = Math.sqrt(currentX * currentX + currentY * currentY + currentZ * currentZ);
			const nx = currentX / currentRadius;
			const ny = currentY / currentRadius;
			const nz = currentZ / currentRadius;
			
			// Create gentle wave patterns on visible water
			const waveHeight = Math.sin(currentX * 0.3 + waterTime) * 0.1 + 
							  Math.cos(currentZ * 0.3 + waterTime * 0.7) * 0.1;
			
			const newRadius = waterLevel + waveHeight;
			
			waterVertices[i] = nx * newRadius;
			waterVertices[i + 1] = ny * newRadius;
			waterVertices[i + 2] = nz * newRadius;
		}

		waterGeometry.attributes.position.needsUpdate = true;
		
		renderer.render(scene, camera);
	}
</script>

<canvas bind:this={canvas} style="display: block; width: 100%; height: 100vh;"></canvas>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>