/**
 * Environment variable validation for production deployment
 */

const logger = require('../utils/logger');

class EnvironmentValidator {
  constructor() {
    this.requiredVars = [
      'AZURE_FORM_RECOGNIZER_ENDPOINT',
      'AZURE_FORM_RECOGNIZER_KEY', 
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_KEY',
      'AZURE_OPENAI_DEPLOYMENT_NAME'
    ];

    this.optionalVars = [
      'PORT',
      'NODE_ENV',
      'MAX_FILE_SIZE',
      'MAX_PAGES_PER_BATCH',
      'CONFIDENCE_THRESHOLD'
    ];
  }

  validate() {
    const missing = [];
    const warnings = [];

    // Check required variables
    this.requiredVars.forEach(varName => {
      if (!process.env[varName]) {
        missing.push(varName);
      }
    });

    // Check optional variables with defaults
    if (!process.env.PORT) {
      warnings.push('PORT not set, defaulting to 3000');
    }

    if (!process.env.NODE_ENV) {
      warnings.push('NODE_ENV not set, defaulting to development');
    }

    // Report results
    if (missing.length > 0) {
      logger.error('Missing required environment variables', null, { missing });
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (warnings.length > 0) {
      warnings.forEach(warning => logger.warn(warning));
    }

    logger.info('Environment validation passed', {
      configured: this.requiredVars.length,
      warnings: warnings.length
    });

    return true;
  }

  getConfigSummary() {
    return {
      azure: {
        documentIntelligence: !!process.env.AZURE_FORM_RECOGNIZER_ENDPOINT,
        openAI: !!process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'not-set'
      },
      app: {
        port: process.env.PORT || 3000,
        environment: process.env.NODE_ENV || 'development',
        maxFileSize: process.env.MAX_FILE_SIZE || '50MB'
      }
    };
  }
}

module.exports = new EnvironmentValidator();
