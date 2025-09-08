import * as BABYLON from '@babylonjs/core'

export const defaultRagdollConfig = [
  { bones: ["bone0"], size: 1, mass: 5},
  { bones: ["bone1"], size: 7, min: 1, max: 1, mass: 10},
  { bones: ["bone5"], size: 6, min: -20, max: 20, mass: 8},
  { bones: ["bone7"], size: 6, boxOffset: 4, min: -45, max: 45, mass: 6},
  { bones: ["bone13", "bone32"], size: 6, boxOffset: 6, rotationAxis: BABYLON.Axis.Z, min: -30, max: 30, mass: 7},
  { bones: ["bone14", "bone33"], size: 6, boxOffset: 6, rotationAxis: BABYLON.Axis.Y, min: -30, max: 30, mass: 5},
  { bones: ["bone50", "bone54"], size: 8, boxOffset: 8, rotationAxis: BABYLON.Axis.Z, min: -90, max: 5, mass: 12},
  { bones: ["bone51", "bone55"], size: 8, boxOffset: 8, min: 0, max: 130, mass: 10},
  { bones: ["bone52", "bone56"], size: 6, min: 1, max: 1, mass: 8}
]

export class Ragdoll {
  constructor(skeleton, mesh, config, jointCollisions = false, showBoxes = false, mainPivotSphereSize = 0, disableBoxBoneSync = false) {
    this.skeleton = skeleton
    this.scene = skeleton.getScene()
    this.mesh = mesh
    this.config = config
    this.boxConfigs = []
    this.showBoxes = showBoxes
    this.boxVisibility = 0.6
    this.bones = []
    this.initialRotation = []
    this.boneNames = []
    this.boxes = []
    this.impostors = []
    this.mainPivotSphereSize = mainPivotSphereSize
    this.disableBoxBoneSync = disableBoxBoneSync
    this.ragdollMode = false
    this.jointCollisions = jointCollisions
    this.rootBoneName = null
    this.rootBoneIndex = -1
    this.mass = 1
    this.restitution = 0

    this.putBoxesInBoneCenter = false
    this.defaultJoint = BABYLON.PhysicsJoint.HingeJoint
    this.defaultJointMin = -90
    this.defaultJointMax = 90

    this.boneOffsetAxis = BABYLON.Axis.Y
  }

  createColliders() {
    this.mesh.computeWorldMatrix()

    for (let i = 0; i < this.config.length; i++) {
      const boneNames = this.config[i].bone ? [this.config[i].bone] : this.config[i].bones

      for (let ii = 0; ii < boneNames.length; ii++) {
        const currentBone = this.skeleton.bones[this.skeleton.getBoneIndexByName(boneNames[ii])]

        if (!currentBone) {
          console.log("Bone", boneNames[ii], "does not exist")
          return
        }

        const currentBoxProps = {
          width: this.config[i].width,
          depth: this.config[i].depth,
          height: this.config[i].height,
          size: this.config[i].size,
        }

        const box = BABYLON.MeshBuilder.CreateBox(currentBone.name + "_box", currentBoxProps, this.scene)
        box.visibility = this.showBoxes ? this.boxVisibility : 0

        currentBoxProps.joint = this.config[i].joint ?? this.defaultJoint
        currentBoxProps.rotationAxis = this.config[i].rotationAxis ?? BABYLON.Axis.X
        currentBoxProps.min = this.config[i].min ?? this.defaultJointMin
        currentBoxProps.max = this.config[i].max ?? this.defaultJointMax

        let boxOffset = 0
        if (this.config[i].putBoxInBoneCenter || this.putBoxesInBoneCenter) {
          if (currentBone.length === undefined) {
            console.log("The length property is not defined for bone", currentBone.name, ". putBox(es)InBoneCenter will not work")
          }
          boxOffset = currentBone.length / 2
        } else if (this.config[i].boxOffset) {
          boxOffset = this.config[i].boxOffset
        }
        currentBoxProps.boxOffset = boxOffset

        const boneOffsetAxis = this.config[i].boneOffsetAxis ?? this.boneOffsetAxis
        const boneDir = currentBone.getDirection(boneOffsetAxis, this.mesh)
        currentBoxProps.boneOffsetAxis = boneOffsetAxis

        box.position = currentBone.getAbsolutePosition(this.mesh).add(boneDir.scale(boxOffset))

        const mass = this.config[i].mass ?? this.mass
        const restitution = this.config[i].restitution ?? this.restitution
        box.physicsImpostor = new BABYLON.PhysicsImpostor(box, BABYLON.PhysicsImpostor.BoxImpostor, { mass, restitution }, this.scene)

        this.bones.push(currentBone)
        this.boneNames.push(currentBone.name)
        this.boxes.push(box)
        this.boxConfigs.push(currentBoxProps)
        this.impostors.push(box.physicsImpostor)
        this.initialRotation.push(currentBone.getRotationQuaternion(BABYLON.Space.WORLD, this.mesh))
      }
    }
  }

