'use strict';

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { asyncRoute, bad } = require('./helpers');

const router = express.Router();
const optimizationPromptFile = path.join(config.root, 'config/prompt_optimization.md');
const scriptPromptFile = path.join(config.root, 'config/script_generation.md');

function endpointOf(url) {
  const value = String(url || '').replace(/\/+$/, '');
  return value.endsWith('/chat/completions') ? value : `${value}/chat/completions`;
}

function readSystemPrompt(file) {
  try {
    const prompt = fs.readFileSync(file, 'utf8').trim();
    if (!prompt) throw new Error('empty file');
    return prompt;
  } catch (err) {
    throw bad(`AI system prompt is unavailable: ${err.message}`, 500);
  }
}

async function complete(systemPrompt, userPrompt) {
  if (!config.ai.apiKey) throw bad('AI apiKey is not configured', 503);
  try {
    const response = await axios.post(endpointOf(config.ai.url), {
      model: config.ai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }, {
      timeout: config.ai.timeoutMs,
      headers: {
        Authorization: `Bearer ${config.ai.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    const result = response.data?.choices?.[0]?.message?.content;
    if (typeof result !== 'string' || !result.trim()) throw bad('AI returned an empty response', 502);
    return result.trim();
  } catch (err) {
    if (err.status) throw err;
    const status = err.response && err.response.status;
    const detail = err.response && err.response.data && (err.response.data.error?.message || err.response.data.error);
    const failure = new Error(detail || `AI request failed${status ? ` (${status})` : ''}`);
    failure.status = status && status >= 400 && status < 600 ? status : 502;
    throw failure;
  }
}

function parseJsonResponse(value) {
  const cleaned = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw bad('AI returned invalid screenplay JSON', 502);
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (err) {
      throw bad(`AI returned invalid screenplay JSON: ${err.message}`, 502);
    }
  }
}

router.post(
  '/optimize-prompt',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    const settingContent = String(body.settingContent || '').trim();
    if (!prompt) throw bad('Prompt is required');
    const userPrompt = settingContent && !prompt.startsWith(settingContent)
      ? `项目设定内容（仅用于保持风格一致）：\n${settingContent}\n\n待优化提示词：\n${prompt}`
      : prompt;
    res.json({ prompt: await complete(readSystemPrompt(optimizationPromptFile), userPrompt) });
  })
);

router.post(
  '/generate-script',
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const chapterName = String(body.chapterName || '').trim();
    const chapterIntroduction = String(body.chapterIntroduction || '').trim();
    const settingContent = String(body.settingContent || '').trim();
    if (!chapterName) throw bad('Chapter name is required');
    if (!chapterIntroduction) throw bad('Chapter introduction is required');

    const raw = await complete(
      readSystemPrompt(scriptPromptFile),
      JSON.stringify({ chapterName, chapterIntroduction, projectBackground: String(body.projectBackground || '').trim(), settingContent })
    );
    const data = parseJsonResponse(raw);
    const shots = Array.isArray(data) ? data : data.shots;
    if (!Array.isArray(shots) || !shots.length) throw bad('AI returned no screenplay shots', 502);
    if (shots.length > 100) throw bad('AI returned too many screenplay shots', 502);
    const normalized = shots.map((shot) => ({
      name: String(shot && shot.name || '').trim().slice(0, 120),
      remark: String(shot && shot.remark || '').trim().slice(0, 500),
      promptStoryboard: String(shot && (shot.promptStoryboard ?? shot.storyboard) || '').trim().slice(0, 10000),
      promptNegative: String(shot && (shot.promptNegative ?? shot.negative) || '').trim().slice(0, 10000),
    })).filter((shot) => shot.name && shot.promptStoryboard);
    if (!normalized.length) throw bad('AI returned no valid screenplay shots', 502);
    res.json({ shots: normalized });
  })
);

module.exports = router;
