import { logger } from '../../infra/logger.js';
import type { GammaMarket, GammaMarketSimplified } from './gamma_types.js';

const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';

/**
 * Gamma API Client for market discovery
 */
export class GammaClient {
    private baseUrl: string;

    constructor(baseUrl: string = GAMMA_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Search markets by query
     */
    async searchMarkets(query: string, limit: number = 10): Promise<GammaMarketSimplified[]> {
        try {
            const url = `${this.baseUrl}/markets?query=${encodeURIComponent(query)}&limit=${limit}`;

            logger.debug('gamma.search.request', {
                query,
                limit,
                url,
            });

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json() as GammaMarket[];

            const simplified = data.map(market => this.simplifyMarket(market));

            logger.info('gamma.search.success', {
                query,
                resultsCount: simplified.length,
            });

            return simplified;
        } catch (error) {
            logger.error('gamma.search.error', {
                query,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Get market by slug
     */
    async getMarketBySlug(slug: string): Promise<GammaMarketSimplified | null> {
        try {
            const url = `${this.baseUrl}/markets/${slug}`;

            logger.debug('gamma.get_market.request', {
                slug,
                url,
            });

            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 404) {
                    logger.warn('gamma.get_market.not_found', { slug });
                    return null;
                }
                throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
            }

            const market = await response.json() as GammaMarket;

            logger.info('gamma.get_market.success', { slug });

            return this.simplifyMarket(market);
        } catch (error) {
            logger.error('gamma.get_market.error', {
                slug,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Simplify market data for display
     */
    private simplifyMarket(market: GammaMarket): GammaMarketSimplified {
        return {
            id: market.id,
            slug: market.slug,
            question: market.question,
            status: market.closed ? 'closed' : (market.active ? 'active' : 'closed'),
            outcomes: market.outcomes || [],
            clobTokenIds: market.clobTokenIds || [],
            liquidity: market.liquidity,
            volume: market.volume,
        };
    }
}
