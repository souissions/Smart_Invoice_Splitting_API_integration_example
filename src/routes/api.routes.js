/**
 * ================================================================================
 * API ROUTES - INVOICE PROCESSING REST API
 * ================================================================================
 * 
 * RESTful API endpoints for the invoice processing system. Provides complete
 * functionality for PDF upload, batch processing, data extraction, validation,
 * and debugging through well-structured HTTP endpoints.
 * 
 * 🎯 API STRUCTURE:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 📤 UPLOAD ENDPOINTS:
 * • POST   /api/upload                     - Upload PDF and create document batch
 * • GET    /api/batches                    - List all document batches
 * • GET    /api/batches/:batchId           - Get specific batch information
 * • DELETE /api/batches/:batchId           - Delete batch and associated files
 * 
 * 🔄 PROCESSING ENDPOINTS:
 * • POST   /api/batches/:batchId/process   - Start batch processing (text extraction + AI)
 * • POST   /api/batches/:batchId/splits    - Apply splits and extract invoice data
 * • POST   /api/batches/:batchId/reprocess - Reprocess failed or updated batch
 * • GET    /api/batches/:batchId/health    - Check Azure services health status
 * 
 * ✅ VALIDATION ENDPOINTS:
 * • POST   /api/batches/:batchId/validate/:invoiceIndex - Submit validated invoice data
 * • GET    /api/batches/:batchId/data      - Get extracted data for validation
 * 
 * 🐛 DEBUG & TESTING ENDPOINTS:
 * • POST   /api/debug/extract              - Debug invoice extraction (single file)
 * • POST   /api/debug/mapping              - Test mapping agent on uploaded file
 * • GET    /api/debug/services             - Check service configuration status
 * • POST   /api/debug/llm-direct           - Direct LLM extraction testing
 * 
 * 📁 FILE SERVING ENDPOINTS:
 * • GET    /api/files/split/:batchId/:filename - Serve split PDF files
 * • GET    /api/files/original/:filename   - Serve original uploaded files
 * 
 * 🔧 MIDDLEWARE CONFIGURATION:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • **JSON Parser** - 10MB limit for large extraction payloads
 * • **Multer Upload** - File upload handling with PDF validation
 * • **Error Handling** - Comprehensive error capture and response formatting
 * • **CORS Support** - Cross-origin request handling for frontend integration
 * 
 * 📊 REQUEST/RESPONSE PATTERNS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 🟢 **Success Response Format:**
 * ```json
 * {
 *   "success": true,
 *   "data": { ... },
 *   "message": "Operation completed successfully"
 * }
 * ```
 * 
 * 🔴 **Error Response Format:**
 * ```json
 * {
 *   "success": false,
 *   "error": "Error description",
 *   "details": { ... }
 * }
 * ```
 * 
 * 📋 **Batch Information Response:**
 * ```json
 * {
 *   "id": "uuid",
 *   "filename": "invoice.pdf",
 *   "status": "COMPLETED",
 *   "pageCount": 15,
 *   "splits": [...],
 *   "extractedData": [...],
 *   "createdAt": "2025-09-02T10:30:00Z"
 * }
 * ```
 * 
 * 🔄 PROCESSING WORKFLOW:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 1. **Upload** → POST /api/upload
 *    - Upload PDF file
 *    - Create document batch
 *    - Return batch ID and initial info
 * 
 * 2. **Process** → POST /api/batches/:id/process  
 *    - Extract text from PDF
 *    - Detect invoice boundaries using AI
 *    - Generate split proposals
 * 
 * 3. **Apply Splits** → POST /api/batches/:id/splits
 *    - Apply approved splits
 *    - Extract data from individual invoices
 *    - Generate structured data
 * 
 * 4. **Validate** → POST /api/batches/:id/validate/:index
 *    - Submit user-validated data
 *    - Update validation status
 *    - Complete processing when all validated
 * 
 * 🐛 DEBUG FEATURES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • **Single File Testing** - Test extraction on individual files
 * • **Service Health Checks** - Verify Azure service connectivity
 * • **LLM Direct Testing** - Test AI extraction capabilities
 * • **Mapping Agent Testing** - Validate schema mapping functionality
 * • **Configuration Validation** - Check service setup and credentials
 * 
 * 🔧 DEPENDENCIES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • Upload Controller       - File upload and batch management
 * • Processing Controller   - Invoice processing and data extraction
 * • Validation Controller   - Data validation and quality assurance
 * • Azure Document Service  - PDF analysis and extraction
 * • Data Mapper Service     - Schema validation and utilities
 * • DocumentBatch Model     - Database operations
 * 
 * 🚀 PERFORMANCE FEATURES:
 * • Streaming file uploads for large PDFs
 * • Asynchronous processing with status tracking
 * • Efficient error handling and recovery
 * • Comprehensive logging and debugging support
 * • RESTful design for easy integration
 * 
 * ================================================================================
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

// Import controllers
const uploadController = require('../controllers/upload.controller');
const processingController = require('../controllers/processing.controller');

// Import services for debugging (split-only minimal services)
const azureDocumentService = require('../services/azure-document.service');

// Import model for database access
const DocumentBatch = require('../models/document-batch.model');

// Middleware for JSON parsing
router.use(express.json({ limit: '10mb' }));


// ============================================================================
// UPLOAD ROUTES
// ============================================================================

/**
 * POST /api/upload
 * Upload a PDF file and create a document batch
 */
