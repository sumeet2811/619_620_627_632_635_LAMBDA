# 🐳 Lambda-Like Serverless Function Execution Platform

A mini serverless function execution engine — inspired by AWS Lambda — built using:

- 💾 Docker containers for isolated code execution
- 🔒 gVisor runtime for secure sandboxing
- 🧠 Metrics collection (Response time, errors, resource usage)
- ⚡️ Warm-up mechanism for cold-start optimization
- 💡 Container pooling for performance boost

---

## 🧰 Features

✅ Request routing to appropriate function containers  
✅ Function warm-up & caching  
✅ Metrics collection and storage  
✅ Supports two virtualization technologies:
- Docker (Default)
- gVisor (`runsc`)

---

## 💡 How It Works

1. 💻 User sends function code via API (`POST /execute`)
2. 🐳 The system packages the code into an isolated container
3. 🚀 Executes it securely using Docker or gVisor
4. 📊 Collects execution metrics and returns the output

---

## 🐧 Project Structure



