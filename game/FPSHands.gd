extends Node3D
class_name FPSHands

var left_hand: MeshInstance3D
var right_hand: MeshInstance3D  
var animation_player: AnimationPlayer

var idle_sway_time = 0.0
var walk_bob_time = 0.0

func _ready():
	setup_hands()
	setup_animations()

func _process(delta):
	handle_hand_animations(delta)

func setup_hands():
	"""Create simple hand meshes"""
	# Left hand
	if not left_hand:
		left_hand = MeshInstance3D.new()
		add_child(left_hand)
		left_hand.name = "LeftHand"
	
	left_hand.mesh = BoxMesh.new()
	left_hand.mesh.size = Vector3(0.08, 0.15, 0.3)
	left_hand.position = Vector3(0.3, -0.2, 0.4)
	left_hand.rotation_degrees = Vector3(-10, -15, -20)
	
	var left_material = StandardMaterial3D.new()
	left_material.albedo_color = Color(0.9, 0.7, 0.6)
	left_hand.material_override = left_material
	
	# Right hand
	if not right_hand:
		right_hand = MeshInstance3D.new()
		add_child(right_hand)
		right_hand.name = "RightHand"
	
	right_hand.mesh = BoxMesh.new()
	right_hand.mesh.size = Vector3(0.08, 0.15, 0.3)
	right_hand.position = Vector3(-0.3, -0.2, 0.4)
	right_hand.rotation_degrees = Vector3(-10, 15, 20)
	
	var right_material = StandardMaterial3D.new()
	right_material.albedo_color = Color(0.9, 0.7, 0.6)
	right_hand.material_override = right_material
	
	# Add simple fingers to each hand
	add_simple_fingers(left_hand, true)
	add_simple_fingers(right_hand, false)

func add_simple_fingers(hand: MeshInstance3D, is_left: bool):
	"""Add basic finger geometry"""
	for i in range(4):
		var finger = MeshInstance3D.new()
		finger.mesh = BoxMesh.new()
		finger.mesh.size = Vector3(0.02, 0.02, 0.08)
		
		var x_offset = (i - 1.5) * 0.02
		if is_left:
			finger.position = Vector3(x_offset, 0.05, 0.12)
		else:
			finger.position = Vector3(x_offset, 0.05, 0.12)
		
		finger.material_override = hand.material_override
		hand.add_child(finger)
	
	# Thumb
	var thumb = MeshInstance3D.new()
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

func setup_animations():
	"""Setup basic hand animations"""
	if not animation_player:
		animation_player = AnimationPlayer.new()
		add_child(animation_player)
		animation_player.name = "AnimationPlayer"
	
	# Create idle sway animation
	var idle_animation = Animation.new()
	idle_animation.length = 4.0
	idle_animation.loop_mode = Animation.LOOP_LINEAR
	
	# Add animation library
	var library = AnimationLibrary.new()
	library.add_animation("idle_sway", idle_animation)
	animation_player.add_animation_library("default", library)

func handle_hand_animations(delta: float):
	"""Handle procedural hand animations"""
	idle_sway_time += delta
	
	# Simple idle sway
	var sway_x = sin(idle_sway_time * 0.8) * 0.01
	var sway_y = cos(idle_sway_time * 1.2) * 0.005
	
	if left_hand:
		left_hand.position.x = 0.3 + sway_x
		left_hand.position.y = -0.2 + sway_y
		left_hand.rotation_degrees.z = -20 + sin(idle_sway_time) * 2
	
	if right_hand:
		right_hand.position.x = -0.3 - sway_x
		right_hand.position.y = -0.2 + sway_y  
		right_hand.rotation_degrees.z = 20 - sin(idle_sway_time) * 2

func play_walk_animation(speed: float):
	"""Play walking hand bob animation"""
	walk_bob_time += get_process_delta_time() * speed * 8
	
	var bob_y = sin(walk_bob_time) * 0.03
	var bob_x = cos(walk_bob_time * 0.5) * 0.02
	
	if left_hand:
		left_hand.position.y = -0.2 + bob_y
		left_hand.position.x = 0.3 + bob_x
	
	if right_hand:
		right_hand.position.y = -0.2 - bob_y
		right_hand.position.x = -0.3 - bob_x

func reset_to_idle():
	"""Reset hands to idle position"""
	if left_hand:
		left_hand.position = Vector3(0.3, -0.2, 0.4)
		left_hand.rotation_degrees = Vector3(-10, -15, -20)
	
	if right_hand:
		right_hand.position = Vector3(-0.3, -0.2, 0.4)
		right_hand.rotation_degrees = Vector3(-10, 15, 20)
	
	walk_bob_time = 0.0