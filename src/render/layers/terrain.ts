import type { Era } from '../../sim/tiles';
import type { World } from '../../sim/world';
import type { Camera } from '../camera';
import { TerrainCache } from '../terrainCache';

/**
 * Terrain layer. All the painting lives in TerrainCache; this is the seam the
 * renderer talks to, and the place a future terraforming action would call
 * invalidate().
 */
export class TerrainLayer {
  private readonly cache = new TerrainCache();

  draw(ctx: CanvasRenderingContext2D, world: World, camera: Camera, era: Era): void {
    this.cache.ensure(world, camera, era);
    this.cache.blit(ctx, camera);
  }

  invalidate(): void {
    this.cache.invalidate();
  }

  get lastRepaintMs(): number {
    return this.cache.lastRepaintDuration;
  }
}
