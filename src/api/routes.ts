import { Router } from 'express';
import { accountsRouter } from './accounts';
import { periodsRouter } from './periods';
import { reportsRouter } from './reports';
import { stagingRouter } from './staging';
import { transactionsRouter } from './transactions';

// ---------------------------------------------------------------------------
// routes.ts — Assembles all API sub-routers under /api
// ---------------------------------------------------------------------------

export const apiRouter = Router();

apiRouter.use('/accounts', accountsRouter);
apiRouter.use('/transactions', transactionsRouter);
apiRouter.use('/staging', stagingRouter);
apiRouter.use('/periods', periodsRouter);
apiRouter.use('/reports', reportsRouter);
