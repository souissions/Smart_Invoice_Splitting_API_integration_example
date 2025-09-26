const database = require('../config/database');

class DocumentBatch {
  constructor(data) {
    this.id = data.id;
    this.originalFilename = data.original_filename;
    this.filePath = data.file_path;
    this.status = data.status || 'UPLOADED';
    this.totalPages = data.total_pages;
    this.proposedSplits = data.proposed_splits ? JSON.parse(data.proposed_splits) : null;
    this.validatedSplits = data.validated_splits ? JSON.parse(data.validated_splits) : null;
    this.extractedData = data.extracted_data ? JSON.parse(data.extracted_data) : null;
    this.confidenceScores = data.confidence_scores ? JSON.parse(data.confidence_scores) : null;
    this.errorMessage = data.error_message;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  static async create(batchData) {
    const db = database.getDb();
    const {
      id,
      originalFilename,
      filePath,
      status = 'UPLOADED',
      totalPages = null
    } = batchData;

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO document_batches (
          id, original_filename, file_path, status, total_pages
        ) VALUES (?, ?, ?, ?, ?)
      `;

      db.run(sql, [id, originalFilename, filePath, status, totalPages], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(new DocumentBatch({
            id,
            original_filename: originalFilename,
            file_path: filePath,
            status,
            total_pages: totalPages
          }));
        }
      });
    });
  }

  static async findById(id) {
    const db = database.getDb();
    
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM document_batches WHERE id = ?';
      
      db.get(sql, [id], (err, row) => {
        if (err) {
          reject(err);
        } else if (row) {
          resolve(new DocumentBatch(row));
        } else {
          resolve(null);
        }
      });
    });
  }

  static async findAll() {
    const db = database.getDb();
    
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM document_batches ORDER BY created_at DESC';
      
      db.all(sql, [], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows.map(row => new DocumentBatch(row)));
        }
      });
    });
  }

  async update(updateData) {
    const db = database.getDb();
    const allowedFields = [
      'status', 'total_pages', 'proposed_splits', 'validated_splits',
      'extracted_data', 'confidence_scores', 'error_message'
    ];

    const updates = [];
    const values = [];

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        updates.push(`${key} = ?`);
        // Convert objects to JSON strings for storage
        if (typeof updateData[key] === 'object' && updateData[key] !== null) {
          values.push(JSON.stringify(updateData[key]));
        } else {
          values.push(updateData[key]);
        }
      }
    });

    if (updates.length === 0) {
      throw new Error('No valid fields to update');
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(this.id);

    const sql = `UPDATE document_batches SET ${updates.join(', ')} WHERE id = ?`;

    return new Promise((resolve, reject) => {
      db.run(sql, values, function(err) {
        if (err) {
          reject(err);
        } else {
          // Update instance properties
          Object.keys(updateData).forEach((key) => {
            if (allowedFields.includes(key)) {
              if (key.includes('splits') || key.includes('data') || key.includes('scores')) {
                this[this.toCamelCase(key)] = updateData[key];
              } else {
                this[this.toCamelCase(key)] = updateData[key];
              }
            }
          });
          
          resolve(this);
        }
      }.bind(this));
    });
  }

  toCamelCase(str) {
    return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
  }

  // Static method to update splits for a batch
  static async updateSplits(id, splits) {
    const db = database.getDb();
    
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE document_batches 
        SET proposed_splits = ?, updated_at = DATETIME('now')
        WHERE id = ?
      `;
      
      db.run(sql, [JSON.stringify(splits), id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }

  async delete() {
    const db = database.getDb();
    
    return new Promise((resolve, reject) => {
      const sql = 'DELETE FROM document_batches WHERE id = ?';
      
      db.run(sql, [this.id], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes > 0);
        }
      });
    });
  }
}

module.exports = DocumentBatch;

