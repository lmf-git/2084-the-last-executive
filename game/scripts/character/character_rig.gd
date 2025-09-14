extends Node3D
class_name CharacterRig

var character_model: Node3D
var skeleton_3d: Skeleton3D
var ragdoll_system: Node3D
var animation_player: AnimationPlayer

# IK system
var ik_system: Node3D
var left_arm_ik: SkeletonIK3D
var right_arm_ik: SkeletonIK3D
var left_leg_ik: SkeletonIK3D
var right_leg_ik: SkeletonIK3D

# IK targets
var left_hand_target: Node3D
var right_hand_target: Node3D
var left_foot_target: Node3D
var right_foot_target: Node3D

var is_ragdoll_active = false
var is_ik_active = false
var available_characters: Array[String] = [
	"res://characters/Superhero_Male.gltf",
	"res://characters/Superhero_Female.gltf"
]
var current_character_index = 0

func _ready():
	load_character_model()
	# Don't setup ragdoll physics immediately - only when needed
	# setup_ragdoll_physics()
	setup_ik_system()
	# Ensure ragdoll is deactivated initially
	is_ragdoll_active = false

func load_character_model():
	"""Load GLTF character model"""
	if available_characters.size() == 0:
		print("No character models available - using basic setup")
		setup_basic_skeleton()
		return
	
	var character_path = available_characters[current_character_index]
	var character_scene = load(character_path)
	
	if character_scene:
		# Clear existing character
		if character_model:
			character_model.queue_free()
		
		# Instantiate new character
		character_model = character_scene.instantiate()
		
		# Create a container to isolate the character model
		var character_container = Node3D.new()
		character_container.name = "CharacterModelContainer"
		add_child(character_container)
		character_container.add_child(character_model)
		
		# Position character model properly to match capsule dimensions
		# Capsule: height=1.8, player at Y=1, so capsule bottom is at Y=0.1
		# Character should have feet at capsule bottom
		character_model.position = Vector3(0, -0.9, 0)  # Offset so character feet align with capsule bottom
		
		# Scale character to match capsule dimensions (capsule height=1.8)
		var target_height = 1.8
		character_model.scale = Vector3.ONE * (target_height / 1.8)  # Adjust if character is not 1.8 units tall
		
		# Ensure character model doesn't affect parent transforms
		character_model.top_level = false
		
		# Find skeleton and animation player in the loaded model
		find_character_components(character_model)
		
		# Remove all collision from character model (visual only)
		remove_character_collisions(character_model)
		
		# Lock the character model position to prevent any movement
		# Only the skeleton bones should move during ragdoll, not the root
		character_model.set_notify_transform(false)
		
		# Setup IK system now that we have the character and skeleton
		setup_ik_system()
		
		print("Loaded character: ", character_path)
	else:
		print("Failed to load character: ", character_path)
		# Fallback to basic skeleton
		setup_basic_skeleton()

func find_character_components(node: Node):
	"""Recursively find skeleton and animation player"""
	if node is Skeleton3D:
		skeleton_3d = node
		print("Found Skeleton3D: ", node.name)
	elif node is AnimationPlayer:
		animation_player = node  
		print("Found AnimationPlayer: ", node.name)
		print("Available animations: ", animation_player.get_animation_list())
		# Don't start animations automatically - they interfere with physics
		animation_player.stop()  # Stop any currently playing animation
		animation_player.active = false  # Disable the animation player
		print("Animation player stopped and disabled to prevent physics interference")
	
	for child in node.get_children():
		find_character_components(child)

