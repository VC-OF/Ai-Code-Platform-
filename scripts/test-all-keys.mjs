import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// 1. Read .env.local
const envFile = path.join(process.cwd(), '.env.local');
const env = {};
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
}

// 2. Read .platform/settings.key
const keyFile = path.join(process.cwd(), '.platform', 'settings.key');
let settingsKeySecret = '';
if (process.env.SETTINGS_ENCRYPTION_KEY) {
  settingsKeySecret = process.env.SETTINGS_ENCRYPTION_KEY;
} else if (env.SETTINGS_ENCRYPTION_KEY) {
  settingsKeySecret = env.SETTINGS_ENCRYPTION_KEY;
} else if (fs.existsSync(keyFile)) {
  settingsKeySecret = fs.readFileSync(keyFile, 'utf8').trim();
}

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function decryptWith(key, payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function decrypt(payload) {
  const attempts = [];
  if (settingsKeySecret) {
    attempts.push(deriveKey(settingsKeySecret));
  }
  if (fs.existsSync(keyFile)) {
    attempts.push(deriveKey(fs.readFileSync(keyFile, 'utf8').trim()));
  }
  attempts.push(deriveKey('dev-only-insecure-default-key-change-me'));

  for (const key of attempts) {
    try {
      return decryptWith(key, payload);
    } catch {
      // try the next candidate key
    }
  }
  throw new Error('Failed to decrypt with any known key');
}

// 3. Read .settings/*.json
const settingsDir = path.join(process.cwd(), '.settings');
const decryptedSettings = {};
if (fs.existsSync(settingsDir)) {
  const files = fs.readdirSync(settingsDir);
  for (const file of files) {
    if (file.endsWith('.json')) {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(settingsDir, file), 'utf8'));
        for (const [k, v] of Object.entries(content)) {
          try {
            decryptedSettings[k] = decrypt(v);
          } catch (err) {
            console.error(`Error decrypting ${k} in ${file}: ${err.message}`);
          }
        }
      } catch {}
    }
  }
}

// Merge all keys
const allKeys = {
  ...decryptedSettings,
  ...env,
};

// ----------------- TEST GROQ -----------------
async function testGroq(apiKey) {
  console.log('\n========================================');
  console.log('Testing GROQ_API_KEY');
  console.log('========================================');
  try {
    // 1. List models
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const modelsData = await modelsRes.json();
    if (!modelsRes.ok) {
      console.log('✗ Groq Auth / List Models Failed:', modelsData);
      return { success: false, error: modelsData };
    }
    const modelIds = (modelsData.data || []).map(m => m.id);
    console.log(`✓ Groq Authentication successful! Found ${modelIds.length} models:`);
    console.log(modelIds.slice(0, 8).join(', ') + (modelIds.length > 8 ? '...' : ''));

    // Pick first active model, prefer llama-3.3-70b-versatile or whatever is available
    const preferredModel = modelIds.find(m => m.includes('llama-3.3-70b') || m.includes('llama-3.1') || m.includes('llama3') || m.includes('mixtral') || m.includes('gemma')) || modelIds[0];
    console.log(`Testing chat completion with model: "${preferredModel}"...`);

    const chatRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: preferredModel,
        messages: [{ role: 'user', content: 'Reply with "GROQ_OK".' }],
        max_tokens: 15,
      }),
    });
    const chatData = await chatRes.json();
    if (chatRes.ok) {
      const reply = chatData.choices?.[0]?.message?.content?.trim();
      console.log(`✓ Groq End-to-End Chat Completion SUCCESS!`);
      console.log(`  Model: ${preferredModel}`);
      console.log(`  Response: "${reply}"`);
      return { success: true, model: preferredModel, reply };
    } else {
      console.log('✗ Groq Chat Completion Failed:', chatData);
      return { success: false, error: chatData };
    }
  } catch (err) {
    console.log('✗ Groq Exception:', err.message);
    return { success: false, error: err.message };
  }
}

