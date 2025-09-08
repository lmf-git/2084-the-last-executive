<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';

	let canvas = $state();
	let scene, camera, renderer;
	let planet, water;
	let mouse = { x: 0, y: 0 };
	let raycaster = new THREE.Raycaster();
	
	// Planet parameters
	const PLANET_RADIUS = 15;
	const WATER_LEVEL = 14.5;
	const SEGMENTS = 1024; // Ultra-high tessellation for extremely smooth surface
	const DESTRUCTION_RADIUS = 2;
	
	// Terrain data
	let heightData = [];
	let originalVertices = [];
	let waterHeights = [];

	onMount(() => {
		init();
		createPlanet();
		createWater();
		animate();
		
		return () => {
			if (renderer) {
				renderer.dispose();
			}
		};
	});

	function init() {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x000011);

		camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
		camera.position.set(0, 0, 40);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.4;

		// Enhanced lighting
		const ambientLight = new THREE.AmbientLight(0x404040, 0.15);
		scene.add(ambientLight);

		// Main sun light
		const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
		sunLight.position.set(100, 100, 50);
		sunLight.castShadow = true;
		sunLight.shadow.mapSize.width = 4096;
		sunLight.shadow.mapSize.height = 4096;
		sunLight.shadow.camera.near = 0.5;
		sunLight.shadow.camera.far = 300;
		sunLight.shadow.camera.left = -50;
		sunLight.shadow.camera.right = 50;
		sunLight.shadow.camera.top = 50;
		sunLight.shadow.camera.bottom = -50;
		sunLight.shadow.bias = -0.0001;
		scene.add(sunLight);

		// Rim light
		const rimLight = new THREE.DirectionalLight(0x4444ff, 0.4);
		rimLight.position.set(-80, 30, -50);
		scene.add(rimLight);

		// Event listeners
		window.addEventListener('resize', onWindowResize);
		canvas.addEventListener('mousemove', onMouseMove);
		canvas.addEventListener('click', onMouseClick);
	}

	function createPlanet() {
		const geometry = new THREE.SphereGeometry(PLANET_RADIUS, SEGMENTS, SEGMENTS / 2);
		const vertices = geometry.attributes.position.array;
		const colors = [];
		
		// Store original vertices for reference
		originalVertices = [...vertices];
		heightData = new Array(vertices.length / 3).fill(0);

		// Generate terrain with multiple noise layers
		for (let i = 0; i < vertices.length; i += 3) {
			const x = vertices[i];
			const y = vertices[i + 1];
			const z = vertices[i + 2];
			
			// Normalize to get direction
			const length = Math.sqrt(x * x + y * y + z * z);
			const nx = x / length;
			const ny = y / length;
			const nz = z / length;
			
			// Generate height using multiple octaves of noise
			const noise1 = Math.sin(nx * 4) * Math.cos(ny * 4) * Math.sin(nz * 4);
			const noise2 = Math.sin(nx * 8) * Math.cos(ny * 8) * Math.sin(nz * 8) * 0.5;
			const noise3 = Math.sin(nx * 16) * Math.cos(ny * 16) * Math.sin(nz * 16) * 0.25;
			const noise4 = Math.sin(nx * 32) * Math.cos(ny * 32) * Math.sin(nz * 32) * 0.125;
			const noise5 = Math.sin(nx * 64) * Math.cos(ny * 64) * Math.sin(nz * 64) * 0.0625;
			
			const heightVariation = (noise1 + noise2 + noise3 + noise4 + noise5) * 1.5;
			const newRadius = PLANET_RADIUS + heightVariation;
			
			// Update vertex position
			vertices[i] = nx * newRadius;
			vertices[i + 1] = ny * newRadius;
			vertices[i + 2] = nz * newRadius;
			
			// Store height data
			const vertexIndex = i / 3;
			heightData[vertexIndex] = newRadius;
			
			// Generate colors based on height
			const height = newRadius - PLANET_RADIUS;
			let color;
			
			if (height > 1.0) {
				// Snow peaks
				color = new THREE.Color(0.9, 0.9, 0.95);
			} else if (height > 0.5) {
				// Rocky mountains
				color = new THREE.Color(0.6, 0.5, 0.4);
			} else if (height > 0) {
				// Hills
				color = new THREE.Color(0.4, 0.6, 0.3);
			} else if (height > -0.5) {
				// Lowlands
				color = new THREE.Color(0.3, 0.5, 0.2);
			} else {
				// Deep valleys
				color = new THREE.Color(0.2, 0.3, 0.1);
			}
			
			colors.push(color.r, color.g, color.b);
		}

		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.computeVertexNormals();

		const material = new THREE.MeshLambertMaterial({
			vertexColors: true,
			side: THREE.FrontSide
		});

		planet = new THREE.Mesh(geometry, material);
		planet.castShadow = true;
		planet.receiveShadow = true;
		
		scene.add(planet);
	}

	function createWater() {
		const geometry = new THREE.SphereGeometry(WATER_LEVEL, SEGMENTS / 2, SEGMENTS / 4);
		const vertices = geometry.attributes.position.array;
		
		// Initialize water heights
		waterHeights = new Array(vertices.length / 3).fill(WATER_LEVEL);

		const material = new THREE.MeshPhongMaterial({
			color: 0x006994,
			transparent: true,
			opacity: 0.7,
			shininess: 100,
			side: THREE.FrontSide
		});

		water = new THREE.Mesh(geometry, material);
		water.receiveShadow = true;
		
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
		
		const intersects = raycaster.intersectObject(planet);
		if (intersects.length > 0) {
			const point = intersects[0].point;
			destroyTerrain(point);
		}
	}

	function destroyTerrain(impactPoint) {
		const geometry = planet.geometry;
		const vertices = geometry.attributes.position.array;
		const colors = geometry.attributes.color.array;
		
		// Find vertices within destruction radius
		for (let i = 0; i < vertices.length; i += 3) {
			const x = vertices[i];
			const y = vertices[i + 1];
			const z = vertices[i + 2];
			
			const distance = Math.sqrt(
				(x - impactPoint.x) ** 2 + 
				(y - impactPoint.y) ** 2 + 
				(z - impactPoint.z) ** 2
			);
			
			if (distance < DESTRUCTION_RADIUS) {
				const factor = 1 - (distance / DESTRUCTION_RADIUS);
				const vertexIndex = i / 3;
				
				// Calculate how much to lower the terrain
				const currentRadius = Math.sqrt(x * x + y * y + z * z);
				const destructionDepth = factor * 3;
				const newRadius = Math.max(PLANET_RADIUS - 2, currentRadius - destructionDepth);
				
				// Normalize and apply new radius
				const length = Math.sqrt(x * x + y * y + z * z);
				const nx = x / length;
				const ny = y / length;
				const nz = z / length;
				
				vertices[i] = nx * newRadius;
				vertices[i + 1] = ny * newRadius;
				vertices[i + 2] = nz * newRadius;
				
				// Update height data
				heightData[vertexIndex] = newRadius;
				
				// Update colors based on new height
				const height = newRadius - PLANET_RADIUS;
				let color;
				
				if (height < -1) {
					// Deep crater - dark rock
					color = new THREE.Color(0.2, 0.15, 0.1);
				} else if (height < 0) {
					// Crater - exposed rock
					color = new THREE.Color(0.4, 0.3, 0.2);
				} else {
					// Surface terrain (unchanged)
					continue;
				}
				
				colors[i] = color.r;
				colors[i + 1] = color.g;
				colors[i + 2] = color.b;
			}
		}
		
		// Update geometry
		geometry.attributes.position.needsUpdate = true;
		geometry.attributes.color.needsUpdate = true;
		geometry.computeVertexNormals();
		
		// Update water to flow into crater
		updateWaterFlow(impactPoint);
	}

	function updateWaterFlow(impactPoint) {
		// Start water flow simulation after terrain destruction
		simulateWaterFlow(impactPoint);
	}

	function simulateWaterFlow(impactPoint) {
		const waterGeometry = water.geometry;
		const waterVertices = waterGeometry.attributes.position.array;
		const planetVertices = planet.geometry.attributes.position.array;
		
		// Initialize base water levels if not already done
		if (!water.userData.baseWaterLevels) {
			water.userData.baseWaterLevels = [...waterVertices];
		}
		
		// Create a grid to track water levels for flow simulation
		const waterLevels = [];
		const terrainHeights = [];
		
		// Calculate current water levels and terrain heights
		for (let i = 0; i < waterVertices.length; i += 3) {
			const x = waterVertices[i];
			const y = waterVertices[i + 1];
			const z = waterVertices[i + 2];
			const waterRadius = Math.sqrt(x * x + y * y + z * z);
			waterLevels.push(waterRadius);
			
			// Find corresponding terrain height
			const vertexIndex = i / 3;
			let terrainHeight = PLANET_RADIUS;
			
			// Find closest planet vertex to get terrain height
			if (vertexIndex * 3 < planetVertices.length) {
				const tx = planetVertices[i];
				const ty = planetVertices[i + 1];
				const tz = planetVertices[i + 2];
				terrainHeight = Math.sqrt(tx * tx + ty * ty + tz * tz);
			}
			
			terrainHeights.push(terrainHeight);
		}
		
		// Flow simulation - water flows from higher to lower areas
		const newWaterLevels = [...waterLevels];
		const flowRate = 0.05; // How fast water flows
		
		for (let i = 0; i < waterLevels.length; i++) {
			const currentWaterLevel = waterLevels[i];
			const currentTerrainHeight = terrainHeights[i];
			
			// Water can't go below terrain
			const minWaterLevel = Math.max(currentTerrainHeight + 0.02, WATER_LEVEL - 2);
			
			// Find neighboring vertices and their water levels
			const neighbors = getNeighborIndices(i, waterVertices.length / 3);
			let totalFlow = 0;
			let neighborCount = 0;
			
			for (const neighborIdx of neighbors) {
				if (neighborIdx >= 0 && neighborIdx < waterLevels.length) {
					const neighborWaterLevel = waterLevels[neighborIdx];
					const neighborTerrainHeight = terrainHeights[neighborIdx];
					
					// Calculate water level difference
					const waterDifference = currentWaterLevel - neighborWaterLevel;
					
					// Only flow if there's a significant difference and neighbor can accept water
					if (Math.abs(waterDifference) > 0.05) {
						const maxNeighborWater = Math.max(neighborTerrainHeight + 0.02, WATER_LEVEL);
						
						if (waterDifference > 0 && neighborWaterLevel < maxNeighborWater) {
							// Flow from current to neighbor (current has more water)
							totalFlow -= waterDifference * flowRate;
						} else if (waterDifference < 0 && currentWaterLevel < WATER_LEVEL) {
							// Flow from neighbor to current (neighbor has more water)
							totalFlow -= waterDifference * flowRate;
						}
					}
					neighborCount++;
				}
			}
			
			// Apply flow and ensure water doesn't go below terrain
			if (neighborCount > 0) {
				newWaterLevels[i] = Math.max(minWaterLevel, 
					Math.min(WATER_LEVEL + 1, currentWaterLevel + totalFlow / neighborCount));
			}
		}
		
		// Apply the new water levels to the geometry
		for (let i = 0; i < waterVertices.length; i += 3) {
			const vertexIndex = i / 3;
			const newRadius = newWaterLevels[vertexIndex];
			
			// Normalize direction
			const x = waterVertices[i];
			const y = waterVertices[i + 1];
			const z = waterVertices[i + 2];
			const length = Math.sqrt(x * x + y * y + z * z);
			const nx = x / length;
			const ny = y / length;
			const nz = z / length;
			
			// Update water vertex position
			waterVertices[i] = nx * newRadius;
			waterVertices[i + 1] = ny * newRadius;
			waterVertices[i + 2] = nz * newRadius;
			
			// Update base water levels
			water.userData.baseWaterLevels[i] = nx * newRadius;
			water.userData.baseWaterLevels[i + 1] = ny * newRadius;
			water.userData.baseWaterLevels[i + 2] = nz * newRadius;
		}
		
		waterGeometry.attributes.position.needsUpdate = true;
		waterGeometry.computeVertexNormals();
	}

	function getNeighborIndices(vertexIndex, totalVertices) {
		// Improved neighbor finding for sphere geometry with higher subdivision
		const neighbors = [];
		const segmentsHorizontal = SEGMENTS;
		const segmentsVertical = SEGMENTS / 2;
		
		const row = Math.floor(vertexIndex / segmentsHorizontal);
		const col = vertexIndex % segmentsHorizontal;
		
		// Add neighboring vertices (up, down, left, right)
		if (row > 0) neighbors.push((row - 1) * segmentsHorizontal + col);
		if (row < segmentsVertical - 1) neighbors.push((row + 1) * segmentsHorizontal + col);
		
		// Handle horizontal wrapping for spherical geometry
		const leftCol = (col - 1 + segmentsHorizontal) % segmentsHorizontal;
		const rightCol = (col + 1) % segmentsHorizontal;
		neighbors.push(row * segmentsHorizontal + leftCol);
		neighbors.push(row * segmentsHorizontal + rightCol);
		
		// Add diagonal neighbors for better flow
		if (row > 0) {
			neighbors.push((row - 1) * segmentsHorizontal + leftCol);
			neighbors.push((row - 1) * segmentsHorizontal + rightCol);
		}
		if (row < segmentsVertical - 1) {
			neighbors.push((row + 1) * segmentsHorizontal + leftCol);
			neighbors.push((row + 1) * segmentsHorizontal + rightCol);
		}
		
		return neighbors.filter(idx => idx >= 0 && idx < totalVertices);
	}

	function animate() {
		requestAnimationFrame(animate);
		
		// Rotate camera around planet
		const time = Date.now() * 0.0003;
		camera.position.x = Math.cos(time) * 40;
		camera.position.z = Math.sin(time) * 40;
		camera.lookAt(0, 0, 0);
		
		// Animate water waves - much more gentle
		if (water) {
			const waterTime = Date.now() * 0.0005; // Slower animation
			const waterGeometry = water.geometry;
			const waterVertices = waterGeometry.attributes.position.array;
			
			// Store base water level for each vertex if not already stored
			if (!water.userData.baseWaterLevels) {
				water.userData.baseWaterLevels = [...waterVertices];
			}
			
			const baseWaterLevels = water.userData.baseWaterLevels;
			
			for (let i = 0; i < waterVertices.length; i += 3) {
				// Use base water level as reference
				const baseX = baseWaterLevels[i];
				const baseY = baseWaterLevels[i + 1];
				const baseZ = baseWaterLevels[i + 2];
				
				const baseRadius = Math.sqrt(baseX * baseX + baseY * baseY + baseZ * baseZ);
				const nx = baseX / baseRadius;
				const ny = baseY / baseRadius;
				const nz = baseZ / baseRadius;
				
				// Very gentle wave motion
				const wave1 = Math.sin(baseX * 0.2 + waterTime) * 0.02;
				const wave2 = Math.cos(baseZ * 0.15 + waterTime * 0.8) * 0.015;
				const waveHeight = wave1 + wave2;
				
				const newRadius = baseRadius + waveHeight;
				
				waterVertices[i] = nx * newRadius;
				waterVertices[i + 1] = ny * newRadius;
				waterVertices[i + 2] = nz * newRadius;
			}
			
			waterGeometry.attributes.position.needsUpdate = true;
		}
		
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