import { mkdirSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { env } from '../config/env.js';

const LOGS_DIR = './logs';
const EVENTS_LOG_FILE = join(LOGS_DIR, 'events.jsonl');

// Ensure logs directory exists
function ensureLogsDir() {
    if (!existsSync(LOGS_DIR)) {
        mkdirSync(LOGS_DIR, { recursive: true });
    }
}

// Initialize logger
ensureLogsDir();

/**
 * Supported log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log event structure
 */
export interface LogEvent {
    timestamp: string;
    type: string;
    level?: LogLevel;
    payload: unknown;
}

/**
 * Log level priority for threshold filtering
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * Check if a log level should be emitted based on configured threshold
 */
function shouldLog(level: LogLevel): boolean {
    const configuredLevel = env.LOG_LEVEL;
    const configuredPriority = LOG_LEVEL_PRIORITY[configuredLevel];
    const messagePriority = LOG_LEVEL_PRIORITY[level];

    return messagePriority >= configuredPriority;
}

/**
 * Logs an event to console and optionally to a JSONL file
 * @param type - Event type/category
 * @param payload - Event data
 * @param level - Log level (default: 'info')
 */
export function logEvent(type: string, payload: unknown, level: LogLevel = 'info') {
    // Check if this log level should be emitted
    if (!shouldLog(level)) {
        return;
    }

    const event: LogEvent = {
        timestamp: new Date().toISOString(),
        type,
        level,
        payload,
    };

    // Console output with colors based on level
    const levelColors: Record<LogLevel, string> = {
        debug: '\x1b[36m', // Cyan
        info: '\x1b[32m',  // Green
        warn: '\x1b[33m',  // Yellow
        error: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    const color = levelColors[level] || reset;

    console.log(
        `${color}[${event.timestamp}] [${level.toUpperCase()}] [${type}]${reset}`,
        typeof payload === 'object' ? JSON.stringify(payload, null, 2) : payload
    );

    // Write to JSONL file if enabled
    if (env.LOG_TO_FILE) {
        try {
            const jsonLine = JSON.stringify(event) + '\n';
            appendFileSync(EVENTS_LOG_FILE, jsonLine, 'utf-8');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
}

/**
 * Convenience methods for different log levels
 */
export const logger = {
    debug: (type: string, payload: unknown) => logEvent(type, payload, 'debug'),
    info: (type: string, payload: unknown) => logEvent(type, payload, 'info'),
    warn: (type: string, payload: unknown) => logEvent(type, payload, 'warn'),
    error: (type: string, payload: unknown) => logEvent(type, payload, 'error'),
};
