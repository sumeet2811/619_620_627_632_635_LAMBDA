// backend/routes/execute.js
const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const router = express.Router();
const path = require('path');

router.post('/execute', async (req, res) => {
  const code = req.body.code;
  if (!code) return res.status(400).send('No code provided');

  const codePath = path.join(__dirname, '../executor/code.py');

  // Write code to code.py
  fs.writeFileSync(codePath, code);

  // Build and run the Docker container
  exec(
    `docker build -t lambda-python ./executor && docker run --rm lambda-python`,
    (err, stdout, stderr) => {
      if (err) {
        return res.status(500).send(`Error: ${stderr}`);
      }
      res.send({ output: stdout });
    }
  );
});

module.exports = router;
