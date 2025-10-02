# 2084: The Last Executive

**Version:** 0.0
**Genre:** First-Person Shooter (FPS)
**Platform:** PC (Steam, Itch.io), Console (Xbox, PlayStation)
**Target Audience:** Fans of gritty, narrative-driven FPS games like "Call of Duty 4: Modern Warfare" and the world-building of "Battlestar Galactica"

A single-player FPS set in a post-apocalyptic world devastated by "The Decimation" (2081-2084). Players alternate between Corporal Kaelen Vex (FAS) and Sergeant Anya Sharma (RNC), two soldiers on opposing sides of a brutal proxy war. As they fight, both discover their conflict is orchestrated by "The Executive," a shadow figure manipulating both factions. The campaign spans six levels, culminating in former enemies uniting to expose the conspiracy and end the senseless war.

Inspired by Battlestar Galactica and Call of Duty 4, the game combines grounded military realism with selective sci-fi elements, emphasizing environmental storytelling and the human cost of manipulation and conflict.

## Locations

### Planetary System Structure
The game takes place across multiple planets and moons in a colonized star system, with conflicts spanning different gravity wells and orbital positions.

### Primary Locations

#### Terra Nova (Habitable Planet - FAS Territory)
- **Type:** Earth-like terrestrial planet
- **Gravity:** 1.0g
- **Distance from System Primary:** 1.2 AU
- **Key Locations:**
  - Level 2: "The Harvest" - Northern agricultural settlements
  - FAS military command infrastructure

#### Kepler's Rest (Ice Moon - Contested Territory)
- **Type:** Frozen moon orbiting gas giant Goliath
- **Gravity:** 0.3g
- **Distance from Goliath:** 420,000 km
- **Distance from System Primary:** 5.4 AU
- **Key Locations:**
  - Level 1: "The Sinking Penitent" - Flooded penitentiary complex on thawing ice shelf
  - Underground water reservoirs

#### New Vancouver (Industrial Colony - RNC Territory)
- **Type:** Rocky moon with thin atmosphere
- **Gravity:** 0.7g
- **Distance from System Primary:** 2.8 AU
- **Key Locations:**
  - Level 3: "Harbor Gauntlet" - Coastal industrial harbor
  - RNC naval staging grounds

#### Cirrus Station (Orbital Platform - Neutral Space)
- **Type:** Derelict orbital shipyard
- **Gravity:** Variable (rotating sections 0.8g, outer sections microgravity)
- **Orbital Position:** Lagrange point between Terra Nova and gas giant Goliath
- **Key Locations:**
  - Level 4: "The Airship Graveyard" - Abandoned spacecraft maintenance bays
  - Zero-g combat zones

#### Forge Prime (Asteroid Colony - Executive's Hidden Base)
- **Type:** Hollowed asteroid with artificial gravity
- **Gravity:** 0.5g (artificial)
- **Distance from System Primary:** 3.2 AU (asteroid belt)
- **Key Locations:**
  - Level 5: "The Foundry" - Industrial manufacturing complex
  - Executive's command bunker
  - Level 6: "The Bunker" - Deep underground facility

### Travel Distances
- Terra Nova ↔ Kepler's Rest: ~630 million km (burn time: 3-5 days via military transport)
- New Vancouver ↔ Cirrus Station: ~240 million km (burn time: 1-2 days)
- Cirrus Station ↔ Forge Prime: ~280 million km (burn time: 2-3 days)

## Level Structure

### Level 1: "The Sinking Penitent" (Vex) — Equilibrium
- **Core Features:** Swimming, boats/buoyancy, destructible structures, environmental audio
- **Narrative Function:** Establishes the war's "normal state" through Vex's imprisonment; world-building via radio broadcasts, news reports, and guard behavior reveals accepted faction ideology and the established conflict

### Level 2: "The Harvest" (Vex) — Disruption
- **Core Features:** Advanced audio/visual effects, destructible cover, crowd audio and behavior
- **Narrative Function:** Disrupts Vex's acceptance of the war through brutal civilian riot suppression; destructible cover reveals desperate humanity beneath enemy labels; the moral foundation cracks

