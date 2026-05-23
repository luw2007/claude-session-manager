/**
 * Wiki API routes / Wiki API 路由
 *
 * GET /api/v1/wiki/:projectId/:sessionId        → full WikiSession object
 * GET /api/v1/wiki/:projectId/:sessionId/graph  → DAG graph (nodes + edges)
 * GET /api/v1/wiki/:projectId/:sessionId/nodes  → flat node list (paginated)
 *
 * 所有路由都受 requireAuth 中间件保护（在 server/index.ts 中注册时应用）
 */

import { Router } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { config } from '../utils/config.js';
import { buildWikiGraph, buildWikiSession } from '../services/wiki-builder.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Validate and resolve session file path.
 * Returns filePath string or null if invalid.
 * 验证并解析 session 文件路径；无效时返回 null
 */
function resolveSessionPath(projectId: string, sessionId: string): string | null {
  // Prevent path traversal / 防止路径遍历
  if (!/^[A-Za-z0-9_.-]+$/.test(projectId) || !/^[A-Za-z0-9_.-]+$/.test(sessionId)) {
    return null;
  }
  const filePath = join(config.claudeDir, 'projects', projectId, `${sessionId}.jsonl`);
  if (!existsSync(filePath)) return null;
  return filePath;
}

// GET /api/v1/wiki/:projectId/:sessionId
// Returns the full WikiSession with cases, turns, and nodes
// 返回完整的 WikiSession（含案例、轮次和节点）
router.get('/wiki/:projectId/:sessionId', async (req, res) => {
  const { projectId, sessionId } = req.params;
  const filePath = resolveSessionPath(projectId, sessionId);
  if (!filePath) {
    res.status(404).json({ error: 'Session not found / 会话未找到' });
    return;
  }

  try {
    const session = await buildWikiSession(filePath, projectId);
    res.json({ session });
  } catch (err) {
    logger.error(`wiki session build failed: ${err}`);
    res.status(500).json({ error: `Failed to build wiki: ${err}` });
  }
});

// GET /api/v1/wiki/:projectId/:sessionId/graph
// Returns DAG: nodes + edges + turns + cases (optimised for graph rendering)
// 返回 DAG：节点 + 边 + 轮次 + 案例（为图渲染优化）
router.get('/wiki/:projectId/:sessionId/graph', async (req, res) => {
  const { projectId, sessionId } = req.params;
  const filePath = resolveSessionPath(projectId, sessionId);
  if (!filePath) {
    res.status(404).json({ error: 'Session not found / 会话未找到' });
    return;
  }

  try {
    const graph = await buildWikiGraph(filePath, projectId, sessionId);
    res.json(graph);
  } catch (err) {
    logger.error(`wiki graph build failed: ${err}`);
    res.status(500).json({ error: `Failed to build graph: ${err}` });
  }
});

// GET /api/v1/wiki/:projectId/:sessionId/nodes?page=0&limit=50
// Returns paginated flat node list for list-view browsing
// 返回分页的平铺节点列表（列表视图浏览）
router.get('/wiki/:projectId/:sessionId/nodes', async (req, res) => {
  const { projectId, sessionId } = req.params;
  const page = Math.max(0, parseInt(req.query['page'] as string || '0', 10));
  const limit = Math.max(1, Math.min(100, parseInt(req.query['limit'] as string || '50', 10)));

  const filePath = resolveSessionPath(projectId, sessionId);
  if (!filePath) {
    res.status(404).json({ error: 'Session not found / 会话未找到' });
    return;
  }

  try {
    const session = await buildWikiSession(filePath, projectId);
    const total = session.nodes.length;
    const nodes = session.nodes.slice(page * limit, (page + 1) * limit);
    res.json({
      nodes,
      total,
      page,
      limit,
      hasMore: (page + 1) * limit < total,
    });
  } catch (err) {
    logger.error(`wiki nodes fetch failed: ${err}`);
    res.status(500).json({ error: `Failed to fetch nodes: ${err}` });
  }
});

export default router;
