/**
 * ================================================================================
 * AZURE OPENAI SERVICE - INTELLIGENT DOCUMENT ANALYSIS
 * ================================================================================
 * 
 * AI-powered service for intelligent document processing using Azure OpenAI GPT-4.
 * Specializes in invoice boundary detection and advanced field extraction.
 * 
 * 🎯 PRIMARY METHODS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 🔧 SETUP & INITIALIZATION:
 * • initialize()                           - Initialize Azure OpenAI client and deployment
 * • isConfigured()                         - Check if service is properly configured
 * 
 * 📄 INVOICE BOUNDARY DETECTION:
 * • detectInvoiceBoundaries(pages)         - Main entry point for multi-page invoice splitting
 * • getSystemPrompt()                      - System prompt for boundary detection
 * • createBoundaryDetectionPrompt(pages)   - Create formatted prompt for GPT-4
 * • parseAIResponse(response, totalPages)  - Parse GPT-4 response into structured splits
 * • validateSplits(splits, totalPages)     - Validate and fix proposed splits
 * • calculateSplitConfidence(splits, pages)- Calculate confidence scores for splits
 * 
 * 🧠 ADVANCED FIELD EXTRACTION:
 * • extractMissingFields(azure, data, fields) - LLM-based extraction for missing fields
 * • extractTaxRateFromText(text, financial)   - Extract tax rates using intelligent analysis
 * • getFieldExtractionSystemPrompt()          - System prompt for field extraction
 * • createMissingFieldsPrompt(azure, data, fields) - Create comprehensive extraction prompt
 * 
 * 📊 CONTENT ANALYSIS:
 * • extractComprehensiveAzureContent(response) - Extract all available content from Azure API
 * • extractFieldFromContent(content, field)     - Smart field extraction from text content
 * • analyzeDocumentStructure(pages)            - Analyze document layout and structure
 * 
 * 🔄 DATA PROCESSING FLOW:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * BOUNDARY DETECTION:
 * 1. Multi-page PDF → Text extraction → Page analysis
 * 2. Intelligent pattern recognition → Invoice header detection
 * 3. Content transition analysis → Boundary proposals
 * 4. Validation & confidence scoring → Final splits
 * 
 * FIELD EXTRACTION:
 * 1. Azure API Response → Comprehensive content extraction
 * 2. Missing field identification → Targeted prompts
 * 3. GPT-4 analysis → Intelligent field detection
 * 4. Confidence assessment → Validated results
 * 
 * 🔍 INTELLIGENT CAPABILITIES:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * ✅ Multi-language invoice detection (French, English, German, etc.)
 * ✅ Conservative splitting approach (minimizes false negatives)
 * ✅ Invoice pattern recognition (headers, numbers, dates, totals)
 * ✅ Content transition analysis for accurate boundaries
 * ✅ Vendor-agnostic field extraction
 * ✅ Complex table structure analysis
 * ✅ Contextual field value detection
 * ✅ Financial data reconciliation
 * ✅ Regulatory compliance field extraction
 * ✅ Confidence scoring and quality assessment
 * ✅ Fallback mechanisms for parsing failures
 * ✅ Error handling and graceful degradation
 * 
 * 📋 SUPPORTED INVOICE FORMATS:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * • Single-page invoices
 * • Multi-page invoices with continuation
 * • Multiple invoices per PDF
 * • Mixed vendor formats
 * • Various languages and currencies
 * • Complex table structures
 * • Handwritten annotations
 * • Scanned documents with OCR artifacts
 * 
 * @author Invoice Processing System
 * @version 1.1.0
 * @since 2024
 */

const azureConfig = require('../config/azure');

class AzureOpenAIService {
  constructor() {
    this.client = null;
    this.deploymentName = null;
  this.maxJsonWindowBytes = parseInt(process.env.MAX_JSON_WINDOW_BYTES || '30000', 10);
  this.llmFallbackMode = (process.env.LLM_FALLBACK_MODE || 'confirm-only').toLowerCase();
  }

  initialize() {
    try {
      // Ensure Azure config is initialized
      if (!azureConfig.openAIClient) {
        azureConfig.initialize();
      }
      this.client = azureConfig.getOpenAIClient();
      this.deploymentName = azureConfig.getOpenAIDeploymentName();
    } catch (error) {
      console.warn('Azure OpenAI not available:', error.message);
      this.client = null;
      this.deploymentName = null;
    }
  }

