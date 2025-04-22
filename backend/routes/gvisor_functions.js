const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const db = require('../db');

// Check if gVisor is properly installed and configured
const checkGvisorInstallation = () => {
  return new Promise((resolve, reject) => {
    // Check if we're running on Windows or Linux
    const isWindows = process.platform === 'win32';
    
    // For Windows, we'll use a different approach
    if (isWindows) {
      console.log('⚠️ Running on Windows, using alternative gVisor check');
      
      // Check if Docker can use runsc
      exec('docker info --format "{{.Runtimes}}"', (dockerErr, dockerStdout, dockerStderr) => {
        if (dockerErr) {
          console.error('❌ Error checking Docker runtimes:', dockerErr);
          reject(new Error('Failed to check Docker runtimes. Make sure Docker is running.'));
          return;
        }
        
        if (!dockerStdout || !dockerStdout.includes('runsc')) {
          console.warn('⚠️ runsc runtime not found in Docker. This is expected if using Docker in Windows with gVisor in WSL2.');
          console.warn('⚠️ We will attempt to use gVisor through WSL2 integration.');
          
          // Instead of failing, we'll try to use WSL2 integration
          resolve({ usingWsl2: true });
          return;
        }
        
        resolve({ usingWsl2: false });
      });
    } else {
      // For Linux, we can use the which command
      exec('which runsc', (err, stdout, stderr) => {
        if (err) {
          console.error('❌ runsc not found in PATH:', err);
          reject(new Error('gVisor (runsc) is not installed or not in PATH. Please install gVisor in your environment.'));
          return;
        }
        
        // Now check if Docker can use runsc
        exec('docker info --format "{{.Runtimes}}"', (dockerErr, dockerStdout, dockerStderr) => {
          if (dockerErr) {
            console.error('❌ Error checking Docker runtimes:', dockerErr);
            reject(new Error('Failed to check Docker runtimes. Make sure Docker is running.'));
            return;
          }
          
          if (!dockerStdout || !dockerStdout.includes('runsc')) {
            console.warn('⚠️ runsc runtime not found in Docker. This is unexpected if gVisor is installed.');
            console.warn('⚠️ We will attempt to use gVisor directly.');
            
            // Instead of failing, we'll try to use gVisor directly
            resolve({ usingWsl2: false, directRunsc: true });
            return;
          }
          
          resolve({ usingWsl2: false, directRunsc: false });
        });
      });
    }
  });
};

