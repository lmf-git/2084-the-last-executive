extends Node3D
class_name FPSHands

## First-person view hands with procedural animation
##
## Features:
## - Procedural idle sway animation
## - Walking bob animation synchronized with movement
## - Simple hand and finger geometry
## - Material customization

@export_group("Animation")
@export var idle_sway_strength: float = 0.01
@export var walk_bob_strength: float = 0.03
@export var animation_speed: float = 1.0

@export_group("Appearance")
@export var hand_material: StandardMaterial3D

var left_hand: MeshInstance3D
var right_hand: MeshInstance3D
var animation_player: AnimationPlayer

var idle_sway_time: float = 0.0
var walk_bob_time: float = 0.0
var current_aim_offset: float = 0.0  # Store current aiming offset from mouse movement

func _ready() -> void:
	print("FPS Hands: Setting up hands...")
	_setup_hands()
	_setup_animations()
	print("FPS Hands: Setup complete. Left hand at: ", left_hand.position if left_hand else "null")
	print("FPS Hands: Setup complete. Right hand at: ", right_hand.position if right_hand else "null")

func _process(delta: float) -> void:
	_handle_hand_animations(delta)

func _setup_hands() -> void:
	"""Create simple hand meshes with fingers"""
	_create_hand("left")
	_create_hand("right")

func _create_hand(side: String) -> void:
	"""Create a hand mesh for the specified side"""
	var hand := MeshInstance3D.new()
	hand.name = side.capitalize() + "Hand"
	add_child(hand)

	# Create more visible hand mesh - larger and more detailed
	var hand_mesh := BoxMesh.new()
	hand_mesh.size = Vector3(0.15, 0.08, 0.25)  # Larger for better visibility
	hand.mesh = hand_mesh
	
	# Position based on side - visible in first-person view, further from camera
	if side == "left":
		hand.position = Vector3(0.5, -0.4, 1.0)  # Further from camera to avoid near plane clipping
		hand.rotation_degrees = Vector3(-10, -25, -20)
		left_hand = hand
		print("Created left hand at position: ", hand.position)
	else:
		hand.position = Vector3(-0.5, -0.4, 1.0)  # Further from camera to avoid near plane clipping
		hand.rotation_degrees = Vector3(-10, 25, 20)
		right_hand = hand
		print("Created right hand at position: ", hand.position)
	
	# Apply material
	var material := hand_material if hand_material else _create_default_material()
	hand.material_override = material
	
	# Add fingers
	_add_fingers_to_hand(hand, side == "left")

func _create_default_material() -> StandardMaterial3D:
	"""Create default skin-toned material"""
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.9, 0.7, 0.6)  # Brighter for better visibility
	material.metallic = 0.0
	material.roughness = 0.6
	material.emission_enabled = true
	material.emission = Color(0.1, 0.08, 0.06)  # Slight emission for visibility
	material.rim_enabled = true
	material.rim = 0.5
	material.rim_tint = 0.8
	return material

func _add_fingers_to_hand(hand: MeshInstance3D, is_left: bool) -> void:
	"""Add visible finger geometry to hand"""
	# Four fingers - make them larger and more visible
	for i in range(4):
		var finger := MeshInstance3D.new()
		finger.mesh = BoxMesh.new()
		finger.mesh.size = Vector3(0.015, 0.025, 0.06)  # Slightly larger

		var x_offset := (i - 1.5) * 0.025  # More spacing
		finger.position = Vector3(x_offset, 0.02, 0.1)
		finger.material_override = hand.material_override
		hand.add_child(finger)

		# Add finger segments for more detail
		var finger_tip := MeshInstance3D.new()
		finger_tip.mesh = BoxMesh.new()
		finger_tip.mesh.size = Vector3(0.012, 0.02, 0.04)
		finger_tip.position = Vector3(0, 0, 0.04)
		finger_tip.material_override = hand.material_override
		finger.add_child(finger_tip)

	# Thumb - make it more prominent
	var thumb := MeshInstance3D.new()
	thumb.mesh = BoxMesh.new()
	thumb.mesh.size = Vector3(0.02, 0.04, 0.03)

	if is_left:
		thumb.position = Vector3(0.05, 0.01, 0.05)
		thumb.rotation_degrees = Vector3(0, 0, -30)
	else:
		thumb.position = Vector3(-0.05, 0.01, 0.05)
		thumb.rotation_degrees = Vector3(0, 0, 30)

	thumb.material_override = hand.material_override
	hand.add_child(thumb)

	# Add wrist/forearm for more presence
	var forearm := MeshInstance3D.new()
	forearm.mesh = CylinderMesh.new()
	forearm.mesh.top_radius = 0.03
	forearm.mesh.bottom_radius = 0.035
	forearm.mesh.height = 0.15
	forearm.position = Vector3(0, 0, -0.08)
	forearm.material_override = hand.material_override
	hand.add_child(forearm)

