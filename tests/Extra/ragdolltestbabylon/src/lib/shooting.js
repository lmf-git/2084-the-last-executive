import * as BABYLON from '@babylonjs/core'

export function setupShooting(scene, camera, ragdoll, newMeshes) {
  scene.onPointerObservable.add((pointerInfo) => {
    if (pointerInfo.type === BABYLON.PointerEventTypes.POINTERDOWN && pointerInfo.event.button === 0) {
      // Only shoot if clicking on canvas
      if (pointerInfo.event.target.tagName !== 'CANVAS') return
      
      const ray = scene.createPickingRay(pointerInfo.event.offsetX, pointerInfo.event.offsetY, BABYLON.Matrix.Identity(), camera)
      const hit = scene.pickWithRay(ray)
      
      let hitTarget = false
      let hitPoint = null
      
      // Check if we hit the dude mesh or any ragdoll boxes
      if (hit.hit && hit.pickedMesh) {
        if (newMeshes.includes(hit.pickedMesh)) {
          hitTarget = true
          hitPoint = hit.pickedPoint
        } else if (ragdoll.boxes && ragdoll.boxes.includes(hit.pickedMesh)) {
          hitTarget = true
          hitPoint = hit.pickedPoint
        }
      }
      
      if (hitTarget) {
        // Enter ragdoll mode if not already
        if (!ragdoll.ragdollMode) {
          scene.stopAnimation(ragdoll.skeleton)
          ragdoll.ragdoll()
        }
        
        let targetImpostor = null
        let limbName = "unknown"
        
        // If we hit a ragdoll box directly, use that specific impostor
        if (ragdoll.boxes && ragdoll.boxes.includes(hit.pickedMesh)) {
          const boxIndex = ragdoll.boxes.indexOf(hit.pickedMesh)
          targetImpostor = ragdoll.impostors[boxIndex]
          limbName = ragdoll.boneNames[boxIndex]
        } else {
          // If we hit the mesh, find closest physics impostor to hit point
          let closestDistance = Infinity
          
          for (let i = 0; i < ragdoll.boxes.length; i++) {
            const distance = BABYLON.Vector3.Distance(hitPoint, ragdoll.boxes[i].position)
            if (distance < closestDistance) {
              closestDistance = distance
              targetImpostor = ragdoll.impostors[i]
              limbName = ragdoll.boneNames[i]
            }
          }
        }
        
        if (targetImpostor) {
          applyImpulse(targetImpostor, ray.direction, hitPoint, 25)
        }
      }
    }
  })
}

function applyImpulse(impostor, direction, hitPoint, strength) {
  const shootingDirection = direction.normalize()
  const impulse = shootingDirection.scale(strength)
  
  // Apply impulse to the specific physics body
  impostor.setLinearVelocity(impostor.getLinearVelocity().add(impulse))
  
  // Apply angular impulse based on hit location relative to center of mass
  const hitOffset = hitPoint.subtract(impostor.object.position)
  const torque = BABYLON.Vector3.Cross(hitOffset, impulse).scale(0.5)
  impostor.setAngularVelocity(impostor.getAngularVelocity().add(torque))
}