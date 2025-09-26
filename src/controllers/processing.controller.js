/**
 * ================================================================================
 * PROCESSING CONTROLLER - INVOICE BATCH PROCESSING ENGINE
 * ================================================================================
 * 
 * Main controller for handling invoice processing workflows including PDF splitting,
 * text extraction, data mapping, and validation. Orchestrates the complete 
 * invoice processing pipeline from raw PDF upload to structured data extraction.
 * 
 * 🎯 PRIMARY ENDPOINTS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 📂 BATCH PROCESSING:
 * • startProcessing(req, res)              - Initialize batch processing workflow
 * • applySplits(req, res)                  - Apply PDF splits and extract invoice data
 * • reprocessBatch(req, res)               - Reprocess failed or updated batches
 * 
 * 📄 DATA EXTRACTION:
 * • getExtractedData(req, res)             - Retrieve extracted invoice data
 * • extractBatchInvoiceData(documentBatch) - Internal batch data extraction
 * • mapFieldVariations(extractedData)      - Map field name variations to canonical names
 * 
 * 🔧 UTILITY METHODS:
 * • initializeServices()                   - Initialize Azure services (Document AI, OpenAI)
 * • parseNumericValue(value)               - Parse numeric values with European formatting
 * • validateEnhancedExtractionData()       - Validate extracted data with metadata
 * • calculateEnhancedConfidence()          - Calculate confidence scores from metadata
 * • checkServiceHealth(req, res)           - Health check for Azure services
 * 
 * 🔄 PROCESSING WORKFLOW:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 1. **Batch Initialization**
 *    - Validate batch status and permissions
 *    - Initialize Azure Document Intelligence & OpenAI services
 *    - Update batch status to PROCESSING
 * 
 * 2. **PDF Analysis & Splitting**
 *    - Extract raw text using Azure Layout API
 *    - Detect invoice boundaries using AI analysis
 *    - Generate split proposals with confidence scoring
 * 
 * 3. **Data Extraction Pipeline**
 *    - Apply approved splits to create individual invoice PDFs
 *    - Process each invoice using Invoice Mapping Agent
 *    - Extract structured data with 100% schema compliance
 *    - Perform validation and confidence assessment
 * 
 * 4. **Quality Assurance**
 *    - Field validation and type checking
 *    - Financial reconciliation (HT/TTC/Tax calculations)
 *    - Confidence scoring and error reporting
 *    - Final batch status update
 * 
 * 📊 EXTRACTION FEATURES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * ✅ **Multi-Tier Extraction Engine**
 *    - Azure Document Intelligence native fields
 *    - Query-based field detection
 *    - LLM fallback extraction for missing data
 * 
 * ✅ **Schema Compliance**
 *    - 31+ field complete schema mapping
 *    - Required field validation
 *    - Data type enforcement
 * 
 * ✅ **Financial Processing**
 *    - Currency detection and normalization
 *    - Tax calculation and reconciliation
 *    - Weight extraction (gold, platinum)
 *    - Line item processing with audit trails
 * 
 * ✅ **Quality Assurance**
 *    - Confidence scoring per field
 *    - Overall extraction quality assessment
 *    - Error handling and fallback mechanisms
 *    - Processing audit trails
 * 
 * 🔧 DEPENDENCIES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • DocumentBatch Model           - Batch management and status tracking
 * • Azure Document Service        - PDF text extraction and invoice analysis
 * • Azure OpenAI Service          - AI-powered boundary detection and field extraction
 * • PDF Splitter Service          - PDF manipulation and file operations
 * • Data Mapper Service           - Schema validation and utility functions
 * 
 * 🚀 PERFORMANCE OPTIMIZATIONS:
 * • Lazy service initialization for faster startup
 * • Batch processing for multiple invoices
 * • Confidence-based extraction prioritization
 * • Memory-efficient PDF handling
 * • Structured error handling and recovery
 * 
 * ================================================================================
 */

const DocumentBatch = require('../models/document-batch.model');
const azureDocumentService = require('../services/azure-document.service');
const azureOpenAIService = require('../services/azure-openai.service');
const pdfSplitterService = require('../services/pdf-splitter.service');

class ProcessingController {
  constructor() {
    // Services will be initialized lazily when needed
    this.servicesInitialized = false;
  }

