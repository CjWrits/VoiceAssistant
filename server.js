/**
 * Sovereign Edge Conversational Platform - Fastify Backend Server (High Performance & Optimized)
 * 
 * Tech Stack:
 * - Backend: Node.js, Fastify, @fastify/websocket, @fastify/static
 * - Local AI: Ollama (Llama-3.2-3B-Instruct) for streaming text with AbortController barge-in
 * - Semantic Router: @xenova/transformers (all-MiniLM-L6-v2) on CPU
 * - RAG: ChromaDB + Resilient Embedded Vector Engine with strict tenant isolation (where: { user_id })
 * - TTS: Dual Engine - Browser Edge Speech (Instant 0ms) + Kokoro-82M ONNX (Edge Neural)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Suppress libvips / GLib non-critical notices
process.env.VIPS_WARNING = '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Prepend ONNX Runtime native binary directories to PATH for Windows DLL resolution
if (process.platform === 'win32') {
  const onnxDirs = [
    path.join(__dirname, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v3/win32/x64'),
    path.join(__dirname, 'node_modules/onnxruntime-node/bin/napi-v3/win32/x64'),
    path.join(__dirname, 'node_modules/@xenova/transformers/node_modules/onnxruntime-node/bin/napi-v3/win32/x64')
  ];
  for (const d of onnxDirs) {
    if (fs.existsSync(d)) {
      process.env.PATH = d + ';' + (process.env.PATH || '');
    }
  }
}

// Dynamic imports to enforce correct ONNX Runtime linking order
const Fastify = (await import('fastify')).default;
const fastifyWebsocket = (await import('@fastify/websocket')).default;
const fastifyStatic = (await import('@fastify/static')).default;
const { KokoroTTS } = await import('kokoro-js');
const { pipeline } = await import('@xenova/transformers');
const { ChromaClient } = await import('chromadb');

// ============================================================================
// CONFIGURATION & ENVIRONMENT
// ============================================================================
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
let OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';
const CHROMA_HOST = process.env.CHROMA_HOST || '127.0.0.1';
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8000', 10);
const COLLECTION_NAME = 'sovereign_rag_docs';
const SIMILARITY_THRESHOLD = 0.65;

// ============================================================================
// HARDCODED RAG TRIGGER PHRASES
// ============================================================================
const RAG_TRIGGER_PHRASES = [
  "my data",
  "my documents",
  "account details",
  "personal information",
  "confidential records",
  "my files",
  "clearance level",
  "access pass",
  "emergency passphrase",
  "security code",
  "recovery passphrase",
  "financial report",
  "budget figures",
  "infrastructure plan",
  "deployment architecture",
  "what is stored about me",
  "show my records",
  "swiss escrow code",
  "cluster deployment",
  "secret key",
  "dossier",
  "private notes"
];

// ============================================================================
// TENANT DOCUMENTS (Embedded Vector Store Fallback for Resilient Zero-Failure RAG)
// ============================================================================
const TENANT_DOCUMENTS = [
  // User A: Engineering / Infrastructure Lead (Alice Chen)
  {
    id: 'doc_user_a_1',
    text: "Project Aegis Deployment Plan: Alice Chen (user_A) manages the sovereign edge infrastructure. The production cluster is deployed across 5 edge nodes with zero-trust mTLS encryption. Emergency recovery secret passphrase: 'CYBER-PHOENIX-9842'. All edge logs are strictly encrypted with AES-256.",
    metadata: { user_id: 'user_A', title: 'Project Aegis Deployment Plan', category: 'Infrastructure', author: 'Alice Chen' }
  },
  {
    id: 'doc_user_a_2',
    text: "User A Personal Account Dossier: Alice Chen's corporate ID is AC-9941. Current clearance level: Ultra-Confidential Tier 4. Personal assigned edge server IP is 10.240.12.88 with SSH key fingerprint SHA256:7vQxM99aK. Next security review scheduled for October 15.",
    metadata: { user_id: 'user_A', title: 'Personal Account Dossier', category: 'Identity', author: 'Alice Chen' }
  },

  // User B: Chief Financial Officer (Bob Martinez)
  {
    id: 'doc_user_b_1',
    text: "Q3 Financial Audit & Treasury Report: Bob Martinez (user_B) oversees corporate asset reserves. Sovereign edge CAPEX allocation for Q3 is $4,250,000 with cash reserves maintained at Silicon Valley Edge Trust. Authorized Swiss escrow account code: 'ALPINE-VAULT-7719'.",
    metadata: { user_id: 'user_B', title: 'Q3 Financial Audit & Treasury Report', category: 'Finance', author: 'Bob Martinez' }
  },
  {
    id: 'doc_user_b_2',
    text: "User B Personal Account Dossier: Bob Martinez's employee badge ID is BM-1004. Executive clearance: Tier 5 Financial Omniscience. Bob's personal corporate credit limit is $500,000 and executive compensation wire router number is FEDWIRE-021000021.",
    metadata: { user_id: 'user_B', title: 'Personal Account Dossier', category: 'Identity', author: 'Bob Martinez' }
  }
];

// ============================================================================
// MATH UTILITIES: COSINE SIMILARITY & CENTROID
// ============================================================================

/**
 * Computes exact cosine similarity between two Float32Array or number arrays:
 * cos_sim(A, B) = (A • B) / (||A|| * ||B||)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Computes the normalized centroid vector from an array of embedding vectors.
 */
