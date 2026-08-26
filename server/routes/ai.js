'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { asyncRoute, bad } = require('./helpers');

const router = express.Router();
const systemPromptFile = path.join(config.root, 'config/prompt_optimization.md');

function endpointOf(url) {
  const value = String(url || '').replace(/\/+$/, '');
  return value.endsWith('/chat/completions') ? value : `${value}/chat/completions`;
}

function readSystemPrompt() {
  try {
    const prompt = fs.readFileSync(systemPromptFile, 'utf8').trim();
    if (!prompt) throw new Error('empty file');
    return prompt;
  } catch (err) {
    throw bad(`Prompt optimization instructions are unavailable: ${err.message}`, 500);
  }
}

router.post(
  '/optimize-prompt',
  asyncRoute(async (req, res) => {
    const prompt = String((req.body || {}).prompt || '').trim();
    if (!prompt) throw bad('Prompt is required');
    if (!config.ai.apiKey) throw bad('AI apiKey is not configured', 503);

    let response;
    try {
      response = await axios.post(endpointOf(config.ai.url), {
        model: config.ai.model,
        messages: [
          { role: 'system', content: readSystemPrompt() },
          { role: 'user', content: prompt },
        ],
      }, {
        timeout: config.ai.timeoutMs,
        headers: {
          Authorization: `Bearer ${config.ai.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      const status = err.response && err.response.status;
      const detail = err.response && err.response.data && (err.response.data.error?.message || err.response.data.error);
      const failure = new Error(detail || `AI request failed${status ? ` (${status})` : ''}`);
      failure.status = status && status >= 400 && status < 600 ? status : 502;
      throw failure;
    }

    const result = response.data?.choices?.[0]?.message?.content;
    if (typeof result !== 'string' || !result.trim()) throw bad('AI returned an empty prompt', 502);
    res.json({ prompt: result.trim() });
  })
);

module.exports = router;
