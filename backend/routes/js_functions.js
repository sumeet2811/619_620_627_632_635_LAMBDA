const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// CREATE JavaScript function
router.post('/api/js-functions', (req, res) => {
  const { name, code, timeout = 5 } = req.body;
  const id = uuidv4();

  // Validate timeout is a positive number
  const timeoutValue = parseInt(timeout);
  if (isNaN(timeoutValue) || timeoutValue <= 0) {
    return res.status(400).json({ error: 'Timeout must be a positive number' });
  }

  // SQL query to insert JavaScript function in 'functions' table
  const sqlFunction = 'INSERT INTO functions (id, name, language, code, timeout) VALUES (?, ?, ?, ?, ?)';

  db.query(sqlFunction, [id, name, 'javascript', code, timeoutValue], (err) => {
    if (err) {
      console.error('❌ Error inserting JavaScript function:', err);
      return res.status(500).json({ error: 'Database insert failed' });
    }

    // Return success with function ID
    return res.status(201).json({ 
      message: 'JavaScript function created successfully',
      function_id: id 
    });
  });
});

// UPDATE JavaScript function
router.put('/api/js-functions/:id', (req, res) => {
  const { id } = req.params;
  const { name, code, timeout = 5 } = req.body;

  // Validate timeout is a positive number
  const timeoutValue = parseInt(timeout);
  if (isNaN(timeoutValue) || timeoutValue <= 0) {
    return res.status(400).json({ error: 'Timeout must be a positive number' });
  }

  // SQL query to update JavaScript function in 'functions' table
  const sqlFunction = 'UPDATE functions SET name = ?, code = ?, timeout = ? WHERE id = ? AND language = ?';

  db.query(sqlFunction, [name, code, timeoutValue, id, 'javascript'], (err, result) => {
    if (err) {
      console.error('❌ Error updating JavaScript function:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'JavaScript function not found' });
    }

    // Return success
    return res.status(200).json({ 
      message: 'JavaScript function updated successfully' 
    });
  });
});

// DELETE JavaScript function
router.delete('/api/js-functions/:id', (req, res) => {
  const { id } = req.params;

  // SQL query to delete JavaScript function from 'functions' table
  const sqlFunction = 'DELETE FROM functions WHERE id = ? AND language = ?';

  db.query(sqlFunction, [id, 'javascript'], (err, result) => {
    if (err) {
      console.error('❌ Error deleting JavaScript function:', err);
      return res.status(500).json({ error: 'Database delete failed' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'JavaScript function not found' });
    }

    // Return success
    return res.status(200).json({ 
      message: 'JavaScript function deleted successfully' 
    });
  });
});

// GET all JavaScript functions
router.get('/api/js-functions', (req, res) => {
  // SQL query to get all JavaScript functions from 'functions' table
  const sqlFunction = 'SELECT id, name, code, timeout FROM functions WHERE language = ?';

  db.query(sqlFunction, ['javascript'], (err, results) => {
    if (err) {
      console.error('❌ Error fetching JavaScript functions:', err);
      return res.status(500).json({ error: 'Database query failed' });
    }

    // Return all JavaScript functions
    return res.status(200).json(results);
  });
});

module.exports = router; 