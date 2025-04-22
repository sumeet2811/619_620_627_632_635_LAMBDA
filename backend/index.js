const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('./db');

// Import routes
const functionsRoutes = require('./routes/functions');
const gvisorFunctionsRoutes = require('./routes/gvisor_functions');
const jsFunctionsRoutes = require('./routes/js_functions');

// Initialize the express app
const app = express();

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(bodyParser.json()); // Parse incoming JSON bodies

// Use the routes
app.use(functionsRoutes); // Handles /api/functions and /api/functions/:id/execute
app.use(gvisorFunctionsRoutes); // Handles /api/gvisor/functions and /api/gvisor/functions/:id/execute
app.use(jsFunctionsRoutes); // Handles /api/js-functions

// Route for executing arbitrary code
app.post('/api/execute', async (req, res) => {
  const { code, timeout = 5, language = 'python' } = req.body;
  const startTime = new Date();

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  // Function to execute a stored function by name
  const executeStoredFunction = async (functionName) => {
    return new Promise((resolve, reject) => {
      // First find the function by name
      db.query('SELECT id, language FROM functions WHERE name = ?', [functionName], (err, results) => {
        if (err) {
          console.error('❌ Database error:', err);
          reject(new Error('Database error'));
          return;
        }
        if (results.length === 0) {
          reject(new Error(`Function '${functionName}' not found`));
          return;
        }

        const functionId = results[0].id;
        const functionLanguage = results[0].language;
        
        // Execute the function based on its language
        if (functionLanguage === 'javascript') {
          // For JavaScript functions, execute directly with Node.js
          db.query('SELECT code FROM functions WHERE id = ?', [functionId], (codeErr, codeResults) => {
            if (codeErr || codeResults.length === 0) {
              reject(new Error('Failed to retrieve function code'));
              return;
            }
            
            const code = codeResults[0].code;
            const tempFilePath = path.join(__dirname, './temp/temp_function.js');
            
            // Write the JavaScript code to a temporary file
            fs.writeFile(tempFilePath, code, (writeErr) => {
              if (writeErr) {
                reject(new Error(`Failed to write function code: ${writeErr.message}`));
                return;
              }
              
              // Execute the JavaScript code
              exec(`node ${tempFilePath}`, { timeout: 5000 }, (execErr, stdout, stderr) => {
                // Clean up the temporary file
                fs.unlink(tempFilePath, () => {});
                
                if (execErr) {
                  reject(new Error(`Function execution failed: ${stderr || execErr.message}`));
                  return;
                }
                
                resolve(stdout.trim());
              });
            });
          });
        } else {
          // For Python functions, use the existing Docker-based execution
          const executeEndpoint = `/api/functions/${functionId}/execute`;
          fetch(`http://localhost:${process.env.PORT || 3000}${executeEndpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          })
          .then(response => response.json())
          .then(data => {
            if (data.error) {
              reject(new Error(data.error));
            } else {
              resolve(data.output);
            }
          })
          .catch(error => {
            reject(error);
          });
        }
      });
    });
  };

  // Process the code to handle lambda_fun calls
  const processCode = async (code, language) => {
    const lambdaFunRegex = /lambda_fun\(([^)]+)\)/g;
    let processedCode = code;
    let match;
    const functionCalls = [];

    // Find all lambda_fun calls
    while ((match = lambdaFunRegex.exec(code)) !== null) {
      const functionName = match[1].trim();
      functionCalls.push({
        name: functionName,
        start: match.index,
        end: match.index + match[0].length
      });
    }

    // Execute functions in reverse order to maintain string indices
    for (let i = functionCalls.length - 1; i >= 0; i--) {
      const call = functionCalls[i];
      try {
        const output = await executeStoredFunction(call.name);
        
        // Replace the lambda_fun call with the appropriate code based on language
        if (language === 'javascript') {
          // For JavaScript, use console.log
          processedCode = processedCode.slice(0, call.start) + 
                         `console.log("${output.replace(/"/g, '\\"')}")` + 
                         processedCode.slice(call.end);
        } else {
          // For Python, use print
          processedCode = processedCode.slice(0, call.start) + 
                         `print("${output.replace(/"/g, '\\"')}")` + 
                         processedCode.slice(call.end);
        }
      } catch (error) {
        console.error(`❌ Error executing function ${call.name}:`, error);
        // Replace the lambda_fun call with an error message
        if (language === 'javascript') {
          processedCode = processedCode.slice(0, call.start) + 
                         `console.log("Error executing ${call.name}: ${error.message}")` + 
                         processedCode.slice(call.end);
        } else {
          processedCode = processedCode.slice(0, call.start) + 
                         `print("Error executing ${call.name}: ${error.message}")` + 
                         processedCode.slice(call.end);
        }
      }
    }

    return processedCode;
  };

  try {
    // Process the code to handle lambda_fun calls
    const processedCode = await processCode(code, language);

    // Handle JavaScript code execution
    if (language === 'javascript') {
      // For JavaScript, we'll use Node.js to execute the code directly
      const tempFilePath = path.join(__dirname, './temp/temp.js');
      
      // Write the JavaScript code to a temporary file
      fs.writeFile(tempFilePath, processedCode, (err) => {
        if (err) {
          console.error('❌ Error writing temp.js:', err);
          
          // Record metrics for file write error
          const endTime = new Date();
          const executionTime = (endTime - startTime) / 1000; // in seconds
          db.query(
            'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
            ['normal_execution', startTime, endTime, executionTime, 'error', 'Failed to write temp.js: ' + err.message],
            (metricsErr) => {
              if (metricsErr) {
                console.error('❌ Error recording metrics:', metricsErr);
              }
            }
          );
          
          return res.status(500).json({ error: 'Failed to write temp.js' });
        }

        // Execute the JavaScript code using Node.js
        exec(`node ${tempFilePath}`, { timeout: (parseInt(timeout) + 1) * 1000 }, (runErr, runStdout, runStderr) => {
          const endTime = new Date();
          const executionTime = (endTime - startTime) / 1000; // in seconds

          // Clean up the temporary file
          fs.unlink(tempFilePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error('❌ Error deleting temp.js:', unlinkErr);
            }
          });

          if (runErr) {
            console.error('❌ Node.js execution error:', runStderr || runErr);
            
            // Record metrics for execution error
            db.query(
              'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
              ['normal_execution', startTime, endTime, executionTime, 'error', 'JavaScript execution failed: ' + (runStderr || runErr)],
              (metricsErr) => {
                if (metricsErr) {
                  console.error('❌ Error recording metrics:', metricsErr);
                }
              }
            );
            
            return res.status(500).json({ error: 'JavaScript execution failed or timeout', details: runStderr || runErr });
          }

          // Record metrics for successful execution
          db.query(
            'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status) VALUES (?, ?, ?, ?, ?)',
            ['normal_execution', startTime, endTime, executionTime, 'success'],
            (metricsErr) => {
              if (metricsErr) {
                console.error('❌ Error recording metrics:', metricsErr);
              }
            }
          );

          res.json({ output: runStdout.trim() });
        });
      });
    } else {
      // For Python, continue with the existing Docker-based execution
      // Write the processed code into a Python file
      const codePath = path.join(__dirname, './executor/normal/code.py');
      fs.writeFile(codePath, processedCode, (err) => {
        if (err) {
          console.error('❌ Error writing code.py:', err);
          
          // Record metrics for file write error
          const endTime = new Date();
          const executionTime = (endTime - startTime) / 1000; // in seconds
          db.query(
            'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
            ['normal_execution', startTime, endTime, executionTime, 'error', 'Failed to write code.py: ' + err.message],
            (metricsErr) => {
              if (metricsErr) {
                console.error('❌ Error recording metrics:', metricsErr);
              }
            }
          );
          
          return res.status(500).json({ error: 'Failed to write code.py' });
        }

        // Create Dockerfile content
        const dockerfilePath = path.join(__dirname, './executor/normal/Dockerfile');
        const dockerfileContent = `
FROM python:3.9-slim
WORKDIR /app
COPY code.py .
CMD ["timeout", "${parseInt(timeout)}", "python3", "code.py"]
`.trim();

        // Write Dockerfile
        fs.writeFile(dockerfilePath, dockerfileContent, (err) => {
          if (err) {
            console.error('❌ Error writing Dockerfile:', err);
            return res.status(500).json({ error: 'Failed to write Dockerfile' });
          }

          const executorPath = path.join(__dirname, './executor/normal');

          // Build the Docker image
          exec(`docker build -t lambda-python-functions ${executorPath}`, (buildErr, buildStdout, buildStderr) => {
            if (buildErr) {
              console.error('❌ Docker build failed:', buildStderr);
              return res.status(500).json({ error: 'Docker build failed', details: buildStderr });
            }

            // Run the Docker container
            exec('docker run lambda-python-functions', { timeout: (parseInt(timeout) + 1) * 1000 }, (runErr, runStdout, runStderr) => {
              const endTime = new Date();
              const executionTime = (endTime - startTime) / 1000; // in seconds

              if (runErr) {
                console.error('❌ Docker run error:', runStderr || runErr);
                
                // Record metrics for execution error
                db.query(
                  'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                  ['normal_execution', startTime, endTime, executionTime, 'error', 'Execution failed: ' + (runStderr || runErr)],
                  (metricsErr) => {
                    if (metricsErr) {
                      console.error('❌ Error recording metrics:', metricsErr);
                    }
                  }
                );
                
                return res.status(500).json({ error: 'Execution failed or timeout', details: runStderr || runErr });
              }

              // Record metrics for successful execution
              db.query(
                'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status) VALUES (?, ?, ?, ?, ?)',
                ['normal_execution', startTime, endTime, executionTime, 'success'],
                (metricsErr) => {
                  if (metricsErr) {
                    console.error('❌ Error recording metrics:', metricsErr);
                  }
                }
              );

              res.json({ output: runStdout.trim() });
            });
          });
        });
      });
    }
  } catch (error) {
    console.error('❌ Error processing code:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET metrics for normal code execution
app.get('/api/execute/metrics', (req, res) => {
  const { limit = 10, offset = 0 } = req.query;
  
  // Get detailed metrics for normal execution
  db.query(
    'SELECT * FROM function_metrics WHERE function_id = ? ORDER BY start_time DESC LIMIT ? OFFSET ?',
    ['normal_execution', parseInt(limit), parseInt(offset)],
    (err, results) => {
      if (err) {
        console.error('❌ Error fetching normal execution metrics:', err);
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
        ['normal_execution'],
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

// Set the port for the server to listen on
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});