# 2084: The Last Executive
## Game Project Plan

**Version:** 1.0  
**Genre:** First-Person Shooter (FPS)  
**Platform:** PC (Steam, Itch.io), Console (Xbox, PlayStation)  
**Target Audience:** Fans of gritty, narrative-driven FPS games

## Synopsis

**2084: The Last Executive** is a single-player FPS that begins with Corporal Kaelen Vex escaping from a collapsing, flooded prison complex. Set in a post-apocalyptic world devastated by "The Decimation" (2081-2084), the game explores a brutal proxy war between two factions: the authoritarian Federation of American States (FAS) and the democratic Republic of the Northern Crescent (RNC).

Players alternate between two protagonists - Vex (FAS) and Sergeant Anya Sharma (RNC) - as they gradually discover their conflict is orchestrated by "The Executive," a shadow figure manipulating both sides. The campaign spans six levels showcasing swimming mechanics, vehicle combat, gravity manipulation, and moral choice, culminating in former enemies uniting to expose the conspiracy and end the senseless war.

Inspired by Battlestar Galactica and Call of Duty 4, the game combines grounded military realism with selective sci-fi elements, emphasizing environmental storytelling and the human cost of manipulation and conflict.

## Game Design Document

### Overview

- **Title:** 2084: The Last Executive
- **Genre:** First-Person Shooter (FPS)
- **Platform:** PC (Steam, Itch.io)
- **Target Audience:** Fans of gritty, narrative-driven FPS games like "Call of Duty 4: Modern Warfare" and the world-building of "Battlestar Galactica"
- **Unique Selling Point:** A campaign that blends grounded military combat with jarring sci-fi elements (point gravity), and a dual-perspective narrative that explores the moral ambiguity of a brutal proxy war

"2084: The Last Executive" is a single-player, narrative-driven FPS set in a post-apocalyptic world torn apart by a brutal proxy war. Players experience the conflict through the eyes of two protagonists from opposing factions, ultimately discovering they are pawns in a larger conspiracy.

### Project Structure

```
2084-the-last-executive/
├── README.md
├── docs/
│   ├── Game_Design_Document.md
│   ├── entities/
│   │   ├── characters/
│   │   ├── factions/
│   │   └── locations/
│   ├── lore/
│   │   └── World_Lore.md
│   ├── concept_art/
│   │   ├── characters/
│   │   ├── environments/
│   │   ├── vehicles/
│   │   ├── weapons/
│   │   ├── ui/
│   │   └── marketing/
│   ├── storyboards/
│   │   ├── characters/
│   │   ├── environments/
│   │   ├── vehicles/
│   │   └── ui/
│   └── media_assets/
│       └── marketing/
└── levels/
    ├── Level_01_Sinking_Penitent.md
    ├── Level_02_The_Harvest.md
    ├── Level_03_Harbor_Gauntlet.md
    ├── Level_04_The_Airship_Graveyard.md
    ├── Level_05_The_Foundry.md
    └── Level_06_The_Bunker.md
```

## Core Gameplay Features

### Player Input
- Standard FPS controls (WASD, Mouse look, Sprint, Crouch, Jump, etc.)
- Context-sensitive interactions for vehicles and special mechanics

### Narrative Progression
- Linear, 6-level campaign with emotional and thematic arc
- Each level serves a purpose in both gameplay and storytelling
- Dual protagonist perspective switching between levels

### Physics & Interaction

#### Core Features
- **Destructible structures and player/vehicle parts**
- **Vehicle interiors via static proxies and kinematic player**
- **Boats/buoyancy/player swimming**
- **Point gravity with dynamic rigid body player**
- **Flying simulation**
- **Driving simulation**
- **Player falling, ground orientation/projected movement**
- **Advanced shaders/appearance**
- **Player IK/ragdoll/animation blending**
- **High-quality positional audio**

#### Destructible Environments
- Strategic, not cosmetic destruction
- Players can target specific elements to create paths or expose enemies
- Realistic damage modeling for structures and vehicles

