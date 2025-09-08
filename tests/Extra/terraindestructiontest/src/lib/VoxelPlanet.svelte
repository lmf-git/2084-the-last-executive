<script>
	import { onMount } from 'svelte';
	import * as THREE from 'three';

	let canvas = $state();
	let scene, camera, renderer;
	let mouse = { x: 0, y: 0 };
	let raycaster = new THREE.Raycaster();
	
	// Voxel system
	const CHUNK_SIZE = 128;
	const VOXEL_SIZE = 0.08;
	const PLANET_RADIUS = 20;
	const WATER_LEVEL = 18;
	const EDITABLE_DEPTH = 5; // Only this many voxel layers from surface are editable
	
	// Voxel types
	const VOXEL_TYPE = {
		AIR: 0,
		STONE: 1,
		WATER: 2
	};

	let voxelChunks = new Map();
	let meshes = new Map();

	onMount(() => {
		init();
		generatePlanet();
		animate();
		
		return () => {
			if (renderer) {
				renderer.dispose();
			}
		};
	});

	function init() {
		scene = new THREE.Scene();
		scene.background = new THREE.Color(0x87CEEB);

		camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
		camera.position.set(0, 0, 50);

		renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
		renderer.setSize(window.innerWidth, window.innerHeight);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.2;

		// Enhanced lighting for better shadows
		const ambientLight = new THREE.AmbientLight(0x404040, 0.2);
		scene.add(ambientLight);

		// Main directional light (sun)
		const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
		directionalLight.position.set(80, 80, 80);
		directionalLight.castShadow = true;
		directionalLight.shadow.mapSize.width = 4096;
		directionalLight.shadow.mapSize.height = 4096;
		directionalLight.shadow.camera.near = 0.5;
		directionalLight.shadow.camera.far = 200;
		directionalLight.shadow.camera.left = -50;
		directionalLight.shadow.camera.right = 50;
		directionalLight.shadow.camera.top = 50;
		directionalLight.shadow.camera.bottom = -50;
		directionalLight.shadow.bias = -0.0001;
		scene.add(directionalLight);

		// Secondary light for fill lighting
		const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
		fillLight.position.set(-40, 20, -40);
		fillLight.castShadow = true;
		fillLight.shadow.mapSize.width = 2048;
		fillLight.shadow.mapSize.height = 2048;
		scene.add(fillLight);

		// Event listeners
		window.addEventListener('resize', onWindowResize);
		canvas.addEventListener('mousemove', onMouseMove);
		canvas.addEventListener('click', onMouseClick);
	}

	function generatePlanet() {
		const range = Math.ceil(PLANET_RADIUS / CHUNK_SIZE) + 1;
		
		for (let cx = -range; cx <= range; cx++) {
			for (let cy = -range; cy <= range; cy++) {
				for (let cz = -range; cz <= range; cz++) {
					const chunkKey = `${cx},${cy},${cz}`;
					const chunk = generateChunk(cx, cy, cz);
					
					if (chunk.hasVoxels) {
						voxelChunks.set(chunkKey, chunk);
						updateChunkMesh(chunkKey, chunk);
					}
				}
			}
		}
	}

	function generateChunk(chunkX, chunkY, chunkZ) {
		const chunk = {
			x: chunkX,
			y: chunkY,
			z: chunkZ,
			voxels: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE),
			editableDepth: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE), // Track distance from surface
			hasVoxels: false
		};

		const offsetX = chunkX * CHUNK_SIZE;
		const offsetY = chunkY * CHUNK_SIZE;
		const offsetZ = chunkZ * CHUNK_SIZE;

		// First pass: determine terrain surface
		const surfaceMap = new Map();

		for (let x = 0; x < CHUNK_SIZE; x++) {
			for (let y = 0; y < CHUNK_SIZE; y++) {
				for (let z = 0; z < CHUNK_SIZE; z++) {
					const worldX = (offsetX + x) * VOXEL_SIZE;
					const worldY = (offsetY + y) * VOXEL_SIZE;
					const worldZ = (offsetZ + z) * VOXEL_SIZE;

					const distanceFromCenter = Math.sqrt(worldX * worldX + worldY * worldY + worldZ * worldZ);
					
					// Generate terrain surface with detailed noise
					const noise1 = Math.sin(worldX * 0.08) * Math.cos(worldY * 0.08) * Math.sin(worldZ * 0.08);
					const noise2 = Math.sin(worldX * 0.16) * Math.cos(worldY * 0.16) * Math.sin(worldZ * 0.16) * 0.5;
					const noise3 = Math.sin(worldX * 0.32) * Math.cos(worldY * 0.32) * Math.sin(worldZ * 0.32) * 0.25;
					const noise4 = Math.sin(worldX * 0.64) * Math.cos(worldY * 0.64) * Math.sin(worldZ * 0.64) * 0.125;
					const noise5 = Math.sin(worldX * 1.28) * Math.cos(worldY * 1.28) * Math.sin(worldZ * 1.28) * 0.0625;
					const terrainRadius = PLANET_RADIUS + noise1 * 3 + noise2 * 1.5 + noise3 * 0.75 + noise4 * 0.375 + noise5 * 0.1875;

					const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;

					if (distanceFromCenter <= PLANET_RADIUS - 2) {
						// Core - always solid, not editable
						chunk.voxels[index] = VOXEL_TYPE.STONE;
						chunk.editableDepth[index] = 255; // Not editable (max depth)
						chunk.hasVoxels = true;
					} else if (distanceFromCenter <= terrainRadius) {
						// Surface terrain - potentially editable
						chunk.voxels[index] = VOXEL_TYPE.STONE;
						// Calculate depth from surface (0 = surface, higher = deeper)
						const depthFromSurface = Math.max(0, terrainRadius - distanceFromCenter);
						chunk.editableDepth[index] = Math.min(255, Math.floor(depthFromSurface / VOXEL_SIZE));
						chunk.hasVoxels = true;
					} else if (distanceFromCenter <= WATER_LEVEL && terrainRadius < WATER_LEVEL) {
						// Water - only where terrain is below water level
						chunk.voxels[index] = VOXEL_TYPE.WATER;
						chunk.editableDepth[index] = 0; // Water is always editable
						chunk.hasVoxels = true;
					} else {
						// Air
						chunk.voxels[index] = VOXEL_TYPE.AIR;
						chunk.editableDepth[index] = 0;
					}
				}
			}
		}

		return chunk;
	}

	function updateChunkMesh(chunkKey, chunk) {
		// Remove existing mesh
		const existingMesh = meshes.get(chunkKey);
		if (existingMesh) {
			scene.remove(existingMesh);
			existingMesh.geometry.dispose();
			existingMesh.material.dispose();
		}

		// Generate new mesh using simple cube-based approach (can be upgraded to marching cubes later)
		const geometry = new THREE.BufferGeometry();
		const vertices = [];
		const colors = [];
		const indices = [];

		let vertexIndex = 0;

		const offsetX = chunk.x * CHUNK_SIZE * VOXEL_SIZE;
		const offsetY = chunk.y * CHUNK_SIZE * VOXEL_SIZE;
		const offsetZ = chunk.z * CHUNK_SIZE * VOXEL_SIZE;

		for (let x = 0; x < CHUNK_SIZE; x++) {
			for (let y = 0; y < CHUNK_SIZE; y++) {
				for (let z = 0; z < CHUNK_SIZE; z++) {
					const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
					const voxelType = chunk.voxels[index];

					if (voxelType === VOXEL_TYPE.AIR || voxelType === VOXEL_TYPE.WATER) continue;

					const worldX = offsetX + x * VOXEL_SIZE;
					const worldY = offsetY + y * VOXEL_SIZE;
					const worldZ = offsetZ + z * VOXEL_SIZE;

					// Check if voxel has exposed faces
					const neighbors = [
						getVoxel(chunk, x + 1, y, z), // right
						getVoxel(chunk, x - 1, y, z), // left
						getVoxel(chunk, x, y + 1, z), // top
						getVoxel(chunk, x, y - 1, z), // bottom
						getVoxel(chunk, x, y, z + 1), // front
						getVoxel(chunk, x, y, z - 1)  // back
					];

					// Add faces for exposed sides
					if (neighbors[0] === VOXEL_TYPE.AIR) { addFace(vertices, colors, indices, worldX + VOXEL_SIZE, worldY, worldZ, 'right', voxelType, vertexIndex); vertexIndex++; }
					if (neighbors[1] === VOXEL_TYPE.AIR) { addFace(vertices, colors, indices, worldX, worldY, worldZ, 'left', voxelType, vertexIndex); vertexIndex++; }
					if (neighbors[2] === VOXEL_TYPE.AIR) { addFace(vertices, colors, indices, worldX, worldY + VOXEL_SIZE, worldZ, 'top', voxelType, vertexIndex); vertexIndex++; }
					if (neighbors[3] === VOXEL_TYPE.AIR) { addFace(vertices, colors, indices, worldX, worldY, worldZ, 'bottom', voxelType, vertexIndex); vertexIndex++; }
					if (neighbors[4] === VOXEL_TYPE.AIR) { addFace(vertices, colors, indices, worldX, worldY, worldZ + VOXEL_SIZE, 'front', voxelType, vertexIndex); vertexIndex++; }
					if (neighbors[5] === VOXEL_TYPE.AIR) { addFace(vertices, colors, indices, worldX, worldY, worldZ, 'back', voxelType, vertexIndex); vertexIndex++; }
				}
			}
		}

		if (vertices.length === 0) return;

		geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		geometry.setIndex(indices);
		geometry.computeVertexNormals();

		const material = new THREE.MeshLambertMaterial({ 
			vertexColors: true,
			transparent: false,
			side: THREE.FrontSide
		});

		const mesh = new THREE.Mesh(geometry, material);
		mesh.receiveShadow = true;
		mesh.castShadow = true;
		mesh.frustumCulled = true;
		
		scene.add(mesh);
		meshes.set(chunkKey, mesh);
	}

	function getVoxel(chunk, x, y, z) {
		if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
			return VOXEL_TYPE.AIR; // Assume air outside chunk bounds
		}
		const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
		return chunk.voxels[index];
	}

	function addFace(vertices, colors, indices, x, y, z, face, voxelType, vertexIndex) {
		const halfSize = VOXEL_SIZE / 2;
		let faceVertices = [];
		
		// Define vertices for each face
		switch (face) {
			case 'right':
				faceVertices = [
					x, y - halfSize, z - halfSize,
					x, y + halfSize, z - halfSize,
					x, y + halfSize, z + halfSize,
					x, y - halfSize, z + halfSize
				];
				break;
			case 'left':
				faceVertices = [
					x, y - halfSize, z + halfSize,
					x, y + halfSize, z + halfSize,
					x, y + halfSize, z - halfSize,
					x, y - halfSize, z - halfSize
				];
				break;
			case 'top':
				faceVertices = [
					x - halfSize, y, z - halfSize,
					x + halfSize, y, z - halfSize,
					x + halfSize, y, z + halfSize,
					x - halfSize, y, z + halfSize
				];
				break;
			case 'bottom':
				faceVertices = [
					x - halfSize, y, z + halfSize,
					x + halfSize, y, z + halfSize,
					x + halfSize, y, z - halfSize,
					x - halfSize, y, z - halfSize
				];
				break;
			case 'front':
				faceVertices = [
					x - halfSize, y - halfSize, z,
					x + halfSize, y - halfSize, z,
					x + halfSize, y + halfSize, z,
					x - halfSize, y + halfSize, z
				];
				break;
			case 'back':
				faceVertices = [
					x + halfSize, y - halfSize, z,
					x - halfSize, y - halfSize, z,
					x - halfSize, y + halfSize, z,
					x + halfSize, y + halfSize, z
				];
				break;
		}

		vertices.push(...faceVertices);

		// Add colors based on voxel type and position
		let color = [0.5, 0.5, 0.5]; // default gray
		if (voxelType === VOXEL_TYPE.STONE) {
			// Vary color based on height and noise for terrain variation
			const height = Math.sqrt(x*x + y*y + z*z);
			const variation = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 0.1;
			
			if (height > 19) {
				// High peaks - rocky/snowy
				color = [0.7 + variation, 0.7 + variation, 0.8 + variation];
			} else if (height > 18.5) {
				// Mountain terrain - brown/gray
				color = [0.5 + variation, 0.4 + variation, 0.3 + variation];
			} else {
				// Lower terrain - green/brown
				color = [0.3 + variation, 0.5 + variation, 0.2 + variation];
			}
		}

		for (let i = 0; i < 4; i++) {
			colors.push(...color);
		}

		// Add face indices (two triangles per face)
		const baseIndex = vertexIndex * 4;
		indices.push(
			baseIndex, baseIndex + 1, baseIndex + 2,
			baseIndex, baseIndex + 2, baseIndex + 3
		);
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
		
		// Find intersection with voxel meshes
		const meshArray = Array.from(meshes.values());
		const intersects = raycaster.intersectObjects(meshArray);
		
		if (intersects.length > 0) {
			const point = intersects[0].point;
			destroyVoxelsAt(point, 3); // Destroy voxels in radius of 3
		}
	}

	function destroyVoxelsAt(point, radius) {
		const radiusSquared = radius * radius;
		
		// Find affected chunks
		const minChunkX = Math.floor((point.x - radius) / (CHUNK_SIZE * VOXEL_SIZE));
		const maxChunkX = Math.floor((point.x + radius) / (CHUNK_SIZE * VOXEL_SIZE));
		const minChunkY = Math.floor((point.y - radius) / (CHUNK_SIZE * VOXEL_SIZE));
		const maxChunkY = Math.floor((point.y + radius) / (CHUNK_SIZE * VOXEL_SIZE));
		const minChunkZ = Math.floor((point.z - radius) / (CHUNK_SIZE * VOXEL_SIZE));
		const maxChunkZ = Math.floor((point.z + radius) / (CHUNK_SIZE * VOXEL_SIZE));

		const chunksToUpdate = new Set();

		for (let cx = minChunkX; cx <= maxChunkX; cx++) {
			for (let cy = minChunkY; cy <= maxChunkY; cy++) {
				for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
					const chunkKey = `${cx},${cy},${cz}`;
					const chunk = voxelChunks.get(chunkKey);
					
					if (!chunk) continue;

					const offsetX = cx * CHUNK_SIZE * VOXEL_SIZE;
					const offsetY = cy * CHUNK_SIZE * VOXEL_SIZE;
					const offsetZ = cz * CHUNK_SIZE * VOXEL_SIZE;

					let chunkModified = false;

					for (let x = 0; x < CHUNK_SIZE; x++) {
						for (let y = 0; y < CHUNK_SIZE; y++) {
							for (let z = 0; z < CHUNK_SIZE; z++) {
								const worldX = offsetX + x * VOXEL_SIZE;
								const worldY = offsetY + y * VOXEL_SIZE;
								const worldZ = offsetZ + z * VOXEL_SIZE;

								const distanceSquared = 
									(worldX - point.x) ** 2 + 
									(worldY - point.y) ** 2 + 
									(worldZ - point.z) ** 2;

								if (distanceSquared <= radiusSquared) {
									const index = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
									const currentVoxel = chunk.voxels[index];
									const depth = chunk.editableDepth[index];
									
									// Only allow editing if:
									// 1. It's not air already
									// 2. It's within editable depth (surface layer or water)
									// 3. It's not part of the planet core
									if (currentVoxel !== VOXEL_TYPE.AIR && 
										(depth <= EDITABLE_DEPTH || currentVoxel === VOXEL_TYPE.WATER)) {
										chunk.voxels[index] = VOXEL_TYPE.AIR;
										chunkModified = true;
									}
								}
							}
						}
					}

					if (chunkModified) {
						chunksToUpdate.add(chunkKey);
					}
				}
			}
		}

		// Update meshes for modified chunks
		chunksToUpdate.forEach(chunkKey => {
			const chunk = voxelChunks.get(chunkKey);
			updateChunkMesh(chunkKey, chunk);
		});

		// Simulate water flow after destruction
		simulateWaterFlow(Array.from(chunksToUpdate));
	}

	function simulateWaterFlow(affectedChunkKeys) {
		// Simple water flow simulation - water falls down if there's empty space below
		affectedChunkKeys.forEach(chunkKey => {
			const chunk = voxelChunks.get(chunkKey);
			if (!chunk) return;

			const newVoxels = new Uint8Array(chunk.voxels);

			for (let x = 0; x < CHUNK_SIZE; x++) {
				for (let y = CHUNK_SIZE - 2; y >= 0; y--) { // Start from second-to-bottom
					for (let z = 0; z < CHUNK_SIZE; z++) {
						const currentIndex = x + y * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;
						const belowIndex = x + (y + 1) * CHUNK_SIZE + z * CHUNK_SIZE * CHUNK_SIZE;

						// If current voxel is water and below is air, move water down
						if (chunk.voxels[currentIndex] === VOXEL_TYPE.WATER && chunk.voxels[belowIndex] === VOXEL_TYPE.AIR) {
							newVoxels[currentIndex] = VOXEL_TYPE.AIR;
							newVoxels[belowIndex] = VOXEL_TYPE.WATER;
						}
					}
				}
			}

			chunk.voxels = newVoxels;
			updateChunkMesh(chunkKey, chunk);
		});
	}

	function animate() {
		requestAnimationFrame(animate);
		
		// Rotate camera around planet
		const time = Date.now() * 0.0005;
		camera.position.x = Math.cos(time) * 50;
		camera.position.z = Math.sin(time) * 50;
		camera.lookAt(0, 0, 0);
		
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