  initJoints() {
    this.mesh.computeWorldMatrix()
    for (let i = 0; i < this.bones.length; i++) {
      if (i === this.rootBoneIndex) continue

      const nearestParent = this.findNearestParent(i)

      if (!nearestParent) {
        console.log("Couldn't find a nearest parent bone in the configs for bone called", this.boneNames[i])
        return
      }

      const boneParentIndex = this.boneNames.indexOf(nearestParent.name)

      let distanceFromParentBoxToBone = this.bones[i].getAbsolutePosition(this.mesh).subtract(this.boxes[boneParentIndex].position)

      const wmat = this.boxes[boneParentIndex].computeWorldMatrix()
      const invertedWorldMat = BABYLON.Matrix.Invert(wmat)
      distanceFromParentBoxToBone = BABYLON.Vector3.TransformCoordinates(this.bones[i].getAbsolutePosition(this.mesh), invertedWorldMat)

      const boneAbsPos = this.bones[i].getAbsolutePosition(this.mesh)
      const boxAbsPos = this.boxes[i].position.clone()
      const myConnectedPivot = boneAbsPos.subtract(boxAbsPos)

      const joint = new BABYLON.PhysicsJoint(this.boxConfigs[i].joint, {
        mainPivot: distanceFromParentBoxToBone,
        connectedPivot: myConnectedPivot,
        mainAxis: this.boxConfigs[i].rotationAxis,
        connectedAxis: this.boxConfigs[i].rotationAxis,
        collision: this.jointCollisions,
        nativeParams: {
          min: this.boxConfigs[i].min,
          max: this.boxConfigs[i].max
        }
      })

      this.impostors[boneParentIndex].addJoint(this.impostors[i], joint)

      if (this.mainPivotSphereSize !== 0) {
        const mainPivotSphere = new BABYLON.MeshBuilder.CreateSphere("mainPivot", { diameter: this.mainPivotSphereSize }, this.scene)
        mainPivotSphere.position = this.bones[i].getAbsolutePosition(this.mesh)
        this.boxes[boneParentIndex].addChild(mainPivotSphere)
      }
    }
  }

  addImpostorRotationToBone(boneIndex) {
    const newRotQuat = this.impostors[boneIndex].object.rotationQuaternion.multiply(this.initialRotation[boneIndex])
    this.bones[boneIndex].setRotationQuaternion(newRotQuat, BABYLON.Space.WORLD, this.mesh)
  }

  defineRootBone() {
    const skeletonRoots = this.skeleton.getChildren()
    if (skeletonRoots.length !== 1) {
      console.log("Ragdoll creation failed: there can only be 1 root in the skeleton")
      return false
    }

    this.rootBoneName = skeletonRoots[0].name
    this.rootBoneIndex = this.boneNames.indexOf(this.rootBoneName)
    if (this.rootBoneIndex === -1) {
      console.log("Ragdoll creation failed: the array boneNames doesn't have the root bone in it - the root bone is", this.skeleton.getChildren())
      return false
    }

    return true
  }

  findNearestParent(boneIndex) {
    let nearestParent = this.bones[boneIndex].getParent()

    do {
      if (nearestParent && this.boneNames.includes(nearestParent.name)) {
        break
      }

      nearestParent = nearestParent?.getParent()
    } while (nearestParent)

    return nearestParent
  }

  toggleShowBoxes() {
    this.showBoxes = !this.showBoxes

    for (const box of this.boxes) {
      box.visibility = this.showBoxes ? this.boxVisibility : 0
    }
  }

  ragdollOff() {
    this.ragdollMode = false
    this.mesh.position = new BABYLON.Vector3()
  }

  setBoxSyncEnabled(enabled) {
    this.disableBoxBoneSync = !enabled
  }

  init() {
    this.createColliders()
    
    if (!this.defineRootBone()) return

    this.initJoints()
    this.syncBonesAndBoxes = () => {
      if (this.ragdollMode) {
        const rootBoneDirection = this.bones[this.rootBoneIndex].getDirection(this.boxConfigs[this.rootBoneIndex].boneOffsetAxis, this.mesh)
        const rootBoneOffsetPosition = this.bones[this.rootBoneIndex].getAbsolutePosition(this.mesh).add(rootBoneDirection.scale(this.boxConfigs[this.rootBoneIndex].boxOffset))

        this.addImpostorRotationToBone(this.rootBoneIndex)

        const dist = rootBoneOffsetPosition.subtract(this.impostors[this.rootBoneIndex].object.position)
        this.mesh.position = this.mesh.position.subtract(dist)

        for (let i = 0; i < this.bones.length; i++) {
          if (i === this.rootBoneIndex) continue
          this.addImpostorRotationToBone(i)
        }
      } else {
        if (!this.disableBoxBoneSync) {
          for (let i = 0; i < this.bones.length; i++) {
            this.impostors[i].syncImpostorWithBone(this.bones[i], this.mesh, null, this.boxConfigs[i].boxOffset, null, this.boxConfigs[i].boneOffsetAxis)

            this.impostors[i].setAngularVelocity(new BABYLON.Vector3())
            this.impostors[i].setLinearVelocity(new BABYLON.Vector3())
          }
        }
      }
    }
    this.scene.registerBeforeRender(this.syncBonesAndBoxes)
  }

  ragdoll() {
    for (let i = 0; i < this.bones.length; i++) {
      const rotationAdjust = BABYLON.Quaternion.Inverse(this.initialRotation[i])
      this.impostors[i].syncImpostorWithBone(this.bones[i], this.mesh, null, this.boxConfigs[i].boxOffset, rotationAdjust, this.boxConfigs[i].boneOffsetAxis)
    }

    if (!this.ragdollMode) {
      this.ragdollMode = true
    }
  }

  dispose() {
    if (this.syncBonesAndBoxes) {
      this.scene.unregisterBeforeRender(this.syncBonesAndBoxes)
    }
    
    this.boxes.forEach(box => box.dispose())
    this.impostors.forEach(impostor => impostor.dispose())
    
    this.boxes = []
    this.impostors = []
    this.bones = []
    this.boneNames = []
    this.boxConfigs = []
  }
}