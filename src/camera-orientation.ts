type Axis = readonly [number, number, number];
type Quaternion = readonly [number, number, number, number];

interface CameraBasis {
  right: Axis;
  up: Axis;
  forward: Axis;
}

const pitchLimit = 1.56;

export class CameraOrientation {
  private yawY = 0;
  private yawW = 1;
  private pitch = 0;
  private currentBasis = basisFromQuaternion([0, 0, 0, 1]);

  get basis(): CameraBasis {
    return this.currentBasis;
  }

  reset(pitch = 0) {
    this.yawY = 0;
    this.yawW = 1;
    this.pitch = pitch;
    this.updateBasis();
  }

  turn(yawDelta: number, pitchDelta: number) {
    // Apply a world-space yaw about the vertical axis without wrapping angles.
    const halfYaw = yawDelta * 0.5;
    const sinYaw = Math.sin(halfYaw);
    const cosYaw = Math.cos(halfYaw);
    const y = cosYaw * this.yawY + sinYaw * this.yawW;
    const w = cosYaw * this.yawW - sinYaw * this.yawY;
    const length = Math.hypot(y, w);
    this.yawY = y / length;
    this.yawW = w / length;

    // Pitch about the camera's right axis and keep the view upright.
    this.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.pitch + pitchDelta));
    this.updateBasis();
  }

  private updateBasis() {
    const pitchX = Math.sin(-this.pitch * 0.5);
    const pitchW = Math.cos(this.pitch * 0.5);

    // Quaternion product yaw * pitch. Pitch is applied in camera space.
    const orientation: Quaternion = [
      this.yawW * pitchX,
      this.yawY * pitchW,
      -this.yawY * pitchX,
      this.yawW * pitchW,
    ];
    this.currentBasis = basisFromQuaternion(orientation);
  }
}

function basisFromQuaternion([x, y, z, w]: Quaternion): CameraBasis {
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return {
    right: [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy)],
    up: [2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx)],
    forward: [2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy)],
  };
}
