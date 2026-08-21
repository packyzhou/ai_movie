'use strict';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pageQuery(req, searchFields) {
  return {
    page: req.query.page,
    pageSize: req.query.pageSize,
    keyword: req.query.keyword,
    searchFields,
  };
}

function requireText(value, label, max) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw bad(`${label} is required`);
  if (max && text.length > max) throw bad(`${label} must be at most ${max} characters`);
  return text;
}

module.exports = { asyncRoute, bad, pageQuery, requireText };
