const express = require('express');
const bodyParser = require('body-parser');
const executePython = require('./executor/executePython');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// In-memory function storage
let functions = [];

// CREATE Function
app.post('/api/functions', (req, res) => {
  const { name, language, code, timeout } = req.body;
  const id = Date.now().toString();
  const newFunction = { id, name, language, code, timeout: timeout || 5000 };
  functions.push(newFunction);
  res.status(201).json(newFunction);
});

// READ All Functions
app.get('/api/functions', (req, res) => {
  res.json(functions);
});

// READ Function by ID
app.get('/api/functions/:id', (req, res) => {
  const func = functions.find(f => f.id === req.params.id);
  if (!func) return res.status(404).json({ error: 'Function not found' });
  res.json(func);
});

// UPDATE Function
app.put('/api/functions/:id', (req, res) => {
  const index = functions.findIndex(f => f.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Function not found' });

  const { name, language, code, timeout } = req.body;
  functions[index] = {
    ...functions[index],
    name: name || functions[index].name,
    language: language || functions[index].language,
    code: code || functions[index].code,
    timeout: timeout || functions[index].timeout,
  };
  res.json(functions[index]);
});

// DELETE Function
app.delete('/api/functions/:id', (req, res) => {
  const index = functions.findIndex(f => f.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Function not found' });

  const deleted = functions.splice(index, 1);
  res.json(deleted[0]);
});

// EXECUTE Function (POSTMAN TESTING)
app.post('/api/execute', async (req, res) => {
  const { code, timeout } = req.body;
  const result = await executePython(code, timeout);
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