func remove_character_collisions(node: Node):
	"""Remove all collision shapes and physics bodies from character model"""
	# Remove collision shapes
	if node is CollisionShape3D:
		print("Removing CollisionShape3D from: ", node.name)
		node.queue_free()
		return
	
	# Disable physics bodies completely
	if node is CharacterBody3D:
		print("Disabling CharacterBody3D: ", node.name)
		var char_body = node as CharacterBody3D
		char_body.set_physics_process(false)
		char_body.set_process(false)
		char_body.motion_mode = CharacterBody3D.MOTION_MODE_GROUNDED
		# Remove collision shapes from the body
		for child in char_body.get_children():
			if child is CollisionShape3D:
				child.queue_free()
	elif node is RigidBody3D:
		print("Disabling RigidBody3D: ", node.name)
		var rigid_body = node as RigidBody3D
		rigid_body.freeze = true
		rigid_body.freeze_mode = RigidBody3D.FREEZE_MODE_KINEMATIC
		rigid_body.set_physics_process(false)
		# Remove collision shapes from the body
		for child in rigid_body.get_children():
			if child is CollisionShape3D:
				child.queue_free()
	elif node is StaticBody3D:
		print("Disabling StaticBody3D: ", node.name)
		# Remove collision shapes from static bodies
		for child in node.get_children():
			if child is CollisionShape3D:
				child.queue_free()
	elif node is Area3D:
		print("Disabling Area3D: ", node.name)
		var area = node as Area3D
		area.set_physics_process(false)
		area.monitoring = false
		area.monitorable = false
	
	# Process children (make a copy of the array to avoid modification during iteration)
	var children = node.get_children()
	for child in children:
		remove_character_collisions(child)

func start_default_animation():
	"""Start playing default animation"""
	if not animation_player:
		return
		
	var animations: Array[StringName] = animation_player.get_animation_list()
	if animations.size() > 0:
		var default_anim: String = ""
		
		# Look for common idle/default animation names
		for anim_name in animations:
			var lower_name = anim_name.to_lower()
			if "idle" in lower_name or "default" in lower_name or "t-pose" in lower_name:
				default_anim = anim_name
				break
		
		# If no idle found, use first animation
		if default_anim == "" and animations.size() > 0:
			default_anim = animations[0]
		
		if default_anim != "":
			# Ensure animation player is active
			animation_player.active = true
			animation_player.play(default_anim)
			print("Playing animation: ", default_anim)
		
		# Wait a frame then check if animation is actually playing
		call_deferred("verify_animation_playing")

func verify_animation_playing():
	"""Verify that animation is actually playing"""
	if animation_player:
		if animation_player.is_playing():
			print("✓ Animation confirmed playing: ", animation_player.current_animation)
		else:
			print("⚠ Animation not playing, attempting restart")
			var animations: Array[StringName] = animation_player.get_animation_list()
			if animations.size() > 0:
				animation_player.play(animations[0])

func switch_character():
	"""Switch to next available character"""
	current_character_index = (current_character_index + 1) % available_characters.size()
	load_character_model()
	setup_ragdoll_physics()

func setup_basic_skeleton():
	"""Fallback basic skeleton if GLTF loading fails"""
	if not skeleton_3d:
		skeleton_3d = Skeleton3D.new()
		add_child(skeleton_3d)
		skeleton_3d.name = "Skeleton3D"
		print("Created fallback skeleton")

func setup_ragdoll_physics():
	"""Setup ragdoll physics system using Godot's built-in skeleton ragdoll"""
	if not skeleton_3d:
		print("No skeleton found for ragdoll")
		return
	
	# Wait a frame for skeleton to be fully loaded
	await get_tree().process_frame
	
	# Create physical bones for ragdoll using Godot's system
	create_skeleton_ragdoll()
	
	print("Ragdoll physics setup complete")

func setup_ik_system():
	"""Setup IK system for character skeleton"""
	if not skeleton_3d:
		print("No skeleton found for IK - will try again when character loads")
		return
	
	print("Setting up IK system with skeleton: ", skeleton_3d.name)
	# Wait for skeleton to be ready
	await get_tree().process_frame
	
	# Create IK system container
	if ik_system:
		ik_system.queue_free()
	
	ik_system = Node3D.new()
	ik_system.name = "IKSystem"
	add_child(ik_system)
	
	# Create IK chains for limbs
	create_arm_ik_chains()
	create_leg_ik_chains()
	create_ik_targets()
	
	print("IK system setup complete")