#### Advanced Locomotion
- Seamless blend of player animations (IK) with dynamic physics (ragdoll)
- Realistic movement and reaction to impacts
- Ground orientation and projected movement along surface normals

#### Water Physics
- Realistic buoyancy system for boats
- Responsive swimming controls for underwater navigation
- Dynamic water interaction with destructible elements

#### Point Gravity System
- Localized gravity emitters in specific levels
- Dynamic rigid body player with locked rotation
- Automatic ground detection via raycasting
- Smooth transitions between gravity orientations

### Audio Design
- High-quality positional audio critical for situational awareness
- Distinct sound profiles for weapons, environments, and physics effects
- Environmental audio cues for gravity shifts and mechanical events
- Realistic audio propagation in different environments

### Visual Design
- "Semi-realistic" aesthetic with gritty, weathered textures
- Dramatic lighting to create desolate, post-apocalyptic atmosphere
- Advanced shader work for realistic materials (metal, concrete, fabric)
- Weather effects integration (rain, dust storms, fog)

## Story Synopsis

The world of 2084 is devastated by a global conflict known as the Decimation. The campaign begins with Cpl. Kaelen Vex, a prisoner of the RNC, escaping a sinking penitentiary. After rejoining his faction, the FAS, he is forced to participate in the brutal suppression of a civilian food riot, planting seeds of disillusionment.

Simultaneously, players experience the conflict through Sgt. Anya Sharma of the RNC, a soldier fighting what she believes is a righteous war for her people. Both protagonists gradually discover the war is a proxy conflict masterminded by "The Executive," a former US president turned warlord.

Their paths converge in the final level as they unite to take down The Executive and end the senseless bloodshed, realizing they have more in common with each other than with the leaders they've been fighting for.

## Level Structure

### Level 1: "The Sinking Penitent" (Vex)
- **Core Features:** Swimming, boats/buoyancy, destructible structures
- **Narrative Purpose:** Character introduction, world establishment

### Level 2: "The Harvest" (Vex)
- **Core Features:** Advanced audio/visual effects, destructible cover
- **Narrative Purpose:** Moral complexity introduction, Vex's disillusionment begins

### Level 3: "Harbor Gauntlet" (Sharma)
- **Core Features:** Vehicle interiors, driving simulation, destructible parts
- **Narrative Purpose:** Sharma introduction, tactical contrast to Vex's missions

### Level 4: "The Airship Graveyard" (Vex)
- **Core Features:** Flying simulation, destructible vehicle parts
- **Narrative Purpose:** Escalation, Vex's growing skepticism

### Level 5: "The Foundry" (Sharma)
- **Core Features:** Point gravity, ground orientation, IK/ragdoll systems
- **Narrative Purpose:** Technology revelation, Sharma's turning point

### Level 6: "The Bunker" (Both)
- **Core Features:** All systems integration, final boss mechanics
- **Narrative Purpose:** Character convergence, climactic resolution

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

3. **Gravity Manipulation System**
   - Point gravity field calculations
   - Player orientation management
   - Physics object behavior in altered gravity

4. **Animation System**
   - IK solver for adaptive character positioning
   - Ragdoll physics integration
   - Smooth blending between animation states

## Production Considerations

### Team Size
- Recommended for small-to-mid size development team (15-30 people)
- Core disciplines: Programming, Art, Design, Audio, QA

### Development Timeline
- Estimated 18-24 months for full production
- 6-month pre-production for technical prototyping
- Phased milestone delivery based on level completion

### Technical Constraints
- Target 60 FPS on modern PC hardware
- Scalable graphics settings for various hardware configurations
- Memory optimization for seamless level transitions

### Asset Pipeline
- Standardized dimensions for promotional materials
- Modular asset creation for efficient development
- Version control system for collaborative development

---

*This project plan is designed for a small-to-mid size game development team and follows industry best practices for FPS game development. All assets and scripts are designed to showcase the core gameplay features while maintaining narrative coherence.*