router.post('/upload', 
  uploadController.upload.single('pdf'),
  uploadController.uploadPDF.bind(uploadController),
  uploadController.handleUploadError.bind(uploadController)
);

/**
 * GET /api/batches
 * List all document batches
 */
router.get('/batches', uploadController.listBatches.bind(uploadController));

/**
 * GET /api/batches/:batchId
 * Get information about a specific batch
 */
router.get('/batches/:batchId', uploadController.getBatchInfo.bind(uploadController));

/**
 * DELETE /api/batches/:batchId
 * Delete a document batch and associated files
 */
router.delete('/batches/:batchId', uploadController.deleteBatch.bind(uploadController));

/**
 * GET /api/storage/stats
 * Get storage statistics
 */
router.get('/storage/stats', uploadController.getStorageStats.bind(uploadController));

/**
 * GET /api/files/:batchId/pdf
 * Serve PDF file for preview
 */
router.get('/files/:batchId/pdf', uploadController.servePDF.bind(uploadController));

// ============================================================================
// PROCESSING ROUTES
// ============================================================================

/**
 * POST /api/batches/:batchId/process
 * Start processing a document batch (text extraction + boundary detection)
 */
router.post('/batches/:batchId/process', processingController.startProcessing.bind(processingController));

/**
 * GET /api/batches/:batchId/status
 * Get processing status for a batch
 */
router.get('/batches/:batchId/status', processingController.getProcessingStatus.bind(processingController));

/**
 * POST /api/batches/:batchId/validate-splits
 * Validate and confirm splits, create individual PDF files
 */
router.post('/batches/:batchId/validate-splits', processingController.validateSplits.bind(processingController));

/**
 * PUT /api/batches/:batchId/splits
 * Update splits manually for a batch
 */
router.put('/batches/:batchId/splits', processingController.updateSplits.bind(processingController));



/**
 * GET /api/health
 * Check Azure services health
 */
router.get('/health', processingController.checkServiceHealth.bind(processingController));

// ============================================================================
// VALIDATION ROUTES
// ============================================================================




// ============================================================================
// ERROR HANDLING MIDDLEWARE
// ============================================================================

/**
 * Global error handler for API routes
 */
router.use((error, req, res, next) => {
  console.error('API Error:', error);
  
  // Handle specific error types
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation error',
      details: error.message
    });
  }
  
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'Invalid ID format'
    });
  }
  
  // Default error response
  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

/**
 * 404 handler for API routes
 */
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method
  });
});


module.exports = router;