func create_arm_ik_chains():
	"""Create IK chains for arms"""
	if not skeleton_3d:
		return
	
	# Find arm bones (common naming patterns)
	var left_arm_bone = find_bone_by_patterns(["leftarm", "left_arm", "l_arm", "mixamorig:leftarm"])
	var left_hand_bone = find_bone_by_patterns(["lefthand", "left_hand", "l_hand", "mixamorig:lefthand"])
	var right_arm_bone = find_bone_by_patterns(["rightarm", "right_arm", "r_arm", "mixamorig:rightarm"])  
	var right_hand_bone = find_bone_by_patterns(["righthand", "right_hand", "r_hand", "mixamorig:righthand"])
	
	# Create left arm IK
	if left_arm_bone != "" and left_hand_bone != "":
		left_arm_ik = SkeletonIK3D.new()
		left_arm_ik.name = "LeftArmIK"
		left_arm_ik.root_bone = left_arm_bone
		left_arm_ik.tip_bone = left_hand_bone
		skeleton_3d.add_child(left_arm_ik)
		print("Created left arm IK: ", left_arm_bone, " -> ", left_hand_bone)
	
	# Create right arm IK
	if right_arm_bone != "" and right_hand_bone != "":
		right_arm_ik = SkeletonIK3D.new()
		right_arm_ik.name = "RightArmIK"
		right_arm_ik.root_bone = right_arm_bone
		right_arm_ik.tip_bone = right_hand_bone
		skeleton_3d.add_child(right_arm_ik)
		print("Created right arm IK: ", right_arm_bone, " -> ", right_hand_bone)

func create_leg_ik_chains():
	"""Create IK chains for legs"""
	if not skeleton_3d:
		return
	
	# Find leg bones
	var left_thigh_bone = find_bone_by_patterns(["leftupleg", "left_upleg", "l_thigh", "mixamorig:leftupleg"])
	var left_foot_bone = find_bone_by_patterns(["leftfoot", "left_foot", "l_foot", "mixamorig:leftfoot"])
	var right_thigh_bone = find_bone_by_patterns(["rightupleg", "right_upleg", "r_thigh", "mixamorig:rightupleg"])
	var right_foot_bone = find_bone_by_patterns(["rightfoot", "right_foot", "r_foot", "mixamorig:rightfoot"])
	
	# Create left leg IK
	if left_thigh_bone != "" and left_foot_bone != "":
		left_leg_ik = SkeletonIK3D.new()
		left_leg_ik.name = "LeftLegIK"
		left_leg_ik.root_bone = left_thigh_bone
		left_leg_ik.tip_bone = left_foot_bone
		skeleton_3d.add_child(left_leg_ik)
		print("Created left leg IK: ", left_thigh_bone, " -> ", left_foot_bone)
	
	# Create right leg IK
	if right_thigh_bone != "" and right_foot_bone != "":
		right_leg_ik = SkeletonIK3D.new()
		right_leg_ik.name = "RightLegIK"
		right_leg_ik.root_bone = right_thigh_bone
		right_leg_ik.tip_bone = right_foot_bone
		skeleton_3d.add_child(right_leg_ik)
		print("Created right leg IK: ", right_thigh_bone, " -> ", right_foot_bone)

func find_bone_by_patterns(patterns: Array) -> String:
	"""Find bone by matching name patterns - returns bone name"""
	if not skeleton_3d:
		return ""
	
	for i in range(skeleton_3d.get_bone_count()):
		var bone_name = skeleton_3d.get_bone_name(i)
		var bone_name_lower = bone_name.to_lower()
		
		for pattern in patterns:
			if pattern.to_lower() in bone_name_lower:
				return bone_name
	
	return ""

func find_bone_index_by_patterns(patterns: Array) -> int:
	"""Find bone index by matching name patterns - returns bone index"""
	if not skeleton_3d:
		return -1
	
	for i in range(skeleton_3d.get_bone_count()):
		var bone_name = skeleton_3d.get_bone_name(i)
		var bone_name_lower = bone_name.to_lower()
		
		for pattern in patterns:
			if pattern.to_lower() in bone_name_lower:
				return i
	
	return -1

