# Sovereign Edge Conversational Voice Assistant ⚡

A high-performance, 100% local edge conversational voice AI platform powered by Node.js, Fastify, Ollama (Llama 3.2), Xenova Semantic Router, ChromaDB with tenant-isolated RAG, and dual-engine voice synthesis (Browser Edge Speech + Kokoro-82M ONNX).

---

## 🚀 Key Features

* **100% Local & Sovereign**: Zero cloud dependencies, zero external API keys required. All text generation, semantic routing, vector embeddings, and speech synthesis run locally on your edge hardware.
* **Semantic Router (MiniLM on CPU)**: Intelligent routing using `@xenova/transformers` (`all-MiniLM-L6-v2`) with cosine similarity scoring against dynamic trigger centroids to automatically route queries to isolated RAG or direct LLM bypass.
* **Strict Multi-Tenant Isolated RAG**: Vector searches are strictly partitioned by tenant ID (`WHERE user_id = ?`) with fallback embedded vector support and negative-probe protections.
* **Dual-Engine Speech Synthesis**:
  * **Browser Edge Speech**: Zero-latency (0ms), immediate sentence streaming via Web Speech API.
  * **Kokoro-82M ONNX**: High-fidelity local neural text-to-speech engine running on CPU with smooth clause chunking.
* **Instant Conversational Barge-In**: Interrupt speech anytime by typing or speaking a new query. The system instantly stops audio and aborts upstream LLM generation.
* **Modern Clean UI**: Refined light aesthetic with sleek telemetry HUD, live cosine similarity meter, tenant isolation filter, soundwave equalizer, and light/dark mode toggle.

---

## 🛠️ Architecture Overview

```text
User Input (WebSocket)
      │
      ▼
Semantic Router (MiniLM-L6-v2 CPU) ──> Cosine Sim >= 0.65?
      ├────────────────────────┬────────────────────────┤
     YES                       NO
      ▼                        ▼
ChromaDB / Vector Fallback   Direct Stream
(WHERE user_id = tenant)       │
      │                        │
      ▼                        │
Contextualized Spoken Prompt ◄─┘
      │
      ▼
Ollama (Llama-3.2-3B Streaming) [AbortController Support]
      │
      ├──> Instant Text Tokens (UI Stream)
      └──> Adaptive Voice Synthesizer
            ├── Browser Edge Speech (Instant 0ms)
            └── Kokoro-82M ONNX TTS (Binary WAV Chunks)
```

---

## 📦 Getting Started

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Ollama](https://ollama.com/) with `llama3.2:latest` installed:
  ```bash
  ollama run llama3.2:latest
  ```
* (Optional) Python with ChromaDB for standalone vector server:
  ```bash
  pip install chromadb uvicorn
  ```

### 2. Installation
```bash
git clone https://github.com/CjWrits/VoiceAssistant.git
cd VoiceAssistant
npm install
```

### 3. Run the Platform
Start the server:
```bash
npm start
```
Open your browser at [http://127.0.0.1:3000](http://127.0.0.1:3000).

### 4. Run Automated End-to-End Tests
```bash
npm test
```

---

## 🛡️ Tenant Isolation Demo Queries

| Tenant | Query | Expected Route | Expected Result |
| :--- | :--- | :--- | :--- |
| **User A (Alice Chen)** | *"What is my emergency recovery secret passphrase?"* | `CHROMA_RAG` | Returns `CYBER-PHOENIX-9842` |
| **User B (Bob Martinez)** | *"What is my emergency recovery secret passphrase?"* | `CHROMA_RAG` | Access Denied (0 records found in partition) |
| **User B (Bob Martinez)** | *"What is my authorized Swiss escrow account code?"* | `CHROMA_RAG` | Returns `ALPINE-VAULT-7719` |
| **Any Tenant** | *"Explain what an edge node is in 10 words."* | `DIRECT_OLLAMA` | Direct LLM response (RAG bypassed) |

---

## 📄 License
MIT License.
