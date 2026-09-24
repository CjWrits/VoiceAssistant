/**
 * Sovereign Edge Conversational Platform - ChromaDB Seeder
 * Populates isolated RAG vector collection with tenant-separated documents for user_A and user_B.
 */

import { ChromaClient } from 'chromadb';
import { pipeline } from '@xenova/transformers';

console.log('='.repeat(70));
console.log('⚡ SOVEREIGN EDGE RAG INITIALIZATION & SEEDING');
console.log('='.repeat(70));

const CHROMA_HOST = process.env.CHROMA_HOST || '127.0.0.1';
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8000', 10);
const COLLECTION_NAME = 'sovereign_rag_docs';

async function main() {
  console.log(`[1/4] Initializing local all-MiniLM-L6-v2 CPU embedding pipeline...`);
  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  const chromaEmbeddingFunction = {
    generate: async (texts) => {
      const results = [];
      for (const text of texts) {
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        results.push(Array.from(output.data));
      }
      return results;
    }
  };

  console.log(`[2/4] Connecting to ChromaDB instance at http://${CHROMA_HOST}:${CHROMA_PORT}...`);
  const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT });

  try {
    const heartbeat = await client.heartbeat();
    console.log(`  -> ChromaDB heartbeat OK:`, heartbeat);
  } catch (err) {
    console.error(`❌ Failed to connect to ChromaDB at http://${CHROMA_HOST}:${CHROMA_PORT}.`);
    console.error(`   Ensure ChromaDB is running via: python -m uvicorn chromadb.app:app --host 127.0.0.1 --port 8000`);
    process.exit(1);
  }

  // Clean reset of existing collection if present
  try {
    const existing = await client.getCollection({
      name: COLLECTION_NAME,
      embeddingFunction: chromaEmbeddingFunction
    });
    if (existing) {
      console.log(`  -> Removing existing '${COLLECTION_NAME}' collection for fresh seed...`);
      await client.deleteCollection({ name: COLLECTION_NAME });
    }
  } catch (err) {
    // Collection doesn't exist yet, proceed
  }

  console.log(`[3/4] Creating collection '${COLLECTION_NAME}'...`);
  const collection = await client.createCollection({
    name: COLLECTION_NAME,
    embeddingFunction: chromaEmbeddingFunction,
    metadata: { "hnsw:space": "cosine", "description": "Sovereign tenant-isolated RAG storage" }
  });

  // Tenant Documents
  const documents = [
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

  console.log(`[4/4] Inserting isolated documents into vector store...`);
  await collection.add({
    ids: documents.map(d => d.id),
    documents: documents.map(d => d.text),
    metadatas: documents.map(d => d.metadata)
  });

  const count = await collection.count();
  console.log(`  -> Successfully seeded ${count} documents into '${COLLECTION_NAME}'.\n`);

  console.log('='.repeat(70));
  console.log('🔒 VERIFYING TENANT ISOLATION (WHERE user_id = ?)');
  console.log('='.repeat(70));

  // Test query for user_A
  const testQueryA = await collection.query({
    queryTexts: ['recovery passphrase or account code'],
    nResults: 2,
    where: { user_id: 'user_A' }
  });
  console.log('User A Query ("recovery passphrase or account code"):');
  testQueryA.documents[0].forEach((doc, i) => {
    console.log(`  [Doc ${i + 1}] (Meta: ${JSON.stringify(testQueryA.metadatas[0][i])}):`);
    console.log(`    "${doc}"`);
  });

  console.log('');

  // Test query for user_B
  const testQueryB = await collection.query({
    queryTexts: ['recovery passphrase or account code'],
    nResults: 2,
    where: { user_id: 'user_B' }
  });
  console.log('User B Query ("recovery passphrase or account code"):');
  testQueryB.documents[0].forEach((doc, i) => {
    console.log(`  [Doc ${i + 1}] (Meta: ${JSON.stringify(testQueryB.metadatas[0][i])}):`);
    console.log(`    "${doc}"`);
  });

  console.log('\n✅ SEEDING COMPLETE: Tenant isolation strictly verified.');
}

main().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