func create_ik_targets():
	"""Create visible and interactive IK target nodes"""
	# Create visible target nodes for IK
	left_hand_target = create_ik_target("LeftHandTarget", Color.RED)
	ik_system.add_child(left_hand_target)
	
	right_hand_target = create_ik_target("RightHandTarget", Color.GREEN)
	ik_system.add_child(right_hand_target)
	
	left_foot_target = create_ik_target("LeftFootTarget", Color.BLUE)
	ik_system.add_child(left_foot_target)
	
	right_foot_target = create_ik_target("RightFootTarget", Color.YELLOW)
	ik_system.add_child(right_foot_target)
	
	# Position targets at approximate limb ends initially
	position_ik_targets_initially()
	
	# Set IK targets
	if left_arm_ik:
		left_arm_ik.target_node = left_arm_ik.get_path_to(left_hand_target)
	if right_arm_ik:
		right_arm_ik.target_node = right_arm_ik.get_path_to(right_hand_target)
	if left_leg_ik:
		left_leg_ik.target_node = left_leg_ik.get_path_to(left_foot_target)
	if right_leg_ik:
		right_leg_ik.target_node = right_leg_ik.get_path_to(right_foot_target)
	
	print("Created IK targets")

func create_ik_target(target_name: String, color: Color) -> Node3D:
	"""Create a visible IK target with colored sphere"""
	var target = Node3D.new()
	target.name = target_name
	
	# Create visual representation
	var mesh_instance = MeshInstance3D.new()
	var sphere_mesh = SphereMesh.new()
	sphere_mesh.radius = 0.05
	sphere_mesh.height = 0.1
	mesh_instance.mesh = sphere_mesh
	
	# Create colored material
	var material = StandardMaterial3D.new()
	material.albedo_color = color
	material.emission_enabled = true
	material.emission = color * 0.3  # Slight glow
	mesh_instance.material_override = material
	
	target.add_child(mesh_instance)
	
	# Make targets visible by default but only when IK is active
	target.visible = false
	print("Created IK target: ", target_name, " at position: ", target.position)
	
	return target

func position_ik_targets_initially():
	"""Position IK targets at approximate limb positions"""
	if not skeleton_3d:
		return
	
	# Try to find hand and foot bones and position targets there
	var left_hand_bone = find_bone_index_by_patterns(["lefthand", "left_hand", "l_hand", "mixamorig:lefthand"])
	var right_hand_bone = find_bone_index_by_patterns(["righthand", "right_hand", "r_hand", "mixamorig:righthand"])
	var left_foot_bone = find_bone_index_by_patterns(["leftfoot", "left_foot", "l_foot", "mixamorig:leftfoot"])
	var right_foot_bone = find_bone_index_by_patterns(["rightfoot", "right_foot", "r_foot", "mixamorig:rightfoot"])
	
	# Position targets at reasonable default positions relative to character
	if left_hand_bone >= 0 and left_hand_target:
		# Get bone position relative to skeleton, then convert to world space
		var bone_pose = skeleton_3d.get_bone_global_pose(left_hand_bone)
		left_hand_target.position = character_model.transform * bone_pose.origin
		print("Positioned left hand target at: ", left_hand_target.position)
	elif left_hand_target:
		left_hand_target.position = Vector3(-0.5, -0.2, 0.3)  # Default left hand position
		
	if right_hand_bone >= 0 and right_hand_target:
		var bone_pose = skeleton_3d.get_bone_global_pose(right_hand_bone)
		right_hand_target.position = character_model.transform * bone_pose.origin
		print("Positioned right hand target at: ", right_hand_target.position)
	elif right_hand_target:
		right_hand_target.position = Vector3(0.5, -0.2, 0.3)  # Default right hand position
		
	if left_foot_bone >= 0 and left_foot_target:
		var bone_pose = skeleton_3d.get_bone_global_pose(left_foot_bone)
		left_foot_target.position = character_model.transform * bone_pose.origin
		print("Positioned left foot target at: ", left_foot_target.position)
	elif left_foot_target:
		left_foot_target.position = Vector3(-0.2, -0.9, 0)  # Default left foot position
		
	if right_foot_bone >= 0 and right_foot_target:
		var bone_pose = skeleton_3d.get_bone_global_pose(right_foot_bone)
		right_foot_target.position = character_model.transform * bone_pose.origin
		print("Positioned right foot target at: ", right_foot_target.position)
	elif right_foot_target:
		right_foot_target.position = Vector3(0.2, -0.9, 0)  # Default right foot position
	
	print("IK target positioning complete")

