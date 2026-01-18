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

            const simplified: GammaMarketSimplified[] = [];

            for (const market of data) {
                try {
                    const simplifiedMarket = this.simplifyMarket(market);
                    simplified.push(simplifiedMarket);
                } catch (error) {
                    logger.warn('gamma.market.parse_error', {
                        id: market.id,
                        slug: market.slug,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    // Continue to next market instead of failing
                }
            }

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
     * Simplify market data for display with robust parsing
     */
    private simplifyMarket(market: GammaMarket): GammaMarketSimplified {
        return {
            id: market.id,
            slug: market.slug,
            question: market.question,
            status: this.parseStatus(market),
            outcomes: this.parseOutcomes(market.outcomes),
            clobTokenIds: this.parseClobTokenIds(market.clobTokenIds),
            liquidity: market.liquidity,
            volume: market.volume,
        };
    }

    /**
     * Parse market status from various fields
     */
    private parseStatus(market: GammaMarket): 'active' | 'closed' {
        // Check closed field first
        if (market.closed === true) {
            return 'closed';
        }

        // Check active field
        if (market.active === false) {
            return 'closed';
        }

        // Default to active if not explicitly closed
        return 'active';
    }

    /**
     * Parse outcomes array with robust handling
     */
    private parseOutcomes(outcomes: unknown): string[] {
        // Handle null/undefined
        if (!outcomes) {
            return [];
        }

        // Handle array
        if (Array.isArray(outcomes)) {
            return outcomes.map(outcome => {
                // If it's already a string
                if (typeof outcome === 'string') {
                    return outcome;
                }

                // If it's an object, try to extract name/label/outcome field
                if (typeof outcome === 'object' && outcome !== null) {
                    const obj = outcome as Record<string, unknown>;

                    if (typeof obj.name === 'string') {
                        return obj.name;
                    }
                    if (typeof obj.label === 'string') {
                        return obj.label;
                    }
                    if (typeof obj.outcome === 'string') {
                        return obj.outcome;
                    }

                    // Fallback to JSON stringify
                    return JSON.stringify(outcome);
                }

                // Convert to string as fallback
                return String(outcome);
            });
        }

        // Handle single string
        if (typeof outcomes === 'string') {
            return [outcomes];
        }

        // Fallback to empty array
        return [];
    }

    /**
     * Parse clobTokenIds with robust handling
     */
    private parseClobTokenIds(clobTokenIds: unknown): string[] {
        // Handle null/undefined
        if (!clobTokenIds) {
            return [];
        }

        // Handle array
        if (Array.isArray(clobTokenIds)) {
            return clobTokenIds.map(id => String(id));
        }

        // Handle single value
        if (typeof clobTokenIds === 'string') {
            return [clobTokenIds];
        }

        // Fallback to empty array
        return [];
    }
}
