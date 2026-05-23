/**
 * Pin API routes / 置顶 API 路由
 */

import { Router } from 'express';
import { listPins, addPin, removePin } from '../services/pin-store.js';

const router = Router();

// GET /api/v1/pins - List all pinned sessions / 列出所有置顶会话
router.get('/pins', (_req, res) => {
  res.json({ pins: listPins() });
});

// POST /api/v1/pins - Pin a session / 置顶一个会话
router.post('/pins', (req, res) => {
  const { projectId, sessionId } = req.body as { projectId?: string; sessionId?: string };
  if (!projectId || !sessionId) {
    res.status(400).json({ error: 'projectId and sessionId are required' });
    return;
  }
  const entry = addPin(projectId, sessionId);
  res.json({ success: true, pin: entry });
});

// DELETE /api/v1/pins/:projectId/:sessionId - Unpin a session / 取消置顶
router.delete('/pins/:projectId/:sessionId', (req, res) => {
  const { projectId, sessionId } = req.params;
  const removed = removePin(projectId, sessionId);
  res.json({ success: removed });
});

export default router;
