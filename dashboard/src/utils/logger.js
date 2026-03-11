/**
 * Debug/Development logging utilities
 * 
 * Only logs in development mode to keep production console clean.
 * Usage:
 *   import { devLog, devWarn, devError } from '@/utils/logger';
 *   devLog('MapView', 'Layers loaded');
 */

const isDev = import.meta.env?.DEV ?? process.env.NODE_ENV !== 'production';

/**
 * Log debug message (only in development)
 * @param {string} module - Module/component name
 * @param {string} message - Log message
 * @param {any} data - Optional data to log
 */
export const devLog = (module, message, data = null) => {
  if (isDev) {
    if (data !== null) {
      console.log(`[${module}] ${message}`, data);
    } else {
      console.log(`[${module}] ${message}`);
    }
  }
};

/**
 * Log warning (only in development)
 */
export const devWarn = (module, message, data = null) => {
  if (isDev) {
    if (data !== null) {
      console.warn(`[${module}] ${message}`, data);
    } else {
      console.warn(`[${module}] ${message}`);
    }
  }
};

/**
 * Log error (always logs - errors are important)
 */
export const devError = (module, message, error = null) => {
  if (error !== null) {
    console.error(`[${module}] ${message}`, error);
  } else {
    console.error(`[${module}] ${message}`);
  }
};

/**
 * Create a logger for a specific module
 * @param {string} moduleName - Name of the module
 * @returns {Object} Logger object with log, warn, error methods
 */
export const createLogger = (moduleName) => ({
  log: (message, data = null) => devLog(moduleName, message, data),
  warn: (message, data = null) => devWarn(moduleName, message, data),
  error: (message, error = null) => devError(moduleName, message, error),
});

export default { devLog, devWarn, devError, createLogger };
