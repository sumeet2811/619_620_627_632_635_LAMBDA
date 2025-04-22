# 🐳 Lambda-Like Serverless Function Execution Platform

A mini serverless function execution engine — inspired by AWS Lambda — built using:

- 💾 Docker containers for isolated code execution
- 🔒 gVisor runtime for secure sandboxing
- 🧠 Metrics collection (Response time, errors)
- ⚡️ Warm-up mechanism for cold-start optimization
- 💡 Container pooling for performance boost

---

## 🧰 Features

✅ Request routing to appropriate function containers  
✅ Function warm-up 
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

## ⚡️ Running Locally

1. Install Docker, gVisor, streamlit and required dependencies. 
2. Clone the repo:
   ```bash
   git clone https://github.com/sumeet2811/619_620_627_632_635_LAMBDA
3. Start the server:
   ```bash
     cd backend
     npm run dev
5. Start the frontend:
   ```bash
     cd frontend
     streamlit run ui.py
---





