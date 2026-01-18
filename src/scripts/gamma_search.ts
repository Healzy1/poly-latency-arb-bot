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
    console.log(`Query: "${query!}"`);
    console.log(`Limit: ${limit}`);
    console.log('');

    const client = new GammaClient();

    try {
        const markets = await client.searchMarkets(query!, limit);

        if (markets.length === 0) {
            console.log('No markets found.');
            return;
        }

        console.log(`Found ${markets.length} market(s):\n`);
        console.log('='.repeat(80));

        markets.forEach((market, index) => {
            console.log(`\n${index + 1}. ${market.question}`);
            console.log(`   Slug: ${market.slug}`);
            console.log(`   Status: ${market.status.toUpperCase()}`);

            if (market.liquidity !== undefined) {
                console.log(`   Liquidity: $${market.liquidity.toLocaleString()}`);
            }

            if (market.volume !== undefined) {
                console.log(`   Volume: $${market.volume.toLocaleString()}`);
            }

            console.log(`   Outcomes: ${market.outcomes.join(', ')}`);

            if (market.clobTokenIds && market.clobTokenIds.length > 0) {
                console.log(`   Token IDs:`);
                market.outcomes.forEach((outcome, i) => {
                    if (market.clobTokenIds[i]) {
                        console.log(`     ${outcome}: ${market.clobTokenIds[i]}`);
                    }
                });
            }

            console.log('   ' + '-'.repeat(76));
        });

        console.log('\n' + '='.repeat(80));
        console.log('\n📝 To use a market:');
        console.log('1. Copy the Token ID for your desired outcome (usually YES or NO)');
        console.log('2. Set it in your .env file:');
        console.log('   POLYMARKET_TOKEN_ID=<token_id_here>');
        console.log('3. Restart the bot: npm run dev');
        console.log('');
    } catch (error) {
        console.error('❌ Error searching markets:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main();
