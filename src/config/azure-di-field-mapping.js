/**
 * ================================================================================
 * AZURE DOCUMENT INTELLIGENCE FIELD MAPPING CONFIGURATION
 * ================================================================================
 * 
 * This configuration defines the mapping between Azure DI standard fields
 * and our target schema fields, categorized by extraction method.
 * 
 * 🟢 STANDARD FIELDS: Extracted automatically by Azure DI
 * 🟡 QUERY FIELDS: Require specific field queries (limited to 20 per request)
 * 🔴 LLM FIELDS: Require LLM extraction for complex calculations
 * 
 * Updated: September 2, 2025
 * Source: Azure DI Invoice Schema 2024-11-30-ga
 */

class AzureDIFieldMapping {
  constructor() {
    // Azure DI Standard Fields - Extracted automatically (corrected based on JSON analysis)
    this.standardFields = {
  // Basic Invoice Information (validated in brut JSON samples)
  'invoice_id': 'InvoiceId', // Confirmed present in Azure DI invoice responses
      'issue_date': 'InvoiceDate',   // May be missing - check alternative names
      'due_date': 'DueDate',
      'po_number': 'PurchaseOrder',
      'payment_terms': 'PaymentTerm',  // Confirmed: Azure DI uses 'PaymentTerm' not 'PaymentTerms'
      
      // Vendor/Exporter Information
      'exporter_name': 'VendorName',   // Confirmed working
      'exporter_address': 'VendorAddress', // Full address
      
      // Customer/Importer Information  
      'importer_name': 'CustomerName', // May be missing - needs investigation
      'importer_address': 'CustomerAddress', // Full address
      
      // Financial Totals (confirmed working with currency structure)
      'total_ht': 'SubTotal.amount',      // SubTotal.valueCurrency.amount
      'total_ttc': 'InvoiceTotal.amount', // InvoiceTotal.valueCurrency.amount - WORKING
  'currency': 'InvoiceTotal.currencyCode', // Actual path: InvoiceTotal.valueCurrency.currencyCode (normalized)
  'tax_amount': 'TotalTax.amount',    // TotalTax.valueCurrency.amount
      'tax_rate': 'TaxDetails.rate',      // TaxDetails array rate
      
      // Line Items (confirmed structure: Items.valueArray[].valueObject)
      // NOTE: These are templates - actual extraction processes ALL items in the array
      'items.description': 'Items.valueArray[].valueObject.Description.valueString',
      'items.item_code': 'Items.valueArray[].valueObject.ProductCode.valueString',
      'items.quantity': 'Items.valueArray[].valueObject.Quantity.valueNumber', 
      'items.unit': 'Items.valueArray[].valueObject.Unit.valueString',
      'items.unit_price': 'Items.valueArray[].valueObject.UnitPrice.valueCurrency.amount',
      'items.total_price_ht': 'Items.valueArray[].valueObject.Amount.valueCurrency.amount',
      'items.tax_rate': 'Items.valueArray[].valueObject.TaxRate.valueString'
    };

    // Query Fields - Custom fields extracted via Azure DI Query Fields API (max 20 fields)
    // 🚨 IMPORTANT: These are ONLY fields NOT available in standard Azure DI invoice model
    // DO NOT duplicate standard fields here to avoid wasting Query Fields API quota
    this.queryFields = {
      // Address Components (Priority 1 - Compliance Critical)
      // NOTE: Azure DI provides VendorAddress/CustomerAddress as full text, but we need components
      'exporter_street': 'What is the street address of the seller/vendor/exporter? Include street number and name.',
      'exporter_city': 'What is the city of the seller/vendor/exporter?',
      'exporter_country': 'What is the country of the seller/vendor/exporter?',
      'exporter_email': 'What is the email address of the seller/vendor/exporter?',
      
      'importer_street': 'What is the street address of the buyer/customer/importer? Include street number and name.',
      'importer_city': 'What is the city of the buyer/customer/importer?',
      'importer_country': 'What is the country of the buyer/customer/importer?',
      'importer_email': 'What is the email address of the buyer/customer/importer?',
      
      // Payment and Shipping (Priority 2 - Business Critical)
      // NOTE: payment_terms is available as PaymentTerm in standard Azure DI - REMOVED to avoid duplication
      'payment_method': 'What is the payment method? Look for terms like "virement", "transfer", "bank transfer", "card", "cash", "check", "wire transfer"',
      'package_number': 'What is the package number, tracking number, shipping reference, or parcel ID?',
      'discount': 'What discount amount or percentage is applied? Look for "discount", "rebate", "reduction", "remise"',
      
      // Item Details (Priority 3 - Valuable for Inventory)
      'items.hs_code': 'What are the HS codes, customs tariff numbers, or harmonized system codes for the items? Look for numeric codes like "8207.9000"',
      'items.made_in': 'What is the country of origin or "made in" information for the items? Look for "Country of origin", "Made in", "Origin"',
      'items.unit_weight': 'What is the unit weight of each item? Look for weight per unit like "24.06 GR", "29.965 GR"',
      'items.client_order': 'What are the client order numbers or customer order references for each item? Look for "Client order", "Customer order", "Ref client", "Order ref", "Commande client", "No cde", "Customer\'s No.", "Your reference", "N/REF"',
      'items.size': 'For each line item, extract the size / measurement if present. Look for labels like Size, Taille, Taglia, Talla, Größe, or patterns inside description or reference such as "FR 95C", "EU 40", "M/L", "85B", "Ø 18 mm", "40 cm", "Size 6.5", "T52". Return only the size text for the item.',
      
      // Compliance and Specialized (Priority 4 - Nice to Have)
      'vat_exemption': 'Is there any VAT exemption statement, tax exemption reason, or tax-free declaration?',
      'late_payment_penalty': 'What is the late payment penalty, interest rate, or penalty for delayed payment?',
      'diamond_statement': 'Is there any diamond statement, Kimberley process certificate, or precious stones declaration?',
      'additional_fees_ht': 'What are any additional fees, charges, or surcharges (excluding tax)?',
      'collection_fee_eur': 'What is the collection fee in EUR or any currency collection charge?'
    };

    // LLM Fields - Require complex extraction/calculation (NO DUPLICATION with Query Fields)
    this.llmFields = {
      // Calculated totals
      'total_quantity': 'sum(Items[].Quantity)',
      'total_net_weight': 'sum(Items[].NetWeight)', 
      
      // Specialized luxury fields
      'total_gold_weight': 'sum(Items[].GoldWeight)',
      'total_platine_weight': 'sum(Items[].PlatineWeight)',
      'items.net_gold_weight': 'GoldWeight per item',
      'items.net_platine_weight': 'PlatineWeight per item',
      
      // Complex references
      'items.po_number': 'Purchase order per item',
      'items.Reference': 'Product reference code',
      
      // NOTE: Removed late_payment_penalty, diamond_statement, collection_fee_eur
      // These are now handled by Query Fields API for direct extraction
    };

    // Field priorities for extraction optimization
    this.extractionPriority = {
      high: [
        'invoice_id', 'issue_date', 'exporter_name', 'importer_name', 
        'total_ttc', 'currency', 'items'
      ],
      medium: [
        'due_date', 'po_number', 'payment_terms', 'total_ht', 'tax_amount'
      ],
      low: [
        'payment_method', 'package_number', 'additional_fees_ht', 'discount'
      ]
    };
  }

