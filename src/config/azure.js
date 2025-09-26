// Load environment variables from .env file
require('dotenv').config();

// Import both old and new Azure Document Intelligence SDKs for compatibility
const { DocumentAnalysisClient, AzureKeyCredential } = require('@azure/ai-form-recognizer');
const OpenAI = require('openai');

// Import the new Document Intelligence REST client for query fields
let DocumentIntelligenceClient = null;
try {
  DocumentIntelligenceClient = require('@azure-rest/ai-document-intelligence').default;
  console.log('✅ New @azure-rest/ai-document-intelligence SDK available');
} catch (error) {
  console.warn('⚠️  New @azure-rest/ai-document-intelligence SDK not installed. Query fields will not be available.');
  console.warn('💡 To use query fields, install: npm install @azure-rest/ai-document-intelligence');
}

class AzureConfig {
  constructor() {
    this.formRecognizerClient = null;
    this.documentIntelligenceClient = null;
    this.openAIClient = null;
  }

  initialize() {
    // Validate required environment variables
    const requiredEnvVars = [
      'AZURE_FORM_RECOGNIZER_ENDPOINT',
      'AZURE_FORM_RECOGNIZER_KEY',
      'AZURE_OPENAI_ENDPOINT',
      'AZURE_OPENAI_KEY',
      'AZURE_OPENAI_DEPLOYMENT_NAME'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Initialize legacy Form Recognizer client (for backwards compatibility)
    this.formRecognizerClient = new DocumentAnalysisClient(
      process.env.AZURE_FORM_RECOGNIZER_ENDPOINT,
      new AzureKeyCredential(process.env.AZURE_FORM_RECOGNIZER_KEY)
    );

    // Initialize new Document Intelligence client (for query fields)
    if (DocumentIntelligenceClient) {
      this.documentIntelligenceClient = new DocumentIntelligenceClient(
        process.env.AZURE_FORM_RECOGNIZER_ENDPOINT,
        new AzureKeyCredential(process.env.AZURE_FORM_RECOGNIZER_KEY)
      );
      console.log('✅ Document Intelligence client initialized (supports query fields)');
    }

    // Initialize OpenAI client
    this.openAIClient = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_KEY,
      baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
      defaultQuery: { 'api-version': '2024-02-01' },
      defaultHeaders: {
        'api-key': process.env.AZURE_OPENAI_KEY,
      },
    });

    console.log('Azure clients initialized successfully');
  }

  getFormRecognizerClient() {
    if (!this.formRecognizerClient) {
      throw new Error('Form Recognizer client not initialized. Call initialize() first.');
    }
    return this.formRecognizerClient;
  }

  getDocumentIntelligenceClient() {
    if (!this.documentIntelligenceClient) {
      throw new Error('Document Intelligence client not available. Install @azure/ai-document-intelligence package first.');
    }
    return this.documentIntelligenceClient;
  }

  hasQueryFieldsSupport() {
    return this.documentIntelligenceClient !== null;
  }

  getOpenAIClient() {
    if (!this.openAIClient) {
      throw new Error('OpenAI client not initialized. Call initialize() first.');
    }
    return this.openAIClient;
  }

  getOpenAIDeploymentName() {
    return process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  }
}

module.exports = new AzureConfig();

