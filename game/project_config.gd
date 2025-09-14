## Global project configuration and constants
## 
## This file contains global constants, enums, and configuration
## that should be accessible throughout the project

extends Node

# Game constants
const GAME_VERSION := "0.1.0"
const GAME_NAME := "2084: The Last Executive"

# Physics layers (use enum for better maintainability)
enum PhysicsLayer {
	PLAYER = 1,
	ENVIRONMENT = 2,
	ENEMIES = 4,
	PROJECTILES = 8,
	PICKUPS = 16,
	TRIGGERS = 32
}

# Input action names (centralize for consistency)
const INPUT_ACTIONS := {
	"move_forward": "move_forward",
	"move_backward": "move_backward", 
	"move_left": "move_left",
	"move_right": "move_right",
	"jump": "ui_accept",
	"interact": "ui_accept",
	"menu": "ui_cancel"
}

# Default game settings
const DEFAULT_SETTINGS := {
	"mouse_sensitivity": 0.002,
	"movement_speed": 5.0,
	"jump_height": 4.5,
	"fov": 75.0,
	"master_volume": 1.0,
	"sfx_volume": 1.0,
	"music_volume": 1.0
}

# File paths
const SAVE_FILE_PATH := "user://save_game.dat"
const SETTINGS_FILE_PATH := "user://settings.cfg"

# Scene paths  
const SCENES := {
	"main": "res://scenes/main.tscn",
	"main_menu": "res://scenes/ui/main_menu.tscn",
	"game": "res://scenes/game.tscn"
}

# Utility functions
static func get_setting(key: String, default_value = null):
	"""Get a setting value with fallback to default"""
	return DEFAULT_SETTINGS.get(key, default_value)

static func is_valid_physics_layer(layer: int) -> bool:
	"""Check if a physics layer value is valid"""
	return layer > 0 and layer <= 32

static func print_debug(message: String, category: String = "DEBUG") -> void:
	"""Print debug message with category prefix"""
	if OS.is_debug_build():
		print("[%s] %s" % [category, message])