  async initializeServices() {
    if (this.servicesInitialized) return;
    
    try {
      // Initialize only the services required for split detection.
      // If SPLIT_ONLY mode is disabled, initialize all services as before.
      await azureOpenAIService.initialize();
      // Azure DocumentService initialize may contact the Form Recognizer. In SPLIT_ONLY mode
      // we still need the layout extraction, so initialize azureDocumentService unless
      // the environment explicitly disables it.
      if (process.env.SPLIT_ONLY !== 'true' || process.env.ENABLE_LAYOUT_EXTRACT === 'true') {
        await azureDocumentService.initialize();
      } else {
        // In strict SPLIT_ONLY without layout extraction, we still proceed — caller must provide
        // pre-extracted pages or rely on lightweight layout mocks.
        console.log('⚠️ Running in SPLIT_ONLY mode with layout extraction disabled via env');
      }

      this.servicesInitialized = true;
      console.log('✅ Azure services initialized for processing');
    } catch (error) {
      console.error('Failed to initialize Azure services:', error);
      throw error;
    }
  }

  /**
   * Start processing a document batch - extract text and detect boundaries
   */
  async startProcessing(req, res) {
    try {
      const { batchId } = req.params;
      
      // Get document batch
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      if (!['UPLOADED', 'SPLIT_PROPOSED', 'PROCESSING_FAILED'].includes(documentBatch.status)) {
        return res.status(400).json({
          success: false,
          error: `Cannot process batch in status: ${documentBatch.status}`
        });
      }

      // Update status to processing
      await documentBatch.update({ status: 'PROCESSING_SPLIT' });

      // Start processing asynchronously
      this.processDocumentBatch(documentBatch).catch(error => {
        console.error(`Processing failed for batch ${batchId}:`, error);
        documentBatch.update({ 
          status: 'ERROR',
          error_message: error.message 
        }).catch(console.error);
      });

      res.json({
        success: true,
        message: 'Processing started',
        data: {
          batchId: documentBatch.id,
          status: 'PROCESSING_SPLIT'
        }
      });

    } catch (error) {
      console.error('Start processing error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to start processing'
      });
    }
  }

  /**
   * Process document batch (internal method)
   */
  async processDocumentBatch(documentBatch) {
    try {
      console.log(`Starting processing for batch: ${documentBatch.id}`);

      // Initialize Azure services if not already done
      await this.initializeServices();

      // Step 1: Extract text from PDF
      console.log('Step 1: Extracting text from PDF...');
      const textExtractionResult = await azureDocumentService.extractTextFromPDF(documentBatch.filePath);
      
      if (!textExtractionResult.success) {
        throw new Error(`Text extraction failed: ${textExtractionResult.error}`);
      }

      console.log(`Text extracted: ${textExtractionResult.totalPages} pages, ${textExtractionResult.totalWords} words`);

      // Step 2: Detect invoice boundaries using AI
      console.log('Step 2: Detecting invoice boundaries...');
      const boundaryDetectionResult = await azureOpenAIService.detectInvoiceBoundaries(textExtractionResult.pages);
      
      if (!boundaryDetectionResult.success) {
        throw new Error(`Boundary detection failed: ${boundaryDetectionResult.error}`);
      }

      console.log(`Boundaries detected: ${boundaryDetectionResult.invoiceCount} invoices`);

      // Update document batch with proposed splits
      await documentBatch.update({
        status: 'SPLIT_PROPOSED',
        proposed_splits: boundaryDetectionResult.proposedSplits
      });

      // If configured to deliver split-only, stop the pipeline here.
      if (process.env.SPLIT_ONLY === 'true') {
        console.log('SPLIT_ONLY mode enabled — stopping after split proposal (no extraction will run)');
        return;
      }

      console.log(`Processing completed for batch: ${documentBatch.id}`);

    } catch (error) {
      console.error(`Processing error for batch ${documentBatch.id}:`, error);
      await documentBatch.update({
        status: 'ERROR',
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(req, res) {
    try {
      const { batchId } = req.params;
      
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      const response = {
        success: true,
        data: {
          batchId: documentBatch.id,
          status: documentBatch.status,
          totalPages: documentBatch.totalPages,
          errorMessage: documentBatch.errorMessage,
          updatedAt: documentBatch.updatedAt
        }
      };

      // Include proposed splits if available
      if (documentBatch.proposedSplits) {
        response.data.proposedSplits = documentBatch.proposedSplits;
        response.data.invoiceCount = documentBatch.proposedSplits.length;
      }

      res.json(response);

    } catch (error) {
      console.error('Get processing status error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get processing status'
      });
    }
  }

  // Update splits for a batch - manual editing
  async updateSplits(req, res) {
    try {
      const { batchId } = req.params;
      const { splits } = req.body;
      
      console.log(`Updating splits for batch ${batchId}:`, splits);

      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      // Validate splits format
      if (!Array.isArray(splits)) {
        return res.status(400).json({
          success: false,
          error: 'Splits must be an array'
        });
      }

      // Validate each split
      for (const split of splits) {
        if (!split.startPage || !split.endPage) {
          return res.status(400).json({
            success: false,
            error: 'Each split must have startPage and endPage'
          });
        }
      }

      // Update the batch with new splits
      await DocumentBatch.updateSplits(batchId, splits);

      res.json({
        success: true,
        message: 'Splits updated successfully'
      });

    } catch (error) {
      console.error('Error updating splits:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Validate and confirm splits, then create individual PDF files
   */
  async validateSplits(req, res) {
    try {
      const { batchId } = req.params;
      const { validatedSplits } = req.body;

      if (!validatedSplits || !Array.isArray(validatedSplits)) {
        return res.status(400).json({
          success: false,
          error: 'Valid splits array is required'
        });
      }

      // Get document batch
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      if (documentBatch.status !== 'SPLIT_PROPOSED') {
        return res.status(400).json({
          success: false,
          error: `Cannot validate splits for batch in status: ${documentBatch.status}`
        });
      }

      console.log(`Validating splits for batch: ${batchId}`);

      // Split the PDF based on validated splits
      const splitResult = await pdfSplitterService.splitPDF(
        documentBatch.filePath,
        validatedSplits,
        batchId
      );

      if (!splitResult.success) {
        return res.status(500).json({
          success: false,
          error: `PDF splitting failed: ${splitResult.error}`
        });
      }

      // Update document batch
      await documentBatch.update({
        status: 'SPLIT_VALIDATED',
        validated_splits: splitResult.splits // Use the actual split results with filenames
      });

      console.log(`Splits validated for batch: ${batchId} (${splitResult.totalSplits} files created)`);

      res.json({
        success: true,
        message: 'Splits validated and PDF files created',
        data: {
          batchId: documentBatch.id,
          status: 'SPLIT_VALIDATED',
          totalSplits: splitResult.totalSplits,
          splits: splitResult.splits
        }
      });

    } catch (error) {
      console.error('Validate splits error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to validate splits'
      });
    }
  }

  /**
   * Extract data from individual invoice PDFs
   */
  async extractInvoiceData(req, res) {
    try {
      // If SPLIT_ONLY mode is enabled, disallow starting extraction
      if (process.env.SPLIT_ONLY === 'true') {
        return res.status(403).json({
          success: false,
          error: 'Data extraction is disabled in SPLIT_ONLY mode'
        });
      }

      const { batchId } = req.params;
      
      // Get document batch
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      if (documentBatch.status !== 'SPLIT_VALIDATED') {
        return res.status(400).json({
          success: false,
          error: `Cannot extract data for batch in status: ${documentBatch.status}`
        });
      }

      // Update status
      await documentBatch.update({ status: 'EXTRACTING_DATA' });

      // Start data extraction asynchronously
      this.extractBatchInvoiceData(documentBatch).catch(error => {
        console.error(`Data extraction failed for batch ${batchId}:`, error);
        documentBatch.update({ 
          status: 'ERROR',
          error_message: error.message 
        }).catch(console.error);
      });

      res.json({
        success: true,
        message: 'Data extraction started',
        data: {
          batchId: documentBatch.id,
          status: 'EXTRACTING_DATA'
        }
      });

    } catch (error) {
      console.error('Extract invoice data error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to start data extraction'
      });
    }
  }

  /**
   * Extract data from all invoices in a batch (internal method)
   */
  async extractBatchInvoiceData(documentBatch) {
    try {
      // Defensive: do not run extraction if SPLIT_ONLY is enabled
      if (process.env.SPLIT_ONLY === 'true') {
        throw new Error('SPLIT_ONLY mode enabled — batch extraction aborted');
      }

      console.log(`Starting data extraction for batch: ${documentBatch.id}`);

      if (!documentBatch.validatedSplits || documentBatch.validatedSplits.length === 0) {
        throw new Error('No validated splits found');
      }

      const extractedInvoices = [];
      const confidenceScores = {};

      // Process each split
      for (let i = 0; i < documentBatch.validatedSplits.length; i++) {
        const split = documentBatch.validatedSplits[i];
        console.log(`Extracting data from invoice ${i + 1}/${documentBatch.validatedSplits.length}: ${split.invoiceNumber}`);

        // Construct file path for the split PDF
        // Files are named like: DKEF-01286-1_pages_1-2_2025-08-31.pdf
        const today = new Date().toISOString().split('T')[0];
        // Clean invoice number by removing confidence markers
        const cleanInvoiceNumber = (split.invoiceNumber || '')
          .replace(/\s*\[LOW_CONFIDENCE\]\s*/g, '')
          .trim();
        const filename = `${cleanInvoiceNumber}_pages_${split.startPage}-${split.endPage}_${today}.pdf`;
        const splitFilePath = `storage/split/${documentBatch.id}/${filename}`;
        
        console.log(`Looking for file: ${splitFilePath}`);

        // Extract invoice data using Invoice Mapping Agent (100% Schema)
        console.log('🚀 Using Invoice Mapping Agent (100% Schema Compliance)...');
        console.log(`🗺️  ORCHESTRATOR: Starting mapping for invoice ${i + 1}/${documentBatch.validatedSplits.length}`);
        console.log(`📁 Target file: ${splitFilePath}`);
        const extractionResult = await azureDocumentService.processInvoiceWithFullMapping(splitFilePath);
        
        // Enhanced extraction debugging
        console.log('🎯 MAPPING ORCHESTRATOR RESULTS');
        console.log('====================================');
        console.log('📁 File processed:', splitFilePath);
        console.log('📊 Mapping success:', extractionResult.success);
        if (extractionResult.success) {
          const metadata = extractionResult.metadata;
          console.log('📊 Invoice Mapping Agent summary:');
          console.log(`  ✅ Fields covered: ${metadata?.fieldsCovered}/48 (${Math.round((metadata?.fieldsCovered/48)*100)}%)`);
          console.log(`  � Items extracted: ${metadata?.itemsExtracted}`);
          console.log(`  📈 Average confidence: ${Math.round((metadata?.averageConfidence || 0)*100)}%`);
          console.log('🎯 Key mapped fields:');
          const payload = extractionResult.finalPayload || {};
          console.log(`  📄 Invoice ID: ${payload.invoice_id}`);
          console.log(`  📅 Issue Date: ${payload.issue_date}`);
          console.log(`  📅 Due Date: ${payload.due_date}`);
          console.log(`  💰 Total HT: ${payload.total_ht}`);
          console.log(`  💰 Total TTC: ${payload.total_ttc}`);
          console.log(`  💱 Currency: ${payload.currency}`);
          console.log(`  📦 Package: ${payload.package_number}`);
          console.log(`  👥 Exporter: ${payload.exporter_name}`);
          console.log(`  🏢 Importer: ${payload.importer_name}`);
          console.log(`🔗 Field mapping process will now begin...`);
        } else {
          console.log('❌ Mapping failed:', extractionResult.error);
        }
        console.log('====================================');
        console.log('🎯 MAPPING ORCHESTRATOR DEBUG END\n');
        
        if (extractionResult.success) {
          // Mapping Agent returns finalPayload with complete schema
          let extractedData = extractionResult.finalPayload;
          
          console.log('🔗 POST-MAPPING FIELD VARIATIONS');
          console.log('=================================');
          console.log('🔄 Applying field mapping variations...');
          console.log(`📊 Original data keys: ${Object.keys(extractedData).join(', ')}`);
          
          // Log the data before field variations
          console.log('📄 EXTRACTED DATA BEFORE FIELD VARIATIONS (JSON)');
          console.log('=================================================');
          const beforeVariationsStr = JSON.stringify(extractedData, null, 2);
          if (beforeVariationsStr.length > 8000) {
            console.log(beforeVariationsStr.substring(0, 4000) + '\n...[TRUNCATED]...');
          } else {
            console.log(beforeVariationsStr);
          }
          console.log('=================================================');
          
          // Apply field mapping to ensure canonical field names
          extractedData = this.mapFieldVariations(extractedData);

          // Normalize line item numeric fields and correct implausible unit prices (guardrail)
          try {
            if (Array.isArray(extractedData.items) && extractedData.items.length) {
              extractedData.items = this.normalizeItemsNumbers(extractedData.items);
            }
          } catch (e) {
            console.warn('Item normalization failed, continuing without correction:', e?.message || e);
          }
          console.log(`📊 Mapped data keys: ${Object.keys(extractedData).join(', ')}`);
          
          // Log the data after field variations
          console.log('📄 FINAL EXTRACTED DATA AFTER FIELD VARIATIONS (JSON)');
          console.log('======================================================');
          const afterVariationsStr = JSON.stringify(extractedData, null, 2);
          if (afterVariationsStr.length > 8000) {
            console.log(afterVariationsStr.substring(0, 4000) + '\n...[TRUNCATED]...');
          } else {
            console.log(afterVariationsStr);
          }
          console.log('======================================================');
          
          console.log('✅ Field mapping variations applied');
          console.log('=================================');
          
          // Create enhanced validation
          console.log('🔍 VALIDATION PHASE');
          console.log('===================');
          const validation = this.validateEnhancedExtractionData(extractedData, extractionResult.metadata);
          console.log(`✅ Validation result: ${validation.isValid ? 'VALID' : 'INVALID'}`);
          if (validation.errors.length > 0) {
            console.log(`❌ Validation errors: ${validation.errors.join(', ')}`);
          }
          if (validation.warnings.length > 0) {
            console.log(`⚠️  Validation warnings: ${validation.warnings.join(', ')}`);
          }
          console.log('===================');
          
          // Calculate confidence from mapping agent metadata
          const confidence = extractionResult.metadata?.averageConfidence || 0;

          extractedInvoices.push({
            splitId: split.id,
            invoiceNumber: split.invoiceNumber,
            pageRange: split.pageRange,
            extractedData: extractedData,
            items: extractedData.items || [],
            confidence: confidence,
            validation: validation,
            metadata: {
              ...extractionResult.metadata,
              extractionMethod: 'mapping-agent',
              auditTrail: extractionResult.auditPayload,
              itemCurrencySummary: (() => {
                try {
                  const audit = extractionResult.auditPayload || {};
                  const summary = {};
                  Object.entries(audit).forEach(([k, v]) => {
                    if (k.startsWith('item_') && v && typeof v === 'object' && v.detected_currency && v.detected_currency.evidence) {
                      const code = String(v.detected_currency.evidence).match(/Detected in item context: (\w{3})/);
                      const curr = code ? code[1] : 'UNKNOWN';
                      summary[curr] = (summary[curr] || 0) + 1;
                    }
                  });
                  return summary;
                } catch { return {}; }
              })()
              , fieldSources: (() => {
                try {
                  const audit = extractionResult.auditPayload || {};
                  const sources = {};
                  Object.keys(extractedData || {}).forEach(k => {
                    const a = audit[k];
                    if (a && a.source) sources[k] = a.source;
                  });
                  return sources;
                } catch { return {}; }
              })()
            }
          });

          confidenceScores[split.id] = confidence;
          console.log(`✅ Invoice ${i + 1} processed successfully (confidence: ${Math.round(confidence * 100)}%)`);
          try {
            const itemCurrencySummary = extractedInvoices[extractedInvoices.length - 1].metadata.itemCurrencySummary || {};
            const summaryPairs = Object.entries(itemCurrencySummary).map(([c, n]) => `${c}:${n}`).join(', ');
            if (summaryPairs) console.log(`💱 Detected item currencies: ${summaryPairs}`);
          } catch {}
        } else {
          console.warn(`Invoice Mapping Agent failed for split ${split.id}: ${extractionResult.error}`);
          
          // Create empty invoice with error info
          extractedInvoices.push({
            splitId: split.id,
            invoiceNumber: split.invoiceNumber,
            pageRange: split.pageRange,
            extractedData: {}, // Empty schema - extraction service archived
            items: [],
            confidence: 0,
            validation: { isValid: false, errors: [extractionResult.error], warnings: [] },
            metadata: { error: extractionResult.error, extractionMethod: 'mapping-agent-failed' }
          });

          confidenceScores[split.id] = 0;
        }
      }

      // Update document batch with extracted data
      console.log(`🎯 BATCH EXTRACTION SUMMARY`);
      console.log(`============================`);
      console.log(`📊 Batch ID: ${documentBatch.id}`);
      console.log(`📄 Total invoices processed: ${extractedInvoices.length}`);
      console.log(`✅ Successful extractions: ${extractedInvoices.filter(inv => inv.confidence > 0).length}`);
      console.log(`❌ Failed extractions: ${extractedInvoices.filter(inv => inv.confidence === 0).length}`);
      
      // Calculate batch-level metrics
      const validInvoices = extractedInvoices.filter(inv => inv.confidence > 0);
      if (validInvoices.length > 0) {
        const avgConfidence = validInvoices.reduce((sum, inv) => sum + inv.confidence, 0) / validInvoices.length;
        const totalItems = validInvoices.reduce((sum, inv) => sum + (inv.items?.length || 0), 0);
        const totalFieldsExtracted = validInvoices.reduce((sum, inv) => {
          const data = inv.extractedData || {};
          return sum + Object.keys(data).filter(key => {
            const value = data[key];
            return value !== "" && value !== 0 && value !== null && !(Array.isArray(value) && value.length === 0);
          }).length;
        }, 0);
        
        console.log(`📈 Average confidence: ${Math.round(avgConfidence * 100)}%`);
        console.log(`📋 Total line items: ${totalItems}`);
        console.log(`📊 Total fields populated: ${totalFieldsExtracted}`);
        console.log(`🏆 Best confidence: ${Math.round(Math.max(...validInvoices.map(inv => inv.confidence)) * 100)}%`);
        console.log(`⚠️  Lowest confidence: ${Math.round(Math.min(...validInvoices.map(inv => inv.confidence)) * 100)}%`);
      }
      console.log(`============================`);
      
      await documentBatch.update({
        status: 'DATA_VALIDATION_PENDING',
        extracted_data: extractedInvoices,
        confidence_scores: confidenceScores
      });

      console.log(`✅ Data extraction completed for batch: ${documentBatch.id} (${extractedInvoices.length} invoices)`);

    } catch (error) {
      console.error(`Data extraction error for batch ${documentBatch.id}:`, error);
      await documentBatch.update({
        status: 'ERROR',
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Get extracted invoice data for validation
   */
  async getExtractedData(req, res) {
    try {
      const { batchId } = req.params;
      
      const documentBatch = await DocumentBatch.findById(batchId);
      if (!documentBatch) {
        return res.status(404).json({
          success: false,
          error: 'Batch not found'
        });
      }

      if (!documentBatch.extractedData) {
        return res.status(400).json({
          success: false,
          error: 'No extracted data available'
        });
      }

      res.json({
        success: true,
        data: {
          batchId: documentBatch.id,
          status: documentBatch.status,
          extractedInvoices: documentBatch.extractedData,
          confidenceScores: documentBatch.confidenceScores,
          totalInvoices: documentBatch.extractedData.length
        }
      });

    } catch (error) {
      console.error('Get extracted data error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get extracted data'
      });
    }
  }

  /**
   * Map common field variations to canonical field names
   */
  mapFieldVariations(extractedData) {
    console.log(`🔄 FIELD VARIATIONS MAPPING START`);
    console.log(`==============================`);
    console.log(`📥 Input data keys: ${Object.keys(extractedData).join(', ')}`);
    
    const mappedData = { ...extractedData };
    let mappingCount = 0;
    
    // Map invoice number variations
    if (!mappedData.invoice_id && mappedData.invoice_number) {
      console.log(`  📋 Mapping invoice_number → invoice_id: "${mappedData.invoice_number}"`);
      mappedData.invoice_id = mappedData.invoice_number;
      mappingCount++;
    }
    
    // Map invoice date variations
    if (!mappedData.issue_date && mappedData.invoice_date) {
      console.log(`  📅 Mapping invoice_date → issue_date: "${mappedData.invoice_date}"`);
      mappedData.issue_date = mappedData.invoice_date;
      mappingCount++;
    }
    
    // Map total amount variations
    if (!mappedData.total_ttc && mappedData.total_amount) {
      console.log(`  💰 Mapping total_amount → total_ttc: "${mappedData.total_amount}"`);
      mappedData.total_ttc = mappedData.total_amount;
      mappingCount++;
    }
    
    // Map vendor/exporter fields
    if (!mappedData.exporter_name && mappedData.vendor_name) {
      console.log(`  🏢 Mapping vendor_name → exporter_name: "${mappedData.vendor_name}"`);
      mappedData.exporter_name = mappedData.vendor_name;
      mappingCount++;
    }
    
    if (!mappedData.exporter_street && mappedData.vendor_address) {
      console.log(`  🏠 Mapping vendor_address → exporter_street: "${mappedData.vendor_address}"`);
      mappedData.exporter_street = mappedData.vendor_address;
      mappingCount++;
    }
    
    // Map customer/importer fields
    if (!mappedData.importer_name && mappedData.customer_name) {
      console.log(`  👥 Mapping customer_name → importer_name: "${mappedData.customer_name}"`);
      mappedData.importer_name = mappedData.customer_name;
      mappingCount++;
    }
    
    if (!mappedData.importer_street && mappedData.customer_address) {
      console.log(`  🏠 Mapping customer_address → importer_street: "${mappedData.customer_address}"`);
      mappedData.importer_street = mappedData.customer_address;
      mappingCount++;
    }
    
    // Map line items structure
    if (!mappedData.items && mappedData.line_items) {
      console.log(`  📋 Mapping line_items → items (${mappedData.line_items.length} items)`);
      mappedData.items = mappedData.line_items.map((item, index) => {
        console.log(`    📦 Item ${index + 1}: "${item.description || 'N/A'}" (qty: ${item.quantity || 0}, price: ${item.unit_price || 0})`);
        return {
          product_name: item.description || '',
          Reference: '', // Not available in source data
          po_number: item.po_number || '', // Use item-level PO number from extraction
          client_order: item.client_order || '',
          item_code: item.product_code || '',
          description: item.description || '',
          size: '',
          hs_code: '',
          made_in: '',
          unit_weight: '',
          net_weight: 0,
          net_gold_weight: 0,
          net_platine_weight: 0,
          discount: 0,
          quantity: parseInt(item.quantity) || 0,
          unit_price: this.parseNumericValue(item.unit_price) || 0,
          total_price_ht: this.parseNumericValue(item.line_total) || 0
        };
      });
      mappingCount++;
    }
    
    console.log(`✅ Field variations mapping completed: ${mappingCount} mappings applied`);
    console.log(`📤 Output data keys: ${Object.keys(mappedData).join(', ')}`);
    console.log(`==============================`);
    console.log(`🔄 FIELD VARIATIONS MAPPING END`);
    
    return mappedData;
  }
  
  /**
   * Normalize line item numbers and correct implausible unit prices using total/quantity
   * - Parses numbers robustly using parseNumericValue
   * - If unit_price * quantity is wildly off vs total_price_ht, replace unit_price with total/quantity
   */
  normalizeItemsNumbers(items) {
    return (items || []).map((it) => {
      const item = { ...it };
      const q = this.parseNumericValue(item.quantity);
      const total = this.parseNumericValue(item.total_price_ht || item.line_total || item.Amount);
      let up = this.parseNumericValue(item.unit_price || item.UnitPrice);

      // Assign parsed values back (keeping other fields untouched)
      item.quantity = q;
      item.total_price_ht = total;
      item.unit_price = up;

      if (q > 0 && total > 0 && up > 0) {
        const ratio = (up * q) / total;
        // Correct only when egregiously off (likely OCR/format issue): >50x or <1/50x
        if (!isFinite(ratio) || ratio > 50 || ratio < 0.02) {
          item.unit_price = +(total / q).toFixed(2);
        }
      }

      // Sanitize other numeric fields if present
      if (item.net_weight != null) item.net_weight = this.parseNumericValue(item.net_weight);
      if (item.net_gold_weight != null) item.net_gold_weight = this.parseNumericValue(item.net_gold_weight);
      if (item.net_platine_weight != null) item.net_platine_weight = this.parseNumericValue(item.net_platine_weight);
      if (item.discount != null) item.discount = this.parseNumericValue(item.discount);
      return item;
    });
  }

  /**
   * Parse numeric value from string (handles European format with commas)
   */
  parseNumericValue(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

    // Keep digits, separators, minus; drop everything else (incl. currency symbols/codes)
    let s = String(value).trim();
    // Normalize common currency words/symbols quickly
    s = s.replace(/(CHF|EUR|USD|GBP|JPY|CNY|€|\$|£)\s*/gi, '');
    // Keep only digits, comma, dot, minus, and apostrophe/space as thousand markers
    s = s.replace(/[^0-9,.'\-\s]/g, '');

    // Remove spaces and apostrophes used as thousand separators
    s = s.replace(/[\s']/g, '');

    // Determine decimal separator as the last occurrence of ',' or '.'
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const lastSep = Math.max(lastComma, lastDot);
    if (lastSep !== -1) {
      const intPart = s.slice(0, lastSep).replace(/[.,]/g, '');
      const decPart = s.slice(lastSep + 1);
      s = `${intPart}.${decPart}`;
    } else {
      // No decimal separator present; ensure only digits and optional leading minus remain
      s = s.replace(/[^0-9\-]/g, '');
    }

    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Validate enhanced extraction data
   */
  validateEnhancedExtractionData(extractedData, metadata) {
    const errors = [];
    const warnings = [];
    
    // Map common field variations to canonical field names
    const mappedData = this.mapFieldVariations(extractedData);
    
    // Check required fields
    const requiredFields = ['invoice_id', 'issue_date', 'total_ttc'];
    for (const field of requiredFields) {
      if (!mappedData[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Check extraction success rate
    const summary = metadata?.extractionSummary;
    if (summary) {
      const successRate = parseFloat(summary.successRate);
      if (successRate < 30) {
        warnings.push(`Low extraction success rate: ${summary.successRate}%`);
      }
      
      // Check if too many fields need query fields
      const queryFieldsCount = summary.tierBreakdown?.Query || 0;
      if (queryFieldsCount > 10) {
        warnings.push(`Many fields require query field implementation: ${queryFieldsCount}`);
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      extractionMethod: 'enhanced'
    };
  }

  /**
   * Calculate confidence from enhanced extraction metadata
   */
  calculateEnhancedConfidence(metadata) {
    const summary = metadata?.extractionSummary;
    if (!summary) return 0.5; // Default moderate confidence
    
    const successRate = parseFloat(summary.successRate) / 100;
    const tierBreakdown = summary.tierBreakdown || {};
    
    // Weight different tiers differently
    const tierWeights = {
      Standard: 1.0,    // Highest confidence
      Intelligent: 0.8, // Good confidence
      Query: 0.6,       // Moderate confidence
      Missing: 0.0      // No confidence
    };
    
    let weightedSum = 0;
    let totalFields = 0;
    
    for (const [tier, count] of Object.entries(tierBreakdown)) {
      const weight = tierWeights[tier] || 0;
      weightedSum += count * weight;
      totalFields += count;
    }
    
    if (totalFields === 0) return 0.5;
    
    const tierConfidence = weightedSum / totalFields;
    
    // Combine success rate with tier confidence
    return Math.min(0.95, (successRate * 0.7) + (tierConfidence * 0.3));
  }

  /**
   * Check if Azure services are configured and available
   */
  async checkServiceHealth(req, res) {
    try {
      const health = {
        documentIntelligence: azureDocumentService.isConfigured(),
        enhancedExtraction: await this.enhancedAzureService.validateConfiguration(),
        openAI: azureOpenAIService.isConfigured(),
        timestamp: new Date().toISOString()
      };

      const allHealthy = Object.values(health).every(status => status === true || typeof status === 'string');

      res.json({
        success: true,
        data: {
          status: allHealthy ? 'healthy' : 'degraded',
          services: health
        }
      });

    } catch (error) {
      console.error('Service health check error:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Health check failed'
      });
    }
  }
}

module.exports = new ProcessingController();

