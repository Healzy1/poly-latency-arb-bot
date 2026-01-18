import { config as loadEnv } from 'dotenv';
import { GammaClient } from '../data/polymarket/gamma_client.js';

// Load environment variables
loadEnv();

const query = process.env.POLY_GAMMA_QUERY;
const limit = parseInt(process.env.POLY_GAMMA_LIMIT || '10', 10);

if (!query) {
    console.error('❌ Error: POLY_GAMMA_QUERY environment variable is required');
    console.error('');
    console.error('Usage:');
    console.error('  Set POLY_GAMMA_QUERY in .env file or run:');
    console.error('  POLY_GAMMA_QUERY="bitcoin" npm run gamma:search');
    console.error('');
    process.exit(1);
}

async function main() {
    console.log('🔍 Searching Polymarket active markets...');
    console.log(`Query: "${query}"`);
    console.log(`Limit: ${limit}`);
    console.log('');

    const client = new GammaClient();

    try {
        // Search for markets matching query
        const markets = await client.searchMarkets(query!, limit);

        if (markets.length > 0) {
            console.log(`✅ Found ${markets.length} active market(s) matching "${query}"\n`);
            console.log('='.repeat(80));
            console.log('\n🟢 ACTIVE MARKETS (Ranked by Liquidity):\n');

            markets.forEach((market, index) => {
                displayMarket(market, index + 1);
            });

            console.log('\n' + '='.repeat(80));
            console.log('\n📝 To use a market:');
            console.log('1. Choose a market from the list above');
            console.log('2. Copy the Token ID for your desired outcome (usually YES or NO)');
            console.log('3. Set it in your .env file:');
            console.log('   POLYMARKET_TOKEN_ID=<token_id_here>');
            console.log('4. Restart the bot: npm run dev');
            console.log('');
        } else {
            // No matches - show fallback
            console.log(`⚠️  No markets found matching "${query}"\n`);
            console.log('Fetching top newest active markets as fallback...\n');

            const allMarkets = await client.fetchActiveMarkets();
            const topMarkets = allMarkets.slice(0, 10);

            if (topMarkets.length === 0) {
                console.log('❌ No active markets found at all. The API may be down or returning no data.');
                return;
            }

            console.log(`📊 Top ${topMarkets.length} newest active markets (fallback):\n`);
            console.log('='.repeat(80));
            console.log('');

            topMarkets.forEach((market, index) => {
                displayMarket(market, index + 1);
            });

            console.log('\n' + '='.repeat(80));
            console.log('\n💡 Tip: Try searching for:');
            console.log('  - "trump" or "election" for political markets');
            console.log('  - "bitcoin" or "btc" for crypto markets');
            console.log('  - "ethereum" or "eth" for Ethereum markets');
            console.log('  - "sports" for sports betting markets');
            console.log('');
        }
    } catch (error) {
        console.error('❌ Error searching markets:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

function displayMarket(market: any, index: number): void {
    console.log(`${index}. ${market.question}`);
    console.log(`   Slug: ${market.slug}`);
    console.log(`   Status: ${market.status.toUpperCase()}`);

    // Tradability indicator
    if (market.enableOrderBook !== undefined) {
        console.log(`   📊 Order Book: ${market.enableOrderBook ? 'ENABLED' : 'DISABLED'}`);
    } else {
        console.log(`   📊 Order Book: Unknown (likely tradable)`);
    }

    if (market.liquidity !== undefined && market.liquidity !== null && market.liquidity > 0) {
        console.log(`   💰 Liquidity: $${market.liquidity.toLocaleString()}`);
    }

    if (market.volume !== undefined && market.volume !== null && market.volume > 0) {
        console.log(`   📈 Volume: $${market.volume.toLocaleString()}`);
    }

    // Display outcomes
    if (market.outcomes && market.outcomes.length > 0) {
        console.log(`   Outcomes: ${market.outcomes.join(', ')}`);
    } else {
        console.log(`   Outcomes: N/A`);
    }

    // Display token IDs mapped to outcomes
    if (market.clobTokenIds && market.clobTokenIds.length > 0) {
        console.log(`   Token IDs:`);

        for (let i = 0; i < market.clobTokenIds.length; i++) {
            const outcome = market.outcomes?.[i] || `Outcome ${i + 1}`;
            const tokenId = market.clobTokenIds[i];

            if (tokenId) {
                console.log(`     ${outcome}: ${tokenId}`);
            }
        }
    } else {
        console.log(`   Token IDs: N/A`);
    }

    console.log('   ' + '-'.repeat(76));
}

main();