// ----------------- TEST OPENROUTER -----------------
async function testOpenRouter(apiKey) {
  console.log('\n========================================');
  console.log('Testing OPENROUTER_API_KEY');
  console.log('========================================');
  try {
    const authRes = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const authData = await authRes.json();
    if (!authRes.ok) {
      console.log('✗ OpenRouter Auth Failed:', authData);
      return { success: false, error: authData };
    }
    console.log('✓ OpenRouter Authentication successful!');
    console.log(`  Usage: $${authData.data?.usage || 0}`);
    console.log(`  Free requests remaining today: ${authData.data?.free_model_daily_requests?.remaining ?? 'N/A'}`);

    // Test with model configured in .env.local: moonshotai/kimi-k3 or moonshotai/kimi-k2.7-code or meta-llama/llama-3.3-70b-instruct:free
    const targetModel = (env.LLM_MODEL || '').replace('openrouter:', '') || 'meta-llama/llama-3.3-70b-instruct:free';
    console.log(`Testing chat completion with configured model: "${targetModel}"...`);

    const chatRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'AI Code Platform Test',
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [{ role: 'user', content: 'Say "OPENROUTER_OK" only.' }],
        max_tokens: 30,
      }),
    });
    const chatData = await chatRes.json();
    if (chatRes.ok) {
      const reply = chatData.choices?.[0]?.message?.content?.trim();
      console.log(`✓ OpenRouter End-to-End Chat Completion SUCCESS!`);
      console.log(`  Model: ${chatData.model || targetModel}`);
      console.log(`  Response: "${reply}"`);
      return { success: true, model: targetModel, reply };
    } else {
      console.log(`Notice: Model ${targetModel} returned:`, JSON.stringify(chatData));
      console.log('Testing fallback model: meta-llama/llama-3.3-70b-instruct:free ...');
      const chatRes2 = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [{ role: 'user', content: 'Say "OPENROUTER_OK" only.' }],
          max_tokens: 30,
        }),
      });
      const chatData2 = await chatRes2.json();
      if (chatRes2.ok) {
        const reply = chatData2.choices?.[0]?.message?.content?.trim();
        console.log(`✓ OpenRouter End-to-End Chat Completion (free tier) SUCCESS!`);
        console.log(`  Response: "${reply}"`);
        return { success: true, model: 'meta-llama/llama-3.3-70b-instruct:free', reply, note: `Primary model ${targetModel} had: ${chatData.error?.message}` };
      } else {
        return { success: false, error: chatData2 };
      }
    }
  } catch (err) {
    console.log('✗ OpenRouter Exception:', err.message);
    return { success: false, error: err.message };
  }
}

// ----------------- TEST GEMINI -----------------
async function testGemini(apiKey) {
  console.log('\n========================================');
  console.log('Testing GEMINI_API_KEY');
  console.log('========================================');
  try {
    // 1. Query models
    const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const modelsData = await modelsRes.json();
    if (!modelsRes.ok) {
      console.log('✗ Gemini Auth Failed:', modelsData);
      return { success: false, error: modelsData };
    }
    const modelNames = (modelsData.models || []).map(m => m.name.replace('models/', ''));
    console.log(`✓ Gemini Authentication successful! Found ${modelNames.length} models:`);
    const flashModels = modelNames.filter(m => m.includes('flash') || m.includes('gemini'));
    console.log(flashModels.slice(0, 10).join(', '));

    // Determine working model name
    // Google recently updated Gemini 2.0 / 2.5 / 1.5 naming
    const candidateModels = [
      'gemini-2.5-flash',
      'gemini-1.5-flash',
      'gemini-2.0-flash-exp',
      'gemini-flash-latest',
      modelNames.find(m => m.includes('flash')),
      'gemini-1.5-pro'
    ].filter(Boolean);

    let completionSuccess = false;
    let successModel = '';
    let successReply = '';
    let lastError = null;

    for (const m of candidateModels) {
      console.log(`Testing chat completion via OpenAI-compatible endpoint with model "${m}"...`);
      const chatRes = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: 'Reply with "GEMINI_OK".' }],
          max_tokens: 15,
        }),
      });
      const chatData = await chatRes.json();
      if (chatRes.ok) {
        successReply = chatData.choices?.[0]?.message?.content?.trim();
        successModel = m;
        completionSuccess = true;
        console.log(`✓ Gemini End-to-End Chat Completion SUCCESS!`);
        console.log(`  Model: ${m}`);
        console.log(`  Response: "${successReply}"`);
        break;
      } else {
        lastError = chatData;
        console.log(`  Model ${m} returned (${chatRes.status}):`, chatData.error?.message || JSON.stringify(chatData));
      }
    }

    if (completionSuccess) {
      return { success: true, model: successModel, reply: successReply };
    } else {
      return { success: false, error: lastError };
    }
  } catch (err) {
    console.log('✗ Gemini Exception:', err.message);
    return { success: false, error: err.message };
  }
}

async function main() {
  const summary = {};
  if (allKeys.GROQ_API_KEY) {
    summary.Groq = await testGroq(allKeys.GROQ_API_KEY);
  }
  if (allKeys.OPENROUTER_API_KEY) {
    summary.OpenRouter = await testOpenRouter(allKeys.OPENROUTER_API_KEY);
  }
  if (allKeys.GEMINI_API_KEY) {
    summary.Gemini = await testGemini(allKeys.GEMINI_API_KEY);
  }

  console.log('\n========================================');
  console.log('SUMMARY OF ALL API KEY TESTS');
  console.log('========================================');
  for (const [provider, result] of Object.entries(summary)) {
    console.log(`${provider}: ${result.success ? 'PASSED (200 OK)' : 'FAILED'}`);
    if (result.success) {
      console.log(`  Active Model: ${result.model}`);
      console.log(`  Response: "${result.reply}"`);
    } else {
      console.log(`  Error: ${JSON.stringify(result.error)}`);
    }
  }
}

main();
