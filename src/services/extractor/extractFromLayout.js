const azureConfig = require('../../config/azure');
const { deriveProductTableHints } = require('./deriveProductTableHints');
const { buildExtractPrompt } = require('../../prompts/extractInvoice');
const { InvoiceExtractSchema } = require('../../validation/invoice-extract.zod');
const dayjs = require('dayjs');
const countries = require('i18n-iso-countries');

// Load locales for countries
try { countries.registerLocale(require('i18n-iso-countries/langs/en.json')); } catch {}
try { countries.registerLocale(require('i18n-iso-countries/langs/fr.json')); } catch {}
try { countries.registerLocale(require('i18n-iso-countries/langs/de.json')); } catch {}

function toISODate(s) {
  if (!s) return undefined;
  const candidates = [
    'YYYY-MM-DD', 'DD/MM/YYYY', 'DD.MM.YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'YYYY/MM/DD'
  ];
  for (const fmt of candidates) {
    const d = dayjs(s, fmt, true);
    if (d.isValid()) return d.format('YYYY-MM-DD');
  }
  const d2 = dayjs(s);
  return d2.isValid() ? d2.format('YYYY-MM-DD') : undefined;
}

function normCurrency(s) {
  if (!s) return undefined;
  const code = String(s).trim().toUpperCase();
  // Common ISO 4217 currency codes
  const validCurrencies = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK'];
  if (validCurrencies.includes(code)) return code;
  // Try symbol map
  const symbolMap = { '€': 'EUR', '$': 'USD', '£': 'GBP', 'CHF': 'CHF' };
  if (symbolMap[code]) return symbolMap[code];
  return undefined;
}

function normCountry(s) {
  if (!s) return undefined;
  const name = String(s).trim();
  const alpha2 = countries.getAlpha2Code(name, 'en') || countries.getAlpha2Code(name, 'fr') || countries.getAlpha2Code(name, 'de');
  if (alpha2) return alpha2;
  // Already alpha-2?
  if (/^[A-Z]{2}$/.test(name)) return name;
  return undefined;
}

function normalizeInvoice(extract) {
  // Normalize dates, currencies, and countries in-place
  const normalized = JSON.parse(JSON.stringify(extract || {}));

  // basicInformation dates and countries
  normalized.basicInformation = (normalized.basicInformation || []).map(b => ({
    ...b,
    documentDate: b.documentDate ? toISODate(b.documentDate) : undefined,
    dispatchCountry: b.dispatchCountry ? normCountry(b.dispatchCountry) : undefined,
    finalDestination: b.finalDestination ? normCountry(b.finalDestination) : undefined,
  }));

  // totals currency and totals
  normalized.totalsAndSubtotals = (normalized.totalsAndSubtotals || []).map(t => ({
    ...t,
    currency: t.currency ? normCurrency(t.currency) : undefined,
  }));

  // line items: nothing special besides numbers are parsed by Zod already

  // importer/exporter countries
  normalized.importer = (normalized.importer || []).map(i => ({
    ...i,
    country: i.country ? normCountry(i.country) : undefined,
  }));
  normalized.exporter = (normalized.exporter || []).map(e => ({
    ...e,
    country: e.country ? normCountry(e.country) : undefined,
  }));

  // Compute amountDue if missing and derivable
  const diagnostics = { computed: {} };
  if ((normalized.totalsAndSubtotals?.length || 0) > 0) {
    const totals = normalized.totalsAndSubtotals[0];
    if (totals.amountDue == null && Array.isArray(normalized.lineItems)) {
      const sum = normalized.lineItems.reduce((acc, it) => acc + (Number(it.totalAmount) || 0), 0);
      if (sum > 0) {
        totals.amountDue = Number(sum.toFixed(2));
        diagnostics.computed.amountDue = true;
      }
    }
  }

  return { normalized, diagnostics };
}

async function callAzureOpenAI({ system, user }) {
  if (!azureConfig.openAIClient) {
    azureConfig.initialize();
  }
  const client = azureConfig.getOpenAIClient();
  const deployment = azureConfig.getOpenAIDeploymentName();

  try {
    const resp = await client.chat.completions.create({
      model: deployment,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) },
      ],
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    });
    
    // Check if response was truncated due to token limits
    const finishReason = resp?.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
      throw new Error('Response truncated due to token limit. The document may be too complex or contain too much data for processing.');
    }
    
    const content = resp?.choices?.[0]?.message?.content?.trim() || '{}';
    if (!content || content === '{}') {
      throw new Error('Empty or invalid response from AI model. This may indicate token limitations or processing issues.');
    }
    
    return content;
  } catch (error) {
    // Enhanced error handling for different types of failures
    if (error.message.includes('token')) {
      throw new Error(`Token limit exceeded: ${error.message}. Try processing a smaller document or fewer pages.`);
    }
    if (error.message.includes('rate limit')) {
      throw new Error(`Rate limit exceeded: ${error.message}. Please wait a moment before retrying.`);
    }
    if (error.message.includes('quota')) {
      throw new Error(`API quota exceeded: ${error.message}. Please check your Azure OpenAI usage limits.`);
    }
    throw error;
  }
}

