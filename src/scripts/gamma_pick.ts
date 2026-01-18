import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import { GammaClient } from '../data/polymarket/gamma_client.js';
import { GammaSearchClient } from '../data/polymarket/gamma_search_client.js';
import { ClobClient } from '@polymarket/clob-client';
import { calculateOrderbookMetrics, type OrderbookMetrics } from '../data/polymarket/orderbook_metrics.js';
import { logger } from '../infra/logger.js';

// Load environment variables
loadEnv();

// Validate picker-specific env vars
const pickerEnvSchema = z.object({
    POLY_GAMMA_QUERY: z.string().optional(),
    PICK_QUERIES: z.string().optional(),
    POLY_GAMMA_LIMIT: z.coerce.number().int().positive().default(50),
    PICK_MARKETS_PER_QUERY: z.coerce.number().int().positive().default(25),
    PICK_MAX_EVENTS_FETCH: z.coerce.number().int().positive().default(3000),
    PICK_TOP: z.coerce.number().int().positive().default(10),
    PICK_DEPTH_LEVELS: z.coerce.number().int().positive().default(10),
    PICK_MAX_SPREAD_BPS: z.coerce.number().positive().default(150),
    PICK_MIN_LIQUIDITY: z.coerce.number().positive().default(500),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const pickerEnv = pickerEnvSchema.parse(process.env);

// Determine queries to use
const queries = pickerEnv.PICK_QUERIES
    ? pickerEnv.PICK_QUERIES.split(',').map(q => q.trim()).filter(q => q.length > 0)
    : pickerEnv.POLY_GAMMA_QUERY
        ? [pickerEnv.POLY_GAMMA_QUERY]
        : [];

if (queries.length === 0) {
    console.error('❌ Error: Either POLY_GAMMA_QUERY or PICK_QUERIES must be set');
    console.error('');
    console.error('Examples:');
    console.error('  Set in .env: PICK_QUERIES=election,president,trump');
    console.error('  Or PowerShell: $env:PICK_QUERIES="election,president,trump"; npm run gamma:pick');
    console.error('');
    process.exit(1);
}

interface TokenCandidate {
    marketQuestion: string;
    marketSlug: string;
    marketId: string;
    outcome: string;
    tokenId: string;
    liquidity?: number;
    volume?: number;
    metrics: OrderbookMetrics;
    score: number;
    operable: boolean;
    query: string;
    source: 'search' | 'events';
}

/**
 * Process tokens in batches with concurrency limit
 */
async function processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    concurrency: number = 5
): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
    }

    return results;
}

