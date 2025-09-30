// Azure Document Intelligence Layout Service
// Handles PDF layout extraction using Azure Document Intelligence prebuilt-layout model
// Flow: PDF → Azure DI Layout API → Layout JSON → OpenAI Processing → Structured Data

const fs = require('fs');

class AzureDocumentLayoutService {
  constructor() {
    this.client = null;
  }

  async initialize() {
    if (this.client) return;
    try {
      const cfg = require('../config/azure');
      if (cfg && typeof cfg.initialize === 'function') cfg.initialize();
      if (cfg && typeof cfg.getFormRecognizerClient === 'function') this.client = cfg.getFormRecognizerClient();
    } catch (e) {
      console.error('Failed to initialize Azure Document Intelligence client:', e.message);
      this.client = null;
    }
  }

  // Extracts simple page-level text using Azure Document Intelligence prebuilt-layout
  async extractTextFromPDF(filePath) {
    try {
      await this.initialize();
      const pdfBuffer = fs.readFileSync(filePath);
      if (!this.client) return { success: false, error: 'Azure Form Recognizer client not configured', pages: [] };

      const poller = await this.client.beginAnalyzeDocument('prebuilt-layout', pdfBuffer);
      const result = await poller.pollUntilDone();
      if (!result || !result.pages) return { success: false, error: 'No pages found', pages: [] };

      const pages = result.pages.map(pg => {
        const pageNumber = pg.pageNumber;
        let text = '';
        if (result.paragraphs) {
          const pageParagraphs = result.paragraphs.filter(p => p.boundingRegions && p.boundingRegions.some(br => br.pageNumber === pageNumber));
          text = pageParagraphs.map(p => p.content).join('\n');
        }
        if (!text && pg.lines) text = pg.lines.map(l => l.content).join('\n');
        return { pageNumber, text: (text || '').trim(), wordCount: (text || '').split(/\s+/).filter(Boolean).length };
      });

      return { success: true, pages, totalPages: pages.length, totalWords: pages.reduce((s, p) => s + p.wordCount, 0) };
    } catch (err) {
      return { success: false, error: err.message || String(err), pages: [] };
    }
  }

  isConfigured() { return !!this.client; }

  // Get complete layout JSON from PDF for extraction processing
  async getLayoutFromPDF(filePath) {
    try {
      await this.initialize();
      if (!this.client) {
        return { success: false, error: 'Azure Document Intelligence client not configured' };
      }

      const pdfBuffer = fs.readFileSync(filePath);
      console.log(`Analyzing PDF with Azure Document Intelligence Layout API...`);
      
      // Use prebuilt-layout model to extract complete document structure
      const poller = await this.client.beginAnalyzeDocument('prebuilt-layout', pdfBuffer);
      const result = await poller.pollUntilDone();
      
      if (!result) {
        return { success: false, error: 'No result from Azure Document Intelligence' };
      }

      // Return complete layout structure for OpenAI processing
      const layout = {
        content: result.content || '',
        pages: result.pages || [],
        tables: result.tables || [],
        paragraphs: result.paragraphs || [],
        keyValuePairs: result.keyValuePairs || []
      };

      console.log(`Layout extraction successful: ${layout.pages.length} pages, ${layout.tables.length} tables`);
      return { success: true, layout };
      
    } catch (error) {
      console.error('Layout extraction error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Disabled heavy APIs — archived
  async mapInvoiceToSchema() { throw new Error('mapInvoiceToSchema is disabled in split-only delivery'); }
  async extractInvoiceData() { throw new Error('extractInvoiceData is disabled in split-only delivery'); }
  async executeQueryFields() { throw new Error('executeQueryFields is disabled in split-only delivery'); }
}

module.exports = new AzureDocumentLayoutService();

