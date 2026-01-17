import { logger } from '../../infra/logger.js';
import { env } from '../../config/env.js';
import type { SpotTick, BinanceStreamMessage, PriceReturn } from './types.js';

/**
 * Binance Spot WebSocket Client
 */
export class BinanceSpotFeed {
    private ws: WebSocket | null = null;
    private reconnectAttempt = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private snapshotTimer: NodeJS.Timeout | null = null;
    private isShuttingDown = false;

    // Price buffer for return calculation (symbol -> array of ticks)
    private priceBuffer = new Map<string, SpotTick[]>();

    // Latest price per symbol
    private latestPrice = new Map<string, number>();

    // Last sample time per symbol for downsampling
    private lastSampleTime = new Map<string, number>();

    private readonly symbols: string[];
    private readonly wsUrl: string;
    private readonly textDecoder = new TextDecoder();

    constructor() {
        this.symbols = env.SPOT_SYMBOLS.split(',').map(s => s.trim());

        // Build WebSocket URL for combined streams
        const streams = this.symbols
            .map(sym => `${sym.toLowerCase()}@trade`)
            .join('/');
        this.wsUrl = `${env.BINANCE_WS_BASE}/stream?streams=${streams}`;
    }

    /**
     * Start the WebSocket connection
     */
    public start(): void {
        this.connect();
        this.startSnapshotTimer();
    }

    /**
     * Stop the WebSocket connection and cleanup
     */
    public stop(): void {
        this.isShuttingDown = true;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.snapshotTimer) {
            clearInterval(this.snapshotTimer);
            this.snapshotTimer = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Connect to Binance WebSocket
     */
    private connect(): void {
        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                this.reconnectAttempt = 0;
                logger.info('spot.ws.connected', {
                    symbols: this.symbols,
                    url: this.wsUrl,
                });
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.ws.onerror = (error) => {
                logger.error('spot.ws.error', {
                    error: String(error),
                });
            };

            this.ws.onclose = () => {
                logger.warn('spot.ws.disconnected', {
                    reconnectAttempt: this.reconnectAttempt,
                });

                if (!this.isShuttingDown) {
                    this.scheduleReconnect();
                }
            };
        } catch (error) {
            logger.error('spot.ws.connection_failed', {
                error: error instanceof Error ? error.message : String(error),
            });

            if (!this.isShuttingDown) {
                this.scheduleReconnect();
            }
        }
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        // Backoff: 1s, 2s, 5s, 10s, 30s (max)
        const delays = [1000, 2000, 5000, 10000, 30000];
        const delay = delays[Math.min(this.reconnectAttempt, delays.length - 1)];

        logger.info('spot.ws.reconnecting', {
            attempt: this.reconnectAttempt + 1,
            delayMs: delay,
        });

        this.reconnectTimer = setTimeout(() => {
            this.reconnectAttempt++;
            this.connect();
        }, delay);
    }

    /**
     * Handle incoming WebSocket message with robust parsing
     */
    private handleMessage(data: string | ArrayBuffer | Blob): void {
        try {
            // Convert data to string if needed
            let messageStr: string;

            if (typeof data === 'string') {
                messageStr = data;
            } else if (data instanceof ArrayBuffer) {
                messageStr = this.textDecoder.decode(data);
            } else if (data instanceof Uint8Array) {
                messageStr = this.textDecoder.decode(data);
            } else {
                logger.error('spot.ws.unsupported_data_type', {
                    type: typeof data,
                });
                return;
            }

            const message = JSON.parse(messageStr) as BinanceStreamMessage;

            if (!message.data || !message.data.p) {
                return;
            }

            const trade = message.data;
            const tsLocal = Date.now();

            // Normalize to SpotTick
            const tick: SpotTick = {
                symbol: trade.s.toUpperCase(), // btcusdt -> BTCUSDT
                price: parseFloat(trade.p),
                tsExchange: trade.T,
                tsLocal,
            };

            this.processTick(tick);
        } catch (error) {
            logger.error('spot.ws.parse_error', {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Process a tick: update buffers, calculate returns, emit logs
     */
    private processTick(tick: SpotTick): void {
        const { symbol, price, tsExchange, tsLocal } = tick;

        // Always update latest price
        this.latestPrice.set(symbol, price);

        // Downsampling: only add to buffer if enough time has passed
        const lastSample = this.lastSampleTime.get(symbol) || 0;
        const shouldSample = (tsLocal - lastSample) >= env.SPOT_BUFFER_SAMPLE_MS;

        if (shouldSample) {
            this.lastSampleTime.set(symbol, tsLocal);

            // Add to buffer
            if (!this.priceBuffer.has(symbol)) {
                this.priceBuffer.set(symbol, []);
            }
            const buffer = this.priceBuffer.get(symbol)!;
            buffer.push(tick);

            // Clean old ticks outside the window using incremental shift
            const cutoff = tsLocal - env.SPOT_RETURN_WINDOW_MS;
            while (buffer.length > 0 && buffer[0].tsLocal < cutoff) {
                buffer.shift();
            }
        }

        // Calculate latency
        const latencyMs = tsLocal - tsExchange;

        // Debug log every tick (will be filtered by LOG_LEVEL)
        logger.debug('spot.tick', {
            symbol,
            price,
            latencyMs,
            tsExchange,
            tsLocal,
        });

        // Calculate return if we have enough history
        const buffer = this.priceBuffer.get(symbol);
        if (buffer && buffer.length > 1) {
            const oldestTick = buffer[0];
            const currentTick: SpotTick = {
                symbol,
                price,
                tsExchange,
                tsLocal,
            };

            const priceReturn = this.calculateReturn(currentTick, oldestTick);

            // Only emit spot.move if window is at least 80% of configured window
            const minWindowMs = env.SPOT_RETURN_WINDOW_MS * 0.8;

            if (priceReturn.windowMs >= minWindowMs &&
                Math.abs(priceReturn.returnBps) >= env.SPOT_MOVE_THRESHOLD_BPS) {
                logger.warn('spot.move', {
                    symbol: priceReturn.symbol,
                    returnBps: priceReturn.returnBps.toFixed(2),
                    direction: priceReturn.direction,
                    currentPrice: priceReturn.currentPrice,
                    pastPrice: priceReturn.pastPrice,
                    windowMs: priceReturn.windowMs,
                });
            }
        }
    }

    /**
     * Calculate price return between two ticks
     */
    private calculateReturn(current: SpotTick, past: SpotTick): PriceReturn {
        const returnRatio = (current.price / past.price) - 1;
        const returnBps = returnRatio * 10000;

        return {
            symbol: current.symbol,
            currentPrice: current.price,
            pastPrice: past.price,
            returnBps,
            direction: returnBps > 0 ? 'up' : 'down',
            windowMs: current.tsLocal - past.tsLocal,
        };
    }

    /**
     * Start periodic snapshot logging
     */
    private startSnapshotTimer(): void {
        this.snapshotTimer = setInterval(() => {
            const snapshot: Record<string, number> = {};

            for (const [symbol, price] of this.latestPrice.entries()) {
                snapshot[symbol] = price;
            }

            if (Object.keys(snapshot).length > 0) {
                logger.info('spot.snapshot', {
                    prices: snapshot,
                    bufferSizes: Object.fromEntries(
                        Array.from(this.priceBuffer.entries()).map(([sym, buf]) => [sym, buf.length])
                    ),
                });
            }
        }, env.SPOT_SNAPSHOT_INTERVAL_MS);
    }
}
