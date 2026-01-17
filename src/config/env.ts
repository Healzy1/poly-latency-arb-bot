import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
loadEnv();

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
    POLYMARKET_TOKEN_ID: z.string().min(1, 'POLYMARKET_TOKEN_ID is required'),
    POLY_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().finite().default(5000),
    POLY_DEPTH_LEVELS: z.coerce.number().int().positive().finite().default(10),
});

// Parse and validate environment variables
function validateEnv() {
    try {
        const parsed = envSchema.parse(process.env);
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
