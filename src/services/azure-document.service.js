// Minimal azure-document.service.js (split-only delivery)
// This file intentionally only contains the minimal methods needed by the split
// flow (layout extraction). All heavy extraction/mapping logic is archived in
// archive/extraction/ and not present here.

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

  // Disabled heavy APIs — archived
  async mapInvoiceToSchema() { throw new Error('mapInvoiceToSchema is disabled in split-only delivery'); }
  async extractInvoiceData() { throw new Error('extractInvoiceData is disabled in split-only delivery'); }
  async executeQueryFields() { throw new Error('executeQueryFields is disabled in split-only delivery'); }
}

module.exports = new AzureDocumentLayoutService();

