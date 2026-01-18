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
    console.log('🔍 Searching Polymarket markets...');
    console.log(`Query: "${query}"`);
    console.log(`Limit: ${limit}`);
    console.log('');

    const client = new GammaClient();

    try {
        const markets = await client.searchMarkets(query!, limit);

        if (markets.length === 0) {
            console.log('No markets found.');
            return;
        }

        // Separate active and closed markets
        const activeMarkets = markets.filter(m => m.status === 'active');
        const closedMarkets = markets.filter(m => m.status === 'closed');

        console.log(`Found ${markets.length} market(s): ${activeMarkets.length} active, ${closedMarkets.length} closed\n`);
        console.log('='.repeat(80));

        // Display active markets first
        if (activeMarkets.length > 0) {
            console.log('\n🟢 ACTIVE MARKETS:\n');
            activeMarkets.forEach((market, index) => {
                displayMarket(market, index + 1);
            });
        }

        // Display closed markets
        if (closedMarkets.length > 0) {
            console.log('\n🔴 CLOSED MARKETS:\n');
            closedMarkets.forEach((market, index) => {
                displayMarket(market, activeMarkets.length + index + 1);
            });
        }

        console.log('\n' + '='.repeat(80));
        console.log('\n📝 To use a market:');
        console.log('1. Choose an ACTIVE market from the list above');
        console.log('2. Copy the Token ID for your desired outcome (usually YES or NO)');
        console.log('3. Set it in your .env file:');
        console.log('   POLYMARKET_TOKEN_ID=<token_id_here>');
        console.log('4. Restart the bot: npm run dev');
        console.log('');

        if (closedMarkets.length > 0) {
            console.log('⚠️  Note: Closed markets are shown for reference but cannot be traded.');
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

    if (market.liquidity !== undefined && market.liquidity !== null) {
        console.log(`   Liquidity: $${market.liquidity.toLocaleString()}`);
    }

    if (market.volume !== undefined && market.volume !== null) {
        console.log(`   Volume: $${market.volume.toLocaleString()}`);
    }

    // Display outcomes
    if (market.outcomes && market.outcomes.length > 0) {
        console.log(`   Outcomes: ${market.outcomes.join(', ')}`);
    } else {
        console.log(`   Outcomes: N/A`);
    }

    // Display token IDs
    if (market.clobTokenIds && market.clobTokenIds.length > 0) {
        console.log(`   Token IDs:`);

        // Match outcomes with token IDs
        const maxLength = Math.max(market.outcomes?.length || 0, market.clobTokenIds.length);

        for (let i = 0; i < maxLength; i++) {
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
