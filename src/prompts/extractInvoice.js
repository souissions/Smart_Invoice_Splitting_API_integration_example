function buildExtractPrompt({ markdown, tablesGlossary, interfaceCode }) {
  const system = "You are an invoice data extraction engine. Extract structured data from invoices and output ONLY a JSON object that matches the exact required schema format. Focus on accurate field mapping and data normalization.";
  
  const user = {
    markdown,
    tables_glossary: tablesGlossary,
    interface: interfaceCode,
    extraction_rules: [
      "CRITICAL: Output data in the exact required schema format with these sections:",
      "1) exporter: Company details (name, vatNumber, address, city, zipCode, country as ISO alpha-2)",
      "2) importer: Recipient details (name, address, city, zipCode, country as ISO alpha-2)", 
      "3) basicInformation: Document info (documentType, documentNumber, documentDate as DD/MM/YYYY, dispatchCountry, finalDestination, originCountries)",
      "4) totalsAndSubtotals: Financial totals (amountDue, currency, totalNetWeight, totalGrossWeight, totalQuantity)",
      "5) lineItems: Product details (productCode, description, hsCode, originCountry, totalAmount, netWeight, grossWeight, quantity, UOM)",
      "6) Extract ALL product rows from tables - include model numbers, HS codes, weights, quantities",
      "7) Normalize countries to ISO 3166-1 alpha-2 format (FR, CH, DE, etc.)",
      "8) Extract weights in kg, quantities as numbers, amounts as numbers",
      "9) Map document types: FACTURE->Invoice, PROFORMA->Proforma, etc.",
      "10) Return strict JSON only—no commentary or explanations.",
    ],
    schema_example: {
      "exporter": [{"name": "Company Name", "vatNumber": "VAT123", "address": "Street", "city": "City", "zipCode": 12345, "country": "FR"}],
      "importer": [{"name": "Importer Name", "address": "Address", "city": "City", "zipCode": 12345, "country": "CH"}],
      "basicInformation": [{"documentType": "Invoice", "documentNumber": "INV123", "documentDate": "05/02/2025", "dispatchCountry": "FR", "finalDestination": "CH"}],
      "totalsAndSubtotals": [{"amountDue": 100.50, "currency": "CHF", "totalNetWeight": 2.5, "totalGrossWeight": 3.0, "totalQuantity": 5}],
      "lineItems": [{"productCode": "ABC123", "description": "Product Name", "hsCode": "1234567890", "originCountry": "FR", "totalAmount": 50.25, "netWeight": 1.2, "grossWeight": 1.5, "quantity": 2, "UOM": "pcs"}]
    }
  };
  return { system, user };
}

module.exports = { buildExtractPrompt };
