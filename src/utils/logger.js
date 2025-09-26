/**
 * Production-ready logging utility
 * Replaces console.log statements with structured logging
 */

class Logger {
  constructor() {
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  info(message, meta = {}) {
    if (this.isDevelopment) {
      console.log(`[INFO] ${message}`, meta);
    } else {
      // In production, you might want to use a proper logging service
      console.log(JSON.stringify({
        level: 'info',
        message,
        meta,
        timestamp: new Date().toISOString()
      }));
    }
  }

  error(message, error = null, meta = {}) {
    const errorData = {
      level: 'error',
      message,
      meta,
      timestamp: new Date().toISOString()
    };

    if (error) {
      errorData.error = {
        message: error.message,
        stack: error.stack,
        name: error.name
      };
    }

    if (this.isDevelopment) {
      console.error(`[ERROR] ${message}`, error || meta);
    } else {
      console.error(JSON.stringify(errorData));
    }
  }

  warn(message, meta = {}) {
    if (this.isDevelopment) {
      console.warn(`[WARN] ${message}`, meta);
    } else {
      console.warn(JSON.stringify({
        level: 'warn',
        message,
        meta,
        timestamp: new Date().toISOString()
      }));
    }
  }

  debug(message, meta = {}) {
    if (this.isDevelopment) {
      console.log(`[DEBUG] ${message}`, meta);
    }
    // Debug logs are typically not shown in production
  }
}

module.exports = new Logger();
