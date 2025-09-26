const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
  }

  async initialize() {
    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../storage/database.sqlite');
    
    // Ensure storage directory exists
    const storageDir = path.dirname(dbPath);
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
        } else {
          console.log('Connected to SQLite database');
          this.createTables().then(resolve).catch(reject);
        }
      });
    });
  }

  async createTables() {
    const createDocumentBatchTable = `
      CREATE TABLE IF NOT EXISTS document_batches (
        id TEXT PRIMARY KEY,
        original_filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UPLOADED',
        total_pages INTEGER,
        proposed_splits TEXT, -- JSON string
        validated_splits TEXT, -- JSON string
        extracted_data TEXT, -- JSON string
        confidence_scores TEXT, -- JSON string
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createInvoicesTable = `
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        page_range TEXT NOT NULL, -- "1-3" format
        file_path TEXT,
        extracted_data TEXT, -- JSON string
        confidence_score REAL,
        validation_status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (batch_id) REFERENCES document_batches (id)
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(createDocumentBatchTable, (err) => {
          if (err) {
            console.error('Error creating document_batches table:', err);
            reject(err);
            return;
          }
        });

        this.db.run(createInvoicesTable, (err) => {
          if (err) {
            console.error('Error creating invoices table:', err);
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  }

  getDb() {
    return this.db;
  }

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = new Database();

