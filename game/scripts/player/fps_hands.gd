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

func _ready() -> void:
	_setup_hands()
	_setup_animations()

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
	
	# Create hand mesh
	var hand_mesh := BoxMesh.new()
	hand_mesh.size = Vector3(0.08, 0.15, 0.3)
	hand.mesh = hand_mesh
	
	# Position based on side
	if side == "left":
		hand.position = Vector3(0.3, -0.2, 0.4)
		hand.rotation_degrees = Vector3(-10, -15, -20)
		left_hand = hand
	else:
		hand.position = Vector3(-0.3, -0.2, 0.4)
		hand.rotation_degrees = Vector3(-10, 15, 20)
		right_hand = hand
	
	# Apply material
	var material := hand_material if hand_material else _create_default_material()
	hand.material_override = material
	
	# Add fingers
	_add_fingers_to_hand(hand, side == "left")

func _create_default_material() -> StandardMaterial3D:
	"""Create default skin-toned material"""
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.9, 0.7, 0.6)
	return material

func _add_fingers_to_hand(hand: MeshInstance3D, is_left: bool) -> void:
	"""Add simple finger geometry to hand"""
	# Four fingers
	for i in range(4):
		var finger := MeshInstance3D.new()
		finger.mesh = BoxMesh.new()
		finger.mesh.size = Vector3(0.02, 0.02, 0.08)
		
		var x_offset := (i - 1.5) * 0.02
		finger.position = Vector3(x_offset, 0.05, 0.12)
		finger.material_override = hand.material_override
		hand.add_child(finger)
	
	# Thumb
	var thumb := MeshInstance3D.new()
	thumb.mesh = BoxMesh.new()
	thumb.mesh.size = Vector3(0.02, 0.06, 0.02)
	
	if is_left:
		thumb.position = Vector3(0.04, 0.02, 0.08)
		thumb.rotation_degrees = Vector3(0, 0, -30)
	else:
		thumb.position = Vector3(-0.04, 0.02, 0.08)
		thumb.rotation_degrees = Vector3(0, 0, 30)
	
	thumb.material_override = hand.material_override
	hand.add_child(thumb)

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
		left_hand.position.x = 0.3 + sway_x
		left_hand.position.y = -0.2 + sway_y
		left_hand.rotation_degrees.z = -20 + sin(idle_sway_time) * 2
	
	if right_hand:
		right_hand.position.x = -0.3 - sway_x
		right_hand.position.y = -0.2 + sway_y
		right_hand.rotation_degrees.z = 20 - sin(idle_sway_time) * 2

func play_walk_animation(speed_factor: float) -> void:
	"""Play walking hand bob animation"""
	walk_bob_time += get_process_delta_time() * speed_factor * 8.0 * animation_speed
	
	var bob_y := sin(walk_bob_time) * walk_bob_strength
	var bob_x := cos(walk_bob_time * 0.5) * walk_bob_strength * 0.7
	
	if left_hand:
		left_hand.position.y = -0.2 + bob_y
		left_hand.position.x = 0.3 + bob_x
	
	if right_hand:
		right_hand.position.y = -0.2 - bob_y
		right_hand.position.x = -0.3 - bob_x

func reset_to_idle() -> void:
	"""Reset hands to idle position"""
	if left_hand:
		left_hand.position = Vector3(0.3, -0.2, 0.4)
		left_hand.rotation_degrees = Vector3(-10, -15, -20)
	
	if right_hand:
		right_hand.position = Vector3(-0.3, -0.2, 0.4)
		right_hand.rotation_degrees = Vector3(-10, 15, 20)
	
	walk_bob_time = 0.0