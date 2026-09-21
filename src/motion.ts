import { rpyToMatrix, degToRad } from "@pollen-robotics/reachy-mini-sdk";
import { suspicion, coinFlip, type PoseTarget } from "reachy-jev";

export interface RobotMotionPort {
  state: string;
  gotoTarget(target: { head?: number[]; antennas?: number[]; duration: number }): boolean;
}
export function toSdkTarget(pose: PoseTarget, duration = 0.4) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 3) throw new RangeError("invalid motion duration");
  const matrix = rpyToMatrix(pose.rollDeg, pose.pitchDeg, pose.yawDeg);
  matrix[2]![3] = pose.zMm / 1000;
  return {
    head: matrix.flat(),
    antennas: [degToRad(pose.rightAntennaDeg), degToRad(pose.leftAntennaDeg)],
    duration,
  };
}
export function showSuspicion(robot: RobotMotionPort | undefined, p: number): boolean {
  if (!robot || robot.state !== "streaming") return false;
  return robot.gotoTarget(toSdkTarget(suspicion(p)));
}
export async function performCoinFlip(robot: RobotMotionPort | undefined, wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), active: () => boolean = () => true): Promise<boolean> {
  if (!robot || robot.state !== "streaming") return false;
  for (const pose of coinFlip()) {
    if (!active() || robot.state !== "streaming") return false;
    if (!robot.gotoTarget(toSdkTarget(pose, 0.25))) return false;
    await wait(260);
  }
  return true;
}
