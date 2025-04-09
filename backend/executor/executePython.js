const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

module.exports = (code, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const fileName = `code-${Date.now()}.py`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, code);

    const dockerCommand = `docker build -t lambda-python -f ${__dirname}/Dockerfile ${__dirname} && docker run --rm -v ${filePath}:/app/code.py --network none --memory="128m" --cpus="0.5" --name exec_${Date.now()} lambda-python`;

    const child = exec(dockerCommand, { timeout: timeout }, (err, stdout, stderr) => {
      fs.unlinkSync(filePath); // delete the temp file

      if (err) {
        if (err.killed) {
          return resolve({ output: '⏰ Execution timed out.' });
        }
        return resolve({ output: stderr || err.message });
      }

      resolve({ output: stdout });
    });
  });
};