func create_skeleton_ragdoll():
	"""Create physical bones for proper ragdoll using Godot's system"""
	if not skeleton_3d:
		return
		
	print("Creating skeleton ragdoll with ", skeleton_3d.get_bone_count(), " bones")
	
	# Important bones for ragdoll physics (common bone names)
	var important_bones = [
		"head", "spine", "chest", "pelvis", "hips",
		"leftarm", "rightarm", "leftforearm", "rightforearm",
		"lefthand", "righthand", "leftupleg", "rightupleg",
		"leftleg", "rightleg", "leftfoot", "rightfoot",
		# Mixamo rig names
		"mixamorig:head", "mixamorig:spine", "mixamorig:spine1", "mixamorig:spine2",
		"mixamorig:leftarm", "mixamorig:rightarm", "mixamorig:leftforearm", "mixamorig:rightforearm",
		"mixamorig:lefthand", "mixamorig:righthand", "mixamorig:leftupleg", "mixamorig:rightupleg",
		"mixamorig:leftleg", "mixamorig:rightleg", "mixamorig:leftfoot", "mixamorig:rightfoot"
	]
	
	# Create PhysicalBone3D nodes for important bones
	for i in range(skeleton_3d.get_bone_count()):
		var bone_name = skeleton_3d.get_bone_name(i)
		var bone_name_lower = bone_name.to_lower()
		
		# Check if this bone should have physics
		var should_create_physical_bone = false
		for important_bone in important_bones:
			if important_bone in bone_name_lower:
				should_create_physical_bone = true
				break
		
		if should_create_physical_bone:
			create_physical_bone(i, bone_name)
	
	# Ensure physics simulation is stopped after creating all bones
	# This prevents the physical bones from interfering with normal movement
	skeleton_3d.physical_bones_stop_simulation()
	print("Physics bones created but simulation stopped (will only activate during ragdoll)")

func create_physical_bone(bone_idx: int, bone_name: String):
	"""Create a PhysicalBone3D for the given bone"""
	var physical_bone = PhysicalBone3D.new()
	physical_bone.name = "PhysicalBone_" + bone_name
	physical_bone.bone_name = bone_name
	
	# Get bone transform to properly size the physics body
	var bone_transform = skeleton_3d.get_bone_global_rest(bone_idx)
	var bone_length = 0.2  # Default length
	
	# Try to calculate bone length by looking at children, but use conservative sizing
	for i in range(skeleton_3d.get_bone_count()):
		if skeleton_3d.get_bone_parent(i) == bone_idx:
			var child_transform = skeleton_3d.get_bone_global_rest(i)
			bone_length = min(0.3, bone_transform.origin.distance_to(child_transform.origin))  # Cap at 0.3 to prevent huge bones
			break
	
	# Ensure minimum bone length to prevent tiny collision shapes
	bone_length = max(0.05, bone_length)
	
	# Create appropriate collision shape based on bone
	var shape = CapsuleShape3D.new()
	var bone_name_lower = bone_name.to_lower()
	
	if "head" in bone_name_lower:
		shape = SphereShape3D.new()
		shape.radius = max(0.08, bone_length * 0.4)
	elif "spine" in bone_name_lower or "chest" in bone_name_lower:
		shape.radius = max(0.06, bone_length * 0.3)
		shape.height = max(0.15, bone_length * 0.8)
	elif "arm" in bone_name_lower or "forearm" in bone_name_lower:
		shape.radius = max(0.03, bone_length * 0.2)
		shape.height = max(0.2, bone_length * 0.9)
	elif "leg" in bone_name_lower or "upleg" in bone_name_lower:
		shape.radius = max(0.04, bone_length * 0.25)
		shape.height = max(0.25, bone_length * 0.9)
	elif "hand" in bone_name_lower or "foot" in bone_name_lower:
		shape.radius = max(0.025, bone_length * 0.3)
		shape.height = max(0.08, bone_length * 0.6)
	else:
		shape.radius = max(0.03, bone_length * 0.25)
		shape.height = max(0.1, bone_length * 0.8)
	
	var collision = CollisionShape3D.new()
	collision.shape = shape
	physical_bone.add_child(collision)
	
	# Set collision layers so ragdoll interacts with environment
	physical_bone.collision_layer = 4  # ENEMIES layer (from project_config.gd)
	physical_bone.collision_mask = 1   # Default layer (StaticBody3D ground uses layer 1)
	
	# Configure physics properties for natural ragdoll behavior
	physical_bone.gravity_scale = 1.0
	
	# Set realistic mass distribution based on bone type
	var bone_mass = 1.0
	if "head" in bone_name_lower:
		bone_mass = 5.0  # Head is heavy
	elif "spine" in bone_name_lower or "chest" in bone_name_lower:
		bone_mass = 8.0  # Torso is heaviest
	elif "upleg" in bone_name_lower:
		bone_mass = 4.0  # Upper legs are heavy
	elif "leg" in bone_name_lower:
		bone_mass = 2.0  # Lower legs medium
	elif "arm" in bone_name_lower:
		bone_mass = 2.0  # Arms medium
	elif "forearm" in bone_name_lower:
		bone_mass = 1.0  # Forearms lighter
	else:
		bone_mass = 1.0  # Default
	
	physical_bone.mass = bone_mass
	physical_bone.friction = 0.5  # Natural friction
	physical_bone.bounce = 0.0   # No artificial bounce
	
	# NO damping - let pure physics work
	physical_bone.linear_damp = 0.0
	physical_bone.angular_damp = 0.0
	
	# Configure joint limits - use simpler, more natural constraints
	if "head" in bone_name_lower:
		# Head: cone joint with natural neck movement
		physical_bone.joint_type = PhysicalBone3D.JOINT_TYPE_CONE
	elif "forearm" in bone_name_lower:
		# Forearms: hinge joint for elbow
		physical_bone.joint_type = PhysicalBone3D.JOINT_TYPE_HINGE
	elif "leg" in bone_name_lower and not "upleg" in bone_name_lower:
		# Lower legs: hinge joint for knee
		physical_bone.joint_type = PhysicalBone3D.JOINT_TYPE_HINGE
	else:
		# Default: cone joint with natural movement (arms, upper legs, spine, etc.)
		physical_bone.joint_type = PhysicalBone3D.JOINT_TYPE_CONE
	
	# Don't set overly restrictive limits - let Godot handle natural joint behavior
	
	# Start in kinematic mode (following animation)
	# PhysicalBone3D starts in kinematic mode by default
	
	# Add to skeleton
	skeleton_3d.add_child(physical_bone)
	print("Created PhysicalBone3D for: ", bone_name)

