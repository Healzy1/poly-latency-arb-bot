import { env } from './config/env.js';
import { logger } from './infra/logger.js';
import { BinanceSpotFeed } from './data/spot/binance_ws.js';
import { PolymarketFeed } from './data/polymarket/market_feed.js';
// import { LatencySignalEngine } from './strategy/latency_signal.js'; // TODO: Connect to feeds

// Global references to keep process alive
let spotFeed: BinanceSpotFeed | null = null;
let polyFeed: PolymarketFeed | null = null;
// let signalEngine: LatencySignalEngine | null = null; // TODO: Connect to feeds

/**
 * Main application entry point
 */
async function main() {
    // Log boot event
    logger.info('app.boot', {
        message: 'Application starting...',
        environment: env.NODE_ENV,
    });

    console.log('\n✅ Boot OK');
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
    console.log(`🌍 Environment: ${env.NODE_ENV}`);
    console.log(`📝 Log Level: ${env.LOG_LEVEL}`);
    console.log(`💾 Log to File: ${env.LOG_TO_FILE ? 'Enabled' : 'Disabled'}`);
    console.log(`\n🔸 Binance Spot Configuration:`);
    console.log(`  📊 Symbols: ${env.SPOT_SYMBOLS}`);
    console.log(`  ⏱️  Snapshot: ${env.SPOT_SNAPSHOT_INTERVAL_MS}ms`);
    console.log(`  📈 Return Window: ${env.SPOT_RETURN_WINDOW_MS}ms`);
    console.log(`  🎯 Move Threshold: ${env.SPOT_MOVE_THRESHOLD_BPS} bps`);
    console.log(`  🔬 Buffer Sample: ${env.SPOT_BUFFER_SAMPLE_MS}ms`);
    console.log(`\n🔹 Polymarket Configuration:`);
    console.log(`  🎲 Token ID: ${env.POLYMARKET_TOKEN_ID}`);
    console.log(`  ⏱️  Snapshot: ${env.POLY_SNAPSHOT_INTERVAL_MS}ms`);
    console.log(`  📊 Depth Levels: ${env.POLY_DEPTH_LEVELS}`);
    console.log(`\n🎯 Arbitrage Strategy:`);
    console.log(`  📏 Min Poly Depth: ${env.ARB_MIN_POLY_DEPTH}`);
    console.log(`  📐 Max Poly Spread: ${env.ARB_MAX_POLY_SPREAD_BPS} bps`);
    console.log(`  💰 Min Edge: ${env.ARB_MIN_EDGE_BPS} bps`);
    console.log(`  ⏱️  Cooldown: ${env.ARB_COOLDOWN_MS}ms\n`);

    // Initialize Strategy Engine (TODO: Connect to feeds)
    // signalEngine = new LatencySignalEngine();

    // Initialize Binance Spot Feed
    spotFeed = new BinanceSpotFeed();
    spotFeed.start();

    // Initialize Polymarket Feed
    polyFeed = new PolymarketFeed();
    polyFeed.start();

    logger.info('app.ready', {
        message: 'Application initialized successfully',
        features: {
            config: 'loaded',
            logger: 'initialized',
            spotFeed: 'started',
            polyFeed: 'started',
            signalEngine: 'available',
        },
    });

    // Future: Initialize execution module
}

/**
 * Graceful shutdown handler
 */
function gracefulShutdown(signal: string) {
    logger.info('app.shutdown', {
        message: `Received ${signal}, shutting down gracefully...`,
    });

    if (spotFeed) {
        spotFeed.stop();
    }

    if (polyFeed) {
        polyFeed.stop();
    }

    setTimeout(() => {
        process.exit(0);
    }, 1000);
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start the application
main().catch((error) => {
    logger.error('app.fatal', {
        message: 'Fatal error during application startup',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
});
