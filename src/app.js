const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Import routes
const apiRoutes = require('./routes/api.routes');

// Import database
const database = require('./config/database');

class InvoiceProcessingApp {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  setupMiddleware() {
    // Security middleware
    this.app.use(helmet());

    // CORS middleware - allow all origins for development
    this.app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // Logging middleware
    const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
    this.app.use(morgan(logFormat));

    // Body parsing middleware
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Static files for file serving
    this.app.use('/uploads', express.static(path.join(__dirname, '../storage/uploads')));
    this.app.use('/static/split', express.static(path.join(__dirname, '../storage/split')));
  }

  setupRoutes() {
    // API routes
    this.app.use('/api', apiRoutes);

    // Health check endpoint
    this.app.get('/ping', (req, res) => {
      res.json({
        success: true,
        message: 'Smart Invoice Splitting API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    });
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      console.error('Global error handler:', error);

      // Check if response was already sent
      if (res.headersSent) {
        return next(error);
      }

      const status = error.status || 500;
      const message = error.message || 'Internal Server Error';

      // Return JSON error response for all requests
      return res.status(status).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    });

    // 404 handler
    this.app.use((req, res) => {
      const status = 404;
      const message = 'Not Found';

      return res.status(status).json({
        success: false,
        error: message,
        path: req.path,
        method: req.method
      });
    });
  }

  async initialize() {
    try {
      // Initialize database
      console.log('Initializing database...');
      await database.initialize();
      console.log('Database initialized successfully');

      // Note: Azure services will be initialized lazily when needed
      
      console.log('Application initialized successfully');
      
      return true;
    } catch (error) {
      console.error('Failed to initialize application:', error);
      throw error;
    }
  }

  async start() {
    try {
      await this.initialize();
      
      const server = this.app.listen(this.port, '0.0.0.0', () => {
        console.log('='.repeat(60));
        console.log('🚀 Smart Invoice Splitting API Started');
        console.log('='.repeat(60));
        console.log(`📍 Server running on: http://0.0.0.0:${this.port}`);
        console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔗 API Base: http://0.0.0.0:${this.port}/api`);
        console.log(`❤️  Health Check: http://0.0.0.0:${this.port}/ping`);
        console.log('='.repeat(60));
        
        // Log configuration status
        this.logConfigurationStatus();
      });

      // Graceful shutdown handling (only for production)
      if (process.env.NODE_ENV === 'production') {
        process.on('SIGTERM', () => this.gracefulShutdown(server));
        process.on('SIGINT', () => this.gracefulShutdown(server));
      } else {
        console.log('🔧 Development mode: Graceful shutdown disabled');
      }

      return server;
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  logConfigurationStatus() {
    console.log('📋 Configuration Status:');
    
    const requiredEnvVars = [
      'AZURE_FORM_RECOGNIZER_ENDPOINT',
      'AZURE_FORM_RECOGNIZER_KEY',
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_KEY',
      'AZURE_OPENAI_DEPLOYMENT_NAME'
    ];

    let configuredCount = 0;
    requiredEnvVars.forEach(varName => {
      const isConfigured = !!process.env[varName];
      console.log(`   ${isConfigured ? '✅' : '❌'} ${varName}`);
      if (isConfigured) configuredCount++;
    });

    console.log(`📈 Azure Services: ${configuredCount}/${requiredEnvVars.length} configured`);
    
    if (configuredCount < requiredEnvVars.length) {
      console.log('⚠️  Warning: Some Azure services are not configured. Check your .env file.');
    }
    
    console.log('='.repeat(60));
  }

  async gracefulShutdown(server) {
    console.log('\n🛑 Received shutdown signal. Gracefully shutting down...');
    
    // Close server
    server.close(async () => {
      console.log('📴 HTTP server closed');
      
      try {
        // Close database connection
        await database.close();
        console.log('🗄️  Database connection closed');
        
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });

    // Force close after 30 seconds
    setTimeout(() => {
      console.error('⏰ Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
  }

  getApp() {
    return this.app;
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new InvoiceProcessingApp();
  app.start();
}

module.exports = InvoiceProcessingApp;

