const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const db = require('../db');

// CREATE function and store container in container_pool
router.post('/api/functions', (req, res) => {
  const { name, language, code, timeout = 5 } = req.body;
  const id = uuidv4();

  // Validate timeout is a positive number
  const timeoutValue = parseInt(timeout);
  if (isNaN(timeoutValue) || timeoutValue <= 0) {
    return res.status(400).json({ error: 'Timeout must be a positive number' });
  }

  // SQL query to insert function in 'functions' table
  const sqlFunction = 'INSERT INTO functions (id, name, language, code, timeout) VALUES (?, ?, ?, ?, ?)';

  db.query(sqlFunction, [id, name, language, code, timeoutValue], (err) => {
    if (err) {
      console.error('❌ Error inserting function:', err);
      return res.status(500).json({ error: 'Database insert failed' });
    }

    // Now create the Docker image for the function and run the container
    const codePath = path.join(__dirname, '../executor/functions/code.py');
    const dockerfilePath = path.join(__dirname, '../executor/functions/Dockerfile');

    // Write the function code to a file
    fs.writeFile(codePath, code, (err) => {
      if (err) {
        console.error('❌ Error writing code.py:', err);
        return res.status(500).json({ error: 'Failed to write code.py' });
      }

      // Create Dockerfile content
      const dockerfileContent = 
`FROM python:3.9-slim
WORKDIR /app
COPY code.py .
CMD ["timeout", "${parseInt(timeout)}", "python3", "-u", "code.py"]`.trim();

      // Write Dockerfile
      fs.writeFile(dockerfilePath, dockerfileContent, (err) => {
        if (err) {
          console.error('❌ Error writing Dockerfile:', err);
          return res.status(500).json({ error: 'Failed to write Dockerfile' });
        }

        const executorPath = path.join(__dirname, '../executor/functions');

        // Build the Docker image
        exec(`docker build -t lambda-python-functions ${executorPath}`, (buildErr, buildStdout, buildStderr) => {
          if (buildErr) {
            console.error('❌ Docker build failed:', buildStderr);
            return res.status(500).json({ error: 'Docker build failed', details: buildStderr });
          }

          // Run the Docker container and get container_id
          exec('docker run -d lambda-python-functions', (runErr, runStdout, runStderr) => {
            if (runErr) {
              console.error('❌ Docker run error:', runStderr);
              return res.status(500).json({ error: 'Execution failed', details: runStderr });
            }

            const containerId = runStdout.trim();

            // Insert container info into the container_pool table
            const sqlContainerPool = 'INSERT INTO container_pool (function_id, container_id, status) VALUES (?, ?, ?)';
            db.query(sqlContainerPool, [id, containerId, 'idle'], (err) => {
              if (err) {
                console.error('❌ Error inserting container into container_pool:', err);
                return res.status(500).json({ error: 'Failed to insert container into container pool' });
              }
              res.status(201).json({ message: 'Function created successfully', function_id: id, container_id: containerId });
            });
          });
        });
      });
    });
  });
});

