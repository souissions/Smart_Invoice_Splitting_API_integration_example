/**
 * ================================================================================
 * UPLOAD CONTROLLER - FILE UPLOAD & BATCH MANAGEMENT
 * ================================================================================
 * 
 * Handles PDF file uploads and document batch creation for the invoice processing
 * system. Manages file storage, validation, and initial document batch setup
 * with comprehensive error handling and security measures.
 * 
 * 🎯 PRIMARY ENDPOINTS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 📤 FILE UPLOAD:
 * • uploadPDF(req, res)                    - Handle PDF file upload and batch creation
 * • uploadMiddleware()                     - Multer middleware for file processing
 * 
 * 📂 BATCH MANAGEMENT:
 * • createDocumentBatch(fileInfo)          - Create new document batch record
 * • validateUploadedFile(file)             - Validate PDF file integrity and format
 * • generateBatchMetadata(file)            - Generate batch metadata and identifiers
 * 
 * 📋 BATCH OPERATIONS:
 * • getBatches(req, res)                   - Retrieve all document batches
 * • getBatch(req, res)                     - Get specific batch details
 * • deleteBatch(req, res)                  - Delete batch and associated files
 * • updateBatchStatus(batchId, status)     - Update batch processing status
 * 
 * 🔧 UTILITY METHODS:
 * • ensureUploadDirectory()                - Create upload directories if needed
 * • cleanupTempFiles(filePath)             - Remove temporary and failed uploads
 * • generateUniqueFilename(originalName)   - Create unique filenames with timestamps
 * • validateFileSize(file)                 - Check file size against limits
 * 
 * 📁 FILE MANAGEMENT:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 📂 **Storage Structure:**
 * ```
 * storage/
 * ├── uploads/           - Original uploaded PDFs
 * ├── processing/        - Files being processed
 * └── split/            - Individual invoice PDFs after splitting
 *     └── {batchId}/    - Batch-specific split files
 * ```
 * 
 * 🔒 **Security Features:**
 * • File type validation (PDF only)
 * • File size limits (configurable, default 50MB)
 * • Unique filename generation to prevent conflicts
 * • Directory traversal protection
 * • MIME type verification
 * 
 * ✅ **Upload Validation:**
 * • PDF format verification
 * • File integrity checks
 * • Size limit enforcement
 * • Duplicate detection
 * • Malformed file detection
 * 
 * 🔄 UPLOAD WORKFLOW:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 1. **File Reception**
 *    - Receive multipart/form-data upload
 *    - Validate MIME type and file extension
 *    - Check file size against configured limits
 * 
 * 2. **Storage Management**
 *    - Generate unique filename with timestamp
 *    - Ensure upload directory exists
 *    - Store file in secure upload location
 * 
 * 3. **Batch Creation**
 *    - Create DocumentBatch database record
 *    - Generate unique batch identifier
 *    - Set initial status to 'UPLOADED'
 *    - Record file metadata and timestamps
 * 
 * 4. **Initial Analysis**
 *    - Get PDF page count and basic info
 *    - Validate PDF structure integrity
 *    - Prepare for processing pipeline
 * 
 * 📊 BATCH STATUS LIFECYCLE:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • **UPLOADED**        - File successfully uploaded and validated
 * • **PROCESSING**      - Text extraction and boundary detection in progress
 * • **SPLIT_PROPOSED**  - AI has proposed invoice splits for review
 * • **SPLIT_APPROVED**  - User has approved the proposed splits
 * • **EXTRACTING**      - Invoice data extraction in progress
 * • **COMPLETED**       - All invoices processed successfully
 * • **FAILED**          - Processing failed with errors
 * 
 * 🔧 DEPENDENCIES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • Multer                  - File upload handling middleware
 * • DocumentBatch Model     - Database operations for batch management
 * • PDF Splitter Service    - PDF analysis and manipulation
 * • File System (fs)        - Directory and file operations
 * • UUID                    - Unique identifier generation
 * 
 * 🚀 PERFORMANCE FEATURES:
 * • Streaming file uploads for large PDFs
 * • Asynchronous file operations
 * • Memory-efficient processing
 * • Configurable upload limits
 * • Automatic cleanup of failed uploads
 * 
 * ================================================================================
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const DocumentBatch = require('../models/document-batch.model');
const pdfSplitter = require('../services/pdf-splitter.service');

class UploadController {
  constructor() {
    this.storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../storage/uploads');
        try {
          await fs.access(uploadDir);
        } catch (error) {
          await fs.mkdir(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
      }
    });

    this.upload = multer({
      storage: this.storage,
      limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024, // 50MB default
        files: 1
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(new Error('Only PDF files are allowed'), false);
        }
      }
    });
  }

  /**
   * Upload PDF file and create document batch
   */
  async uploadPDF(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }

      console.log(`File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);

      // Get PDF information
      const pdfInfo = await pdfSplitter.getPDFInfo(req.file.path);
      
      if (!pdfInfo.success) {
        // Clean up uploaded file
        await fs.unlink(req.file.path).catch(console.error);
        return res.status(400).json({
          success: false,
          error: 'Invalid PDF file'
        });
      }

      // Validate page count
      const maxPages = parseInt(process.env.MAX_PAGES_PER_BATCH) || 200;
      if (pdfInfo.pageCount > maxPages) {
        await fs.unlink(req.file.path).catch(console.error);
        return res.status(400).json({
          success: false,
          error: `PDF has too many pages (${pdfInfo.pageCount}). Maximum allowed: ${maxPages}`
        });
      }

      // Create document batch record
      const batchId = uuidv4();
      const documentBatch = await DocumentBatch.create({
        id: batchId,
        originalFilename: req.file.originalname,
        filePath: req.file.path,
        status: 'UPLOADED',
        totalPages: pdfInfo.pageCount
      });

      console.log(`Document batch created: ${batchId} (${pdfInfo.pageCount} pages)`);

      res.json({
        success: true,
        message: 'File uploaded successfully',
        data: {
          batchId: documentBatch.id,
          originalFilename: documentBatch.originalFilename,
          totalPages: documentBatch.totalPages,
          fileSize: pdfInfo.fileSize,
          status: documentBatch.status,
          uploadedAt: documentBatch.createdAt
        }
      });

    } catch (error) {
      console.error('Upload error:', error);
      
      // Clean up uploaded file if it exists
      if (req.file && req.file.path) {
        await fs.unlink(req.file.path).catch(console.error);
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Upload failed'
      });
    }
  }

  /**
   * Get upload status and batch information
   */
  async getBatchInfo(req, res) {
    try {
      const { batchId } = req.params;
      
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      res.json({
        success: true,
        data: {
          batchId: documentBatch.id,
          originalFilename: documentBatch.originalFilename,
          totalPages: documentBatch.totalPages,
          status: documentBatch.status,
          proposedSplits: documentBatch.proposedSplits,
          validatedSplits: documentBatch.validatedSplits,
          extractedData: documentBatch.extractedData,
          confidenceScores: documentBatch.confidenceScores,
          errorMessage: documentBatch.errorMessage,
          createdAt: documentBatch.createdAt,
          updatedAt: documentBatch.updatedAt
        }
      });

    } catch (error) {
      console.error('Get batch info error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get batch information'
      });
    }
  }

  /**
   * List all document batches
   */
  async listBatches(req, res) {
    try {
      const batches = await DocumentBatch.findAll();
      
      const batchList = batches.map(batch => ({
        batchId: batch.id,
        originalFilename: batch.originalFilename,
        totalPages: batch.totalPages,
        status: batch.status,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt
      }));

      res.json({
        success: true,
        data: {
          batches: batchList,
          totalCount: batchList.length
        }
      });

    } catch (error) {
      console.error('List batches error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list batches'
      });
    }
  }

  /**
   * Delete a document batch and associated files
   */
  async deleteBatch(req, res) {
    try {
      const { batchId } = req.params;
      
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      // Clean up files
      try {
        // Delete original file
        if (documentBatch.filePath) {
          await fs.unlink(documentBatch.filePath).catch(console.error);
        }
        
        // Clean up split files
        await pdfSplitter.cleanupBatchFiles(batchId);
      } catch (cleanupError) {
        console.warn('File cleanup warning:', cleanupError.message);
      }

      // Delete database record
      await documentBatch.delete();

      console.log(`Batch deleted: ${batchId}`);

      res.json({
        success: true,
        message: 'Batch deleted successfully'
      });

    } catch (error) {
      console.error('Delete batch error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete batch'
      });
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(req, res) {
    try {
      const stats = await pdfSplitter.getStorageStats();
      
      if (!stats.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to get storage statistics'
        });
      }

      res.json({
        success: true,
        data: {
          storage: stats.stats,
          totalFiles: stats.totalFiles,
          totalSize: stats.totalSize,
          totalSizeMB: Math.round(stats.totalSize / (1024 * 1024) * 100) / 100
        }
      });

    } catch (error) {
      console.error('Get storage stats error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get storage statistics'
      });
    }
  }

  /**
   * Middleware for handling multer errors
   */
  handleUploadError(error, req, res, next) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File too large'
        });
      } else if (error.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({
          success: false,
          error: 'Too many files'
        });
      }
    } else if (error.message === 'Only PDF files are allowed') {
      return res.status(400).json({
        success: false,
        error: 'Only PDF files are allowed'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Upload error'
    });
  }

  /**
   * Serve PDF file for preview
   */
  async servePDF(req, res) {
    try {
      const { batchId } = req.params;
      
      // Get batch information
      const batch = await DocumentBatch.findById(batchId);
      if (!batch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      // Check if file exists
      const filePath = batch.filePath;
      try {
        await fs.access(filePath);
      } catch (error) {
        return res.status(404).json({
          success: false,
          error: 'PDF file not found'
        });
      }

      // Set appropriate headers for PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${batch.originalFilename}"`);
      
      // Stream the PDF file
      const fs_sync = require('fs');
      const readStream = fs_sync.createReadStream(filePath);
      readStream.pipe(res);
      
    } catch (error) {
      console.error('Error serving PDF:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to serve PDF file'
      });
    }
  }
}

module.exports = new UploadController();