/**
 * Extracts and validates the InvoiceExtract from a single Layout response.
 * @param {object} layout Azure Document Intelligence Layout JSON ({ content, pages, tables, paragraphs, spans })
 * @returns {Promise<{ extract: any, diagnostics: any }>}
 */
async function extractFromLayout(layout) {
  if (!layout || typeof layout !== 'object') throw new Error('layout payload required');

  const { glossary } = deriveProductTableHints(layout);

  const interfaceCode = `export interface InvoiceExtract {\n  lineItems: Array<{\n    productCode?: string;\n    description?: string;\n    hsCode?: string;\n    originCountry?: string;\n    farePreference?: string;\n    totalAmount?: number;\n    netWeight?: number;\n    grossWeight?: number;\n    quantity?: number;\n    UOM?: string;\n    type?: string; // 'product', 'shipping', 'tax', 'fee', 'discount', 'other'\n    rate?: number; // for percentage-based charges\n    baseAmount?: number; // amount the rate is applied to\n    currency?: string;\n    category?: string; // additional categorization\n  }>;\n  totalsAndSubtotals: Array<{\n    airFee?: number;\n    otherFee1?: number;\n    insuranceFee?: number;\n    rebate?: number;\n    amountDue?: number;\n    currency?: string;\n    totalNetWeight?: number;\n    totalGrossWeight?: number;\n    totalQuantity?: number;\n    totalVolume?: number;\n  }>;\n  basicInformation: Array<{\n    internalReference?: string;\n    documentType?: string;\n    documentNumber?: string;\n    documentDate?: string;\n    dispatchCountry?: string;\n    finalDestination?: string;\n    originCountries?: string;\n    incoterms?: string;\n    incotermsCity?: string;\n    commodityCode?: string;\n    totalPackages?: number;\n    parcelType?: string;\n  }>;\n  importer: Array<{\n    name?: string; eoriNumber?: number; vatNumber?: number;\n    address?: string; city?: string; zipCode?: number; country?: string;\n  }>;\n  exporter: Array<{\n    name?: string; eoriNumber?: number; vatNumber?: number; rexNumber?: number;\n    address?: string; city?: string; zipCode?: number; country?: string;\n  }>;\n}`;

  // Build prompt
  const { system, user } = buildExtractPrompt({
    markdown: layout.content || '',
    tablesGlossary: glossary,
    interfaceCode,
  });

  let raw = '{}';
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      raw = await callAzureOpenAI({ system, user });
      console.log('LLM Response length:', raw.length);
      if (raw.length < 10) {
        throw new Error('LLM response too short: ' + raw);
      }
      break;
    } catch (err) {
      console.error(`LLM attempt ${attempt + 1} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  // Parse and validate
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('JSON parse error:', e.message);
    console.error('Raw response length:', raw.length);
    console.error('Raw response preview:', raw.substring(0, 500));
    console.error('Raw response end:', raw.substring(Math.max(0, raw.length - 200)));
    
    // Try multiple cleanup strategies
    let cleaned = raw;
    
    // Strategy 1: Remove code fences
    cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
    
    // Strategy 2: Find JSON object boundaries
    const startIndex = cleaned.indexOf('{');
    const lastIndex = cleaned.lastIndexOf('}');
    if (startIndex !== -1 && lastIndex !== -1 && lastIndex > startIndex) {
      cleaned = cleaned.substring(startIndex, lastIndex + 1);
    }
    
    // Strategy 3: Remove any trailing incomplete content
    cleaned = cleaned.trim();
    
    try {
      parsed = JSON.parse(cleaned);
      console.log('Successfully parsed after cleanup');
    } catch (e2) {
      console.error('Still failed after cleanup:', e2.message);
      console.error('Cleaned content:', cleaned.substring(0, 300));
      
      // Fallback: throw error instead of returning empty structure
      throw new Error(`JSON parsing failed after cleanup attempts: ${e2.message}. This may be due to LLM token limitations or malformed response.`);
    }
  }

  const strict = process.env.STRICT_VALIDATION === 'true' || process.env.STRICT_VALIDATION === '1';
  const validated = InvoiceExtractSchema.parse(parsed);

  const { normalized, diagnostics } = normalizeInvoice(validated);

  return { extract: normalized, diagnostics };
}

module.exports = { extractFromLayout, normalizeInvoice };
