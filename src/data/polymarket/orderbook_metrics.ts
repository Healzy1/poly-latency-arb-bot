/**
 * Orderbook level from CLOB API
 */
export interface OrderbookLevel {
    price: string;
    size: string;
}

/**
 * Orderbook metrics calculated from CLOB data
 */
export interface OrderbookMetrics {
    tokenId: string;
    bestBid: number;
    bestAsk: number;
    midPrice: number;
    spreadBps: number;
    depthTopN: number;
    bidLevels: number;
    askLevels: number;
    valid: boolean;
    error?: string;
}

/**
 * Calculate orderbook metrics from bids and asks
 */
export function calculateOrderbookMetrics(
    tokenId: string,
    bids: OrderbookLevel[],
    asks: OrderbookLevel[],
    depthLevels: number = 10
): OrderbookMetrics {
    // Validate we have data
    if (!bids || bids.length === 0 || !asks || asks.length === 0) {
        return {
            tokenId,
            bestBid: 0,
            bestAsk: 0,
            midPrice: 0,
            spreadBps: 0,
            depthTopN: 0,
            bidLevels: 0,
            askLevels: 0,
            valid: false,
            error: 'No bids or asks available',
        };
    }

    // Sort bids descending (highest first), asks ascending (lowest first)
    const sortedBids = [...bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    const sortedAsks = [...asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));

    // Get best bid and ask
    const bestBid = parseFloat(sortedBids[0].price);
    const bestAsk = parseFloat(sortedAsks[0].price);

    // Validate prices
    if (isNaN(bestBid) || isNaN(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
        return {
            tokenId,
            bestBid,
            bestAsk,
            midPrice: 0,
            spreadBps: 0,
            depthTopN: 0,
            bidLevels: sortedBids.length,
            askLevels: sortedAsks.length,
            valid: false,
            error: 'Invalid prices',
        };
    }

    // Calculate mid price
    const midPrice = (bestBid + bestAsk) / 2;

    // Calculate spread in basis points
    const spreadBps = ((bestAsk - bestBid) / midPrice) * 10000;

    // Calculate depth in top N levels
    let depthTopN = 0;

    // Sum top N bid levels
    for (let i = 0; i < Math.min(depthLevels, sortedBids.length); i++) {
        const size = parseFloat(sortedBids[i].size);
        if (!isNaN(size)) {
            depthTopN += size;
        }
    }

    // Sum top N ask levels
    for (let i = 0; i < Math.min(depthLevels, sortedAsks.length); i++) {
        const size = parseFloat(sortedAsks[i].size);
        if (!isNaN(size)) {
            depthTopN += size;
        }
    }

    return {
        tokenId,
        bestBid,
        bestAsk,
        midPrice,
        spreadBps,
        depthTopN,
        bidLevels: sortedBids.length,
        askLevels: sortedAsks.length,
        valid: true,
    };
}