// CREATE function and store container in container_pool with gVisor runtime
router.post('/api/gvisor/functions', async (req, res) => {
  try {
    // Check if gVisor is properly installed
    const gvisorStatus = await checkGvisorInstallation();
    const usingWsl2 = gvisorStatus.usingWsl2;
    const directRunsc = gvisorStatus.directRunsc || false;
    
    const { name, language, code, timeout = 5 } = req.body;
    const id = uuidv4();

    // Validate timeout is a positive number
    const timeoutValue = parseInt(timeout);
    if (isNaN(timeoutValue) || timeoutValue <= 0) {
      return res.status(400).json({ error: 'Timeout must be a positive number' });
    }

    // SQL query to insert function in 'functions' table with gVisor runtime
    const sqlFunction = 'INSERT INTO functions (id, name, language, code, timeout, runtime) VALUES (?, ?, ?, ?, ?, ?)';

    db.query(sqlFunction, [id, name, language, code, timeoutValue, 'gvisor'], (err) => {
      if (err) {
        console.error('❌ Error inserting function:', err);
        return res.status(500).json({ error: 'Database insert failed' });
      }

      // Now create the gVisor container for the function
      const codePath = path.join(__dirname, '../executor/gvisor/code.py');
      const dockerfilePath = path.join(__dirname, '../executor/gvisor/Dockerfile');

      // Write the function code to a file
      fs.writeFile(codePath, code, (err) => {
        if (err) {
          console.error('❌ Error writing code.py:', err);
          return res.status(500).json({ error: 'Failed to write code.py' });
        }

        // Create Dockerfile content for gVisor
        const dockerfileContent = 
`FROM python:3.9-slim
WORKDIR /app
COPY code.py .
CMD ["timeout", "${timeoutValue}", "python3", "-u", "code.py"]`.trim();

        // Write Dockerfile
        fs.writeFile(dockerfilePath, dockerfileContent, (err) => {
          if (err) {
            console.error('❌ Error writing Dockerfile:', err);
            return res.status(500).json({ error: 'Failed to write Dockerfile' });
          }

          const executorPath = path.join(__dirname, '../executor/gvisor');

          // Build and run the container based on the environment
          if (usingWsl2) {
            // For WSL2, we need to convert Windows path to WSL path
            console.log('Converting Windows path to WSL path...');
            const wslPathCommand = `wsl -d Ubuntu-22.04 -e wslpath -u "${executorPath}"`;
            
            exec(wslPathCommand, (pathErr, wslPath, pathStderr) => {
              if (pathErr) {
                console.error('❌ Error converting path:', pathStderr);
                return res.status(500).json({ error: 'Failed to convert path for WSL2', details: pathStderr });
              }

              const wslExecutorPath = wslPath.trim();
              console.log('Building Docker image in WSL2...');
              const buildCommand = `wsl -d Ubuntu-22.04 -e docker build -t gvisor-python-functions ${wslExecutorPath}`;
              
              exec(buildCommand, (buildErr, buildStdout, buildStderr) => {
                if (buildErr) {
                  console.error('❌ gVisor build failed in WSL2:', buildStderr);
                  return res.status(500).json({ error: 'gVisor build failed in WSL2', details: buildStderr });
                }

                console.log('Running container in WSL2...');
                const runCommand = 'wsl -d Ubuntu-22.04 -e docker run -d --security-opt=seccomp=unconfined gvisor-python-functions';
                
                exec(runCommand, (runErr, runStdout, runStderr) => {
                  if (runErr) {
                    console.error('❌ gVisor run error in WSL2:', runStderr);
                    return res.status(500).json({ error: 'Execution failed in WSL2', details: runStderr });
                  }

                  const containerId = runStdout.trim();

                  // Insert container info into the container_pool table with gVisor runtime
                  const sqlContainerPool = 'INSERT INTO container_pool (function_id, container_id, status, runtime) VALUES (?, ?, ?, ?)';
                  db.query(sqlContainerPool, [id, containerId, 'idle', 'gvisor'], (err) => {
                    if (err) {
                      console.error('❌ Error inserting container into container_pool:', err);
                      return res.status(500).json({ error: 'Failed to insert container into container pool' });
                    }
                    res.status(201).json({ message: 'Function created successfully with gVisor runtime in WSL2', function_id: id, container_id: containerId });
                  });
                });
              });
            });
          } else if (directRunsc) {
            // Use runsc directly
            console.log('Building Docker image with direct runsc...');
            const buildCommand = `runsc do docker build -t gvisor-python-functions ${executorPath}`;
            
            exec(buildCommand, (buildErr, buildStdout, buildStderr) => {
              if (buildErr) {
                console.error('❌ gVisor build failed with direct runsc:', buildStderr);
                return res.status(500).json({ error: 'gVisor build failed with direct runsc', details: buildStderr });
              }

              console.log('Running container with direct runsc...');
              const runCommand = 'runsc do docker run -d --security-opt=seccomp=unconfined gvisor-python-functions';
              
              exec(runCommand, (runErr, runStdout, runStderr) => {
                if (runErr) {
                  console.error('❌ gVisor run error with direct runsc:', runStderr);
                  return res.status(500).json({ error: 'Execution failed with direct runsc', details: runStderr });
                }

                const containerId = runStdout.trim();

                // Insert container info into the container_pool table with gVisor runtime
                const sqlContainerPool = 'INSERT INTO container_pool (function_id, container_id, status, runtime) VALUES (?, ?, ?, ?)';
                db.query(sqlContainerPool, [id, containerId, 'idle', 'gvisor'], (err) => {
                  if (err) {
                    console.error('❌ Error inserting container into container_pool:', err);
                    return res.status(500).json({ error: 'Failed to insert container into container pool' });
                  }
                  res.status(201).json({ message: 'Function created successfully with direct runsc', function_id: id, container_id: containerId });
                });
              });
            });
          } else {
            // Use Docker with runsc runtime
            console.log('Building Docker image with runsc runtime...');
            const buildCommand = `docker build -t gvisor-python-functions ${executorPath}`;
            
            exec(buildCommand, (buildErr, buildStdout, buildStderr) => {
              if (buildErr) {
                console.error('❌ gVisor build failed:', buildStderr);
                return res.status(500).json({ error: 'gVisor build failed', details: buildStderr });
              }

              console.log('Running container with runsc runtime...');
              const runCommand = 'docker run -d --runtime=runsc --security-opt=seccomp=unconfined gvisor-python-functions';
              
              exec(runCommand, (runErr, runStdout, runStderr) => {
                if (runErr) {
                  console.error('❌ gVisor run error:', runStderr);
                  return res.status(500).json({ error: 'Execution failed', details: runStderr });
                }

                const containerId = runStdout.trim();

                // Insert container info into the container_pool table with gVisor runtime
                const sqlContainerPool = 'INSERT INTO container_pool (function_id, container_id, status, runtime) VALUES (?, ?, ?, ?)';
                db.query(sqlContainerPool, [id, containerId, 'idle', 'gvisor'], (err) => {
                  if (err) {
                    console.error('❌ Error inserting container into container_pool:', err);
                    return res.status(500).json({ error: 'Failed to insert container into container pool' });
                  }
                  res.status(201).json({ message: 'Function created successfully with runsc runtime', function_id: id, container_id: containerId });
                });
              });
            });
          }
        });
      });
    });
  } catch (error) {
    console.error('❌ Error checking gVisor installation:', error);
    return res.status(500).json({ error: 'Failed to check gVisor installation' });
  }
});

