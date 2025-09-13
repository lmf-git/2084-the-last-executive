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
var available_characters = [
	"res://characters/Superhero_Male.gltf",
	"res://characters/Superhero_Female.gltf"
]
var current_character_index = 0

func _ready():
	load_character_model()
	setup_ragdoll_physics()
	setup_ik_system()

func load_character_model():
	"""Load GLTF character model"""
	var character_path = available_characters[current_character_index]
	var character_scene = load(character_path)
	
	if character_scene:
		# Clear existing character
		if character_model:
			character_model.queue_free()
		
		# Instantiate new character
		character_model = character_scene.instantiate()
		add_child(character_model)
		
		# Position character model properly (align with capsule)
		character_model.position = Vector3(0, -0.9, 0)  # Offset to align feet with capsule bottom
		
		# Find skeleton and animation player in the loaded model
		find_character_components(character_model)
		
		# Remove all collision from character model (visual only)
		remove_character_collisions(character_model)
		
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
		# Start playing an idle animation if available
		start_default_animation()
	
	for child in node.get_children():
		find_character_components(child)

func remove_character_collisions(node: Node):
	"""Remove all collision shapes from character model"""
	if node is CollisionShape3D or node is CollisionObject3D:
		print("Removing collision from: ", node.name)
		node.queue_free()
		return
	
	# Process children (make a copy of the array to avoid modification during iteration)
	var children = node.get_children()
	for child in children:
		remove_character_collisions(child)

func start_default_animation():
	"""Start playing default animation"""
	if not animation_player:
		return
		
	var animations = animation_player.get_animation_list()
	if animations.size() > 0:
		var default_anim = ""
		
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
			var animations = animation_player.get_animation_list()
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
		print("No skeleton found for IK")
		return
	
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
	"""Find bone by matching name patterns"""
	if not skeleton_3d:
		return ""
	
	for i in range(skeleton_3d.get_bone_count()):
		var bone_name = skeleton_3d.get_bone_name(i)
		var bone_name_lower = bone_name.to_lower()
		
		for pattern in patterns:
			if pattern.to_lower() in bone_name_lower:
				return bone_name
	
	return ""

func create_ik_targets():
	"""Create IK target nodes"""
	# Create target nodes for IK
	left_hand_target = Node3D.new()
	left_hand_target.name = "LeftHandTarget"
	ik_system.add_child(left_hand_target)
	
	right_hand_target = Node3D.new()
	right_hand_target.name = "RightHandTarget" 
	ik_system.add_child(right_hand_target)
	
	left_foot_target = Node3D.new()
	left_foot_target.name = "LeftFootTarget"
	ik_system.add_child(left_foot_target)
	
	right_foot_target = Node3D.new()
	right_foot_target.name = "RightFootTarget"
	ik_system.add_child(right_foot_target)
	
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

func create_physical_bone(_bone_idx: int, bone_name: String):
	"""Create a PhysicalBone3D for the given bone"""
	var physical_bone = PhysicalBone3D.new()
	physical_bone.name = "PhysicalBone_" + bone_name
	physical_bone.bone_name = bone_name
	
	# Create appropriate collision shape based on bone
	var shape = CapsuleShape3D.new()
	var bone_name_lower = bone_name.to_lower()
	
	if "head" in bone_name_lower:
		shape = SphereShape3D.new()
		shape.radius = 0.1
	elif "spine" in bone_name_lower or "chest" in bone_name_lower:
		shape.radius = 0.08
		shape.height = 0.2
	elif "arm" in bone_name_lower or "forearm" in bone_name_lower:
		shape.radius = 0.04
		shape.height = 0.25
	elif "leg" in bone_name_lower or "upleg" in bone_name_lower:
		shape.radius = 0.05
		shape.height = 0.3
	elif "hand" in bone_name_lower or "foot" in bone_name_lower:
		shape.radius = 0.03
		shape.height = 0.1
	else:
		shape.radius = 0.05
		shape.height = 0.15
	
	var collision = CollisionShape3D.new()
	collision.shape = shape
	physical_bone.add_child(collision)
	
	# Configure physics properties
	physical_bone.gravity_scale = 1.0
	physical_bone.mass = 1.0
	
	# Start in kinematic mode (following animation)
	# PhysicalBone3D starts in kinematic mode by default
	
	# Add to skeleton
	skeleton_3d.add_child(physical_bone)
	print("Created PhysicalBone3D for: ", bone_name)

func activate_ragdoll():
	"""Activate ragdoll physics using PhysicalBone3D system"""
	is_ragdoll_active = true
	print("Activating skeleton ragdoll physics")
	
	if not skeleton_3d:
		print("No skeleton found for ragdoll")
		return
	
	# Use Skeleton3D's built-in ragdoll system
	skeleton_3d.physical_bones_start_simulation()
	print("Started physical bone simulation")
	
	# Disable animation player during ragdoll
	if animation_player:
		animation_player.active = false

func deactivate_ragdoll():
	"""Deactivate ragdoll physics and return to animation"""
	is_ragdoll_active = false
	print("Deactivating skeleton ragdoll physics")
	
	if not skeleton_3d:
		return
	
	# Use Skeleton3D's built-in ragdoll system
	skeleton_3d.physical_bones_stop_simulation()
	print("Stopped physical bone simulation")
	
	# Re-enable animation player
	if animation_player:
		animation_player.active = true

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
		
	var animations = animation_player.get_animation_list()
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
		
	var animations = animation_player.get_animation_list()
	for anim_name in animations:
		var lower_name = anim_name.to_lower()
		if "idle" in lower_name or "default" in lower_name:
			if animation_player.current_animation != anim_name:
				animation_player.play(anim_name)
				print("Switching to idle animation: ", anim_name)
			return

func update_movement_animation(is_moving: bool):
	"""Update animation based on movement state"""
	if is_ragdoll_active:
		return  # Don't animate during ragdoll
		
	if is_moving:
		play_walk_animation()
	else:
		play_idle_animation()

# IK Control Functions
func toggle_ik():
	"""Toggle IK system on/off"""
	is_ik_active = !is_ik_active
	
	if is_ik_active:
		activate_ik()
	else:
		deactivate_ik()

func activate_ik():
	"""Activate IK system"""
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
	
	print("IK system activated")

func deactivate_ik():
	"""Deactivate IK system"""
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
	
	print("IK system deactivated")

func move_ik_target(target_name: String, position: Vector3):
	"""Move IK target to position"""
	match target_name:
		"left_hand":
			if left_hand_target:
				left_hand_target.global_position = position
		"right_hand":
			if right_hand_target:
				right_hand_target.global_position = position
		"left_foot":
			if left_foot_target:
				left_foot_target.global_position = position
		"right_foot":
			if right_foot_target:
				right_foot_target.global_position = position

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
