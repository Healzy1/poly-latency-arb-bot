/**
 * Normalized spot tick data
 */
export interface SpotTick {
    symbol: string;           // BTCUSDT, ETHUSDT
    price: number;            // Current price
    tsExchange: number;       // Exchange timestamp (ms)
    tsLocal: number;          // Local timestamp (ms)
}

/**
 * Price return calculation
 */
export interface PriceReturn {
    symbol: string;
    currentPrice: number;
    pastPrice: number;
    returnBps: number;        // Basis points (0.50% = 50 bps)
    direction: 'up' | 'down';
    windowMs: number;
}

/**
 * Binance Trade Stream Event
 */
export interface BinanceTradeEvent {
    e: string;      // Event type (trade)
    E: number;      // Event time
    s: string;      // Symbol (lowercase: btcusdt)
    t: number;      // Trade ID
    p: string;      // Price
    q: string;      // Quantity
    T: number;      // Trade time
    m: boolean;     // Is buyer maker
}

/**
 * Binance WebSocket Stream Message
 */
export interface BinanceStreamMessage {
    stream: string;
    data: BinanceTradeEvent;
}