// EXECUTE function inside gVisor container
router.post('/api/gvisor/functions/:id/execute', async (req, res) => {
  try {
    // Check if gVisor is properly installed
    const gvisorStatus = await checkGvisorInstallation();
    const usingWsl2 = gvisorStatus.usingWsl2;
    const directRunsc = gvisorStatus.directRunsc || false;
    
    const { id } = req.params;
    const startTime = new Date();

    // First check if function exists and get container info
    db.query('SELECT f.*, cp.container_id, cp.status FROM functions f LEFT JOIN container_pool cp ON f.id = cp.function_id WHERE f.id = ? AND f.runtime = ?', [id, 'gvisor'], (err, results) => {
      if (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (results.length === 0) {
        return res.status(404).json({ error: 'Function not found or not a gVisor function' });
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

        // Start the gVisor container
        let startCommand;
        
        if (usingWsl2) {
          startCommand = `wsl -d Ubuntu-22.04 -e docker start ${containerId}`;
        } else if (directRunsc) {
          // Use runsc directly
          startCommand = `runsc do docker start ${containerId}`;
        } else {
          // Use Docker with runsc runtime
          startCommand = `docker start ${containerId}`;
        }
        
        console.log(`Running command: ${startCommand}`);
        
        exec(startCommand, { timeout: (timeoutValue + 1) * 1000 }, (runErr, runStdout, runStderr) => {
          if (runErr) {
            console.error('❌ gVisor run error:', runStderr || runErr);
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
          let logsCommand;
          
          if (usingWsl2) {
            logsCommand = `wsl -d Ubuntu-22.04 -e docker logs ${containerId}`;
          } else if (directRunsc) {
            // Use runsc directly
            logsCommand = `runsc do docker logs ${containerId}`;
          } else {
            // Use Docker with runsc runtime
            logsCommand = `docker logs ${containerId}`;
          }
          
          console.log(`Running command: ${logsCommand}`);
          
          exec(logsCommand, (logsErr, logsStdout, logsStderr) => {
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
              return res.status(500).json({ error: 'Failed to get container logs', details: logsErr });
            }

            // Clean up the output to remove duplicate lines
            const outputLines = logsStdout.trim().split('\n');
            const uniqueOutput = [...new Set(outputLines)].join('\n');

            // Record metrics for successful execution
            db.query(
              'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status) VALUES (?, ?, ?, ?, ?)',
              [id, startTime, endTime, executionTime, 'success'],
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
  } catch (error) {
    console.error('❌ Error checking gVisor installation:', error);
    return res.status(500).json({ error: error.message || 'Failed to check gVisor installation' });
  }
});

// Route for executing arbitrary code with gVisor
router.post('/api/gvisor/execute', async (req, res) => {
  try {
    // Check if gVisor is properly installed
    const gvisorStatus = await checkGvisorInstallation();
    const usingWsl2 = gvisorStatus.usingWsl2;
    const directRunsc = gvisorStatus.directRunsc || false;
    
    const { code, timeout = 5, language = 'python' } = req.body;
    const startTime = new Date();

    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    // Validate timeout is a positive number
    const timeoutValue = parseInt(timeout);
    if (isNaN(timeoutValue) || timeoutValue <= 0) {
      return res.status(400).json({ error: 'Timeout must be a positive number' });
    }

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
              const tempFilePath = path.join(__dirname, '../temp/temp_function.js');
              
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
    const processedCode = await processCode(code, language);

    // Handle JavaScript code execution with gVisor
    if (language === 'javascript') {
      // For JavaScript, we'll use Node.js with gVisor
      const tempFilePath = path.join(__dirname, '../temp/temp_gvisor.js');
      
      // Write the JavaScript code to a temporary file
      fs.writeFile(tempFilePath, processedCode, (err) => {
        if (err) {
          console.error('❌ Error writing temp_gvisor.js:', err);
          
          // Record metrics for file write error
          const endTime = new Date();
          const executionTime = (endTime - startTime) / 1000; // in seconds
          db.query(
            'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
            ['gvisor_execution', startTime, endTime, executionTime, 'error', 'Failed to write temp_gvisor.js: ' + err.message],
            (metricsErr) => {
              if (metricsErr) {
                console.error('❌ Error recording metrics:', metricsErr);
              }
            }
          );
          
          return res.status(500).json({ error: 'Failed to write temp_gvisor.js' });
        }

        // Create Dockerfile content for gVisor
        const dockerfilePath = path.join(__dirname, '../temp/Dockerfile.gvisor');
        const dockerfileContent = `
FROM node:16-slim
WORKDIR /app
COPY temp_gvisor.js .
CMD ["timeout", "${parseInt(timeout)}", "node", "temp_gvisor.js"]
`.trim();

        // Write Dockerfile
        fs.writeFile(dockerfilePath, dockerfileContent, (err) => {
          if (err) {
            console.error('❌ Error writing Dockerfile.gvisor:', err);
            return res.status(500).json({ error: 'Failed to write Dockerfile.gvisor' });
          }

          const tempPath = path.join(__dirname, '../temp');

          // Build the Docker image with gVisor runtime
          let buildCommand = 'docker build -t gvisor-js-executor ';
          if (usingWsl2) {
            buildCommand += '--platform linux/amd64 ';
          }
          buildCommand += tempPath;

          exec(buildCommand, (buildErr, buildStdout, buildStderr) => {
            if (buildErr) {
              console.error('❌ Docker build failed:', buildStderr);
              return res.status(500).json({ error: 'Docker build failed', details: buildStderr });
            }

            // Run the Docker container with gVisor runtime
            let runCommand = 'docker run --rm ';
            if (directRunsc) {
              runCommand += '--runtime=runsc ';
            } else if (!usingWsl2) {
              runCommand += '--runtime=runsc ';
            }
            runCommand += 'gvisor-js-executor';

            exec(runCommand, { timeout: (parseInt(timeout) + 1) * 1000 }, (runErr, runStdout, runStderr) => {
              const endTime = new Date();
              const executionTime = (endTime - startTime) / 1000; // in seconds

              // Clean up temporary files
              fs.unlink(tempFilePath, () => {});
              fs.unlink(dockerfilePath, () => {});

              if (runErr) {
                console.error('❌ Docker run error:', runStderr || runErr);
                
                // Record metrics for execution error
                db.query(
                  'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                  ['gvisor_execution', startTime, endTime, executionTime, 'error', 'JavaScript execution failed: ' + (runStderr || runErr)],
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
                ['gvisor_execution', startTime, endTime, executionTime, 'success'],
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
    } else {
      // For Python, use gVisor with Python
      const codePath = path.join(__dirname, '../executor/gvisor/code.py');
      const dockerfilePath = path.join(__dirname, '../executor/gvisor/Dockerfile');

      // Write the processed code into a Python file
      fs.writeFile(codePath, processedCode, (err) => {
        if (err) {
          console.error('❌ Error writing code.py:', err);
          
          // Record metrics for file write error
          const endTime = new Date();
          const executionTime = (endTime - startTime) / 1000; // in seconds
          db.query(
            'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
            ['gvisor_execution', startTime, endTime, executionTime, 'error', 'Failed to write code.py: ' + err.message],
            (metricsErr) => {
              if (metricsErr) {
                console.error('❌ Error recording metrics:', metricsErr);
              }
            }
          );
          
          return res.status(500).json({ error: 'Failed to write code.py' });
        }

        // Create Dockerfile content for gVisor
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

          const executorPath = path.join(__dirname, '../executor/gvisor');

          // Build the Docker image with gVisor runtime
          let buildCommand = 'docker build -t gvisor-python-executor ';
          if (usingWsl2) {
            buildCommand += '--platform linux/amd64 ';
          }
          buildCommand += executorPath;

          exec(buildCommand, (buildErr, buildStdout, buildStderr) => {
            if (buildErr) {
              console.error('❌ Docker build failed:', buildStderr);
              return res.status(500).json({ error: 'Docker build failed', details: buildStderr });
            }

            // Run the Docker container with gVisor runtime
            let runCommand = 'docker run --rm ';
            if (directRunsc) {
              runCommand += '--runtime=runsc ';
            } else if (!usingWsl2) {
              runCommand += '--runtime=runsc ';
            }
            runCommand += 'gvisor-python-executor';

            exec(runCommand, { timeout: (parseInt(timeout) + 1) * 1000 }, (runErr, runStdout, runStderr) => {
              const endTime = new Date();
              const executionTime = (endTime - startTime) / 1000; // in seconds

              if (runErr) {
                console.error('❌ Docker run error:', runStderr || runErr);
                
                // Record metrics for execution error
                db.query(
                  'INSERT INTO function_metrics (function_id, start_time, end_time, execution_time, status, error_message) VALUES (?, ?, ?, ?, ?, ?)',
                  ['gvisor_execution', startTime, endTime, executionTime, 'error', 'Execution failed: ' + (runStderr || runErr)],
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
                ['gvisor_execution', startTime, endTime, executionTime, 'success'],
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

// GET metrics for gVisor code execution
router.get('/api/gvisor/execute/metrics', (req, res) => {
  const { limit = 10, offset = 0 } = req.query;
  
  // Get detailed metrics for gVisor execution
  db.query(
    'SELECT * FROM function_metrics WHERE function_id = ? ORDER BY start_time DESC LIMIT ? OFFSET ?',
    ['gvisor_execution', parseInt(limit), parseInt(offset)],
    (err, results) => {
      if (err) {
        console.error('❌ Error fetching gVisor execution metrics:', err);
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
        ['gvisor_execution'],
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

module.exports = router; 