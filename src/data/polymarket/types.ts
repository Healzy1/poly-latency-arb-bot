/**
 * Polymarket orderbook level
 */
export interface PolyOrderbookLevel {
    price: string;      // Price as string from API
    size: string;       // Quantity as string from API
}

/**
 * Polymarket orderbook
 */
export interface PolyOrderbook {
    bids: PolyOrderbookLevel[];
    asks: PolyOrderbookLevel[];
    timestamp?: string | number;
    market?: string;
}

/**
 * Normalized Polymarket market data
 */
export interface PolyMarketData {
    tokenId: string;
    midPrice: number;
    bestBid: number;
    bestAsk: number;
    spreadBps: number;      // Spread in basis points
    depthTopN: number;      // Total quantity in top N levels
    tsLocal: number;        // Local timestamp
}
