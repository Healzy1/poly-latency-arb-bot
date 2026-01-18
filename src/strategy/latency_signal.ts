import { logger } from '../infra/logger.js';
import { env } from '../config/env.js';
import type { ArbSignal, DiscardReason, PolySnapshot } from './types.js';

/**
 * Latency Arbitrage Signal Engine
 */
export class LatencySignalEngine {
    private polySnapshots: PolySnapshot[] = [];
    private lastSignalTime = 0;
    private readonly snapshotWindowMs = 60000; // 60s buffer

    constructor() {
        logger.info('arb.engine.init', {
            minPolyDepth: env.ARB_MIN_POLY_DEPTH,
            maxPolySpreadBps: env.ARB_MAX_POLY_SPREAD_BPS,
            minEdgeBps: env.ARB_MIN_EDGE_BPS,
            cooldownMs: env.ARB_COOLDOWN_MS,
        });
    }

    /**
     * Update Polymarket snapshot
     */
    public updatePolySnapshot(snapshot: PolySnapshot): void {
        this.polySnapshots.push(snapshot);

        // Clean old snapshots outside window
        const cutoff = Date.now() - this.snapshotWindowMs;
        this.polySnapshots = this.polySnapshots.filter(s => s.timestamp >= cutoff);

        logger.debug('arb.poly_update', {
            tokenId: snapshot.tokenId,
            midPrice: snapshot.midPrice,
            bufferSize: this.polySnapshots.length,
        });
    }

    /**
     * Process spot move event
     */
    public processSpotMove(
        symbol: string,
        price: number,
        moveBps: number,
        direction: 'up' | 'down'
    ): void {
        const now = Date.now();

        // Get latest Polymarket snapshot
        const latestPoly = this.getLatestPolySnapshot();

        if (!latestPoly) {
            this.logDiscard('no_poly_snapshot', {
                spotSymbol: symbol,
                spotPrice: price,
                spotMoveBps: moveBps,
                spotDirection: direction,
            });
            return;
        }

        // Check spread threshold
        if (latestPoly.spreadBps > env.ARB_MAX_POLY_SPREAD_BPS) {
            this.logDiscard('wide_spread', {
                spotSymbol: symbol,
                spotPrice: price,
                spotMoveBps: moveBps,
                spotDirection: direction,
                polySpreadBps: latestPoly.spreadBps,
                maxAllowed: env.ARB_MAX_POLY_SPREAD_BPS,
            });
            return;
        }

        // Check depth threshold
        if (latestPoly.depthTopN < env.ARB_MIN_POLY_DEPTH) {
            this.logDiscard('low_depth', {
                spotSymbol: symbol,
                spotPrice: price,
                spotMoveBps: moveBps,
                spotDirection: direction,
                polyDepth: latestPoly.depthTopN,
                minRequired: env.ARB_MIN_POLY_DEPTH,
            });
            return;
        }

        // Check cooldown
        const timeSinceLastSignal = now - this.lastSignalTime;
        if (timeSinceLastSignal < env.ARB_COOLDOWN_MS) {
            this.logDiscard('cooldown', {
                spotSymbol: symbol,
                spotPrice: price,
                spotMoveBps: moveBps,
                spotDirection: direction,
                timeSinceLastMs: timeSinceLastSignal,
                cooldownMs: env.ARB_COOLDOWN_MS,
            });
            return;
        }

        // Calculate edge (simplified: assume spot move should reflect in poly)
        const polyMoveBps = this.calculatePolyMovement();
        const edgeBps = Math.abs(moveBps) - Math.abs(polyMoveBps);

        if (edgeBps < env.ARB_MIN_EDGE_BPS) {
            this.logDiscard('insufficient_edge', {
                spotSymbol: symbol,
                spotPrice: price,
                spotMoveBps: moveBps,
                spotDirection: direction,
                polyMoveBps,
                edgeBps,
                minRequired: env.ARB_MIN_EDGE_BPS,
            });
            return;
        }

        // Emit signal
        this.emitSignal({
            timestamp: now,
            spotSymbol: symbol,
            spotPrice: price,
            spotMoveBps: moveBps,
            spotDirection: direction,
            polyTokenId: latestPoly.tokenId,
            polyMidPrice: latestPoly.midPrice,
            polySpreadBps: latestPoly.spreadBps,
            polyDepth: latestPoly.depthTopN,
            edgeBps,
            reason: 'latency_opportunity',
        });

        this.lastSignalTime = now;
    }

    /**
     * Get latest Polymarket snapshot
     */
    private getLatestPolySnapshot(): PolySnapshot | null {
        if (this.polySnapshots.length === 0) {
            return null;
        }
        return this.polySnapshots[this.polySnapshots.length - 1];
    }

    /**
     * Calculate Polymarket movement in bps
     */
    private calculatePolyMovement(): number {
        if (this.polySnapshots.length < 2) {
            return 0;
        }

        const oldest = this.polySnapshots[0];
        const latest = this.polySnapshots[this.polySnapshots.length - 1];

        const returnRatio = (latest.midPrice / oldest.midPrice) - 1;
        return returnRatio * 10000;
    }

    /**
     * Emit arbitrage signal
     */
    private emitSignal(signal: ArbSignal): void {
        logger.warn('arb.signal', {
            spotSymbol: signal.spotSymbol,
            spotPrice: signal.spotPrice,
            spotMoveBps: signal.spotMoveBps.toFixed(2),
            spotDirection: signal.spotDirection,
            polyTokenId: signal.polyTokenId,
            polyMidPrice: signal.polyMidPrice.toFixed(4),
            polySpreadBps: signal.polySpreadBps.toFixed(2),
            polyDepth: signal.polyDepth.toFixed(2),
            edgeBps: signal.edgeBps.toFixed(2),
            reason: signal.reason,
        });
    }

    /**
     * Log discard with reason
     */
    private logDiscard(reason: DiscardReason, data: Record<string, unknown>): void {
        logger.debug('arb.discard', {
            reason,
            ...data,
        });
    }
}