// LIST all functions
router.get('/api/functions', (req, res) => {
  db.query('SELECT * FROM functions', (err, results) => {
    if (err) {
      console.error('❌ Error fetching functions:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// GET function by ID
router.get('/api/functions/:id', (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM functions WHERE id = ?', [id], (err, results) => {
    if (err) {
      console.error('❌ Error fetching function:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }
    res.json(results[0]);
  });
});

// EXECUTE function inside Docker
router.post('/api/functions/:id/execute', (req, res) => {
  const { id } = req.params;
  const startTime = new Date();

  // First check if function exists and get container info
  db.query('SELECT f.*, cp.container_id, cp.status FROM functions f LEFT JOIN container_pool cp ON f.id = cp.function_id WHERE f.id = ?', [id], (err, results) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }

    const func = results[0];
    const containerStatus = results[0].status;
    const containerId = results[0].container_id;

    // Validate timeout
    const timeoutValue = parseInt(func.timeout) || 5; // Default to 5 seconds if invalid
    if (isNaN(timeoutValue) || timeoutValue <= 0) {
      return res.status(500).json({ error: 'Invalid timeout value in function configuration' });
    }

    // Check if container exists and is idle
    if (!containerId) {
      return res.status(400).json({ error: 'No container found for this function' });
    }
    if (containerStatus !== 'idle') {
      return res.status(400).json({ error: `Container is not available (status: ${containerStatus})` });
    }

    // Mark container as busy
    db.query('UPDATE container_pool SET status = ? WHERE function_id = ?', ['busy', id], (updateErr) => {
      if (updateErr) {
        console.error('❌ Error updating container status:', updateErr);
        return res.status(500).json({ error: 'Failed to update container status' });
      }

      const codePath = path.join(__dirname, '../executor/functions/code.py');
      const dockerfilePath = path.join(__dirname, '../executor/functions/Dockerfile');

      fs.writeFile(codePath, func.code, (err) => {
        if (err) {
          console.error('❌ Error writing code.py:', err);
          return res.status(500).json({ error: 'Failed to write code.py' });
        }

        const dockerfileContent = 
`FROM python:3.9-slim
WORKDIR /app
COPY code.py .
CMD ["timeout", "${parseInt(func.timeout)}", "python3", "-u", "code.py"]`.trim();

        fs.writeFile(dockerfilePath, dockerfileContent, (err) => {
          if (err) {
            console.error('❌ Error writing Dockerfile:', err);
            return res.status(500).json({ error: 'Failed to write Dockerfile' });
          }

          const executorPath = path.join(__dirname, '../executor/functions');
          exec(`docker build -t lambda-python-functions ${executorPath}`, (buildErr, buildStdout, buildStderr) => {
            if (buildErr) {
              console.error('❌ Docker build failed:', buildStderr || buildErr);
              // Update container status back to idle on build failure
              db.query('UPDATE container_pool SET status = ? WHERE function_id = ?', ['idle', id]);
              
              // Record metrics for build failure
              const endTime = new Date();
              const executionTime = (endTime - startTime) / 1000; // in seconds
              db.query(
                'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                [id, startTime, endTime, executionTime, 'error', 'Docker build failed: ' + buildStderr],
                (metricsErr) => {
                  if (metricsErr) {
                    console.error('❌ Error recording metrics:', metricsErr);
                  }
                }
              );
              
              return res.status(500).json({ error: 'Docker build failed', details: buildStderr });
            }

            exec(`docker start ${containerId}`, { timeout: (timeoutValue + 1) * 1000 }, (runErr, runStdout, runStderr) => {
              if (runErr) {
                console.error('❌ Docker run error:', runStderr || runErr);
                // Update container status to error
                db.query('UPDATE container_pool SET status = ? WHERE function_id = ?', ['error', id], (updateErr) => {
                  if (updateErr) {
                    console.error('❌ Error updating container status:', updateErr);
                  }
                });
                
                // Record metrics for execution error
                const endTime = new Date();
                const executionTime = (endTime - startTime) / 1000; // in seconds
                db.query(
                  'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                  [id, startTime, endTime, executionTime, 'error', 'Execution failed: ' + runStderr],
                  (metricsErr) => {
                    if (metricsErr) {
                      console.error('❌ Error recording metrics:', metricsErr);
                    }
                  }
                );
                
                return res.status(500).json({ error: 'Execution failed or timeout', details: runStderr });
              }
              
              // Get the output from the container
              exec(`docker logs ${containerId}`, (logsErr, logsStdout, logsStderr) => {
                // Update container status to idle after execution
                db.query('UPDATE container_pool SET status = ? WHERE function_id = ?', ['idle', id], (updateErr) => {
                  if (updateErr) {
                    console.error('❌ Error updating container status:', updateErr);
                  }
                });
                
                const endTime = new Date();
                const executionTime = (endTime - startTime) / 1000; // in seconds
                
                if (logsErr) {
                  console.error('❌ Error getting container logs:', logsErr);
                  
                  // Record metrics for logs error
                  db.query(
                    'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                    [id, startTime, endTime, executionTime, 'error', 'Failed to get container logs: ' + logsErr],
                    (metricsErr) => {
                      if (metricsErr) {
                        console.error('❌ Error recording metrics:', metricsErr);
                      }
                    }
                  );
                  
                  return res.status(500).json({ error: 'Failed to get container logs', details: logsErr });
                }
                
                // Clean up the output to remove duplicate lines
                const outputLines = logsStdout.trim().split('\n');
                const uniqueOutput = [...new Set(outputLines)].join('\n');
                
                // Record metrics for successful execution
                db.query(
                  'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                  [id, startTime, endTime, executionTime, 'success', null],
                  (metricsErr) => {
                    if (metricsErr) {
                      console.error('❌ Error recording metrics:', metricsErr);
                    }
                  }
                );
                
                res.json({ output: uniqueOutput });
              });
            });
          });
        });
      });
    });
  });
});

// UPDATE function
router.put('/api/functions/:id', (req, res) => {
  const { id } = req.params;
  const { name, code, timeout } = req.body;
  const sql = 'UPDATE functions SET name = ?, code = ?, timeout = ? WHERE id = ?';

  db.query(sql, [name, code, timeout, id], (err, result) => {
    if (err) {
      console.error('❌ Error updating function:', err);
      return res.status(500).json({ error: 'Database update failed' });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Function not found' });
    }
    res.json({ message: 'Function updated successfully' });
  });
});

// DELETE function
router.delete('/api/functions/:id', (req, res) => {
  const { id } = req.params;
  
  // First get container info
  db.query('SELECT container_id FROM container_pool WHERE function_id = ?', [id], (err, results) => {
    if (err) {
      console.error('❌ Error fetching container info:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const containerId = results[0]?.container_id;
    
    // If container exists, stop and remove it
    if (containerId) {
      exec(`docker stop ${containerId}`, (stopErr) => {
        if (stopErr) {
          console.error('❌ Error stopping container:', stopErr);
        }
        
        exec(`docker rm ${containerId}`, (rmErr) => {
          if (rmErr) {
            console.error('❌ Error removing container:', rmErr);
          }
          
          // Delete container record from container_pool
          db.query('DELETE FROM container_pool WHERE function_id = ?', [id], (deleteContainerErr) => {
            if (deleteContainerErr) {
              console.error('❌ Error deleting container record:', deleteContainerErr);
            }
            
            // Finally delete the function
            db.query('DELETE FROM functions WHERE id = ?', [id], (deleteFunctionErr, result) => {
              if (deleteFunctionErr) {
                console.error('❌ Error deleting function:', deleteFunctionErr);
                return res.status(500).json({ error: 'Database delete failed' });
              }
              if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Function not found' });
              }
              res.json({ message: 'Function and container deleted successfully' });
            });
          });
        });
      });
    } else {
      // If no container exists, just delete the function
      db.query('DELETE FROM functions WHERE id = ?', [id], (deleteFunctionErr, result) => {
        if (deleteFunctionErr) {
          console.error('❌ Error deleting function:', deleteFunctionErr);
          return res.status(500).json({ error: 'Database delete failed' });
        }
        if (result.affectedRows === 0) {
          return res.status(404).json({ error: 'Function not found' });
        }
        res.json({ message: 'Function deleted successfully' });
      });
    }
  });
});

// GET metrics for a specific function
router.get('/api/functions/:id/metrics', (req, res) => {
  const { id } = req.params;
  const { limit = 10, offset = 0 } = req.query;
  
  // Get detailed metrics for the function
  db.query(
    'SELECT * FROM function_metrics WHERE function_id = ? ORDER BY start_time DESC LIMIT ? OFFSET ?',
    [id, parseInt(limit), parseInt(offset)],
    (err, results) => {
      if (err) {
        console.error('❌ Error fetching function metrics:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Get aggregated metrics
      db.query(
        `SELECT 
          COUNT(*) as total_executions,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successful_executions,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed_executions,
          AVG(execution_time) as avg_execution_time,
          MIN(execution_time) as min_execution_time,
          MAX(execution_time) as max_execution_time
        FROM function_metrics 
        WHERE function_id = ?`,
        [id],
        (aggErr, aggResults) => {
          if (aggErr) {
            console.error('❌ Error fetching aggregated metrics:', aggErr);
            return res.status(500).json({ error: 'Database error' });
          }
          
          res.json({
            detailed_metrics: results,
            aggregated_metrics: aggResults[0]
          });
        }
      );
    }
  );
});

// GET aggregated metrics for all functions
router.get('/api/functions/metrics/aggregate', (req, res) => {
  db.query(
    `SELECT 
      f.id as function_id,
      f.name as function_name,
      COUNT(fm.id) as total_executions,
      SUM(CASE WHEN fm.status = 'success' THEN 1 ELSE 0 END) as successful_executions,
      SUM(CASE WHEN fm.status = 'error' THEN 1 ELSE 0 END) as failed_executions,
      AVG(fm.execution_time) as avg_execution_time,
      MIN(fm.execution_time) as min_execution_time,
      MAX(fm.execution_time) as max_execution_time
    FROM functions f
    LEFT JOIN function_metrics fm ON f.id = fm.function_id
    GROUP BY f.id, f.name`,
    (err, results) => {
      if (err) {
        console.error('❌ Error fetching aggregated metrics:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(results);
    }
  );
});

// GET metrics for a specific time period
router.get('/api/functions/metrics/timeframe', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }
  
  db.query(
    `SELECT 
      f.id as function_id,
      f.name as function_name,
      COUNT(fm.id) as total_executions,
      SUM(CASE WHEN fm.status = 'success' THEN 1 ELSE 0 END) as successful_executions,
      SUM(CASE WHEN fm.status = 'error' THEN 1 ELSE 0 END) as failed_executions,
      AVG(fm.execution_time) as avg_execution_time,
      MIN(fm.execution_time) as min_execution_time,
      MAX(fm.execution_time) as max_execution_time
    FROM functions f
    LEFT JOIN function_metrics fm ON f.id = fm.function_id
    WHERE fm.start_time BETWEEN ? AND ?
    GROUP BY f.id, f.name`,
    [start_date, end_date],
    (err, results) => {
      if (err) {
        console.error('❌ Error fetching timeframe metrics:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(results);
    }
  );
});

module.exports = router;