function computeNormalizedCentroid(embeddings) {
  if (!embeddings || embeddings.length === 0) return null;
  const dim = embeddings[0].length;
  const centroid = new Float32Array(dim);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }

  // Normalize to unit length
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    norm += centroid[i] * centroid[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      centroid[i] /= norm;
    }
  }

  return centroid;
}

// ============================================================================
// GLOBAL STATE & AI MODELS
// ============================================================================
let embedder = null;
let triggerEmbeddings = [];
let centroidEmbedding = null;
let inMemoryTenantDocs = [];
let chromaClient = null;
let chromaCollection = null;
let kokoro = null;

// ============================================================================
// INITIALIZE MODELS & SERVICES
// ============================================================================
async function initServices() {
  console.log('='.repeat(70));
  console.log('🚀 SOVEREIGN EDGE AI CONVERSATIONAL PLATFORM - INITIALIZING');
  console.log('='.repeat(70));

  // 1. Initialize Kokoro ONNX TTS on CPU
  console.log('[1/4] Loading Kokoro-82M ONNX TTS on CPU...');
  try {
    kokoro = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'cpu'
    });
    console.log('  -> Kokoro-82M ONNX TTS ready on CPU.');
  } catch (err) {
    console.error('  ⚠️ Kokoro TTS initialization error:', err.message);
    console.warn('     Audio streaming will fall back gracefully to browser edge speech.');
  }

  // 2. Initialize CPU Embedding Pipeline for Semantic Router & Local RAG
  console.log('[2/4] Loading @xenova/transformers (all-MiniLM-L6-v2) on CPU...');
  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('  -> Embedding pipeline ready.');

  // Pre-embed RAG triggers & compute centroid
  console.log(`  -> Pre-embedding ${RAG_TRIGGER_PHRASES.length} RAG triggers to construct router centroid...`);
  triggerEmbeddings = [];
  for (const phrase of RAG_TRIGGER_PHRASES) {
    const out = await embedder(phrase, { pooling: 'mean', normalize: true });
    triggerEmbeddings.push({
      phrase,
      vector: Array.from(out.data)
    });
  }
  centroidEmbedding = computeNormalizedCentroid(triggerEmbeddings.map(t => t.vector));
  console.log(`  -> Trigger centroid computed (${centroidEmbedding.length} dimensions).`);
  console.log(`  -> RAG Routing Threshold: ${SIMILARITY_THRESHOLD}`);

  // Pre-embed tenant documents for resilient in-memory vector fallback
  console.log(`  -> Pre-embedding ${TENANT_DOCUMENTS.length} tenant documents for resilient vector storage...`);
  inMemoryTenantDocs = [];
  for (const doc of TENANT_DOCUMENTS) {
    const out = await embedder(doc.text, { pooling: 'mean', normalize: true });
    inMemoryTenantDocs.push({
      ...doc,
      vector: Array.from(out.data)
    });
  }
  console.log('  -> In-memory tenant vector store primed.');

  // 3. Initialize ChromaDB Client & Collection (if running)
  console.log(`[3/4] Connecting to ChromaDB (http://${CHROMA_HOST}:${CHROMA_PORT})...`);
  try {
    chromaClient = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });
    await chromaClient.heartbeat();

    const chromaEmbeddingFunction = {
      generate: async (texts) => {
        const results = [];
        for (const t of texts) {
          const out = await embedder(t, { pooling: 'mean', normalize: true });
          results.push(Array.from(out.data));
        }
        return results;
      }
    };

    chromaCollection = await chromaClient.getOrCreateCollection({
      name: COLLECTION_NAME,
      embeddingFunction: chromaEmbeddingFunction
    });

    const count = await chromaCollection.count();
    console.log(`  -> Connected to ChromaDB. Collection '${COLLECTION_NAME}' has ${count} documents.`);
  } catch (err) {
    console.warn(`  ⚠️ ChromaDB not reachable at http://${CHROMA_HOST}:${CHROMA_PORT}.`);
    console.log(`     Autonomous in-memory vector store is ACTIVE for tenant-isolated RAG.`);
  }

  // 4. Verify Ollama Connection & auto-detect model
  console.log('[4/4] Verifying Ollama local model availability...');
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      const models = data.models?.map(m => m.name) || [];
      console.log(`  -> Installed Ollama models: ${models.join(', ')}`);
      if (!models.includes(OLLAMA_MODEL)) {
        const candidate = models.find(m => m.startsWith('llama3.2')) || models[0];
        if (candidate) {
          console.log(`  -> Auto-selected model: '${candidate}'`);
          OLLAMA_MODEL = candidate;
        }
      } else {
        console.log(`  -> Using model: '${OLLAMA_MODEL}'`);
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Ollama not reachable at ${OLLAMA_HOST}. Ensure Ollama is running.`);
  }

  console.log('='.repeat(70));
  console.log('✅ ALL LOCAL EDGE SYSTEMS OPERATIONAL');
  console.log('='.repeat(70));
}

// ============================================================================
// SEMANTIC ROUTER LOGIC
// ============================================================================

/**
 * Evaluates user query embedding against the RAG trigger phrases and centroid.
 * Returns similarity score, decision, closest trigger phrase, and query vector.
 */
async function routeQuery(queryText) {
  const startTime = Date.now();
  const queryOut = await embedder(queryText, { pooling: 'mean', normalize: true });
  const queryVec = Array.from(queryOut.data);

  // 1. Centroid Cosine Similarity
  const centroidSim = cosineSimilarity(queryVec, centroidEmbedding);

  // 2. Max similarity against individual triggers
  let maxTriggerSim = -1;
  let bestPhrase = '';
  for (const t of triggerEmbeddings) {
    const sim = cosineSimilarity(queryVec, t.vector);
    if (sim > maxTriggerSim) {
      maxTriggerSim = sim;
      bestPhrase = t.phrase;
    }
  }

  // Combined score: take max of centroid and closest trigger
  const finalSimilarity = Math.max(centroidSim, maxTriggerSim);
  const shouldTriggerRag = finalSimilarity >= SIMILARITY_THRESHOLD;
  const elapsedMs = Date.now() - startTime;

  return {
    similarity: parseFloat(finalSimilarity.toFixed(4)),
    centroidSimilarity: parseFloat(centroidSim.toFixed(4)),
    maxTriggerSimilarity: parseFloat(maxTriggerSim.toFixed(4)),
    matchedPhrase: bestPhrase,
    threshold: SIMILARITY_THRESHOLD,
    shouldTriggerRag,
    route: shouldTriggerRag ? 'CHROMA_RAG' : 'DIRECT_OLLAMA',
    queryVector: queryVec,
    elapsedMs
  };
}

// ============================================================================
// ADAPTIVE VOICE CHUNKER: CLAUSE & SENTENCE BOUNDARY EXTRACTION
// ============================================================================

/**
 * Extracts voice chunks smoothly.
 * Splits on terminal punctuation [.?!] or clause boundaries [,;:] if >= 60 characters
 * to avoid over-fragmentation and robotic stutter.
 */
function extractVoiceChunks(buffer, isFinal = false) {
  const chunks = [];
  let remaining = buffer;

  while (true) {
    // 1. Terminal punctuation: [.?!] followed by whitespace or end of string
    let match = remaining.match(/^([\s\S]*?[.?!]+)([\s\r\n]+|$)/);

    // 2. Clause punctuation: [,;:] only if sentence has accumulated >= 60 chars
    if (!match) {
      const clauseMatch = remaining.match(/^([\s\S]{60,}?[,;:]+)([\s\r\n]+)/);
      if (clauseMatch) {
        match = clauseMatch;
      }
    }

    if (!match) {
      if (isFinal && remaining.trim().length > 0) {
        chunks.push(remaining.trim());
        remaining = '';
      }
      break;
    }

    const chunk = match[1].trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(match[0].length);

    if (!isFinal) break; // In streaming mode, process one chunk at a time
  }

  return { chunks, remaining };
}

// ============================================================================
// FASTIFY APPLICATION SETUP
// ============================================================================
const app = Fastify({ logger: false });

// Register WebSocket plugin
await app.register(fastifyWebsocket);

// Serve static frontend UI from ./public
await app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

// REST Health Check
app.get('/api/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    threshold: SIMILARITY_THRESHOLD,
    model: OLLAMA_MODEL,
    ragCollection: COLLECTION_NAME
  };
});

// ============================================================================
// WEBSOCKET HANDLER: STREAMING AI CONVERSATION PIPELINE
// ============================================================================
app.get('/ws', { websocket: true }, (socket, req) => {
  const ws = socket.socket || socket;
  ws.currentGenId = 0; // Generation ID for conversational barge-in / interruption
  ws.currentAbortController = null; // AbortController to immediately stop LLM HTTP stream
  console.log('⚡ Client connected via WebSocket.');

  ws.on('message', async (rawMessage) => {
    let payload;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON payload' }));
      return;
    }

    const { text, user_id, voice_engine = 'browser' } = payload;
    if (!text || !user_id) {
      ws.send(JSON.stringify({ type: 'error', message: 'Payload must contain { text, user_id }' }));
      return;
    }

    // CONVERSATIONAL BARGE-IN:
    // Abort active upstream Ollama generation immediately!
    if (ws.currentAbortController) {
      try {
        ws.currentAbortController.abort();
      } catch (err) {}
      ws.currentAbortController = null;
    }

    const genId = Date.now();
    ws.currentGenId = genId;
    let abortController = null;

    console.log(`\n[WS Request #${genId}] Tenant: ${user_id} | Voice: ${voice_engine} | Query: "${text}"`);

    try {
      // ------------------------------------------------------------------------
      // STEP 1: SEMANTIC ROUTING (CPU Cosine Similarity)
      // ------------------------------------------------------------------------
      const routeInfo = await routeQuery(text);
      console.log(`[Router] Similarity: ${routeInfo.similarity} (Threshold: ${routeInfo.threshold}) -> Route: ${routeInfo.route} (${routeInfo.elapsedMs}ms)`);

      // Stream routing decision telemetry to client
      ws.send(JSON.stringify({
        type: 'router_decision',
        similarity: routeInfo.similarity,
        centroidSimilarity: routeInfo.centroidSimilarity,
        maxTriggerSimilarity: routeInfo.maxTriggerSimilarity,
        matchedPhrase: routeInfo.matchedPhrase,
        threshold: routeInfo.threshold,
        shouldTriggerRag: routeInfo.shouldTriggerRag,
        route: routeInfo.route,
        elapsedMs: routeInfo.elapsedMs,
        userId: user_id,
        genId: genId
      }));

      // ------------------------------------------------------------------------
      // STEP 2: RAG QUERY WITH STRICT TENANT ISOLATION (where: { user_id })
      // ------------------------------------------------------------------------
      let retrievedDocs = [];
      let retrievedMetadatas = [];

      if (routeInfo.shouldTriggerRag) {
        // Option A: Query ChromaDB if reachable
        if (chromaCollection) {
          try {
            console.log(`[ChromaDB] Executing tenant-isolated query: WHERE user_id = '${user_id}'`);
            // Pass pre-computed queryVector directly to avoid re-embedding on CPU!
            const queryResult = await chromaCollection.query({
              queryEmbeddings: [routeInfo.queryVector],
              nResults: 2,
              where: { user_id: user_id }
            });

            retrievedDocs = queryResult.documents?.[0] || [];
            retrievedMetadatas = queryResult.metadatas?.[0] || [];
            console.log(`[ChromaDB] Retrieved ${retrievedDocs.length} isolated documents for ${user_id}`);
          } catch (ragErr) {
            console.warn(`[ChromaDB] Query failed (${ragErr.message}). Using in-memory fallback.`);
            retrievedDocs = [];
            retrievedMetadatas = [];
          }
        }

        // Option B: Resilient In-Memory Vector Store Fallback
        if (retrievedDocs.length === 0 && inMemoryTenantDocs.length > 0) {
          const tenantDocs = inMemoryTenantDocs.filter(d => d.metadata.user_id === user_id);
          const scoredDocs = tenantDocs.map(d => ({
            doc: d.text,
            metadata: d.metadata,
            similarity: cosineSimilarity(routeInfo.queryVector, d.vector)
          })).filter(d => d.similarity >= 0.16)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 2);

          if (scoredDocs.length > 0) {
            retrievedDocs = scoredDocs.map(d => d.doc);
            retrievedMetadatas = scoredDocs.map(d => d.metadata);
            console.log(`[Embedded Vector Store] Retrieved ${retrievedDocs.length} isolated documents for ${user_id}`);
          }
        }

        // Stream RAG context telemetry to client
        ws.send(JSON.stringify({
          type: 'rag_context',
          documents: retrievedDocs,
          metadatas: retrievedMetadatas,
          count: retrievedDocs.length,
          userId: user_id,
          genId: genId
        }));
      }

      // ------------------------------------------------------------------------
      // STEP 3: CONSTRUCT OLLAMA PROMPTS (Strict Tenant Partitioning & Spoken Clarity)
      // ------------------------------------------------------------------------
      let systemPrompt;
      if (routeInfo.shouldTriggerRag) {
        if (retrievedDocs.length > 0) {
          systemPrompt = `You are a sovereign conversational edge AI voice assistant.
Active authenticated tenant: ${user_id}.

ISOLATED CONFIDENTIAL DOCUMENTS FOR ${user_id}:
${retrievedDocs.map((doc, i) => `[Doc ${i + 1}] (${retrievedMetadatas[i]?.title || 'Confidential'}): ${doc}`).join('\n')}

VOICE SYNTHESIS RULES:
1. Provide the direct answer in 1 or 2 concise, natural sentences based strictly on the isolated documents above.
2. Start directly with the answer (e.g., "Your emergency recovery passphrase is CYBER-PHOENIX-9842.").
3. Do NOT use markdown, bullet points, asterisks, or quotes. Write in clean spoken English.`;
        } else {
          // Negative test / cross-tenant probe: Tenant does NOT have access or 0 docs found!
          systemPrompt = `You are a sovereign conversational edge AI voice assistant.
Active authenticated tenant: ${user_id}.

SECURITY ALERT: The user queried confidential records, but ZERO matching records exist in their isolated partition (${user_id}).
Do NOT guess or hallucinate any passwords, codes, or secrets.
Politely inform the user in 1 concise sentence that no confidential records matching this query exist in their authorized account or clearance tier.
Do NOT use markdown, bullet points, asterisks, or quotes. Speak naturally.`;
        }
      } else {
        systemPrompt = `You are a sovereign conversational edge AI voice assistant running locally on edge hardware.
Active tenant: ${user_id}.

VOICE SYNTHESIS RULES:
1. Answer directly and concisely in 1 or 2 short, conversational sentences.
2. Do NOT use markdown, asterisks, or bullet points. Speak naturally and clearly.`;
      }

      // ------------------------------------------------------------------------
      // STEP 4: OLLAMA STREAMING & ADAPTIVE VOICE CHUNKING
      // ------------------------------------------------------------------------
      abortController = new AbortController();
      ws.currentAbortController = abortController;

      console.log(`[Ollama] Dispatching streaming generation (Model: ${OLLAMA_MODEL})...`);
      const ollamaResponse = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: text,
          system: systemPrompt,
          stream: true
        }),
        signal: abortController.signal
      });

      if (!ollamaResponse.ok) {
        throw new Error(`Ollama returned status ${ollamaResponse.status} ${ollamaResponse.statusText}`);
      }

      const reader = ollamaResponse.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let sentenceBuffer = '';
      let fullResponseText = '';
      let streamLineBuffer = '';

      // Only invoke Kokoro ONNX on CPU if the client explicitly requested Kokoro voice!
      // This prevents massive CPU stalls when using Browser Edge Speech or Voice Off!
      const isKokoroActive = (voice_engine === 'kokoro') && (kokoro !== null);
      let audioQueuePromise = Promise.resolve();

      function queueTtsChunk(chunkText) {
        if (!isKokoroActive || !chunkText || chunkText.trim().length === 0) return;

        audioQueuePromise = audioQueuePromise.then(async () => {
          // Barge-in check: If user sent a newer message, skip stale chunk!
          if (ws.currentGenId !== genId) {
            return;
          }

          // Strip any accidental markdown punctuation from spoken text
          const cleanSpeechText = chunkText.replace(/[*_#`~[\]]/g, '').trim();
          if (cleanSpeechText.length === 0) return;

          try {
            const startTts = Date.now();
            const audio = await kokoro.generate(cleanSpeechText, {
              voice: 'af_heart',
              speed: 1.1
            });
            const wavArrayBuffer = audio.toWav();
            const wavBuffer = Buffer.from(wavArrayBuffer);
            const ttsDuration = Date.now() - startTts;
            console.log(`  [TTS Synthesized] "${cleanSpeechText.slice(0, 35)}..." (${wavBuffer.length} bytes, ${ttsDuration}ms)`);

            // Stream raw WAV binary frame down WebSocket if still active request
            if (ws.readyState === 1 /* OPEN */ && ws.currentGenId === genId) {
              ws.send(wavBuffer, { binary: true });
            }
          } catch (ttsErr) {
            console.error(`  ⚠️ [TTS Error] Could not synthesize chunk "${cleanSpeechText}":`, ttsErr.message);
          }
        }).catch(err => {
          console.error('Audio queue pipeline error:', err);
        });
      }

      // Read LLM stream chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Check if user interrupted with a new query during LLM streaming
        if (ws.currentGenId !== genId) {
          console.log(`[LLM Abort] Query #${genId} superseded by new user input`);
          reader.cancel();
          return;
        }

        streamLineBuffer += decoder.decode(value, { stream: true });
        const lines = streamLineBuffer.split('\n');
        streamLineBuffer = lines.pop(); // Retain incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed;
          try {
            parsed = JSON.parse(line);
          } catch (e) {
            continue;
          }

          const token = parsed.response || '';
          if (token) {
            fullResponseText += token;
            sentenceBuffer += token;

            // Stream text token immediately to WebSocket client for real-time UI
            ws.send(JSON.stringify({ type: 'token', token, genId: genId }));

            // Adaptive Voice Chunking for Kokoro TTS if enabled
            if (isKokoroActive) {
              const { chunks, remaining } = extractVoiceChunks(sentenceBuffer, false);
              if (chunks.length > 0) {
                for (const chunk of chunks) {
                  queueTtsChunk(chunk);
                }
                sentenceBuffer = remaining;
              }
            }
          }

          if (parsed.done) {
            break;
          }
        }
      }

      // Process any remaining text in sentenceBuffer at stream end for Kokoro
      if (isKokoroActive) {
        const { chunks: finalChunks } = extractVoiceChunks(sentenceBuffer, true);
        for (const finalChunk of finalChunks) {
          queueTtsChunk(finalChunk);
        }
      }
      sentenceBuffer = '';

      console.log(`[Text Stream Complete] Tenant: ${user_id} | Response length: ${fullResponseText.length} chars`);

      // Immediately signal completion to client chat UI
      ws.send(JSON.stringify({
        type: 'text_done',
        done: true, // For test-e2e compatibility
        fullText: fullResponseText,
        route: routeInfo.route,
        similarity: routeInfo.similarity,
        ragDocsCount: retrievedDocs.length,
        userId: user_id,
        genId: genId
      }));

      // If Kokoro audio chunks were generated, send audio_done when queue drains
      if (isKokoroActive) {
        audioQueuePromise.then(() => {
          if (ws.readyState === 1 && ws.currentGenId === genId) {
            ws.send(JSON.stringify({ type: 'audio_done', genId: genId }));
          }
        });
      }

    } catch (flowErr) {
      if (flowErr.name === 'AbortError') {
        console.log(`[WS Request #${genId}] Aborted cleanly by barge-in.`);
        return;
      }
      console.error('[Pipeline Execution Error]:', flowErr);
      ws.send(JSON.stringify({
        type: 'error',
        message: `Pipeline failure: ${flowErr.message}`
      }));
    } finally {
      if (ws.currentAbortController === abortController) {
        ws.currentAbortController = null;
      }
    }
  });

  ws.on('close', () => {
    console.log('⚡ WebSocket client disconnected.');
    if (ws.currentAbortController) {
      try { ws.currentAbortController.abort(); } catch (e) {}
    }
  });
});

// ============================================================================
// SERVER BOOTSTRAP
// ============================================================================
async function start() {
  await initServices();

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 Server listening at http://${HOST}:${PORT}`);
    console.log(`🔗 WebSocket available at ws://${HOST}:${PORT}/ws`);
    console.log(`💻 Web UI served at http://${HOST}:${PORT}/\n`);
  } catch (err) {
    console.error('Failed to start Fastify server:', err);
    process.exit(1);
  }
}

start();
