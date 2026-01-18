import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
loadEnv();

// Detect script mode from process.argv
const scriptPath = process.argv[1] || '';
const isGammaSearch = scriptPath.includes('gamma_search');
const isGammaPick = scriptPath.includes('gamma_pick');
const isGammaScript = isGammaSearch || isGammaPick;

// Define the schema for environment variables
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    LOG_TO_FILE: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),

    // Binance Spot Feed
    BINANCE_WS_BASE: z.string().default('wss://stream.binance.com:9443'),
    SPOT_SYMBOLS: z.string().default('BTCUSDT,ETHUSDT'),
    SPOT_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().finite().default(5000),
    SPOT_RETURN_WINDOW_MS: z.coerce.number().int().positive().finite().default(60000),
    SPOT_MOVE_THRESHOLD_BPS: z.coerce.number().positive().finite().default(50),
    SPOT_BUFFER_SAMPLE_MS: z.coerce.number().int().positive().finite().default(250),

    // Polymarket Market Data
    // Optional for gamma scripts, required for bot mode
    POLYMARKET_TOKEN_ID: z.string().default(''),
    POLY_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().finite().default(5000),
    POLY_DEPTH_LEVELS: z.coerce.number().int().positive().finite().default(10),

    // Gamma Market Discovery
    POLY_GAMMA_QUERY: z.string().optional(),
    POLY_GAMMA_LIMIT: z.coerce.number().int().positive().finite().default(10),

    // Arbitrage Strategy
    ARB_MIN_POLY_DEPTH: z.coerce.number().positive().finite().default(50),
    ARB_MAX_POLY_SPREAD_BPS: z.coerce.number().positive().finite().default(80),
    ARB_MIN_EDGE_BPS: z.coerce.number().positive().finite().default(20),
    ARB_COOLDOWN_MS: z.coerce.number().int().positive().finite().default(15000),
});

// Parse and validate environment variables
function validateEnv() {
    try {
        const parsed = envSchema.parse(process.env);

        // Additional validation: POLYMARKET_TOKEN_ID required for bot mode
        if (!isGammaScript && !parsed.POLYMARKET_TOKEN_ID) {
            console.error('❌ Invalid environment variables:');
            console.error('  - POLYMARKET_TOKEN_ID: Required for bot mode');
            console.error('');
            console.error('To find a market:');
            console.error('  1. Run: npm run gamma:search');
            console.error('  2. Or run: npm run gamma:pick');
            console.error('  3. Copy a token ID and set POLYMARKET_TOKEN_ID in .env');
            console.error('');
            process.exit(1);
        }

        return parsed;
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('❌ Invalid environment variables:');
            error.errors.forEach(err => {
                console.error(`  - ${err.path.join('.')}: ${err.message}`);
            });
            process.exit(1);
        }
        throw error;
    }
}

// Export validated environment configuration
export const env = validateEnv();

export type Env = z.infer<typeof envSchema>;