func remove_all_physical_bones():
	"""Remove all PhysicalBone3D nodes from skeleton"""
	if not skeleton_3d:
		return
	
	var bones_to_remove = []
	for child in skeleton_3d.get_children():
		if child is PhysicalBone3D:
			bones_to_remove.append(child)
	
	for bone in bones_to_remove:
		print("Removing PhysicalBone3D: ", bone.name)
		bone.queue_free()
	
	print("Removed all physical bones")

# Removed reset_skeleton_to_natural_pose() - let pure physics handle everything

func activate_ragdoll():
	"""Activate ragdoll physics using PhysicalBone3D system"""
	is_ragdoll_active = true
	print("Activating skeleton ragdoll physics")
	
	if not skeleton_3d:
		print("No skeleton found for ragdoll")
		return
	
	# Setup ragdoll physics on-demand
	setup_ragdoll_physics()
	await get_tree().process_frame  # Wait for physics bones to be created
	
	# Start physics simulation immediately - let pure physics take over
	skeleton_3d.physical_bones_start_simulation()
	print("Started pure physics ragdoll simulation")
	
	# COMPLETELY disable all other systems during ragdoll
	if animation_player:
		animation_player.active = false
		animation_player.stop()
		print("Animation completely disabled for ragdoll")
	
	# Force disable IK during ragdoll
	if is_ik_active:
		deactivate_ik()
		print("IK forcibly disabled for ragdoll")
	
	# Ensure no other systems interfere with pure physics

func deactivate_ragdoll():
	"""Deactivate ragdoll physics and return to animation"""
	is_ragdoll_active = false
	print("Deactivating skeleton ragdoll physics")
	
	if not skeleton_3d:
		return
	
	# Use Skeleton3D's built-in ragdoll system
	skeleton_3d.physical_bones_stop_simulation()
	print("Stopped physical bone simulation")
	
	# Remove all physical bones - clean slate
	remove_all_physical_bones()
	
	# Keep all systems disabled - pure capsule physics only
	if animation_player:
		animation_player.active = false
		animation_player.stop()
		print("All systems remain disabled - using capsule physics only")

