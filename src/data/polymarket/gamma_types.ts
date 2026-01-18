/**
 * Gamma API event data
 */
export interface GammaEvent {
    id: string;
    slug: string;
    title: string;
    description?: string;
    active: boolean;
    closed: boolean;
    markets?: GammaMarket[];
}

/**
 * Gamma API market data
 */
export interface GammaMarket {
    id: string;
    slug: string;
    question: string;
    description?: string;
    active: boolean;
    closed: boolean;
    outcomes: string[] | string;
    outcomePrices?: string[] | string;
    clobTokenIds: string[] | string;
    liquidity?: number;
    volume?: number;
    enableOrderBook?: boolean;
}

/**
 * Simplified market for display
 */
export interface GammaMarketSimplified {
    id: string;
    slug: string;
    question: string;
    status: 'active' | 'closed';
    outcomes: string[];
    clobTokenIds: string[];
    liquidity?: number;
    volume?: number;
    enableOrderBook?: boolean;
    tradability: 'confirmed' | 'unknown';
}
