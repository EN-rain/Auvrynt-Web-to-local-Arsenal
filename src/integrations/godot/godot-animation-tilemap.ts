import type { GodotEditorBridgeClient } from "./godot-editor-bridge.js";

export interface AnimationTrack {
  type: string;
  targetPath: string;
  keys: Array<{ time: number; value: unknown }>;
  interpolation: "nearest" | "linear" | "cubic";
}

export interface AnimationInfo {
  name: string;
  lengthSeconds: number;
  loop: boolean;
  step: number;
  tracks: AnimationTrack[];
}

export interface SpriteFramesAnimationInput {
  workspaceId: string;
  animatedSpriteNodePath?: string;
  animationName: string;
  framePaths?: string[];
  spriteSheetPath?: string;
  columns?: number;
  rows?: number;
  frameIndices?: number[];
  fps?: number;
  loop?: boolean;
}

export async function listAnimations(
  input: { workspaceId: string; animationPlayerNodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<string[]> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  const result = await bridgeClient.sendRequest("animation.list", { nodePath: input.animationPlayerNodePath });
  return result.animations ?? [];
}

export async function getAnimation(
  input: { workspaceId: string; animationPlayerNodePath: string; animationName: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<AnimationInfo> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("animation.get", {
    nodePath: input.animationPlayerNodePath,
    animationName: input.animationName,
  });
}

export async function createAnimation(
  input: { workspaceId: string; animationPlayerNodePath: string; animationName: string; lengthSeconds?: number; loop?: boolean },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ created: boolean; name: string }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  await bridgeClient.sendRequest("animation.create", {
    nodePath: input.animationPlayerNodePath,
    animationName: input.animationName,
    length: input.lengthSeconds ?? 1,
    loop: input.loop ?? false,
  });
  return { created: true, name: input.animationName };
}

export async function validateAnimation(
  input: { workspaceId: string; animationPlayerNodePath: string; animationName: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ valid: boolean; issues: string[] }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  const animation = await getAnimation(input, bridgeClient);
  const issues: string[] = [];
  if (animation.lengthSeconds === 0) issues.push("Animation length is zero.");
  for (const track of animation.tracks) {
    if (track.keys.length === 0) issues.push(`Track '${track.targetPath}' has no keys.`);
  }
  return { valid: issues.length === 0, issues };
}

export async function getTileLayers(
  input: { workspaceId: string; tileMapNodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<Array<{ index: number; name: string; enabled: boolean; layerMask: number }>> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  const result = await bridgeClient.sendRequest("tilemap.get_layers", { nodePath: input.tileMapNodePath });
  return result.layers ?? [];
}

export async function inspectTileset(
  input: { workspaceId: string; tileMapNodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<Record<string, unknown>> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("tilemap.inspect_tileset", { nodePath: input.tileMapNodePath });
}

export async function validateTilemap(
  input: { workspaceId: string; tileMapNodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ valid: boolean; issues: string[] }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("tilemap.validate", { nodePath: input.tileMapNodePath });
}

export async function getPhysicsConfiguration(
  input: { workspaceId: string; nodePath?: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<Record<string, unknown>> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("physics.get_configuration", { nodePath: input.nodePath ?? "/" });
}

export async function validateCollisions(
  input: { workspaceId: string; nodePath?: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ valid: boolean; issues: string[] }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("physics.validate_collisions", { nodePath: input.nodePath ?? "/" });
}

export async function getCameraState(
  input: { workspaceId: string; cameraNodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<Record<string, unknown>> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("camera.get_state", { nodePath: input.cameraNodePath });
}

export async function validateCamera(
  input: { workspaceId: string; cameraNodePath: string },
  bridgeClient: GodotEditorBridgeClient,
): Promise<{ valid: boolean; issues: string[] }> {
  if (!bridgeClient.status) throw new Error("Godot Editor Bridge is not connected.");
  return bridgeClient.sendRequest("camera.validate", { nodePath: input.cameraNodePath });
}
