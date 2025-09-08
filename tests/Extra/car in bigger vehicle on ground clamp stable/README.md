# Local Grid Physics System

A SvelteKit application demonstrating local grid-based physics with Rapier3D and Three.js, featuring:

## Features

1. **Local Grid System**: 16x16 grid for tracking entities within vehicle interiors
2. **Dynamic Rigidbody Vehicle**: Moving vehicle with locked rotation
3. **Player Capsule Controller**: Kinematic character controller that can:
   - Move independently inside the vehicle
   - Be affected by vehicle motion
   - Maintain orientation with locked rotation
4. **Interior Sensor Volume**: Detects when player enters/exits vehicle
5. **Interior Floor Collider**: Provides proper ground collision within vehicle

## Controls

### Player Controls
- **WASD**: Move player
- **Space**: Jump (only outside vehicle)
- **Enter**: Enter vehicle (when close)
- **Escape**: Exit vehicle

### Vehicle Controls
- **Arrow Keys**: Move vehicle

## Architecture

The system uses static methods instead of traditional classes:

### PhysicsWorld
- Manages Three.js scene and Rapier physics world
- Handles rendering and physics stepping
- Creates dynamic and kinematic bodies

### Vehicle
- Dynamic rigidbody with locked rotation
- Contains local grid for interior entity tracking
- Provides coordinate transformation between world and local space
- Tracks entities inside via sensor volumes

### Player
- Kinematic capsule controller
- Switches between world-space and local-space movement
- Affected by vehicle motion when inside

### LocalGrid
- 16x16 grid system for efficient spatial queries
- Supports pathfinding and entity tracking
- Handles coordinate conversion between world and grid space

## Physics Concepts

1. **Coordinate Transformation**: Player movement is transformed between world space and vehicle local space
2. **Vehicle Motion Integration**: Player inherits vehicle velocity for realistic physics
3. **Sensor Volumes**: Interior detection using physics sensors
4. **Locked Rotation**: Vehicle maintains upright orientation while allowing translation

## Use Cases

This system is ideal for:
- Vehicle interiors in open-world games
- Space/sci-fi simulators (ships, stations)
- VR locomotion systems
- Physics-aware moving platforms

## Running

```bash
yarn install
yarn dev
```

Navigate to `http://localhost:5173` to test the system.