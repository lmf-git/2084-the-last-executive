import * as THREE from 'three';

/**
 * Local grid system for tracking entities within a vehicle
 */
export class LocalGrid {
	static create(width, height, cellSize = 0.5) {
		return {
			width,
			height,
			cellSize,
			grid: new Array(width * height).fill(null).map(() => new Set()),
			entities: new Map()
		};
	}

	static worldToGrid(grid, worldPos) {
		const gridX = Math.floor((worldPos.x + (grid.width * grid.cellSize) / 2) / grid.cellSize);
		const gridZ = Math.floor((worldPos.z + (grid.height * grid.cellSize) / 2) / grid.cellSize);
		
		return {
			x: Math.max(0, Math.min(grid.width - 1, gridX)),
			z: Math.max(0, Math.min(grid.height - 1, gridZ))
		};
	}

	static gridToWorld(grid, gridX, gridZ) {
		const worldX = (gridX * grid.cellSize) - (grid.width * grid.cellSize) / 2 + grid.cellSize / 2;
		const worldZ = (gridZ * grid.cellSize) - (grid.height * grid.cellSize) / 2 + grid.cellSize / 2;
		
		return new THREE.Vector3(worldX, 0, worldZ);
	}

	static getCellIndex(grid, gridX, gridZ) {
		return gridZ * grid.width + gridX;
	}

	static addEntity(grid, entity, localPos) {
		const gridPos = LocalGrid.worldToGrid(grid, localPos);
		
		// Check if position is within grid bounds
		if (gridPos.x < 0 || gridPos.x >= grid.width || 
			gridPos.z < 0 || gridPos.z >= grid.height) {
			console.warn('Entity position outside grid bounds, not adding to grid:', entity.id);
			return;
		}
		
		const cellIndex = LocalGrid.getCellIndex(grid, gridPos.x, gridPos.z);
		
		// Remove from old cell if exists
		if (grid.entities.has(entity.id)) {
			const oldCellIndex = grid.entities.get(entity.id).cellIndex;
			grid.grid[oldCellIndex].delete(entity);
		}
		
		// Add to new cell
		grid.grid[cellIndex].add(entity);
		grid.entities.set(entity.id, {
			entity,
			cellIndex,
			gridPos,
			localPos: localPos.clone()
		});
	}

	static removeEntity(grid, entity) {
		if (grid.entities.has(entity.id)) {
			const entityData = grid.entities.get(entity.id);
			grid.grid[entityData.cellIndex].delete(entity);
			grid.entities.delete(entity.id);
		}
	}

	static updateEntityPosition(grid, entity, newLocalPos) {
		if (!grid.entities.has(entity.id)) return;
		
		const newGridPos = LocalGrid.worldToGrid(grid, newLocalPos);
		const entityData = grid.entities.get(entity.id);
		const oldGridPos = entityData.gridPos;
		
		// Check if grid position changed
		if (newGridPos.x !== oldGridPos.x || newGridPos.z !== oldGridPos.z) {
			// Remove from old cell
			grid.grid[entityData.cellIndex].delete(entity);
			
			// Check if new position is within grid bounds
			if (newGridPos.x >= 0 && newGridPos.x < grid.width && 
				newGridPos.z >= 0 && newGridPos.z < grid.height) {
				// Add to new cell
				const newCellIndex = LocalGrid.getCellIndex(grid, newGridPos.x, newGridPos.z);
				grid.grid[newCellIndex].add(entity);
				
				// Update entity data
				entityData.cellIndex = newCellIndex;
				entityData.gridPos = newGridPos;
			} else {
				// Entity is outside grid bounds, remove it from the grid system
				grid.entities.delete(entity.id);
				console.warn('Entity moved outside grid bounds, removing from grid:', entity.id);
				return;
			}
		}
		
		// Update local position
		entityData.localPos = newLocalPos.clone();
	}

	static getEntitiesInCell(grid, gridX, gridZ) {
		const cellIndex = LocalGrid.getCellIndex(grid, gridX, gridZ);
		return Array.from(grid.grid[cellIndex]);
	}