func _setup_animations() -> void:
	"""Setup basic hand animations"""
	animation_player = AnimationPlayer.new()
	add_child(animation_player)
	animation_player.name = "AnimationPlayer"

func _handle_hand_animations(delta: float) -> void:
	"""Handle procedural hand animations"""
	idle_sway_time += delta * animation_speed

	# Simple idle sway
	var sway_x := sin(idle_sway_time * 0.8) * idle_sway_strength
	var sway_y := cos(idle_sway_time * 1.2) * idle_sway_strength * 0.5

	if left_hand:
		left_hand.position.x = 0.5 + sway_x
		left_hand.position.y = -0.4 + sway_y
		left_hand.rotation_degrees.z = -20 + sin(idle_sway_time) * 2

	if right_hand:
		right_hand.position.x = -0.5 - sway_x
		right_hand.position.y = -0.4 + sway_y
		right_hand.rotation_degrees.z = 20 - sin(idle_sway_time) * 2

	# Apply aim movement after animation updates
	_apply_aim_movement()

func play_walk_animation(speed_factor: float) -> void:
	"""Play walking hand bob animation"""
	walk_bob_time += get_process_delta_time() * speed_factor * 8.0 * animation_speed

	var bob_y := sin(walk_bob_time) * walk_bob_strength
	var bob_x := cos(walk_bob_time * 0.5) * walk_bob_strength * 0.7

	if left_hand:
		left_hand.position.y = -0.4 + bob_y
		left_hand.position.x = 0.5 + bob_x

	if right_hand:
		right_hand.position.y = -0.4 - bob_y
		right_hand.position.x = -0.5 - bob_x

	# Apply aim movement after walk animation updates
	_apply_aim_movement()

func reset_to_idle() -> void:
	"""Reset hands to idle position"""
	if left_hand:
		left_hand.position = Vector3(0.5, -0.4, 1.0)
		left_hand.rotation_degrees = Vector3(-10, -25, -20)

	if right_hand:
		right_hand.position = Vector3(-0.5, -0.4, 1.0)
		right_hand.rotation_degrees = Vector3(-10, 25, 20)

	# Apply aim movement after reset
	_apply_aim_movement()

func update_aim_movement(mouse_delta_x: float) -> void:
	"""Update hands based on mouse movement for natural aiming feel"""
	# Accumulate mouse movement for smooth aiming offset
	current_aim_offset += mouse_delta_x * 0.1  # Scale down the movement
	current_aim_offset = clamp(current_aim_offset, -1.0, 1.0)  # Keep in reasonable range

	# Apply decay so hands return to center over time
	current_aim_offset *= 0.95

	_apply_aim_movement()

func _apply_aim_movement() -> void:
	"""Apply subtle aiming movement to hands"""
	# Since hands are children of the camera, they automatically rotate with the character
	# We just add subtle movement based on recent mouse input for natural feel

	if left_hand:
		# Subtle left hand aiming movement - moves opposite to aim for natural feel
		left_hand.rotation_degrees.y = -25 - current_aim_offset * 3.0
		# Slight position shift for natural aiming movement
		var base_x = left_hand.position.x if abs(left_hand.position.x - 0.5) < 0.2 else 0.5
		left_hand.position.x = base_x - current_aim_offset * 0.04

	if right_hand:
		# Subtle right hand aiming movement - follows aim direction
		right_hand.rotation_degrees.y = 25 + current_aim_offset * 5.0
		# Slight position shift for natural aiming movement
		var base_x = right_hand.position.x if abs(right_hand.position.x + 0.5) < 0.2 else -0.5
		right_hand.position.x = base_x + current_aim_offset * 0.04
	
	walk_bob_time = 0.0