  /**
   * Confirm-only extractor: given small JSON windows from Azure DI, return exact substring if present.
   * Never computes or reformats. Returns null when not found verbatim in provided windows.
   */
  async confirmFromJsonWindows({ field, hints = [], windows = [] }) {
    if (!this.client) this.initialize();
    if (!this.client) throw new Error('Azure OpenAI client not available');

    // Enforce confirm-only mode
    if (this.llmFallbackMode !== 'confirm-only') {
      console.warn(`LLM_FALLBACK_MODE=${this.llmFallbackMode} (expected confirm-only). Proceeding in confirm-only semantics.`);
    }

    // Guard: no more than 3 windows; each size <= MAX_JSON_WINDOW_BYTES
    const safeWindows = (windows || [])
      .slice(0, 3)
      .map(w => ({
        text: (w.text || '').slice(0, this.maxJsonWindowBytes),
        paths: Array.isArray(w.paths) ? w.paths.slice(0, 50) : []
      }));

    const systemPrompt = `You are a strict verifier. You receive JSON snippets (not the full file) produced by Azure Document Intelligence for an invoice. Your job is to locate and return the exact substring in these snippets for a requested field, only if it appears verbatim in the snippets. Do not calculate, reformat, normalize, convert currencies, sum numbers, or infer missing data. If the requested value does not appear in the snippets, return null.`;

    const schema = {
      type: 'object',
      properties: {
        field: { type: 'string' },
        value: { type: ['string', 'null'] },
        sourcePath: { type: 'array', items: { type: 'string' } }
      },
      required: ['field', 'value']
    };

    const userPayload = {
      field,
      hints: hints || [],
      windows: safeWindows
    };

    const resp = await this.client.chat.completions.create({
      model: this.deploymentName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) }
      ],
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      tools: [
        {
          type: 'function',
          function: {
            name: 'return_result',
            description: 'Return the verbatim value if and only if it appears in the snippets.',
            parameters: schema
          }
        }
      ]
    });

    let parsed = null;
    try {
      // Prefer tool call arguments; else parse content
      const choice = resp.choices?.[0];
      const tool = choice?.message?.tool_calls?.[0];
      if (tool?.function?.arguments) {
        parsed = JSON.parse(tool.function.arguments);
      } else {
        const content = choice?.message?.content || '{}';
        parsed = JSON.parse(content);
      }
    } catch (e) {
      console.warn('confirmFromJsonWindows: JSON parse failed, treating as null', e.message);
      parsed = { field, value: null };
    }

    // Post-validation: ensure verbatim presence
    const value = parsed?.value == null ? null : String(parsed.value);
    if (value) {
      const present = safeWindows.some(w => (w.text || '').includes(value));
      if (!present) {
        return { field, value: null };
      }
    }

    return {
      field: parsed?.field || field,
      value: value || null,
      sourcePath: Array.isArray(parsed?.sourcePath) ? parsed.sourcePath : undefined
    };
  }

  /**
   * Detect invoice boundaries in a multi-page document
   * @param {Array} pages - Array of page objects with text content
   * @returns {Promise<Object>} - Proposed invoice splits
   */
  async detectInvoiceBoundaries(pages) {
    try {
      if (!this.client) {
        this.initialize();
      }

      console.log(`Analyzing ${pages.length} pages for invoice boundaries`);

      // Prepare the text content for analysis
      const pageTexts = pages.map((page, index) => ({
        pageNumber: page.pageNumber || (index + 1),
        text: page.text || '',
        wordCount: page.wordCount || 0
      }));

      // Create the prompt for GPT-4o
      const prompt = this.createBoundaryDetectionPrompt(pageTexts);

      // Call Azure OpenAI
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          {
            role: 'system',
            content: this.getSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent results
        max_tokens: 2000,
        top_p: 0.95
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error('No response from OpenAI');
      }

      const aiResponse = response.choices[0].message.content;
      console.log('AI Response:', aiResponse);

      // Parse the AI response to extract invoice boundaries
      const proposedSplits = this.parseAIResponse(aiResponse, pages.length);

      // Validate the proposed splits
      const validatedSplits = this.validateSplits(proposedSplits, pages.length);

      console.log(`Boundary detection completed: ${validatedSplits.length} invoices detected`);

      return {
        success: true,
        totalPages: pages.length,
        invoiceCount: validatedSplits.length,
        proposedSplits: validatedSplits,
        aiResponse: aiResponse,
        metadata: {
          analyzedAt: new Date().toISOString(),
          model: this.deploymentName,
          confidence: this.calculateSplitConfidence(validatedSplits, pageTexts)
        }
      };

    } catch (error) {
      console.error('Error detecting invoice boundaries:', error);
      return {
        success: false,
        error: error.message,
        totalPages: pages.length,
        invoiceCount: 0,
        proposedSplits: []
      };
    }
  }

  /**
   * Get the system prompt for invoice boundary detection
   * @returns {string} - System prompt
   */
  getSystemPrompt() {
    return `You are an expert AI assistant specialized in analyzing multi-page PDF documents containing multiple invoices. Your task is to identify where each individual invoice begins and ends.

IMPORTANT GUIDELINES:
1. Be CONSERVATIVE - prefer false positives (suggesting a split that might be wrong) over false negatives (missing a split)
2. Look for clear invoice indicators: headers, invoice numbers, dates, vendor information, totals
3. Consider page breaks, formatting changes, and content transitions
4. Each invoice typically contains: header, line items, subtotals, taxes, and total amounts
5. Invoices from the same vendor may have similar formatting
6. Some invoices may span multiple pages
7. Some pages may contain multiple invoices

RESPONSE FORMAT:
Respond with a JSON array of invoice objects. Each object should have:
- "invoiceNumber": estimated invoice number or identifier (if found)
- "startPage": first page number of the invoice
- "endPage": last page number of the invoice  
- "confidence": your confidence level (0.0 to 1.0)
- "reasoning": brief explanation of why you identified this as an invoice

Example response:
[
  {
    "invoiceNumber": "INV-2024-001",
    "startPage": 1,
    "endPage": 2,
    "confidence": 0.95,
    "reasoning": "Clear invoice header with number, vendor info, and itemized billing"
  },
  {
    "invoiceNumber": "INV-2024-002", 
    "startPage": 3,
    "endPage": 3,
    "confidence": 0.87,
    "reasoning": "Single page invoice with complete billing information"
  }
]`;
  }

  /**
   * Create the boundary detection prompt
   * @param {Array} pageTexts - Array of page text objects
   * @returns {string} - Formatted prompt
   */
  createBoundaryDetectionPrompt(pageTexts) {
    let prompt = `Please analyze the following ${pageTexts.length} pages of text and identify individual invoice boundaries:\n\n`;

    pageTexts.forEach((page) => {
      prompt += `--- PAGE ${page.pageNumber} (${page.wordCount} words) ---\n`;
      prompt += page.text.substring(0, 2000); // Limit text to avoid token limits
      if (page.text.length > 2000) {
        prompt += '\n[... text truncated ...]';
      }
      prompt += '\n\n';
    });

    prompt += `\nBased on the above content, identify each individual invoice and provide the page ranges. Remember to be conservative and prefer suggesting splits that might be wrong rather than missing actual invoice boundaries.`;

    return prompt;
  }

  /**
   * Parse AI response to extract invoice boundaries
   * @param {string} aiResponse - Raw AI response
   * @param {number} totalPages - Total number of pages
   * @returns {Array} - Parsed invoice splits
   */
  parseAIResponse(aiResponse, totalPages) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in AI response');
      }

      const parsedSplits = JSON.parse(jsonMatch[0]);
      
      if (!Array.isArray(parsedSplits)) {
        throw new Error('AI response is not an array');
      }

      return parsedSplits.map((split, index) => ({
        id: `invoice_${index + 1}`,
        invoiceNumber: split.invoiceNumber || `Invoice ${index + 1}`,
        startPage: parseInt(split.startPage) || 1,
        endPage: parseInt(split.endPage) || 1,
        confidence: parseFloat(split.confidence) || 0.5,
        reasoning: split.reasoning || 'AI detected invoice pattern',
        pageRange: `${split.startPage}-${split.endPage}`
      }));

    } catch (error) {
      console.warn('Failed to parse AI response as JSON, using fallback:', error.message);
      
      // Fallback: create a single invoice spanning all pages
      return [{
        id: 'invoice_1',
        invoiceNumber: 'Invoice 1',
        startPage: 1,
        endPage: totalPages,
        confidence: 0.3,
        reasoning: 'Fallback: Could not parse AI response, treating as single invoice',
        pageRange: `1-${totalPages}`
      }];
    }
  }

  /**
   * Validate and fix proposed splits
   * @param {Array} splits - Proposed splits from AI
   * @param {number} totalPages - Total number of pages
   * @returns {Array} - Validated splits
   */
  validateSplits(splits, totalPages) {
    if (!splits || splits.length === 0) {
      // No splits detected, treat as single invoice
      return [{
        id: 'invoice_1',
        invoiceNumber: 'Invoice 1',
        startPage: 1,
        endPage: totalPages,
        confidence: 0.3,
        reasoning: 'No splits detected, treating as single invoice',
        pageRange: `1-${totalPages}`
      }];
    }

    // Sort splits by start page
    splits.sort((a, b) => a.startPage - b.startPage);

    // Validate and fix overlaps/gaps
    const validatedSplits = [];
    let currentPage = 1;

    splits.forEach((split, index) => {
      // Ensure start page is not less than current page
      const startPage = Math.max(split.startPage, currentPage);
      
      // Ensure end page is not greater than total pages
      const endPage = Math.min(split.endPage, totalPages);
      
      // Ensure end page is not less than start page
      const finalEndPage = Math.max(endPage, startPage);

      if (startPage <= totalPages) {
        validatedSplits.push({
          ...split,
          startPage,
          endPage: finalEndPage,
          pageRange: `${startPage}-${finalEndPage}`
        });

        currentPage = finalEndPage + 1;
      }
    });

    // If there are remaining pages, add them to the last invoice or create a new one
    if (currentPage <= totalPages) {
      if (validatedSplits.length > 0) {
        // Extend the last invoice
        const lastSplit = validatedSplits[validatedSplits.length - 1];
        lastSplit.endPage = totalPages;
        lastSplit.pageRange = `${lastSplit.startPage}-${totalPages}`;
      } else {
        // Create a new invoice for remaining pages
        validatedSplits.push({
          id: 'invoice_1',
          invoiceNumber: 'Invoice 1',
          startPage: currentPage,
          endPage: totalPages,
          confidence: 0.3,
          reasoning: 'Remaining pages after validation',
          pageRange: `${currentPage}-${totalPages}`
        });
      }
    }

    return validatedSplits;
  }

  /**
   * Calculate confidence score for the splits
   * @param {Array} splits - Validated splits
   * @param {Array} pageTexts - Original page texts
   * @returns {number} - Overall confidence (0-1)
   */
  calculateSplitConfidence(splits, pageTexts) {
    if (!splits || splits.length === 0) return 0;

    const confidenceScores = splits.map(split => split.confidence || 0);
    return confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
  }

  /**
   * Extract tax rate information from document text using LLM
   * @param {string} documentText - The document text content
   * @param {Object} financialData - Current extracted financial data
   * @returns {Promise<Object>} - Tax rate extraction result
   */
  async extractTaxRateFromText(documentText, financialData = {}) {
    try {
      if (!this.client) {
        this.initialize();
      }

      if (!this.client) {
        throw new Error('Azure OpenAI client not available');
      }

      const prompt = `You are an expert at extracting tax rate information from French and English invoices.

DOCUMENT TEXT:
${documentText}

CURRENT FINANCIAL DATA:
- Total TTC (with tax): ${financialData.total_ttc || 'not found'}
- Total HT (without tax): ${financialData.total_ht || 'not found'}
- Tax Amount: ${financialData.tax_amount || 'not found'}

TASK: Find the TAX RATE percentage from the document text.

Look for these patterns in French and English:
- TVA: 20%, TVA 20.00%, Taux TVA: 20%
- VAT: 20%, VAT Rate: 20%, Tax Rate: 20%
- Taux: 20%, Rate: 20%
- Any percentage number near words like TVA, VAT, Tax, Taux

IMPORTANT: 
- Return ONLY the percentage number (e.g., 20 for 20%, 0.30 for 0.30%)
- If you find "20%" return 20
- If you find "0.30%" return 0.30
- If multiple tax rates exist, return the main VAT/TVA rate
- If no explicit tax rate is found, return null

Response format (JSON only):
{
  "tax_rate": number or null,
  "confidence": number between 0-1,
  "evidence": "exact text where you found the rate",
  "method": "direct_extraction" or "calculation" or "not_found"
}`;

      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          {
            role: 'system',
            content: 'You are a precise document analysis assistant. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1,
        max_tokens: 500
      });

      let responseText = response.choices[0].message.content.trim();
      
      // Remove markdown code blocks if present
      responseText = responseText.replace(/```json\s*/, '').replace(/```\s*$/, '');
      
      const result = JSON.parse(responseText);
      
      console.log(`🤖 LLM Tax Rate Extraction:`, result);

      return {
        success: true,
        ...result
      };

    } catch (error) {
      console.error('Error in LLM tax rate extraction:', error);
      return {
        success: false,
        error: error.message,
        tax_rate: null,
        confidence: 0,
        evidence: '',
        method: 'error'
      };
    }
  }

  /**
   * Enhanced LLM-based field extraction for missing data
   * Uses the full Azure API JSON response to find missing fields intelligently
   * @param {Object} azureResponse - Complete Azure Document Intelligence API response
   * @param {Object} currentData - Currently extracted data with gaps
   * @param {Array} missingFields - List of field names that are missing or empty
   * @returns {Promise<Object>} - Enhanced extraction results
   */
  async extractMissingFields(azureResponse, currentData, missingFields) {
    try {
      if (!this.client) {
        this.initialize();
      }

      if (!this.client) {
        throw new Error('Azure OpenAI client not available');
      }

      console.log(`🔍 LLM extracting ${missingFields.length} missing fields:`, missingFields);

      // Create enhanced prompt with schema awareness
      const prompt = this.createMissingFieldsPrompt(azureResponse, currentData, missingFields);

      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        messages: [
          {
            role: 'system',
            content: this.getFieldExtractionSystemPrompt()
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 4000,
        top_p: 0.95
      });

      let responseText = response.choices[0].message.content.trim();
      
      // Clean up response format
      responseText = responseText.replace(/```json\s*/, '').replace(/```\s*$/, '');
      
      const extractedFields = JSON.parse(responseText);
      
      console.log(`✅ LLM extracted missing fields:`, Object.keys(extractedFields.fields || {}));

      return {
        success: true,
        fields: extractedFields.fields || {},
        confidence: extractedFields.confidence || {},
        evidence: extractedFields.evidence || {},
        method: 'llm_extraction',
        model: this.deploymentName,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error in LLM missing fields extraction:', error);
      return {
        success: false,
        error: error.message,
        fields: {},
        confidence: {},
        evidence: {},
        method: 'error'
      };
    }
  }

  /**
   * System prompt for field extraction
   * @returns {string} - System prompt
   */
  getFieldExtractionSystemPrompt() {
    return `You are an expert invoice data extraction AI specializing in finding missing fields from comprehensive Azure Document Intelligence API responses.

CORE MISSION: Extract missing invoice fields by intelligently searching through ALL available data in the Azure JSON response.

AZURE API DATA SOURCES TO ANALYZE:
1. 📄 pages[].words[] - Individual words with positioning
2. 📄 pages[].lines[] - Text lines with structure
3. 📊 tables[].cells[] - Structured table data
4. 🔑 keyValuePairs[] - Detected key-value relationships
5. 📝 paragraphs[] - Structured paragraph content
6. 🔍 Word context - Surrounding text analysis

EXTRACTION CAPABILITIES:
- Multi-language support (French, English, German, Italian, Spanish)
- Vendor-agnostic pattern recognition
- Complex table structure analysis
- Contextual field relationship understanding
- Intelligent field value validation

SEARCH METHODOLOGY:
1. Start with high-confidence keyValuePairs[]
2. Search tables for structured data (especially items)
3. Analyze word context around key terms
4. Use paragraph structure for addresses/descriptions
5. Apply pattern matching across all text sources

VENDOR PATTERNS TO RECOGNIZE:
- HERMÈS: "N° (Facture)", "Votre no cde", French formatting
- CHANEL: "CHE004 SF032191", "Numéro de P.O"
- BASF: "Invoice Number", "Your Order No."
- BRAGARD: "FACTURE N°", French patterns
- BUCHER: "Order-No.:", "Rechnung-Nr."
- EUGSTER: "FACTURE", "N/commande no.:"

EXTRACTION PRECISION:
- Extract exact values without modification
- Maintain original formatting and capitalization
- For numerical fields, preserve decimal precision
- For dates, keep original format
- For item arrays, maintain table row order

CONFIDENCE SCORING:
- 0.9-1.0: Found in keyValuePairs with high confidence
- 0.8-0.9: Found in table structure with clear context
- 0.7-0.8: Found in text with strong contextual clues
- 0.6-0.7: Found via pattern matching
- 0.5-0.6: Inferred from surrounding content

RESPONSE FORMAT: Return ONLY valid JSON:
{
  "fields": {
    "field_name": "extracted_value",
    "another_field": "another_value"
  },
  "confidence": {
    "field_name": 0.95,
    "another_field": 0.80
  },
  "evidence": {
    "field_name": "Found in keyValuePairs: 'Invoice Number' → '123456'",
    "another_field": "Table cell at row 2, col 3: 'PO: ABC123'"
  }
}`;
  }

  /**
   * Create detailed prompt for missing fields extraction
   * @param {Object} azureResponse - Azure API response
   * @param {Object} currentData - Current extracted data
   * @param {Array} missingFields - Missing field names
   * @returns {string} - Formatted prompt
   */
  createMissingFieldsPrompt(azureResponse, currentData, missingFields) {
    // Extract comprehensive data from Azure response
    const documentContent = this.extractComprehensiveAzureContent(azureResponse);
    
    let prompt = `TASK: Extract the following missing invoice fields from the complete Azure Document Intelligence API response.

MISSING FIELDS TO FIND:
${missingFields.map(field => `- ${field}`).join('\n')}

CURRENT EXTRACTED DATA (for context):
${JSON.stringify(currentData, null, 2)}

COMPREHENSIVE AZURE API DATA ANALYSIS:
`;

    // Add all available content sources
    if (documentContent.pages && documentContent.pages.length > 0) {
      prompt += `\n📄 DOCUMENT TEXT CONTENT:\n`;
      documentContent.pages.forEach((page, idx) => {
        prompt += `--- Page ${idx + 1} ---\n${page.text.substring(0, 1500)}${page.text.length > 1500 ? '\n[...truncated...]' : ''}\n\n`;
      });
    }

    // Add comprehensive table analysis
    if (documentContent.tables && documentContent.tables.length > 0) {
      prompt += `\n📊 TABLE STRUCTURES AND CONTENT:\n`;
      documentContent.tables.forEach((table, idx) => {
        prompt += `--- Table ${idx + 1} (${table.rowCount} rows × ${table.columnCount} cols) ---\n`;
        if (table.headers.length > 0) {
          prompt += `Headers: ${table.headers.join(' | ')}\n`;
        }
        prompt += `All table content:\n`;
        table.allRows.slice(0, 10).forEach((row, rowIdx) => {
          prompt += `Row ${rowIdx}: ${row.join(' | ')}\n`;
        });
        if (table.allRows.length > 10) {
          prompt += `... and ${table.allRows.length - 10} more rows\n`;
        }
        prompt += `\n`;
      });
    }

    // Add key-value pairs with enhanced context
    if (documentContent.keyValuePairs && documentContent.keyValuePairs.length > 0) {
      prompt += `\n🔑 KEY-VALUE PAIRS DETECTED:\n`;
      documentContent.keyValuePairs.forEach(kvp => {
        prompt += `"${kvp.key}" → "${kvp.value}" (confidence: ${kvp.confidence})\n`;
      });
    }

    // Add paragraph content
    if (documentContent.paragraphs && documentContent.paragraphs.length > 0) {
      prompt += `\n📝 STRUCTURED PARAGRAPHS:\n`;
      documentContent.paragraphs.slice(0, 15).forEach((para, idx) => {
        prompt += `Para ${idx + 1}: ${para.content.substring(0, 200)}${para.content.length > 200 ? '...' : ''}\n`;
      });
    }

    // Add word-level context for precise extraction
    if (documentContent.wordContext && documentContent.wordContext.length > 0) {
      prompt += `\n🔍 CONTEXTUAL WORD ANALYSIS:\n`;
      documentContent.wordContext.forEach(context => {
        prompt += `Near "${context.keyword}": ${context.surroundingText}\n`;
      });
    }

    prompt += `\n🎯 ENHANCED EXTRACTION GUIDELINES:

SEARCH STRATEGIES:
1. Look in ALL data sources: pages, tables, keyValuePairs, paragraphs
2. Search for field variations in multiple languages (French, English, German, Italian)
3. Use contextual clues and document structure patterns
4. For item-level fields, analyze table rows and cells comprehensively
5. Consider vendor-specific formatting patterns

FIELD-SPECIFIC SEARCH PATTERNS:
- invoice_id: "Facture", "Invoice", "INV", "CHE", "SF", "No.", "N°", "#"
- po_number: "PO", "Order", "Command", "Commande", "Your Order", "P.O", "Ref"
- client_order: "Client", "Customer", "Ref Client", "Order Ref"
- payment_terms: "Net", "Days", "Payable", "Payment", "Terme"
- made_in: "Made in", "Origin", "Country", "Fabrique", "Herkunft" (MUST be actual country name, NOT table headers like "Unit", "Code")
- reference: "Ref", "SKU", "Model", "Code", "Article" (MUST be actual product reference, NOT generic words)
- size: Product size/dimension specification (MUST be actual size like "12MM", "Large", NOT table headers like "Code")
- weights: Look for "g", "gr", "gram", "weight", "poids", "oro", "platino"

CRITICAL ITEM-LEVEL EXTRACTION RULES:
1. For item arrays, analyze table structure carefully - distinguish headers from data
2. made_in MUST be actual country (Switzerland, France, Italy) NOT table headers (Unit, Code, Description)
3. size MUST be actual size specification (12MM, Large, XL) NOT column headers (Code, Ref)
4. reference MUST be actual product code/SKU NOT generic terms (Ref, Article)
5. Validate extracted values make logical sense for the field type
6. If uncertain between header and data, prefer data from table cells not headers

VALIDATION CHECKS:
- made_in: Must be valid country name (Switzerland, France, Italy, etc.)
- size: Must be dimension/size (MM, CM, Small, Large, XL, etc.)
- reference: Must be alphanumeric product code/SKU
- quantity: Must be positive number
- weights: Must be numeric with weight units (g, gr, kg)

DATE FORMAT REQUIREMENTS:
- ALL dates must be returned in ISO format: YYYY-MM-DD
- Convert DD/MM/YYYY → YYYY-MM-DD
- Convert DD.MM.YYYY → YYYY-MM-DD  
- Convert MM/DD/YYYY → YYYY-MM-DD
- Examples: "21.09.2025" → "2025-09-21", "30/05/2025" → "2025-05-30"

NUMERIC FORMAT REQUIREMENTS:
- Return numbers as strings with decimal notation
- Use dot (.) for decimals, not comma
- Remove currency symbols and thousand separators
- Examples: "2,378.02 CHF" → "2378.02", "6 834,99 €" → "6834.99"

EXTRACTION RULES:
- Extract exact values, then normalize format as specified above
- For arrays (items), maintain order matching table rows
- Provide high confidence only when evidence is clear
- Include specific evidence showing where data was found

Return ONLY valid JSON in this format:
{
  "fields": {
    "issue_date": "2025-08-15",
    "due_date": "2025-09-21",
    "total_ht": "2378.02"
  },
  "confidence": {
    "issue_date": 0.95,
    "due_date": 0.95,
    "total_ht": 0.90
  },
  "evidence": {
    "issue_date": "Found in table cell at row 3, col 2: 'Date: 15.08.2025'",
    "due_date": "Found in payment terms: 'Up to 21.09.2025'",
    "total_ht": "Found in totals section: 'Sum total 2,378.02 CHF'"
  }
}`;

    return prompt;
  }

  /**
   * Extract comprehensive content from Azure API response
   * @param {Object} azureResponse - Azure API response
   * @returns {Object} - Comprehensive structured content
   */
  extractComprehensiveAzureContent(azureResponse) {
    const content = {
      pages: [],
      tables: [],
      keyValuePairs: [],
      paragraphs: [],
      wordContext: []
    };

    try {
      const analyzeResult = azureResponse.analyzeResult || azureResponse;

      // Extract comprehensive page content
      if (analyzeResult.pages) {
        content.pages = analyzeResult.pages.map(page => ({
          pageNumber: page.pageNumber || 1,
          text: this.extractPageText(page),
          words: page.words || [],
          lines: page.lines || [],
          wordCount: (page.words || []).length
        }));
      }

      // Extract comprehensive table data
      if (analyzeResult.tables) {
        content.tables = analyzeResult.tables.map((table, idx) => {
          const cells = table.cells || [];
          
          // Get headers (first row)
          const headers = cells
            .filter(cell => cell.rowIndex === 0)
            .sort((a, b) => a.columnIndex - b.columnIndex)
            .map(cell => cell.content || '');
          
          // Get ALL rows, not just samples
          const allRows = [];
          for (let row = 0; row < (table.rowCount || 10); row++) {
            const rowCells = cells
              .filter(cell => cell.rowIndex === row)
              .sort((a, b) => a.columnIndex - b.columnIndex)
              .map(cell => cell.content || '');
            if (rowCells.length > 0) {
              allRows.push(rowCells);
            }
          }

          return {
            tableIndex: idx,
            rowCount: table.rowCount || 0,
            columnCount: table.columnCount || 0,
            headers,
            allRows, // Complete table data instead of just samples
            cellsByPosition: this.organizeCellsByPosition(cells)
          };
        });
      }

      // Extract enhanced key-value pairs
      if (analyzeResult.keyValuePairs) {
        content.keyValuePairs = analyzeResult.keyValuePairs
          .filter(kvp => kvp.key && kvp.value)
          .map(kvp => ({
            key: (kvp.key.content || kvp.key).trim(),
            value: (kvp.value.content || kvp.value).trim(),
            confidence: kvp.confidence || 0,
            keyBoundingBox: kvp.key.boundingBox || null,
            valueBoundingBox: kvp.value.boundingBox || null
          }))
          .sort((a, b) => b.confidence - a.confidence); // Sort by confidence
      }

      // Extract paragraphs for structured content
      if (analyzeResult.paragraphs) {
        content.paragraphs = analyzeResult.paragraphs.map(para => ({
          content: para.content || '',
          boundingBox: para.boundingBox || null,
          spans: para.spans || []
        }));
      }

      // Create contextual word analysis for key terms
      content.wordContext = this.extractWordContext(analyzeResult, [
        'PO', 'Order', 'Commande', 'Ref', 'Client', 'Made', 'Origin', 
        'Country', 'Poids', 'Weight', 'Gram', 'Invoice', 'Facture',
        'Payment', 'Due', 'Net', 'Total', 'TVA', 'VAT', 'HT', 'TTC'
      ]);

    } catch (error) {
      console.warn('Error extracting comprehensive Azure content:', error);
    }

    return content;
  }

  /**
   * Organize table cells by position for easier access
   * @param {Array} cells - Table cells
   * @returns {Object} - Cells organized by row and column
   */
  organizeCellsByPosition(cells) {
    const organized = {};
    cells.forEach(cell => {
      const row = cell.rowIndex || 0;
      const col = cell.columnIndex || 0;
      if (!organized[row]) organized[row] = {};
      organized[row][col] = {
        content: cell.content || '',
        confidence: cell.confidence || 0,
        boundingBox: cell.boundingBox || null
      };
    });
    return organized;
  }

  /**
   * Extract word context around key terms
   * @param {Object} analyzeResult - Azure analyze result
   * @param {Array} keywords - Keywords to find context for
   * @returns {Array} - Context information
   */
  extractWordContext(analyzeResult, keywords) {
    const contexts = [];
    
    if (!analyzeResult.pages) return contexts;

    analyzeResult.pages.forEach(page => {
      if (!page.words) return;

      keywords.forEach(keyword => {
        page.words.forEach((word, wordIndex) => {
          if (word.content.toLowerCase().includes(keyword.toLowerCase())) {
            // Get surrounding words for context
            const start = Math.max(0, wordIndex - 10);
            const end = Math.min(page.words.length, wordIndex + 10);
            const surroundingWords = page.words.slice(start, end);
            
            contexts.push({
              keyword: keyword,
              matchedWord: word.content,
              surroundingText: surroundingWords.map(w => w.content).join(' '),
              pageNumber: page.pageNumber || 1,
              confidence: word.confidence || 0
            });
          }
        });
      });
    });

    return contexts;
  }

  /**
   * Extract text from Azure page object
   * @param {Object} page - Azure page object
   * @returns {string} - Extracted text
   */
  extractPageText(page) {
    let text = '';
    
    if (page.words) {
      // Use words with positioning for better context
      text = page.words.map(word => word.content).join(' ');
    } else if (page.lines) {
      // Fallback to lines
      text = page.lines.map(line => line.content).join('\n');
    }
    
    return text;
  }

  /**
   * Extract specific field value from Azure response using LLM
   * @param {Object} azureResponse - Azure API response
   * @param {string} fieldName - Field name to extract
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} - Field extraction result
   */
  async extractSingleField(azureResponse, fieldName, context = {}) {
    try {
      const result = await this.extractMissingFields(azureResponse, context, [fieldName]);
      
      if (result.success && result.fields[fieldName]) {
        return {
          success: true,
          value: result.fields[fieldName],
          confidence: result.confidence[fieldName] || 0,
          evidence: result.evidence[fieldName] || '',
          method: 'llm_single_field'
        };
      }

      return {
        success: false,
        value: null,
        confidence: 0,
        evidence: 'Field not found',
        method: 'llm_single_field'
      };

    } catch (error) {
      console.error(`Error extracting single field ${fieldName}:`, error);
      return {
        success: false,
        value: null,
        confidence: 0,
        evidence: error.message,
        method: 'error'
      };
    }
  }

  /**
   * Check if the service is properly configured
   * @returns {boolean} - True if configured
   */
  isConfigured() {
    try {
      return !!(azureConfig.getOpenAIClient() && azureConfig.getOpenAIDeploymentName());
    } catch (error) {
      return false;
    }
  }
}

module.exports = new AzureOpenAIService();

