/**
 * Pin store service / 置顶存储服务
 * Persists pinned sessions to ~/.claude-session-manager/pins.json
 * 将置顶会话持久化到 ~/.claude-session-manager/pins.json
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { config } from '../utils/config.js';

export interface PinEntry {
  projectId: string;
  sessionId: string;
  pinnedAt: string;
}

const pinsFile = join(config.appDataDir, 'pins.json');

let pins: PinEntry[] = [];

function load(): void {
  if (!existsSync(pinsFile)) {
    pins = [];
    return;
  }
  try {
    pins = JSON.parse(readFileSync(pinsFile, 'utf-8'));
  } catch {
    pins = [];
  }
}

function save(): void {
  writeFileSync(pinsFile, JSON.stringify(pins, null, 2), 'utf-8');
}

load();

export function listPins(): PinEntry[] {
  return pins;
}

export function isPinned(projectId: string, sessionId: string): boolean {
  return pins.some(p => p.projectId === projectId && p.sessionId === sessionId);
}

export function addPin(projectId: string, sessionId: string): PinEntry {
  if (isPinned(projectId, sessionId)) {
    return pins.find(p => p.projectId === projectId && p.sessionId === sessionId)!;
  }
  const entry: PinEntry = { projectId, sessionId, pinnedAt: new Date().toISOString() };
  pins.unshift(entry);
  save();
  return entry;
}

export function removePin(projectId: string, sessionId: string): boolean {
  const idx = pins.findIndex(p => p.projectId === projectId && p.sessionId === sessionId);
  if (idx === -1) return false;
  pins.splice(idx, 1);
  save();
  return true;
}
