extends Node3D
class_name CharacterRig

var character_model: Node3D
var skeleton_3d: Skeleton3D
var ragdoll_system: Node3D
var animation_player: AnimationPlayer

var is_ragdoll_active = false
var available_characters = [
	"res://characters/Superhero_Male.gltf",
	"res://characters/Superhero_Female.gltf"
]
var current_character_index = 0

func _ready():
	load_character_model()
	setup_ragdoll_physics()

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
			animation_player.play(default_anim)
			print("Playing animation: ", default_anim)

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
	"""Setup ragdoll physics system based on actual skeleton"""
	# Clear existing ragdoll
	if ragdoll_system:
		ragdoll_system.queue_free()
	
	ragdoll_system = Node3D.new()
	add_child(ragdoll_system)
	ragdoll_system.name = "RagdollSystem"
	
	if not skeleton_3d:
		print("No skeleton found for ragdoll")
		return
	
	# Wait a frame for skeleton to be fully loaded
	await get_tree().process_frame
	
	# Create ragdoll bodies based on actual skeleton bones
	create_ragdoll_from_skeleton()

func create_ragdoll_from_skeleton():
	"""Create ragdoll physics bodies based on skeleton bones"""
	if not skeleton_3d:
		return
		
	print("Creating ragdoll from skeleton with ", skeleton_3d.get_bone_count(), " bones")
	
	# Important bones for ragdoll physics
	var important_bones = [
		"Head", "head", "HEAD",
		"Spine", "spine", "SPINE", "Spine1", "Spine2", "Spine3",
		"LeftArm", "left_arm", "LEFT_ARM", "L_arm", "mixamorig:LeftArm",
		"RightArm", "right_arm", "RIGHT_ARM", "R_arm", "mixamorig:RightArm", 
		"LeftForeArm", "left_forearm", "LEFT_FOREARM", "L_forearm", "mixamorig:LeftForeArm",
		"RightForeArm", "right_forearm", "RIGHT_FOREARM", "R_forearm", "mixamorig:RightForeArm",
		"LeftUpLeg", "left_upleg", "LEFT_UPLEG", "L_thigh", "mixamorig:LeftUpLeg",
		"RightUpLeg", "right_upleg", "RIGHT_UPLEG", "R_thigh", "mixamorig:RightUpLeg",
		"LeftLeg", "left_leg", "LEFT_LEG", "L_shin", "mixamorig:LeftLeg",
		"RightLeg", "right_leg", "RIGHT_LEG", "R_shin", "mixamorig:RightLeg"
	]
	
	# Create ragdoll bodies for found bones
	for i in range(skeleton_3d.get_bone_count()):
		var bone_name = skeleton_3d.get_bone_name(i)
		
		# Check if this bone is important for ragdoll
		for important_bone in important_bones:
			if bone_name.to_lower().find(important_bone.to_lower()) != -1:
				create_ragdoll_for_bone(i, bone_name)
				break

func create_ragdoll_for_bone(bone_idx: int, bone_name: String):
	"""Create ragdoll body for specific bone"""
	var bone_pose = skeleton_3d.get_bone_global_pose(bone_idx)
	var bone_pos = bone_pose.origin
	
	# Determine size based on bone name
	var size = Vector3(0.1, 0.1, 0.1)  # Default size
	if bone_name.to_lower().find("head") != -1:
		size = Vector3(0.15, 0.15, 0.15)
	elif bone_name.to_lower().find("spine") != -1 or bone_name.to_lower().find("chest") != -1:
		size = Vector3(0.3, 0.4, 0.2)
	elif bone_name.to_lower().find("arm") != -1:
		size = Vector3(0.08, 0.25, 0.08)
	elif bone_name.to_lower().find("leg") != -1 or bone_name.to_lower().find("thigh") != -1:
		size = Vector3(0.1, 0.3, 0.1)
	
	var rigid_body = RigidBody3D.new()
	rigid_body.name = bone_name + "_Ragdoll"
	rigid_body.position = bone_pos
	rigid_body.freeze = true  # Start frozen
	
	# Add collision shape
	var collision = CollisionShape3D.new()
	collision.shape = CapsuleShape3D.new()
	collision.shape.radius = size.x
	collision.shape.height = size.y
	rigid_body.add_child(collision)
	
	# Add visual mesh (smaller, semi-transparent)
	var mesh_instance = MeshInstance3D.new()
	mesh_instance.mesh = CapsuleMesh.new()
	mesh_instance.mesh.radius = size.x
	mesh_instance.mesh.height = size.y
	var material = StandardMaterial3D.new()
	material.albedo_color = Color(1.0, 0.0, 0.0, 0.3)  # Red, semi-transparent
	material.flags_transparent = true
	mesh_instance.material_override = material
	mesh_instance.visible = false  # Hidden by default
	rigid_body.add_child(mesh_instance)
	
	ragdoll_system.add_child(rigid_body)
	print("Created ragdoll for bone: ", bone_name)

func activate_ragdoll():
	"""Activate ragdoll physics"""
	is_ragdoll_active = true
	print("Activating ragdoll physics")
	
	if not ragdoll_system:
		print("No ragdoll system found")
		return
		
	for child in ragdoll_system.get_children():
		if child is RigidBody3D:
			child.freeze = false
			child.gravity_scale = 1.0
			# Show ragdoll visualization
			for grandchild in child.get_children():
				if grandchild is MeshInstance3D:
					grandchild.visible = true
	
	# Hide character model when ragdoll is active
	if character_model:
		character_model.visible = false

func deactivate_ragdoll():
	"""Deactivate ragdoll physics"""
	is_ragdoll_active = false
	print("Deactivating ragdoll physics")
	
	if not ragdoll_system:
		return
		
	for child in ragdoll_system.get_children():
		if child is RigidBody3D:
			child.freeze = true
			# Hide ragdoll visualization
			for grandchild in child.get_children():
				if grandchild is MeshInstance3D:
					grandchild.visible = false
	
	# Show character model when ragdoll is inactive
	if character_model:
		character_model.visible = true

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
	if not animation_player:
		return
		
	var animations = animation_player.get_animation_list()
	for anim_name in animations:
		var lower_name = anim_name.to_lower()
		if "walk" in lower_name or "run" in lower_name:
			animation_player.play(anim_name)
			return
	
	# If no walk animation found, keep current

func play_idle_animation():
	"""Play idle animation"""
	if not animation_player:
		return
		
	var animations = animation_player.get_animation_list()
	for anim_name in animations:
		var lower_name = anim_name.to_lower()
		if "idle" in lower_name or "default" in lower_name:
			animation_player.play(anim_name)
			return

func update_movement_animation(is_moving: bool):
	"""Update animation based on movement state"""
	if is_ragdoll_active:
		return  # Don't animate during ragdoll
		
	if is_moving:
		play_walk_animation()
	else:
		play_idle_animation()
