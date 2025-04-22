const axios = require('axios');

// Test code to execute
const testCode = `
import time

# Simple CPU-intensive task
def calculate_fibonacci(n):
    if n <= 1:
        return n
    else:
        return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)

# Measure execution time
start_time = time.time()
result = calculate_fibonacci(30)
end_time = time.time()

print(f"Fibonacci(30) = {result}")
print(f"Execution time: {end_time - start_time:.4f} seconds")
`;

// Function to test Docker execution
async function testDockerExecution() {
  try {
    console.log('Testing Docker execution...');
    const startTime = Date.now();
    const response = await axios.post('http://localhost:3000/api/execute/docker', {
      code: testCode,
      timeout: 30
    });
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log('Docker Execution Result:');
    console.log(response.data.output);
    console.log(`Total request time: ${totalTime.toFixed(2)} seconds`);
    console.log('-----------------------------------');
    
    return response.data;
  } catch (error) {
    console.error('Docker execution error:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Function to test gVisor execution
async function testGvisorExecution() {
  try {
    console.log('Testing gVisor execution...');
    const startTime = Date.now();
    const response = await axios.post('http://localhost:3000/api/execute/gvisor', {
      code: testCode,
      timeout: 30
    });
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log('gVisor Execution Result:');
    console.log(response.data.output);
    console.log(`Total request time: ${totalTime.toFixed(2)} seconds`);
    console.log('-----------------------------------');
    
    return response.data;
  } catch (error) {
    console.error('gVisor execution error:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Function to test performance comparison
async function testPerformanceComparison() {
  try {
    console.log('Testing performance comparison...');
    const startTime = Date.now();
    const response = await axios.post('http://localhost:3000/api/execute/compare', {
      code: testCode,
      timeout: 30
    });
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;
    
    console.log('Performance Comparison Result:');
    console.log(`Docker execution time: ${response.data.docker.executionTime.toFixed(4)} seconds`);
    console.log(`gVisor execution time: ${response.data.gvisor.executionTime.toFixed(4)} seconds`);
    console.log(`Performance difference: ${response.data.comparison.performanceDiff}`);
    console.log(`Faster engine: ${response.data.comparison.fasterEngine}`);
    console.log(`Total request time: ${totalTime.toFixed(2)} seconds`);
    console.log('-----------------------------------');
    
    return response.data;
  } catch (error) {
    console.error('Performance comparison error:', error.response ? error.response.data : error.message);
    return null;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting execution engine tests...');
  console.log('-----------------------------------');
  
  // Test Docker execution
  await testDockerExecution();
  
  // Test gVisor execution
  await testGvisorExecution();
  
  // Test performance comparison
  await testPerformanceComparison();
  
  console.log('Tests completed.');
}

// Run the tests
runTests(); 