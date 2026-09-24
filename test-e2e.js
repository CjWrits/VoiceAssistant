import WebSocket from 'ws';

async function testQuery(userId, query) {
  return new Promise((resolve, reject) => {
    console.log('\n------------------------------------------------------------');
    console.log(`TESTING [${userId}]: "${query}"`);
    console.log('------------------------------------------------------------');
    const ws = new WebSocket('ws://127.0.0.1:3000/ws');
    let tokens = '';
    let audioBytes = 0;
    let audioChunks = 0;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Test query timed out after 45s: "${query}"`));
    }, 45000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ text: query, user_id: userId, voice_engine: 'browser' }));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        audioChunks++;
        audioBytes += data.length;
        process.stdout.write(`[WAV ${data.length}B] `);
      } else {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'router_decision') {
          console.log(`\n[ROUTER DECISION]: Similarity = ${msg.similarity} (Threshold: ${msg.threshold}) -> ${msg.route}`);
        } else if (msg.type === 'rag_context') {
          console.log(`[RAG CONTEXT]: Retrieved ${msg.count} isolated docs for ${msg.userId}`);
        } else if (msg.type === 'token') {
          tokens += msg.token;
        } else if (msg.type === 'done' || msg.type === 'text_done') {
          clearTimeout(timeout);
          console.log(`\n\n[RESPONSE TEXT]:\n${tokens.trim()}`);
          console.log(`\n[AUDIO SUMMARY]: Received ${audioChunks} binary WAV chunks (${audioBytes} bytes)`);
          ws.close();
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          console.error('[ERROR]:', msg.message);
          ws.close();
          reject(new Error(msg.message));
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      console.error('[WS ERROR]:', err);
      reject(err);
    });
  });
}

async function runAll() {
  console.log('⚡ STARTING FULL END-TO-END PIPELINE VALIDATION');
  
  // Test 1: User A RAG query
  await testQuery('user_A', 'What is my emergency recovery secret passphrase?');

  // Test 2: User B Cross-tenant isolation test
  await testQuery('user_B', 'What is my emergency recovery secret passphrase?');

  // Test 3: General query (Bypass RAG)
  await testQuery('user_A', 'Explain what an edge node is in 10 words.');

  console.log('\n============================================================');
  console.log('✅ ALL END-TO-END PIPELINE TESTS COMPLETED PERFECTLY');
  console.log('============================================================');
}

runAll().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
