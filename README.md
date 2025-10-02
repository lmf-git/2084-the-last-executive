# 2084: The Last Executive

**Version:** 1.0
**Genre:** First-Person Shooter (FPS)
**Platform:** PC (Steam, Itch.io), Console (Xbox, PlayStation)
**Target Audience:** Fans of gritty, narrative-driven FPS games like "Call of Duty 4: Modern Warfare" and the world-building of "Battlestar Galactica"

**2084: The Last Executive** is a single-player FPS that begins with Corporal Kaelen Vex escaping from a collapsing, flooded prison complex. Set in a post-apocalyptic world devastated by "The Decimation" (2081-2084), the game explores a brutal proxy war between two factions: the authoritarian Federation of American States (FAS) and the democratic Republic of the Northern Crescent (RNC).

Players alternate between two protagonists - Vex (FAS) and Sergeant Anya Sharma (RNC) - as they gradually discover their conflict is orchestrated by "The Executive," a shadow figure manipulating both sides. The campaign spans six levels showcasing swimming mechanics, vehicle combat, and moral choice, culminating in former enemies uniting to expose the conspiracy and end the senseless war.

Inspired by Battlestar Galactica and Call of Duty 4, the game combines grounded military realism with selective sci-fi elements, emphasizing environmental storytelling and the human cost of manipulation and conflict.

## Story Synopsis

The world of 2084 is devastated by a global conflict known as the Decimation. The campaign begins with Cpl. Kaelen Vex, a prisoner of the RNC, escaping a sinking penitentiary. After rejoining his faction, the FAS, he is forced to participate in the brutal suppression of a civilian food riot, planting seeds of disillusionment.

Simultaneously, players experience the conflict through Sgt. Anya Sharma of the RNC, a soldier fighting what she believes is a righteous war for her people. Both protagonists gradually discover the war is a proxy conflict masterminded by "The Executive," a former US president turned warlord.

Their paths converge in the final level as they unite to take down The Executive and end the senseless bloodshed, realizing they have more in common with each other than with the leaders they've been fighting for.

## Level Structure

### Level 1: "The Sinking Penitent" (Vex)
- **Core Features:** Swimming, boats/buoyancy, destructible structures, environmental audio
- **Narrative Purpose:** Character introduction, world establishment through overheard radio broadcasts, news reports, and guard behavior; faction ideology exposition

### Level 2: "The Harvest" (Vex)
- **Core Features:** Advanced audio/visual effects, destructible cover, crowd audio and behavior
- **Narrative Purpose:** Moral complexity introduction through civilian riot suppression; destructible cover reveals desperate civilians; Vex's disillusionment begins

### Level 3: "Harbor Gauntlet" (Sharma)
- **Core Features:** Vehicle interiors, driving simulation, destructible vehicle parts, seamless transitions
- **Narrative Purpose:** Sharma introduction; experience war from vehicle interior perspective with destructible parts affecting functionality; tactical contrast to Vex's missions

### Level 4: "The Airship Graveyard" (Vex)
- **Core Features:** Flying simulation, destructible vehicle parts, dynamic physics
- **Narrative Purpose:** Escalation through aerial combat; damaged aircraft parts affect flight control; Vex's growing skepticism

### Level 5: "The Foundry" (Sharma)
- **Core Features:** Advanced locomotion, ragdoll systems, environmental physics
- **Narrative Purpose:** Technology revelation through industrial hazards; ragdoll physics during accidents; Sharma's turning point

### Level 6: "The Bunker" (Both)
- **Core Features:** All systems integration, swimming, vehicles, destruction, final confrontation mechanics
- **Narrative Purpose:** Character convergence; all gameplay systems unite in climactic multi-phase encounter; resolution of conspiracy

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

## Technical Constraints
- Target 60 FPS on modern PC hardware
- Scalable graphics settings for various hardware configurations

## Asset Pipeline
- Standardized dimensions for promotional materials
- Modular asset creation for efficient development
- Version control system for collaborative development