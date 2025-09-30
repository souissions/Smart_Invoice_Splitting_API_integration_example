const azureConfig = require('../../config/azure');
const { deriveProductTableHints } = require('./deriveProductTableHints');
const { buildExtractPrompt } = require('../../prompts/extractInvoice');
const { InvoiceExtractSchema } = require('../../validation/invoice-extract.zod');
const { normalizeInvoice } = require('./extractFromLayout');

async function callAzureOpenAI({ system, user }) {
  if (!azureConfig.openAIClient) {
    azureConfig.initialize();
  }
  const client = azureConfig.getOpenAIClient();
  const deployment = azureConfig.getOpenAIDeploymentName();

  const resp = await client.chat.completions.create({
    model: deployment,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ],
    temperature: 0,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });
  const content = resp?.choices?.[0]?.message?.content?.trim() || '{}';
  return content;
}

/**
 * Extract from large layouts by chunking tables into smaller batches
 */
async function extractFromLayoutChunked(layout) {
  if (!layout || typeof layout !== 'object') throw new Error('layout payload required');

  console.log('📊 Processing layout with', layout.tables?.length || 0, 'tables');

  const tables = layout.tables || [];
  const CHUNK_SIZE = 10; // Process 10 tables at a time
  const allLineItems = [];
  let totalProcessed = 0;

  // Process tables in chunks
  for (let i = 0; i < tables.length; i += CHUNK_SIZE) {
    const chunk = tables.slice(i, i + CHUNK_SIZE);
    const chunkLayout = {
      ...layout,
      tables: chunk
    };

    console.log(`🔄 Processing chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(tables.length/CHUNK_SIZE)} (${chunk.length} tables)`);

    try {
      const { glossary } = deriveProductTableHints(chunkLayout);

      // Build focused content for this chunk
      let chunkContent = layout.content || '';
      
      // If content is too large, create a summary focusing on tables
      if (chunkContent.length > 10000) {
        chunkContent = `Document chunk ${Math.floor(i/CHUNK_SIZE) + 1} with ${chunk.length} tables:\n\n`;
        chunk.forEach((table, idx) => {
          const headerCells = table.cells?.filter(c => c.rowIndex === 0) || [];
          const headers = headerCells
            .sort((a, b) => a.columnIndex - b.columnIndex)
            .map(c => c.content || '');
          chunkContent += `Table ${i + idx + 1}: ${headers.join(', ')}\n`;
          
          // Add a few sample rows
          const sampleRows = table.cells?.filter(c => c.rowIndex > 0 && c.rowIndex <= 3) || [];
          const rowData = {};
          sampleRows.forEach(cell => {
            if (!rowData[cell.rowIndex]) rowData[cell.rowIndex] = [];
            rowData[cell.rowIndex][cell.columnIndex] = cell.content || '';
          });
          
          Object.values(rowData).forEach((row, rowIdx) => {
            chunkContent += `Row ${rowIdx + 1}: ${row.join(' | ')}\n`;
          });
          chunkContent += '\n';
        });
      }

      const interfaceCode = `export interface InvoiceExtract {
  lineItems: Array<{
    productCode?: string;
    description?: string;
    hsCode?: string;
    originCountry?: string;
    totalAmount?: number;
    netWeight?: number;
    grossWeight?: number;
    quantity?: number;
    UOM?: string;
    type?: string; // 'product', 'shipping', 'tax', 'fee', 'discount', 'other'
    rate?: number;
    baseAmount?: number;
    currency?: string;
    category?: string;
  }>;
}`;

      const { system, user } = buildExtractPrompt({
        markdown: chunkContent,
        tablesGlossary: glossary,
        interfaceCode,
      });

      // Call LLM
      let raw = '{}';
      try {
        raw = await callAzureOpenAI({ system, user });
        console.log(`✅ Chunk ${Math.floor(i/CHUNK_SIZE) + 1} LLM response: ${raw.length} chars`);
      } catch (err) {
        console.error(`❌ Chunk ${Math.floor(i/CHUNK_SIZE) + 1} LLM failed:`, err.message);
        continue; // Skip this chunk but continue with others
      }

      // Parse response
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        console.error(`❌ Chunk ${Math.floor(i/CHUNK_SIZE) + 1} JSON parse error:`, e.message);
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
        try {
          parsed = JSON.parse(cleaned);
        } catch (e2) {
          console.error(`❌ Chunk ${Math.floor(i/CHUNK_SIZE) + 1} cleanup failed, skipping`);
          continue;
        }
      }

      // Validate and collect items
      if (parsed.lineItems && Array.isArray(parsed.lineItems)) {
        allLineItems.push(...parsed.lineItems);
        totalProcessed += parsed.lineItems.length;
        console.log(`📦 Chunk ${Math.floor(i/CHUNK_SIZE) + 1} added ${parsed.lineItems.length} items (total: ${totalProcessed})`);
      }

    } catch (error) {
      console.error(`❌ Chunk ${Math.floor(i/CHUNK_SIZE) + 1} failed:`, error.message);
      continue; // Continue with next chunk
    }
  }

  console.log(`🎉 Extraction complete! Total items: ${allLineItems.length}`);

  // Create final extract
  const extract = {
    lineItems: allLineItems,
    totalsAndSubtotals: [],
    basicInformation: [],
    importer: [],
    exporter: []
  };

  // Validate final result
  const validated = InvoiceExtractSchema.parse(extract);
  const { normalized, diagnostics } = normalizeInvoice(validated);

  return { extract: normalized, diagnostics };
}

module.exports = { extractFromLayoutChunked };
