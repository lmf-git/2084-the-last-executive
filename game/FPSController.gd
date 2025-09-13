extends CharacterBody3D

@export var speed = 5.0
@export var jump_velocity = 4.5
@export var mouse_sensitivity = 0.002

var gravity = ProjectSettings.get_setting("physics/3d/default_gravity")

@onready var camera = $Camera3D
@onready var third_person_camera = $ThirdPersonCamera
@onready var fps_hands = $Camera3D/FPSHands
@onready var character_rig = $CharacterRig
@onready var player_mesh = $PlayerMesh

var is_moving = false
var is_first_person = true

func _ready():
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	# Wait one frame for character rig to load, then set initial visibility
	call_deferred("setup_initial_visibility")

func setup_initial_visibility():
	"""Set initial character visibility based on camera mode"""
	if is_first_person:
		if character_rig and character_rig.character_model:
			character_rig.character_model.visible = false
		if player_mesh:
			player_mesh.visible = false
		if fps_hands:
			fps_hands.visible = true
	else:
		if character_rig and character_rig.character_model:
			character_rig.character_model.visible = true
		if player_mesh:
			player_mesh.visible = true
		if fps_hands:
			fps_hands.visible = false

func _input(event):
	if event is InputEventMouseMotion:
		rotate_y(-event.relative.x * mouse_sensitivity)
		var active_camera = camera if is_first_person else third_person_camera
		active_camera.rotate_x(-event.relative.y * mouse_sensitivity)
		active_camera.rotation.x = clamp(active_camera.rotation.x, -PI/2, PI/2)
	
	if event is InputEventKey and event.pressed:
		if event.keycode == KEY_O:
			toggle_camera_mode()
		elif event.keycode == KEY_C:
			switch_character()
		elif event.keycode == KEY_R:
			toggle_ragdoll()
		elif event.keycode == KEY_SPACE:
			handle_jump_input()
		elif event.keycode == KEY_V:
			cycle_animations()
		elif event.keycode == KEY_T:
			toggle_ik()

func _physics_process(delta):
	# Add gravity
	if not is_on_floor():
		velocity.y -= gravity * delta

	# Handle jump - removed from physics process since we handle it in input

	# Get input direction
	var input_dir = Input.get_vector("move_left", "move_right", "move_forward", "move_backward")
	var direction = (transform.basis * Vector3(input_dir.x, 0, input_dir.y)).normalized()
	
	is_moving = input_dir.length() > 0
	
	if direction:
		velocity.x = direction.x * speed
		velocity.z = direction.z * speed
	else:
		velocity.x = move_toward(velocity.x, 0, speed)
		velocity.z = move_toward(velocity.z, 0, speed)

	# Update hand animations
	if fps_hands and is_first_person:
		if is_moving:
			fps_hands.play_walk_animation(input_dir.length())
		else:
			fps_hands.reset_to_idle()
	
	# Update character animations
	if character_rig:
		character_rig.update_movement_animation(is_moving)

	move_and_slide()

func toggle_camera_mode():
	"""Toggle between first and third person camera"""
	is_first_person = !is_first_person
	
	if is_first_person:
		camera.current = true
		third_person_camera.current = false
		# Hide character model and show hands (unless ragdoll is active)
		if character_rig and character_rig.character_model and not character_rig.is_ragdoll_active:
			character_rig.character_model.visible = false
		if player_mesh:
			player_mesh.visible = false
		if fps_hands:
			fps_hands.visible = true
	else:
		camera.current = false  
		third_person_camera.current = true
		# Show character model and hide hands (unless ragdoll is active)
		if character_rig and character_rig.character_model and not character_rig.is_ragdoll_active:
			character_rig.character_model.visible = true
		if player_mesh and not character_rig.is_ragdoll_active:
			player_mesh.visible = true
		if fps_hands:
			fps_hands.visible = false

func switch_character():
	"""Switch to next character model"""
	if character_rig:
		character_rig.switch_character()
		print("Switched character")

func toggle_ragdoll():
	"""Toggle ragdoll physics"""
	if character_rig:
		character_rig.toggle_ragdoll()

func handle_jump_input():
	"""Handle jump input with debugging"""
	print("Jump key pressed")
	print("Is on floor: ", is_on_floor())
	print("Current velocity.y: ", velocity.y)
	
	if is_on_floor():
		velocity.y = jump_velocity
		print("Applied jump velocity: ", jump_velocity)
	else:
		print("Not on floor - cannot jump")

func cycle_animations():
	"""Cycle through available animations for testing"""
	if character_rig and character_rig.animation_player:
		var animations = character_rig.animation_player.get_animation_list()
		if animations.size() > 0:
			var current_anim = character_rig.animation_player.current_animation
			var current_index = animations.find(current_anim)
			var next_index = (current_index + 1) % animations.size()
			var next_anim = animations[next_index]
			character_rig.play_animation(next_anim)
			print("Playing animation: ", next_anim)

func toggle_ik():
	"""Toggle IK system"""
	if character_rig:
		character_rig.toggle_ik()

func _unhandled_input(_event):
	if Input.is_action_just_pressed("ui_cancel"):
		if Input.get_mouse_mode() == Input.MOUSE_MODE_CAPTURED:
			Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
		else:
			Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)