import { UNDO_STACK_SIZE } from '../data/balance';
import type { GameState } from './state';
import { index } from './world';

/**
 * Undo stack (§5.1). Twenty actions deep, money refunded. On a phone a wrong
 * drag is inevitable, so every destructive action has to be reversible — the
 * brief bans punishing a mis-touch (§24).
 *
 * Edits name the column they touched, so one stack covers roads and zones and
 * will cover whatever the later phases add without growing a case per tool.
 */
export type EditLayer = 'road' | 'zone';

export interface TileEdit {
  x: number;
  y: number;
  layer: EditLayer;
  /** Encoded value before the change. */
  previous: number;
}

export interface EditAction {
  changes: TileEdit[];
  /** Money spent, refunded on undo. */
  spent: number;
}

export function revertEdits(state: GameState, changes: readonly TileEdit[]): void {
  const { world } = state;
  for (const change of changes) {
    const at = index(world, change.x, change.y);
    if (change.layer === 'road') world.road[at] = change.previous;
    else world.zone[at] = change.previous;
  }
}

export class UndoStack {
  private readonly actions: EditAction[] = [];

  get depth(): number {
    return this.actions.length;
  }

  get canUndo(): boolean {
    return this.actions.length > 0;
  }

  push(action: EditAction): void {
    if (action.changes.length === 0) return; // nothing happened, nothing to undo
    this.actions.push(action);
    if (this.actions.length > UNDO_STACK_SIZE) this.actions.shift();
  }

  /** Reverses the most recent action and refunds it. Returns what it undid. */
  undo(state: GameState): EditAction | null {
    const action = this.actions.pop();
    if (!action) return null;

    revertEdits(state, action.changes);
    state.money += action.spent;
    return action;
  }

  clear(): void {
    this.actions.length = 0;
  }
}
