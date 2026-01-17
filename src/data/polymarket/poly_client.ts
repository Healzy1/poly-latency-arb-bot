import { ClobClient } from '@polymarket/clob-client';
import { logger } from '../../infra/logger.js';
import type { PolyOrderbook } from './types.js';

/**
 * Polymarket CLOB Client Wrapper
 */
export class PolyClient {
    private client: ClobClient;

    constructor() {
        // Initialize CLOB client (read-only mode, no credentials needed)
        this.client = new ClobClient(
            'https://clob.polymarket.com', // host
            137 // chainId - Polygon mainnet
        );

        logger.info('poly.client.init', {
            host: 'https://clob.polymarket.com',
            chainId: 137,
            mode: 'read-only',
        });
    }

    /**
     * Fetch orderbook for a given token ID
     */
    async getOrderbook(tokenId: string): Promise<PolyOrderbook | null> {
        try {
            const orderbook = await this.client.getOrderBook(tokenId);

            if (!orderbook) {
                logger.warn('poly.orderbook.empty', {
                    tokenId,
                });
                return null;
            }

            return {
                bids: orderbook.bids || [],
                asks: orderbook.asks || [],
                timestamp: orderbook.timestamp,
                market: orderbook.market,
            };
        } catch (error) {
            logger.error('poly.orderbook.error', {
                tokenId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Get client instance for advanced operations
     */
    getClient(): ClobClient {
        return this.client;
    }
}
