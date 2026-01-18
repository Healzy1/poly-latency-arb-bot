import { logger } from '../../infra/logger.js';
import type { GammaEvent, GammaMarket, GammaMarketSimplified } from './gamma_types.js';

const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';

/**
 * Query synonyms for better matching
 */
const QUERY_SYNONYMS: Record<string, string[]> = {
    'bitcoin': ['btc'],
    'btc': ['bitcoin'],
    'ethereum': ['eth'],
    'eth': ['ethereum'],
};

/**
 * Gamma API Client for market discovery via Events endpoint
 */
export class GammaClient {
    private baseUrl: string;

    constructor(baseUrl: string = GAMMA_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Search active markets via Events endpoint
     */
    async searchMarkets(query: string, limit: number = 10): Promise<GammaMarketSimplified[]> {
        try {
            // Fetch active events with pagination
            const allMarkets = await this.fetchActiveMarkets();

            logger.info('gamma.events.fetched', {
                totalMarkets: allMarkets.length,
            });

            // Filter by query (with synonyms)
            const queryLower = query.toLowerCase();
            const synonyms = QUERY_SYNONYMS[queryLower] || [];
            const searchTerms = [queryLower, ...synonyms];

            const matchedMarkets = allMarkets.filter(market => {
                const questionLower = market.question.toLowerCase();
                return searchTerms.some(term => questionLower.includes(term));
            });

            logger.info('gamma.search.matched', {
                query,
                matchedCount: matchedMarkets.length,
            });

            // Sort by liquidity/volume
            matchedMarkets.sort((a, b) => {
                const scoreA = this.getMarketScore(a);
                const scoreB = this.getMarketScore(b);
                return scoreB - scoreA;
            });

            // Return top N
            return matchedMarkets.slice(0, limit);
        } catch (error) {
            logger.error('gamma.search.error', {
                query,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }

    /**
     * Fetch all active markets from events endpoint with pagination
     */
    async fetchActiveMarkets(maxEvents: number = 3000): Promise<GammaMarketSimplified[]> {
        const allMarkets: GammaMarketSimplified[] = [];
        const batchSize = 100;
        let offset = 0;
        let hasMore = true;

        while (hasMore && offset < maxEvents) {
            const url = `${this.baseUrl}/events?active=true&closed=false&order=id&ascending=false&limit=${batchSize}&offset=${offset}`;

            logger.debug('gamma.events.request', {
                offset,
                limit: batchSize,
            });

            try {
                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
                }

                const events = await response.json() as GammaEvent[];

                if (events.length === 0) {
                    hasMore = false;
                    break;
                }

                // Flatten markets from events
                for (const event of events) {
                    if (!event.markets || !Array.isArray(event.markets)) {
                        continue;
                    }

                    for (const market of event.markets) {
                        try {
                            // Filter for tradable markets
                            if (this.isMarketTradable(event, market)) {
                                const simplified = this.simplifyMarket(market);
                                allMarkets.push(simplified);
                            }
                        } catch (error) {
                            logger.warn('gamma.market.parse_error', {
                                eventId: event.id,
                                marketId: market.id,
                                error: error instanceof Error ? error.message : String(error),
                            });
                        }
                    }
                }

                offset += batchSize;

                // If we got fewer than batchSize, we're done
                if (events.length < batchSize) {
                    hasMore = false;
                }
            } catch (error) {
                logger.error('gamma.events.fetch_error', {
                    offset,
                    error: error instanceof Error ? error.message : String(error),
                });
                throw error;
            }
        }

        logger.info('gamma.events.complete', {
            totalMarkets: allMarkets.length,
            eventsFetched: offset,
        });

        return allMarkets;
    }

    /**
     * Check if market is tradable
     */
    private isMarketTradable(event: GammaEvent, market: GammaMarket): boolean {
        // Event must be active and not closed
        if (event.closed || !event.active) {
            return false;
        }

        // Market must have token IDs
        const tokenIds = this.parseArrayField(market.clobTokenIds);
        if (tokenIds.length === 0) {
            return false;
        }

        // If enableOrderBook exists, it must be true
        // If it doesn't exist, we allow it (tradability: unknown)
        if (market.enableOrderBook !== undefined && market.enableOrderBook === false) {
            return false;
        }

        return true;
    }

    /**
     * Calculate market score for ranking
     */
    private getMarketScore(market: GammaMarketSimplified): number {
        let score = 0;

        if (market.liquidity && market.liquidity > 0) {
            score += market.liquidity * 10;
        }

        if (market.volume && market.volume > 0) {
            score += market.volume;
        }

        return score;
    }

    /**
     * Simplify market data
     */
    private simplifyMarket(market: GammaMarket): GammaMarketSimplified {
        const outcomes = this.parseArrayField(market.outcomes);
        const clobTokenIds = this.parseArrayField(market.clobTokenIds);

        return {
            id: market.id,
            slug: market.slug,
            question: market.question,
            status: market.closed ? 'closed' : 'active',
            outcomes,
            clobTokenIds,
            liquidity: market.liquidity,
            volume: market.volume,
            enableOrderBook: market.enableOrderBook,
            tradability: market.enableOrderBook !== undefined ? 'confirmed' : 'unknown',
        };
    }

    /**
     * Parse array field (handles string JSON or array)
     */
    private parseArrayField(field: unknown): string[] {
        if (!field) {
            return [];
        }

        // Already an array
        if (Array.isArray(field)) {
            return field.map(item => String(item));
        }

        // String that might be JSON
        if (typeof field === 'string') {
            try {
                const parsed = JSON.parse(field);
                if (Array.isArray(parsed)) {
                    return parsed.map(item => String(item));
                }
                return [field];
            } catch {
                return [field];
            }
        }

        return [];
    }

    /**
     * Get market by slug (legacy method)
     */
    async getMarketBySlug(slug: string): Promise<GammaMarketSimplified | null> {
        try {
            const url = `${this.baseUrl}/markets/${slug}`;

            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 404) {
                    return null;
                }
                throw new Error(`Gamma API error: ${response.status} ${response.statusText}`);
            }

            const market = await response.json() as GammaMarket;
            return this.simplifyMarket(market);
        } catch (error) {
            logger.error('gamma.get_market.error', {
                slug,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