### Level 3: "Harbor Gauntlet" (Sharma) — Equilibrium (Counter-perspective)
- **Core Features:** Vehicle interiors, driving simulation, destructible vehicle parts, seamless transitions
- **Narrative Function:** Introduces Sharma's equilibrium—her belief in the RNC's righteous cause; vehicle combat from interior perspective establishes her professional competence and tactical certainty

### Level 4: "The Airship Graveyard" (Vex) — Recognition
- **Core Features:** Flying simulation, destructible vehicle parts, dynamic physics
- **Narrative Function:** Vex begins recognizing the war's true nature; aerial perspective provides literal and metaphorical distance; damaged systems mirror his fragmenting worldview

### Level 5: "The Foundry" (Sharma) — Recognition/Disruption
- **Core Features:** Advanced locomotion, ragdoll systems, environmental physics
- **Narrative Function:** Sharma's disruption and recognition converge; industrial setting reveals Executive's manipulation; physical vulnerability through ragdoll physics mirrors ideological collapse

### Level 6: "The Bunker" (Both) — Resolution → New Equilibrium
- **Core Features:** All systems integration, swimming, vehicles, destruction, final confrontation mechanics
- **Narrative Function:** Former enemies resolve the conspiracy together; defeat of The Executive dissolves false conflict; new equilibrium emerges from shared understanding and unity against manipulation

## Core Gameplay Features

### Narrative Progression
- Linear, 6-level campaign with emotional and thematic arc
- Each level serves a purpose in both gameplay and storytelling
- Dual protagonist perspective switching between levels

### Core Mechanics
- **Destructible structures and player/vehicle parts**
- **Swimming and water physics**
- **Vehicle interiors and driving**
- **Flying simulation**
- **Distance-based audio**

### Visual Design
- "Semi-realistic" aesthetic with gritty, weathered textures
- Dramatic lighting to create desolate, post-apocalyptic atmosphere
- Advanced shader work for realistic materials (metal, concrete, fabric)
- Weather effects integration (rain, dust storms, fog)

## Technical Requirements

### Core Systems
1. **Destructible Environment System**
   - Real-time destruction calculations
   - Debris physics simulation
   - Performance optimization for multiple simultaneous destructions

2. **Vehicle System**
   - Static proxy interiors for seamless transitions
   - Kinematic player state management
   - Realistic vehicle physics for boats, aircraft, and ground vehicles

3. **Animation System**
   - Ragdoll physics integration
   - Smooth blending between animation states

4. **Audio System**
   - High-quality positional audio for situational awareness
   - Distinct sound profiles for weapons, environments, and physics effects
   - Realistic audio propagation in different environments

5. **Advanced Physics Systems**
   - Vehicle interiors via static proxies and kinematic player
   - Boats/buoyancy/player swimming
   - Player falling, ground orientation/projected movement
   - Spherical planets (detail method)
   - Grounding and falling quaternion movement
   - Interior system
   - Floating origin
   - Animation and IK ragdoll gltf
   - Advanced shaders/appearance

## Asset Pipeline

### Tools
- **Engine:** Godot 4.x
- **Version Control:** Git with LFS for binary assets
- **3D Modeling/Animation:** Blender

### Standards
- **Model Export:** GLTF 2.0 with separate .bin buffer files
- **Texture Format:** PNG source files; engine converts to compressed formats (BC7/ASTC)
- **Texture Resolution:** 2K base (2048x2048), 4K for hero assets, 1K for background objects
- **PBR Textures:** Base Color (sRGB), Normal (Linear), Metallic/Roughness (Linear, packed), Ambient Occlusion (Linear)
- **Poly Budget:** Characters 15-25k tris, Vehicles 20-40k tris, Props 500-5k tris (LOD0)
- **Audio Format:** 44.1kHz Ogg Vorbis for SFX, music; positional audio via Godot's AudioStreamPlayer3D