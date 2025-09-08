extends RigidBody3D

@export var move_speed = 50.0 # Increased from 10.0 to make movement more noticeable
@export var turn_speed = 2.0
@export var camera_distance = 5.0 # How far the camera should be from the cube.
@export var camera_height = 2.0   # How high the camera should be above the cube.

# Reference to the camera node
var camera_node: Camera3D

# Called when the node enters the scene tree for the first time.
func _ready():
	# Create and configure the camera.
	camera_node = Camera3D.new()
	add_child(camera_node)
	camera_node.current = true # Make this the active camera in the scene.
	
	# Position the camera relative to the cube.
	# We use this as a starting point, the camera will be updated in _process().
	camera_node.transform.origin = Vector3(0, camera_height, camera_distance)
	
	# Set the camera's field of view (optional).
	camera_node.fov = 75.0

# This function gives you manual control over the physics body's state.
# We will use this to lock the rotation on the X and Z axes.
func _integrate_forces(state):
	# Lock the rotation on the X and Z axes by setting their angular velocity to 0.
	state.angular_velocity.x = 0.0
	state.angular_velocity.z = 0.0
	# The cube can still rotate on the Y axis due to the `apply_torque` call.

# Called every physics frame. Use this for physics-related operations.
func _physics_process(_delta):
	# Handle linear movement (forward and backward)
	var move_direction = 0.0
	if Input.is_action_pressed("move_forward"):
		move_direction = 1.0
		# Log a message to confirm the key is detected.
		print("Move forward detected!")
	if Input.is_action_pressed("move_backward"):
		move_direction = -1.0
		# Log a message to confirm the key is detected.
		print("Move backward detected!")
	
	# Apply a force to the cube to move it.
	apply_central_force(-transform.basis.z * move_direction * move_speed)

	# Handle turning (rotation)
	var turn_direction = 0.0
	if Input.is_action_pressed("turn_left"):
		turn_direction = 1.0
		# Log a message to confirm the key is detected.
		print("Turn left detected!")
	if Input.is_action_pressed("turn_right"):
		turn_direction = -1.0
		# Log a message to confirm the key is detected.
		print("Turn right detected!")

	# Apply torque to rotate the cube around its Y-axis (up).
	apply_torque(transform.basis.y * turn_direction * turn_speed)

# Called every frame. Use this for non-physics related updates like camera movement.
func _process(_delta):
	# Update the camera's position to follow the cube.
	# We use global_transform to get the world coordinates.
	var target_position = global_transform.origin
	var camera_offset = -transform.basis.z * camera_distance + Vector3(0, camera_height, 0)
	camera_node.global_transform.origin = target_position + camera_offset
	
	# Make the camera look at the cube's position.
	camera_node.look_at(global_transform.origin)
