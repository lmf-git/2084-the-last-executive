# 2084: The Last Executive

**Version:** 0.0
**Genre:** First-Person Shooter (FPS)
**Platform:** PC (Steam, Itch.io), Console (Xbox, PlayStation)
**Target Audience:** Fans of gritty, narrative-driven FPS games like "Call of Duty 4: Modern Warfare" and the world-building of "Battlestar Galactica"

A single-player FPS set in a post-apocalyptic world devastated by "The Decimation" (2081-2084). Players alternate between Corporal Kaelen Vex (FAS) and Sergeant Anya Sharma (RNC), two soldiers on opposing sides of a brutal proxy war. As they fight, both discover their conflict is orchestrated by "The Executive," a shadow figure manipulating both factions. The campaign spans six levels, culminating in former enemies uniting to expose the conspiracy and end the senseless war.

Inspired by Battlestar Galactica and Call of Duty 4, the game combines grounded military realism with selective sci-fi elements, emphasizing environmental storytelling and the human cost of manipulation and conflict.

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