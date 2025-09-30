/**
 * Analyzes Azure Document Intelligence layout to derive product table hints
 * Helps the LLM understand table structure and content patterns
 */

function deriveProductTableHints(layout) {
  if (!layout || !layout.tables) {
    return { glossary: 'No tables found in document.' };
  }

  const tables = layout.tables;
  const hints = [];
  
  // Analyze each table to understand structure
  tables.forEach((table, tableIndex) => {
    if (!table.cells || table.cells.length === 0) return;
    
    // Get table dimensions
    const maxRow = Math.max(...table.cells.map(c => c.rowIndex || 0));
    const maxCol = Math.max(...table.cells.map(c => c.columnIndex || 0));
    
    // Extract headers (first row)
    const headers = [];
    for (let col = 0; col <= maxCol; col++) {
      const headerCell = table.cells.find(c => c.rowIndex === 0 && c.columnIndex === col);
      headers.push(headerCell ? (headerCell.content || '').trim() : '');
    }
    
    // Sample a few data rows
    const sampleRows = [];
    for (let row = 1; row <= Math.min(3, maxRow); row++) {
      const rowData = [];
      for (let col = 0; col <= maxCol; col++) {
        const cell = table.cells.find(c => c.rowIndex === row && c.columnIndex === col);
        rowData.push(cell ? (cell.content || '').trim() : '');
      }
      sampleRows.push(rowData);
    }
    
    // Analyze column patterns
    const columnAnalysis = headers.map((header, colIndex) => {
      const columnValues = sampleRows.map(row => row[colIndex] || '').filter(v => v);
      
      // Detect column type based on content patterns
      let type = 'text';
      if (columnValues.some(v => /^\d+[\.,]?\d*$/.test(v))) {
        type = 'numeric';
      }
      if (columnValues.some(v => /€|EUR|\$|USD|£|GBP/.test(v))) {
        type = 'currency';
      }
      if (columnValues.some(v => /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{2,4}/.test(v))) {
        type = 'date';
      }
      if (columnValues.some(v => /kg|g|lbs|oz|tons?/i.test(v))) {
        type = 'weight';
      }
      if (columnValues.some(v => /pcs?|units?|qty|pieces?/i.test(v))) {
        type = 'quantity';
      }
      
      return {
        header: header || `Column_${colIndex}`,
        type,
        sampleValues: columnValues.slice(0, 2)
      };
    });
    
    hints.push({
      tableIndex: tableIndex + 1,
      dimensions: `${maxRow + 1} rows × ${maxCol + 1} columns`,
      headers: headers.filter(h => h),
      columnTypes: columnAnalysis,
      totalCells: table.cells.length,
      hasNumericData: columnAnalysis.some(c => c.type === 'numeric' || c.type === 'currency'),
      hasWeightData: columnAnalysis.some(c => c.type === 'weight'),
      hasQuantityData: columnAnalysis.some(c => c.type === 'quantity')
    });
  });
  
  // Generate glossary text
  let glossary = `Document contains ${tables.length} table(s):\n\n`;
  
  hints.forEach(hint => {
    glossary += `Table ${hint.tableIndex} (${hint.dimensions}):\n`;
    glossary += `- Headers: ${hint.headers.join(', ')}\n`;
    
    if (hint.hasNumericData) {
      glossary += `- Contains numeric/currency data\n`;
    }
    if (hint.hasWeightData) {
      glossary += `- Contains weight measurements\n`;
    }
    if (hint.hasQuantityData) {
      glossary += `- Contains quantity information\n`;
    }
    
    // Add column type information
    const typeInfo = hint.columnTypes
      .filter(c => c.type !== 'text')
      .map(c => `${c.header}: ${c.type}`)
      .join(', ');
    
    if (typeInfo) {
      glossary += `- Column types: ${typeInfo}\n`;
    }
    
    glossary += '\n';
  });
  
  // Add extraction guidance
  glossary += 'Extraction Guidelines:\n';
  glossary += '- Extract ALL table rows as lineItems\n';
  glossary += '- Include products, fees, taxes, shipping, discounts\n';
  glossary += '- Set appropriate "type" field for each item\n';
  glossary += '- Preserve original numeric values\n';
  glossary += '- Map country names to ISO codes when possible\n';
  
  return { 
    glossary,
    tableHints: hints,
    totalTables: tables.length,
    hasTabularData: hints.some(h => h.hasNumericData)
  };
}

module.exports = { deriveProductTableHints };
