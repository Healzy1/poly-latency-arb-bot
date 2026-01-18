/**
 * Arbitrage signal types
 */
export interface ArbSignal {
    timestamp: number;
    spotSymbol: string;
    spotPrice: number;
    spotMoveBps: number;
    spotDirection: 'up' | 'down';
    polyTokenId: string;
    polyMidPrice: number;
    polySpreadBps: number;
    polyDepth: number;
    edgeBps: number;
    reason: string;
}

/**
 * Discard reason for non-signals
 */
export type DiscardReason =
    | 'no_poly_snapshot'
    | 'wide_spread'
    | 'low_depth'
    | 'cooldown'
    | 'insufficient_edge';

/**
 * Polymarket snapshot data for strategy
 */
export interface PolySnapshot {
    tokenId: string;
    midPrice: number;
    spreadBps: number;
    depthTopN: number;
    timestamp: number;
}