  /**
   * Get all fields that can be extracted with Azure DI standard extraction
   * @returns {Object} - Map of target field to Azure DI field
   */
  getStandardFields() {
    return { ...this.standardFields };
  }

  /**
   * Get all fields that require Query Field extraction
   * @returns {Object} - Map of target field to Azure DI query field
   */
  getQueryFields() {
    return { ...this.queryFields };
  }

  /**
   * Get all fields that require LLM extraction
   * @returns {Object} - Map of target field to extraction method
   */
  getLLMFields() {
    return { ...this.llmFields };
  }

  /**
   * Get extraction method for a specific field
   * @param {string} fieldName - Target schema field name
   * @returns {Object} - Extraction method info
   */
  getFieldExtractionMethod(fieldName) {
    if (this.standardFields[fieldName]) {
      return {
        method: 'standard',
        azureField: this.standardFields[fieldName],
        priority: this.getFieldPriority(fieldName)
      };
    }
    
    if (this.queryFields[fieldName]) {
      return {
        method: 'query',
        azureField: this.queryFields[fieldName],
        priority: this.getFieldPriority(fieldName)
      };
    }
    
    if (this.llmFields[fieldName]) {
      return {
        method: 'llm',
        extraction: this.llmFields[fieldName],
        priority: this.getFieldPriority(fieldName)
      };
    }
    
    return {
      method: 'unknown',
      priority: 'low'
    };
  }

  /**
   * Get field priority level
   * @param {string} fieldName - Field name
   * @returns {string} - Priority level
   */
  getFieldPriority(fieldName) {
  // Return simplified priority model as required: 'high' | 'normal'
  if (this.extractionPriority.high.includes(fieldName)) return 'high';
  return 'normal';
  }

  /**
   * Get optimized query field batches (max 20 per batch)
   * @returns {Array} - Array of query field batches
   */
  getQueryFieldBatches() {
    const queryFieldNames = Object.keys(this.queryFields);
    const batches = [];
    
    // Split into batches of 20
    for (let i = 0; i < queryFieldNames.length; i += 20) {
      batches.push(queryFieldNames.slice(i, i + 20));
    }
    
    return batches;
  }

  /**
   * Generate field mapping summary for validation
   * @returns {Object} - Complete mapping summary
   */
  getFieldMappingSummary() {
    const standardCount = Object.keys(this.standardFields).length;
    const queryCount = Object.keys(this.queryFields).length;
    const llmCount = Object.keys(this.llmFields).length;
    
    return {
      totalFields: standardCount + queryCount + llmCount,
      standardFields: standardCount,
      queryFields: queryCount,
      llmFields: llmCount,
      queryBatches: this.getQueryFieldBatches().length,
      coverage: {
        automatic: Math.round((standardCount / (standardCount + queryCount + llmCount)) * 100),
        query: Math.round((queryCount / (standardCount + queryCount + llmCount)) * 100),
        llm: Math.round((llmCount / (standardCount + queryCount + llmCount)) * 100)
      }
    };
  }

  /**
   * Check if a field is extractable by Azure DI (standard or query)
   * @param {string} fieldName - Target schema field name
   * @returns {boolean} - True if extractable by Azure DI
   */
  isAzureDIExtractable(fieldName) {
    return !!(this.standardFields[fieldName] || this.queryFields[fieldName]);
  }

  /**
   * Get all Azure DI native fields for validation
   * @returns {Array} - List of all Azure DI field names
   */
  getAllAzureDIFields() {
    const standardFields = Object.values(this.standardFields);
    const queryFields = Object.values(this.queryFields);
    return [...new Set([...standardFields, ...queryFields])];
  }
}

module.exports = new AzureDIFieldMapping();
