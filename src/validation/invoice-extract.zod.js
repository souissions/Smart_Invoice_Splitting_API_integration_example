const { z } = require('zod');

const numberLike = z.union([z.number(), z.string()]).transform((v) => {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s) return undefined;
  const normalized = s
    .replace(/\s/g, '')
    .replace(/,(?=\d{3}(\D|$))/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(/,(\d{1,2})$/g, '.$1');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
});

const optionalString = z.union([z.string(), z.number()]).transform((v) => (v === undefined || v === null ? undefined : String(v))).optional();

const InvoiceExtractSchema = z.object({
  lineItems: z.array(z.object({
    productCode: z.string().optional(), // Code produit (référence produit / SKU)
    description: z.string().optional(), // Description (désignation du produit)
    hsCode: z.string().optional(), // HS Code (code douanier provenant du Customs Harmonized System)
    originCountry: z.string().optional(), // Pays d'origine du produit
    farePreference: z.string().optional(), // Préférence tarifaire
    totalAmount: numberLike.optional(), // Montant total des produits
    netWeight: numberLike.optional(), // Poids net
    grossWeight: numberLike.optional(), // Poids brut
    quantity: numberLike.optional(), // Nombre de produits
    UOM: z.string().optional(), // Unité de mesure (ex: kg, pcs)
  })).optional(),
  totalsAndSubtotals: z.array(z.object({
    airFee: numberLike.optional(),
    otherFee1: numberLike.optional(),
    insuranceFee: numberLike.optional(),
    rebate: numberLike.optional(),
    amountDue: numberLike.optional(),
    currency: optionalString,
    totalNetWeight: numberLike.optional(),
    totalGrossWeight: numberLike.optional(),
    totalQuantity: numberLike.optional(),
    totalVolume: numberLike.optional(),
  })),
  basicInformation: z.array(z.object({
    internalReference: optionalString,
    documentType: optionalString,
    documentNumber: optionalString,
    documentDate: optionalString,
    dispatchCountry: optionalString,
    finalDestination: optionalString,
    originCountries: optionalString,
    incoterms: optionalString,
    incotermsCity: optionalString,
    commodityCode: optionalString,
    totalPackages: numberLike.optional(),
    parcelType: optionalString,
  })),
  importer: z.array(z.object({
    name: optionalString,
    eoriNumber: numberLike.optional(),
    vatNumber: numberLike.optional(),
    address: optionalString,
    city: optionalString,
    zipCode: numberLike.optional(),
    country: optionalString,
  })),
  exporter: z.array(z.object({
    name: optionalString,
    eoriNumber: numberLike.optional(),
    vatNumber: numberLike.optional(),
    rexNumber: numberLike.optional(),
    address: optionalString,
    city: optionalString,
    zipCode: numberLike.optional(),
    country: optionalString,
  })),
});

module.exports = { InvoiceExtractSchema };
