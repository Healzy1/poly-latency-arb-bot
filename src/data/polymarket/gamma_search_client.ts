import { logger } from '../../infra/logger.js';

const GAMMA_BASE_URL = 'https://gamma-api.polymarket.com';

/**
 * Query synonyms for better matching
 */
const QUERY_SYNONYMS: Record<string, string[]> = {
    'trump': ['donald', 'donald trump'],
    'donald': ['trump'],
    'btc': ['bitcoin'],
    'bitcoin': ['btc'],
    'eth': ['ethereum'],
    'ethereum': ['eth'],
    'etf': ['spot etf', 'bitcoin etf'],
};

/**
 * Gamma Search API Client for text-based discovery
 */
export class GammaSearchClient {
    private baseUrl: string;

    constructor(baseUrl: string = GAMMA_BASE_URL) {
        this.baseUrl = baseUrl;
    }

    /**
     * Search using Gamma Search endpoint
     */
    async search(query: string, limit: number = 50): Promise<any[]> {
        try {
            // Try /search endpoint first
            const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&events_status=active&keep_closed_markets=0&limit=${limit}`;

            logger.debug('gamma.search_api.request', {
                query,
                url: searchUrl,
            });

            const response = await fetch(searchUrl);

            if (!response.ok) {
                // Try fallback to /public-search if /search fails
                return await this.publicSearch(query, limit);
            }

            const data = await response.json();

            // Extract events from search response
            const events = this.extractEventsFromSearch(data);

            logger.info('gamma.search_api.success', {
                query,
                eventsCount: events.length,
            });

            return events;
        } catch (error) {
            logger.warn('gamma.search_api.error', {
                query,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Fallback to public-search endpoint
     */
    private async publicSearch(query: string, limit: number): Promise<any[]> {
        try {
            const url = `${this.baseUrl}/public-search?q=${encodeURIComponent(query)}&limit=${limit}`;

            logger.debug('gamma.public_search.request', { query, url });

            const response = await fetch(url);

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            return this.extractEventsFromSearch(data);
        } catch (error) {
            logger.warn('gamma.public_search.error', {
                query,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    /**
     * Extract events from search response
     */
    private extractEventsFromSearch(data: any): any[] {
        // Handle different response formats
        if (Array.isArray(data)) {
            return data;
        }

        if (data.events && Array.isArray(data.events)) {
            return data.events;
        }

        if (data.results && Array.isArray(data.results)) {
            return data.results;
        }

        if (data.data && Array.isArray(data.data)) {
            return data.data;
        }

        return [];
    }

    /**
     * Get query synonyms
     */
    getSynonyms(query: string): string[] {
        const queryLower = query.toLowerCase();
        return QUERY_SYNONYMS[queryLower] || [];
    }

    /**
     * Check if text matches query (with synonyms)
     */
    matchesQuery(text: string, query: string): boolean {
        const textLower = text.toLowerCase();
        const queryLower = query.toLowerCase();

        // Direct match
        if (textLower.includes(queryLower)) {
            return true;
        }

        // Synonym match
        const synonyms = this.getSynonyms(query);
        return synonyms.some(syn => textLower.includes(syn.toLowerCase()));
    }
}
