import { logger } from '../../infra/logger.js';
import { env } from '../../config/env.js';
import { PolyClient } from './poly_client.js';
import type { PolyMarketData, PolyOrderbook, PolyOrderbookLevel } from './types.js';

/**
 * Polymarket Market Data Feed
 */
export class PolymarketFeed {
    private client: PolyClient;
    private pollTimer: NodeJS.Timeout | null = null;
    private inFlight = false;
    private isRunning = false;
    private consecutiveErrors = 0;
    private currentBackoffMs = 0;

    private readonly tokenId: string;
    private readonly baseIntervalMs: number;
    private readonly maxBackoffMs = 30000;

    constructor() {
        this.tokenId = env.POLYMARKET_TOKEN_ID;
        this.baseIntervalMs = env.POLY_SNAPSHOT_INTERVAL_MS;
        this.client = new PolyClient();
    }

    /**
     * Start the market data feed
     */
    public start(): void {
        if (this.isRunning) {
            logger.warn('poly.feed.already_running', {
                tokenId: this.tokenId,
            });
            return;
        }

        this.isRunning = true;
        this.consecutiveErrors = 0;
        this.currentBackoffMs = 0;

        logger.info('poly.feed.started', {
            tokenId: this.tokenId,
            interval: this.baseIntervalMs,
            depthLevels: env.POLY_DEPTH_LEVELS,
        });

        // Start polling loop
        this.schedulePoll();
    }

    /**
     * Stop the market data feed
     */
    public stop(): void {
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }

        this.isRunning = false;

        logger.info('poly.feed.stopped', {
            tokenId: this.tokenId,
        });
    }

    /**
     * Schedule next poll with setTimeout (no overlap)
     */
    private schedulePoll(): void {
        if (!this.isRunning) {
            return;
        }

        const delay = this.currentBackoffMs > 0
            ? this.currentBackoffMs
            : this.baseIntervalMs;

        this.pollTimer = setTimeout(async () => {
            await this.poll();
            this.schedulePoll(); // Schedule next poll after current one completes
        }, delay);
    }

    /**
     * Poll for market data (async, no overlap)
     */
    private async poll(): Promise<void> {
        // Guard against concurrent polls
        if (this.inFlight) {
            logger.warn('poly.poll.skipped', {
                tokenId: this.tokenId,
                reason: 'previous poll still in flight',
            });
            return;
        }

        this.inFlight = true;

        try {
            const orderbook = await this.client.getOrderbook(this.tokenId);

            if (!orderbook) {
                this.handlePollError(new Error('No orderbook data returned'));
                return;
            }

            const marketData = this.normalizeOrderbook(orderbook);

            if (marketData) {
                // Success - reset backoff
                this.consecutiveErrors = 0;
                this.currentBackoffMs = 0;

                logger.info('poly.snapshot', {
                    tokenId: marketData.tokenId,
                    midPrice: marketData.midPrice.toFixed(4),
                    bestBid: marketData.bestBid.toFixed(4),
                    bestAsk: marketData.bestAsk.toFixed(4),
                    spreadBps: marketData.spreadBps.toFixed(2),
                    depthTopN: marketData.depthTopN.toFixed(2),
                    bidLevels: orderbook.bids.length,
                    askLevels: orderbook.asks.length,
                });
            } else {
                this.handlePollError(new Error('Failed to normalize orderbook'));
            }
        } catch (error) {
            this.handlePollError(error);
        } finally {
            this.inFlight = false;
        }
    }

    /**
     * Handle polling errors with exponential backoff
     */
    private handlePollError(error: unknown): void {
        this.consecutiveErrors++;

        // Calculate backoff: double each time, max 30s
        const backoffMs = Math.min(
            this.baseIntervalMs * Math.pow(2, this.consecutiveErrors - 1),
            this.maxBackoffMs
        );

        this.currentBackoffMs = backoffMs;

        logger.error('poly.poll.error', {
            tokenId: this.tokenId,
            error: error instanceof Error ? error.message : String(error),
            consecutiveErrors: this.consecutiveErrors,
            nextBackoffMs: backoffMs,
        });

        if (this.consecutiveErrors > 1) {
            logger.warn('poly.poll.backoff', {
                tokenId: this.tokenId,
                backoffMs,
                consecutiveErrors: this.consecutiveErrors,
            });
        }
    }

    /**
     * Normalize orderbook to PolyMarketData
     */
    private normalizeOrderbook(orderbook: PolyOrderbook): PolyMarketData | null {
        // Check if we have valid bids and asks
        if (!orderbook.bids || orderbook.bids.length === 0 ||
            !orderbook.asks || orderbook.asks.length === 0) {
            logger.warn('poly.orderbook.invalid', {
                tokenId: this.tokenId,
                bids: orderbook.bids?.length || 0,
                asks: orderbook.asks?.length || 0,
            });
            return null;
        }

        // Sort bids descending (highest first), asks ascending (lowest first)
        const sortedBids = this.sortBidsDesc(orderbook.bids);
        const sortedAsks = this.sortAsksAsc(orderbook.asks);

        // Parse best bid and ask from sorted arrays
        const bestBid = parseFloat(sortedBids[0].price);
        const bestAsk = parseFloat(sortedAsks[0].price);

        if (isNaN(bestBid) || isNaN(bestAsk) || bestBid <= 0 || bestAsk <= 0) {
            logger.error('poly.orderbook.invalid_prices', {
                tokenId: this.tokenId,
                bestBid,
                bestAsk,
            });
            return null;
        }

        // Calculate mid price
        const midPrice = (bestBid + bestAsk) / 2;

        // Calculate spread in basis points
        const spreadBps = ((bestAsk - bestBid) / midPrice) * 10000;

        // Calculate depth in top N levels
        const depthTopN = this.calculateDepth(sortedBids, sortedAsks);

        return {
            tokenId: this.tokenId,
            midPrice,
            bestBid,
            bestAsk,
            spreadBps,
            depthTopN,
            tsLocal: Date.now(),
        };
    }

    /**
     * Sort bids in descending order by price (highest first)
     */
    private sortBidsDesc(bids: PolyOrderbookLevel[]): PolyOrderbookLevel[] {
        return [...bids].sort((a, b) => {
            const priceA = parseFloat(a.price);
            const priceB = parseFloat(b.price);
            return priceB - priceA; // descending
        });
    }

    /**
     * Sort asks in ascending order by price (lowest first)
     */
    private sortAsksAsc(asks: PolyOrderbookLevel[]): PolyOrderbookLevel[] {
        return [...asks].sort((a, b) => {
            const priceA = parseFloat(a.price);
            const priceB = parseFloat(b.price);
            return priceA - priceB; // ascending
        });
    }

    /**
     * Calculate total depth in top N levels
     */
    private calculateDepth(sortedBids: PolyOrderbookLevel[], sortedAsks: PolyOrderbookLevel[]): number {
        const topN = env.POLY_DEPTH_LEVELS;
        let totalDepth = 0;

        // Sum top N bid levels
        for (let i = 0; i < Math.min(topN, sortedBids.length); i++) {
            const size = parseFloat(sortedBids[i].size);
            if (!isNaN(size)) {
                totalDepth += size;
            }
        }

        // Sum top N ask levels
        for (let i = 0; i < Math.min(topN, sortedAsks.length); i++) {
            const size = parseFloat(sortedAsks[i].size);
            if (!isNaN(size)) {
                totalDepth += size;
            }
        }

        return totalDepth;
    }
}
