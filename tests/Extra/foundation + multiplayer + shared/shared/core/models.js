export const ModelPaths = {
  // Model file paths relative to the public/models directory
  PLAYER: 'player.glb',
  CAR: 'vehicles/car.glb',
  HELICOPTER: 'vehicles/helicopter.glb',
  PLANE: 'vehicles/plane.glb',
  GHOST_BOX: 'ghosts/box.glb',
  GHOST_SPHERE: 'ghosts/sphere.glb',
  GHOST_CYLINDER: 'ghosts/cylinder.glb'
}

export const getModelUrl = (modelPath, isProduction = false, isClient = true) => {
  if (isClient) {
    // Client always uses relative path from public folder
    return `/models/${modelPath}`
  } else {
    // Server uses localhost in dev, production URL in prod
    const baseUrl = isProduction 
      ? 'https://thecoop.group/models'
      : 'http://localhost:3000/models'
    return `${baseUrl}/${modelPath}`
  }
}

// Base model loader using fetch - works in both environments
export class ModelLoader {
  static async fetchModel(modelPath, isProduction = false, isClient = true) {
    const url = getModelUrl(modelPath, isProduction, isClient)
    
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch model: ${response.statusText}`)
      }
      
      const arrayBuffer = await response.arrayBuffer()
      return arrayBuffer
    } catch (error) {
      console.error(`Failed to load model ${modelPath}:`, error)
      return null
    }
  }
  
  static async loadModels(isProduction = false, isClient = true) {
    const modelPaths = Object.values(ModelPaths)
    const promises = modelPaths.map(path => this.fetchModel(path, isProduction, isClient))
    const results = await Promise.all(promises)
    
    const loaded = results.filter(r => r !== null).length
    console.log(`Loaded ${loaded}/${modelPaths.length} models`)
    
    return loaded === modelPaths.length
  }
}