	static getEntitiesInRadius(grid, centerPos, radius) {
		const entities = [];
		const centerGrid = LocalGrid.worldToGrid(grid, centerPos);
		const cellRadius = Math.ceil(radius / grid.cellSize);
		
		for (let x = centerGrid.x - cellRadius; x <= centerGrid.x + cellRadius; x++) {
			for (let z = centerGrid.z - cellRadius; z <= centerGrid.z + cellRadius; z++) {
				if (x >= 0 && x < grid.width && z >= 0 && z < grid.height) {
					const cellEntities = LocalGrid.getEntitiesInCell(grid, x, z);
					cellEntities.forEach(entity => {
						const entityData = grid.entities.get(entity.id);
						if (entityData && entityData.localPos.distanceTo(centerPos) <= radius) {
							entities.push(entity);
						}
					});
				}
			}
		}
		
		return entities;
	}

	static findPath(grid, start, end) {
		const startGrid = LocalGrid.worldToGrid(grid, start);
		const endGrid = LocalGrid.worldToGrid(grid, end);
		
		// Simple A* pathfinding
		const openSet = [{ x: startGrid.x, z: startGrid.z, f: 0, g: 0, h: 0, parent: null }];
		const closedSet = new Set();
		const visited = new Array(grid.width * grid.height).fill(false);
		
		while (openSet.length > 0) {
			// Find node with lowest f score
			let currentIndex = 0;
			for (let i = 1; i < openSet.length; i++) {
				if (openSet[i].f < openSet[currentIndex].f) {
					currentIndex = i;
				}
			}
			
			const current = openSet.splice(currentIndex, 1)[0];
			const currentKey = `${current.x},${current.z}`;
			closedSet.add(currentKey);
			
			// Check if we reached the end
			if (current.x === endGrid.x && current.z === endGrid.z) {
				const path = [];
				let node = current;
				while (node) {
					path.unshift(LocalGrid.gridToWorld(grid, node.x, node.z));
					node = node.parent;
				}
				return path;
			}
			
			// Check neighbors
			const neighbors = [
				{ x: current.x + 1, z: current.z },
				{ x: current.x - 1, z: current.z },
				{ x: current.x, z: current.z + 1 },
				{ x: current.x, z: current.z - 1 }
			];
			
			for (const neighbor of neighbors) {
				const neighborKey = `${neighbor.x},${neighbor.z}`;
				
				// Skip if out of bounds or already visited
				if (neighbor.x < 0 || neighbor.x >= grid.width || 
					neighbor.z < 0 || neighbor.z >= grid.height ||
					closedSet.has(neighborKey)) {
					continue;
				}
				
				// Calculate scores
				const g = current.g + 1;
				const h = Math.abs(neighbor.x - endGrid.x) + Math.abs(neighbor.z - endGrid.z);
				const f = g + h;
				
				// Check if this path is better
				const existingIndex = openSet.findIndex(node => node.x === neighbor.x && node.z === neighbor.z);
				
				if (existingIndex === -1) {
					openSet.push({
						x: neighbor.x,
						z: neighbor.z,
						f, g, h,
						parent: current
					});
				} else if (g < openSet[existingIndex].g) {
					openSet[existingIndex].g = g;
					openSet[existingIndex].f = f;
					openSet[existingIndex].parent = current;
				}
			}
		}
		
		return []; // No path found
	}

	static isPositionBlocked(grid, localPos) {
		const gridPos = LocalGrid.worldToGrid(grid, localPos);
		const entities = LocalGrid.getEntitiesInCell(grid, gridPos.x, gridPos.z);
		
		// Check if any entity blocks this position
		return entities.some(entity => {
			const entityData = grid.entities.get(entity.id);
			return entityData && entityData.localPos.distanceTo(localPos) < 0.5; // Blocking radius
		});
	}

	static getGridVisualization(grid) {
		const visualization = [];
		
		for (let z = 0; z < grid.height; z++) {
			for (let x = 0; x < grid.width; x++) {
				const entities = LocalGrid.getEntitiesInCell(grid, x, z);
				const worldPos = LocalGrid.gridToWorld(grid, x, z);
				
				visualization.push({
					x, z,
					worldPos,
					entityCount: entities.length,
					entities: entities.map(e => e.id)
				});
			}
		}
		
		return visualization;
	}
}