async function main() {
    console.log('🎯 Polymarket Market Picker (Optimized Search-First)');
    console.log('Finding best tokens for latency arbitrage...\n');
    console.log(`Queries: ${queries.join(', ')}`);
    console.log(`Markets per query: ${pickerEnv.PICK_MARKETS_PER_QUERY}`);
    console.log(`Max spread: ${pickerEnv.PICK_MAX_SPREAD_BPS} bps`);
    console.log(`Min liquidity: $${pickerEnv.PICK_MIN_LIQUIDITY}`);
    console.log('');

    const gammaClient = new GammaClient();
    const searchClient = new GammaSearchClient();
    const clobClient = new ClobClient('https://clob.polymarket.com', 137);

    // In-memory cache for events (fetch once, reuse for all queries)
    let eventsCache: any[] | null = null;
    let eventsCacheFetched = false;

    try {
        // Step 1: Fetch markets for all queries using TRUE search-first strategy
        console.log('📊 Fetching markets (search-first strategy)...');
        const allMarkets = new Map<string, any>(); // Deduplicate by marketId
        const sourceStats = { search: 0, events: 0 };
        const queryStats: Record<string, { source: string; searchCount: number; fallbackCount: number }> = {};

        for (const query of queries) {
            let markets: any[] = [];
            let source: 'search' | 'events' = 'search';
            let searchCount = 0;
            let fallbackCount = 0;

            // Try search API first
            try {
                const searchResults = await searchClient.search(query, pickerEnv.PICK_MARKETS_PER_QUERY);

                if (searchResults.length > 0) {
                    // Flatten markets from search events
                    for (const event of searchResults) {
                        if (event.markets && Array.isArray(event.markets)) {
                            for (const market of event.markets) {
                                // Filter by query match and enableOrderBook
                                const matchesQuery =
                                    searchClient.matchesQuery(market.question || '', query) ||
                                    searchClient.matchesQuery(event.title || '', query) ||
                                    searchClient.matchesQuery(market.slug || '', query);

                                if (matchesQuery) {
                                    markets.push(market);
                                }
                            }
                        }
                    }

                    // Check if we got tradable markets
                    const tradableMarkets = markets.filter(m =>
                        m.clobTokenIds && m.clobTokenIds.length > 0 && m.enableOrderBook !== false
                    );

                    if (tradableMarkets.length > 0) {
                        searchCount = tradableMarkets.length;
                        markets = tradableMarkets;
                        sourceStats.search += markets.length;
                        logger.info('gamma.search.used', { query, count: markets.length });
                    } else {
                        // Search returned results but no tradable markets - fallback
                        markets = [];
                    }
                }
            } catch (error) {
                logger.warn('gamma.search.failed', {
                    query,
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            // Fallback to events API if search returned nothing or failed
            if (markets.length === 0) {
                source = 'events';

                // Fetch events cache once if not already fetched
                if (!eventsCacheFetched) {
                    console.log('  Fetching events cache (once for all queries)...');
                    eventsCache = await gammaClient.fetchActiveMarkets(pickerEnv.PICK_MAX_EVENTS_FETCH);
                    eventsCacheFetched = true;
                    logger.info('gamma.events.fetched_once', {
                        totalMarkets: eventsCache.length,
                        maxEvents: pickerEnv.PICK_MAX_EVENTS_FETCH
                    });
                }

                // Filter cached events by query
                if (eventsCache) {
                    markets = eventsCache.filter(market => {
                        const matchesQuery =
                            searchClient.matchesQuery(market.question || '', query) ||
                            searchClient.matchesQuery(market.slug || '', query);
                        return matchesQuery;
                    }).slice(0, pickerEnv.PICK_MARKETS_PER_QUERY);

                    fallbackCount = markets.length;
                    sourceStats.events += markets.length;
                    logger.info('gamma.events.fallback', { query, count: markets.length });
                }
            }

            queryStats[query] = {
                source: searchCount > 0 ? 'search' : 'events',
                searchCount,
                fallbackCount,
            };

            console.log(`  "${query}": ${markets.length} markets (${queryStats[query].source})`);

            // Deduplicate and tag with source
            for (const market of markets) {
                if (!allMarkets.has(market.id)) {
                    allMarkets.set(market.id, { ...market, queries: [query], source });
                } else {
                    allMarkets.get(market.id)!.queries.push(query);
                }
            }
        }

        console.log(`✅ Total unique markets: ${allMarkets.size}`);
        console.log(`   From search: ${sourceStats.search}, from events: ${sourceStats.events}\n`);

        if (allMarkets.size === 0) {
            console.log('❌ No active markets found for these queries.');
            console.log('Try different search terms like: "trump", "bitcoin", "election"\n');
            return;
        }

        // Step 2: Collect all tokens to analyze
        console.log('🔍 Analyzing orderbook metrics for tokens...\n');
        const tokensToAnalyze: Array<{
            market: any;
            tokenId: string;
            outcome: string;
            index: number;
        }> = [];

        // Deduplicate tokens by tokenId
        const seenTokenIds = new Set<string>();

        for (const market of allMarkets.values()) {
            if (!market.clobTokenIds || market.clobTokenIds.length === 0) {
                continue;
            }

            for (let i = 0; i < market.clobTokenIds.length; i++) {
                const tokenId = market.clobTokenIds[i];

                // Skip if already seen
                if (seenTokenIds.has(tokenId)) {
                    continue;
                }
                seenTokenIds.add(tokenId);

                tokensToAnalyze.push({
                    market,
                    tokenId,
                    outcome: market.outcomes[i] || `Outcome ${i + 1}`,
                    index: i,
                });
            }
        }

        console.log(`Analyzing ${tokensToAnalyze.length} unique tokens (concurrency: 5)...\n`);

        // Step 3: Analyze tokens in batches
        const candidates: TokenCandidate[] = [];

        const analyzeToken = async (item: typeof tokensToAnalyze[0]) => {
            try {
                const orderbook = await clobClient.getOrderBook(item.tokenId);

                if (!orderbook || !orderbook.bids || !orderbook.asks) {
                    return null;
                }

                const metrics = calculateOrderbookMetrics(
                    item.tokenId,
                    orderbook.bids,
                    orderbook.asks,
                    pickerEnv.PICK_DEPTH_LEVELS
                );

                if (!metrics.valid) {
                    return null;
                }

                // Calculate score (lower is better)
                let score = metrics.spreadBps;

                if (item.market.liquidity && item.market.liquidity < 1000) {
                    score += 50;
                }

                if (metrics.depthTopN < 100) {
                    score += 50;
                }

                const operable =
                    metrics.spreadBps <= pickerEnv.PICK_MAX_SPREAD_BPS &&
                    (item.market.liquidity || 0) >= pickerEnv.PICK_MIN_LIQUIDITY &&
                    item.market.enableOrderBook !== false;

                return {
                    marketQuestion: item.market.question,
                    marketSlug: item.market.slug,
                    marketId: item.market.id,
                    outcome: item.outcome,
                    tokenId: item.tokenId,
                    liquidity: item.market.liquidity,
                    volume: item.market.volume,
                    metrics,
                    score,
                    operable,
                    query: item.market.queries[0],
                    source: item.market.source || 'events',
                };
            } catch (error) {
                logger.error('pick.token.error', {
                    tokenId: item.tokenId,
                    error: error instanceof Error ? error.message : String(error),
                });
                return null;
            }
        };

        const results = await processBatch(tokensToAnalyze, analyzeToken, 5);

        for (const result of results) {
            if (result) {
                candidates.push(result);
            }
        }

        if (candidates.length === 0) {
            console.log('❌ No tokens could be analyzed. Check if markets have valid orderbooks.');
            return;
        }

        console.log(`✅ Analyzed ${candidates.length} tokens\n`);

        // Step 4: Sort by score (lower is better)
        candidates.sort((a, b) => a.score - b.score);

        // Step 5: Display overall top recommendations
        const operableCandidates = candidates.filter(c => c.operable);
        const topCandidates = operableCandidates.length > 0
            ? operableCandidates.slice(0, pickerEnv.PICK_TOP)
            : candidates.slice(0, pickerEnv.PICK_TOP);

        console.log('='.repeat(80));
        console.log('\n🏆 TOP RECOMMENDED TOKENS (Overall)\n');

        if (operableCandidates.length === 0) {
            console.log('⚠️  WARNING: No tokens passed operability criteria!');
            console.log(`   Spread threshold: ${pickerEnv.PICK_MAX_SPREAD_BPS} bps`);
            console.log(`   Liquidity threshold: $${pickerEnv.PICK_MIN_LIQUIDITY}`);
            console.log(`   Best available spread: ${candidates[0]?.metrics.spreadBps.toFixed(2)} bps\n`);
            console.log('Showing top candidates anyway:\n');
        } else {
            console.log(`Found ${operableCandidates.length} operable token(s)\n`);
        }

        topCandidates.forEach((candidate, index) => {
            displayCandidate(candidate, index + 1);
        });

        // Step 6: Display best per query
        console.log('\n' + '='.repeat(80));
        console.log('\n📊 BEST PER QUERY (Top 3 each)\n');

        for (const query of queries) {
            const queryCandidates = candidates.filter(c => c.query === query);

            if (queryCandidates.length === 0) {
                console.log(`"${query}": No tokens analyzed`);
                continue;
            }

            const stats = queryStats[query];
            console.log(`"${query}" (${queryCandidates.length} tokens, source: ${stats.source}):`);

            const top3 = queryCandidates.slice(0, 3);
            top3.forEach((candidate, index) => {
                console.log(`  ${index + 1}. ${candidate.outcome} - ${candidate.marketQuestion.substring(0, 50)}...`);
                console.log(`     Spread: ${candidate.metrics.spreadBps.toFixed(2)} bps | Depth: ${candidate.metrics.depthTopN.toFixed(2)} | Score: ${candidate.score.toFixed(2)}`);
            });
            console.log('');
        }

        console.log('='.repeat(80));
        console.log('\n📝 To use a token:');
        console.log('1. Choose a token with low spread and good depth from above');
        console.log('2. Copy the Token ID');
        console.log('3. Set it in your .env file:');
        console.log('   POLYMARKET_TOKEN_ID=<token_id_here>');
        console.log('4. Restart the bot: npm run dev\n');

        console.log('💡 Why these metrics matter for small capital ($20-50):');
        console.log('   - Spread: High spread eats your profit. Aim for <100 bps.');
        console.log('   - Depth: Low depth means slippage. Aim for >100 total.');
        console.log('   - Liquidity: Ensures you can enter/exit positions.\n');
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

function displayCandidate(candidate: TokenCandidate, index: number): void {
    console.log(`${index}. ${candidate.outcome} - ${candidate.marketQuestion}`);
    console.log(`   Market: ${candidate.marketSlug}`);
    console.log(`   Token ID: ${candidate.tokenId}`);
    console.log(`   📊 Spread: ${candidate.metrics.spreadBps.toFixed(2)} bps ${candidate.operable ? '✅' : '❌'}`);
    console.log(`   💰 Mid Price: ${candidate.metrics.midPrice.toFixed(4)}`);
    console.log(`   📈 Depth (top ${pickerEnv.PICK_DEPTH_LEVELS}): ${candidate.metrics.depthTopN.toFixed(2)}`);
    console.log(`   📚 Levels: ${candidate.metrics.bidLevels} bids / ${candidate.metrics.askLevels} asks`);

    if (candidate.liquidity) {
        console.log(`   💵 Liquidity: $${candidate.liquidity.toLocaleString()}`);
    }

    console.log(`   🎯 Score: ${candidate.score.toFixed(2)} (lower is better)`);
    console.log(`   🔍 Query: "${candidate.query}" (${candidate.source})`);
    console.log('   ' + '-'.repeat(76));
}

main();
