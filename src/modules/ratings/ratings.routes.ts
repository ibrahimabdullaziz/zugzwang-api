import { Router } from 'express';
import { getLeaderboard } from './ratings.service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const { category, limit, cursor } = req.query;

    const result = await getLeaderboard(
      typeof category === 'string' ? category : undefined,
      typeof limit === 'string' ? limit : undefined,
      typeof cursor === 'string' ? cursor : undefined,
    );

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
