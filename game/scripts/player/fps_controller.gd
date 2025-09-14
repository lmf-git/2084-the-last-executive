extends CharacterBody3D
class_name FPSController

## First-person/third-person character controller with movement, jumping, and camera switching
##
## Supports:
## - WASD movement with proper physics
## - Mouse look with sensitivity control  
## - Jumping with floor detection
## - First/third person camera switching
## - Character model visibility management
## - Integration with character rig system

@export_group("Movement")
@export var speed: float = 5.0
@export var jump_velocity: float = 4.5

@export_group("Camera")
@export var mouse_sensitivity: float = 0.002
@export var is_first_person: bool = true

var gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity")
var is_moving: bool = false

@onready var first_person_camera: Camera3D = $FirstPersonCamera
@onready var third_person_camera: Camera3D = $ThirdPersonCamera
@onready var fps_hands: Node3D = $FirstPersonCamera/FPSHands
@onready var character_rig: Node3D = $CharacterRig
@onready var player_mesh: MeshInstance3D = $PlayerMesh

func _ready() -> void:
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	call_deferred("_setup_initial_visibility")

func _setup_initial_visibility() -> void:
	"""Set initial character visibility based on camera mode"""
	_update_camera_visibility()

func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		_handle_mouse_look(event)
	
	if event is InputEventKey and event.pressed:
		_handle_key_input(event)

func _handle_mouse_look(event: InputEventMouseMotion) -> void:
	"""Handle mouse look for camera rotation"""
	# Rotate the CharacterBody3D horizontally (Y-axis) - this turns the entire capsule
	rotate_y(-event.relative.x * mouse_sensitivity)
	
	# Rotate only the active camera vertically (X-axis)
	var active_camera := first_person_camera if is_first_person else third_person_camera
	active_camera.rotate_x(-event.relative.y * mouse_sensitivity)
	active_camera.rotation.x = clamp(active_camera.rotation.x, -PI/2, PI/2)

func _handle_key_input(event: InputEventKey) -> void:
	"""Handle keyboard input for various functions"""
	match event.keycode:
		KEY_O:
			toggle_camera_mode()
		KEY_C:
			switch_character()
		KEY_R:
			toggle_ragdoll()
		KEY_SPACE:
			_handle_jump_input()
		KEY_V:
			cycle_animations()
		KEY_T:
			toggle_ik()

func _physics_process(delta: float) -> void:
	# Apply gravity
	if not is_on_floor():
		velocity.y -= gravity * delta

	# Get input direction
	var input_dir := Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
	var direction := (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	
	is_moving = input_dir.length() > 0.0
	
	# Apply movement
	if direction:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0.0, speed)
		velocity.z = move_toward(velocity.z, 0.0, speed)

	# Update animations
	_update_animations()
	
	move_and_slide()

func _update_animations() -> void:
	"""Update hand and character animations based on movement"""
	if fps_hands and is_first_person:
		if is_moving:
			fps_hands.play_walk_animation(velocity.length() / speed)
		else:
			fps_hands.reset_to_idle()
	
	if character_rig:
		character_rig.update_movement_animation(is_moving)

func toggle_camera_mode() -> void:
	"""Toggle between first and third person camera"""
	is_first_person = !is_first_person
	_update_camera_visibility()

func _update_camera_visibility() -> void:
	"""Update camera and model visibility based on current mode"""
	if is_first_person:
		first_person_camera.current = true
		third_person_camera.current = false
		# Hide character model and show hands (unless ragdoll is active)
		if character_rig and character_rig.character_model and not character_rig.is_ragdoll_active:
			character_rig.character_model.visible = false
		if player_mesh:
			player_mesh.visible = false
		if fps_hands:
			fps_hands.visible = true
	else:
		first_person_camera.current = false
		third_person_camera.current = true
		# Show character model and hide hands (unless ragdoll is active)
		if character_rig and character_rig.character_model and not character_rig.is_ragdoll_active:
			character_rig.character_model.visible = true
		if player_mesh and not character_rig.is_ragdoll_active:
			player_mesh.visible = true
		if fps_hands:
			fps_hands.visible = false

func switch_character() -> void:
	"""Switch to next character model"""
	if character_rig:
		character_rig.switch_character()
		print("Switched character")

func toggle_ragdoll() -> void:
	"""Toggle ragdoll physics"""
	if character_rig:
		character_rig.toggle_ragdoll()

func toggle_ik() -> void:
	"""Toggle IK system"""
	if character_rig:
		character_rig.toggle_ik()
		if character_rig.is_ik_active:
			print("IK Mode: ON - Colored spheres show IK targets")
			print("  RED = Left Hand, GREEN = Right Hand")
			print("  BLUE = Left Foot, YELLOW = Right Foot")
		else:
			print("IK Mode: OFF")

func cycle_animations() -> void:
	"""Cycle through available animations for testing"""
	if character_rig and character_rig.has_method("get_animation_list"):
		var animations: Array[StringName] = character_rig.animation_player.get_animation_list()
		if animations.size() > 0:
			var current_anim: String = character_rig.animation_player.current_animation
			var current_index: int = animations.find(current_anim)
			var next_index: int = (current_index + 1) % animations.size()
			var next_anim: StringName = animations[next_index]
			character_rig.play_animation(next_anim)
			print("Playing animation: ", next_anim)

func _handle_jump_input() -> void:
	"""Handle jump input with debugging"""
	if is_on_floor():
		velocity.y = jump_velocity
		print("Jumped with velocity: ", jump_velocity)
	else:
		print("Cannot jump - not on floor")

func _unhandled_input(_event: InputEvent) -> void:
	if Input.is_action_just_pressed("ui_cancel"):
		var mouse_mode := Input.get_mouse_mode()
		if mouse_mode == Input.MOUSE_MODE_CAPTURED:
			Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		else:
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