func toggle_ragdoll():
	"""Toggle ragdoll physics on/off"""
	if is_ragdoll_active:
		deactivate_ragdoll()
	else:
		activate_ragdoll()

# Animation control functions
func play_animation(anim_name: String):
	"""Play specific animation"""
	if animation_player and animation_player.has_animation(anim_name):
		animation_player.play(anim_name)
		print("Playing animation: ", anim_name)

func play_walk_animation():
	"""Play walking animation"""
	if not animation_player or is_ragdoll_active:
		return
		
	var animations: Array[StringName] = animation_player.get_animation_list()
	for anim_name in animations:
		var lower_name = anim_name.to_lower()
		if "walk" in lower_name or "run" in lower_name:
			if animation_player.current_animation != anim_name:
				animation_player.play(anim_name)
				print("Switching to walk animation: ", anim_name)
			return
	
	# If no walk animation found, keep current

func play_idle_animation():
	"""Play idle animation"""
	if not animation_player or is_ragdoll_active:
		return
		
	var animations: Array[StringName] = animation_player.get_animation_list()
	for anim_name in animations:
		var lower_name = anim_name.to_lower()
		if "idle" in lower_name or "default" in lower_name:
			if animation_player.current_animation != anim_name:
				animation_player.play(anim_name)
				print("Switching to idle animation: ", anim_name)
			return

func update_movement_animation(_is_moving: bool):
	"""Update animation based on movement state"""
	if is_ragdoll_active:
		return  # Don't animate during ragdoll
	
	# Disabled - animations interfere with CharacterBody3D physics
	# The visual character should follow the capsule controller, not drive movement
	# TODO: Re-enable with proper root motion handling if needed
	pass

# IK Control Functions
func toggle_ik():
	"""Toggle IK system on/off"""
	is_ik_active = !is_ik_active
	
	if is_ik_active:
		activate_ik()
	else:
		deactivate_ik()

func activate_ik():
	"""Activate IK system and show targets"""
	print("Activating IK system")
	
	# Enable IK chains
	if left_arm_ik:
		left_arm_ik.start()
	if right_arm_ik:
		right_arm_ik.start()
	if left_leg_ik:
		left_leg_ik.start()
	if right_leg_ik:
		right_leg_ik.start()
	
	# Show IK targets
	show_ik_targets(true)
	
	print("IK system activated - targets visible")

func deactivate_ik():
	"""Deactivate IK system and hide targets"""
	print("Deactivating IK system")
	
	# Disable IK chains
	if left_arm_ik:
		left_arm_ik.stop()
	if right_arm_ik:
		right_arm_ik.stop()
	if left_leg_ik:
		left_leg_ik.stop()
	if right_leg_ik:
		right_leg_ik.stop()
	
	# Hide IK targets
	show_ik_targets(false)
	
	print("IK system deactivated - targets hidden")

func show_ik_targets(targets_visible: bool):
	"""Show or hide all IK targets"""
	if left_hand_target:
		left_hand_target.visible = targets_visible
	if right_hand_target:
		right_hand_target.visible = targets_visible
	if left_foot_target:
		left_foot_target.visible = targets_visible
	if right_foot_target:
		right_foot_target.visible = targets_visible

func move_ik_target(target_name: String, target_position: Vector3):
	"""Move IK target to position"""
	match target_name:
		"left_hand":
			if left_hand_target:
				left_hand_target.global_position = target_position
		"right_hand":
			if right_hand_target:
				right_hand_target.global_position = target_position
		"left_foot":
			if left_foot_target:
				left_foot_target.global_position = target_position
		"right_foot":
			if right_foot_target:
				right_foot_target.global_position = target_position

func get_ik_target_position(target_name: String) -> Vector3:
	"""Get current IK target position"""
	match target_name:
		"left_hand":
			return left_hand_target.global_position if left_hand_target else Vector3.ZERO
		"right_hand":
			return right_hand_target.global_position if right_hand_target else Vector3.ZERO
		"left_foot":
			return left_foot_target.global_position if left_foot_target else Vector3.ZERO
		"right_foot":
			return right_foot_target.global_position if right_foot_target else Vector3.ZERO
	
	return Vector3.ZERO
