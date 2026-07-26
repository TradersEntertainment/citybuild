import { UNDO_STACK_SIZE } from '../data/balance';
import { isEmptyRemoval, restoreRemoved, type RemovedEntities } from './demolish';
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
export type EditLayer = 'road' | 'zone' | 'oneWay';

export interface TileEdit {
  x: number;
  y: number;
  layer: EditLayer;
  /** Encoded value before the change. */
  previous: number;
}

export interface EditAction {
  changes: TileEdit[];
  /** Money spent, refunded on undo. Negative when the edit paid the player. */
  spent: number;
  /**
   * Things an erase took down that are not tiles: facilities and grown
   * buildings. Kept whole, so undoing a mis-swipe over a district gives back
   * the blocks that stood there rather than starting them again from huts.
   */
  removed?: RemovedEntities;
}

export function revertEdits(state: GameState, changes: readonly TileEdit[]): void {
  const { world } = state;
  for (const change of changes) {
    const at = index(world, change.x, change.y);
    if (change.layer === 'road') world.road[at] = change.previous;
    else if (change.layer === 'oneWay') world.oneWay[at] = change.previous;
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
    // Nothing happened, nothing to undo — but an erase that only took a station
    // changed no tile at all, so the entity list has to be consulted too.
    if (action.changes.length === 0 && isEmptyRemoval(action.removed)) return;
    this.actions.push(action);
    if (this.actions.length > UNDO_STACK_SIZE) this.actions.shift();
  }

  /** Reverses the most recent action and refunds it. Returns what it undid. */
  undo(state: GameState): EditAction | null {
    const action = this.actions.pop();
    if (!action) return null;

    revertEdits(state, action.changes);
    // After the tiles, so a restored building lands on ground that is zoned for
    // it again and the next building pass does not immediately pull it down.
    if (action.removed) restoreRemoved(state, action.removed);
    state.money += action.spent;
    return action;
  }

  clear(): void {
    this.actions.length = 0;
  }
}
