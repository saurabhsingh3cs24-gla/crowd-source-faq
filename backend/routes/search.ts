import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { adminOnly } from '../middleware/admin.js';
import {
  submitUnresolved,
  getUnresolvedSearches,
  resolveUnresolved,
  getUnresolvedStats,
} from '../controllers/unresolvedSearchController.js';

const router = Router();

// Public: submit "No, I need more help" feedback (protect to capture userId)
router.post('/unresolved', protect, submitUnresolved);

// Admin: list unresolved searches
router.get('/unresolved-list', adminOnly, getUnresolvedSearches);

// Admin: resolve an entry
router.patch('/unresolved-search/:id/resolve', adminOnly, resolveUnresolved);

// Admin: stats
router.get('/unresolved-stats', adminOnly, getUnresolvedStats);

export default router;
