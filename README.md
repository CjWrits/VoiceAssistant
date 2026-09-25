# Sovereign Edge Conversational Voice Assistant ⚡

A high-performance, 100% sovereign local edge conversational voice AI platform powered by Node.js, Fastify, Ollama (Llama 3.2), Xenova Semantic Router, ChromaDB with tenant-isolated RAG, embedded SQLite persistent storage, and dual-engine voice synthesis (Browser Edge Speech + Kokoro-82M ONNX).

---

## 🚀 Key Features

* **100% Sovereign & Self-Hosted**: Zero cloud dependencies, zero external inference APIs. All LLM generation, semantic routing, vector embeddings, persistent storage, and speech synthesis execute locally on edge hardware.
* **Cryptographic Authentication & Zero-Trust Tenant Isolation**: Every WebSocket handshake is verified with HMAC-SHA256 session tokens. Client payload `user_id` is never trusted for authorization; all database and RAG operations are strictly bounded to `authenticatedUserId`.
* **Deterministic Verification Engine (Zero LLM Hallucination)**: Sensitive assertions (passphrases, escrow codes, badge IDs, clearance levels, credit limits) are evaluated via constant-time timing-safe cryptographic comparisons against authoritative vault records with zero LLM invocation.
* **Persistent Storage & Multi-Turn Conversational Memory**: High-concurrency embedded SQLite in WAL mode (`PRAGMA journal_mode = WAL`) preserves dialog turns across browser reloads and server restarts. Ollama `/api/chat` maintains recent multi-turn context while isolating tenant histories.
* **Progressive Intent Router**: Fast-path deterministic routing (< 1ms, 0 CPU embedding overhead) for greetings, control signals, and verifications; MiniLM CPU fallback with trigger centroids for RAG routing.
* **Dual-Engine Speech Synthesis**:
  * **Browser Edge Speech**: Zero-latency (0ms), immediate streaming via Web Speech API.
  * **Kokoro-82M ONNX**: High-fidelity local neural text-to-speech engine running on CPU with dual-phase adaptive clause chunking.
* **Instant Conversational Barge-In**: Interrupt speech anytime by typing or speaking. The system aborts upstream LLM generation via `AbortController` and drains audio queues immediately.
* **Modern Clean UI**: Refined aesthetic with real-time telemetry HUD (TTFT, tokens/sec, routing latency), live tenant isolation indicators, chat history restoration, and light/dark theme toggle.

---

## 🛠️ Architecture Overview

```text
CLIENT (WebSocket Handshake + HMAC-SHA256 Token)
      │
      ▼
Server Derives authenticatedUserId (Zero Client Trust)
      │
      ▼
Progressive Intent Router
      ├───────────────────────┬────────────────────────┬──────────────────────┐
      │ GREETING / CONTROL    │ SENSITIVE ASSERTION    │ OPEN QUERY           │
      ▼                       ▼                        ▼                      │
Direct Template         Deterministic Engine     MiniLM-L6-v2 Embedder        │
(0ms, 0 CPU)            (Constant-Time Equal)    (Cosine Sim >= 0.68?)        │
      │                       │                  ├──────────────┬─────────────┤
      │                       │                 YES             NO            │
      │                       │                  ▼              ▼             │
      │                       │             ChromaDB /     Direct Chat        │
      │                       │             Local Vault         │             │
      │                       │             (WHERE user_id)     │             │
      │                       │                  │              │             │
      │                       │                  ▼              │             │
      │                       │             Grounded Prompt ◄───┘             │
      │                       │                  │                            │
      │                       │                  ▼                            │
      │                       │             SQLite WAL: Fetch Dialog History  │
      │                       │                  │                            │
      │                       │                  ▼                            │
      │                       │             Ollama (/api/chat Stream)         │
      │                       │                  │                            │
      ▼                       ▼                  ▼                            │
UI Stream & Adaptive Voice Synthesizer ◄─────────┴────────────────────────────┘
      ├── Browser Edge Speech (Instant 0ms)
      └── Kokoro-82M ONNX Neural TTS (Adaptive Clause Chunks)
      │
      ▼
SQLite WAL: Persist Turn (Tenant-Partitioned Audit Trail)
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
The repository includes an extensive automated security, grounding, anti-sycophancy, and persistent memory benchmark:
```bash
npm test
```

---

## 🛡️ Benchmark Verification Matrix (26/26 Tests Passing)

| Test Category | Tested Constraint | Verification Guarantee |
| :--- | :--- | :--- |
| **Authentication** | Handshake Enforcement | Unauthenticated and tampered HMAC tokens rejected immediately. |
| **Tenant Isolation** | Spoofing Immunity | Malicious payload `user_id` ignored; strict partition isolation enforced. |
| **Verification** | Zero LLM Hallucination | Exact timing-safe constant-time evaluation of credentials with zero LLM invocation. |
| **Synthetic Generation** | Intent Differentiation | Generation requests bypass RAG and never leak stored secrets. |
| **Grounded RAG** | Evidence Boundary | Context wrapped in untrusted data delimiters; refutes false premises. |
| **Router Latency** | Fast-Path Execution | Greetings and commands route in ≤ 1ms with 0 CPU embedding computation. |
| **Telemetry** | Observability | Every turn emits structured metrics (routing, retrieval, TTFT, generation, tokens/s). |
| **Anti-Sycophancy** | Guardrail Robustness | System rejects false IP, credit limit, and role assertions; resists jailbreak overrides. |
| **Persistent Storage** | Session Continuity | SQLite WAL records turns; `/api/history` restores dialog; cross-tenant history is strictly isolated. |

---

## 📄 License
MIT License.
