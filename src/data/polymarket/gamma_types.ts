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
    outcomes: string[];
    clobTokenIds: string[];
    liquidity?: number;
    volume?: number;
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
}
