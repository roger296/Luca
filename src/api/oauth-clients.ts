// ---------------------------------------------------------------------------
// api/oauth-clients.ts — admin API for managing OAuth clients
// ---------------------------------------------------------------------------

import { Router } from 'express';
import { requirePermission } from './middleware/authorise';
import { createOAuthClient, listClients, deleteClient } from '../engine/oauth';

const oauthClientsRouter = Router();

// List all OAuth clients (ADMIN only)
oauthClientsRouter.get('/', requirePermission('system:configure'), async (_req, res) => {
  try {
    const clients = await listClients();
    res.json({ success: true, data: clients });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: String(e) } });
  }
});

// Create a new OAuth client (ADMIN only)
// Returns the client_secret ONCE — it is never stored in plain text
oauthClientsRouter.post('/', requirePermission('system:configure'), async (req, res) => {
  try {
    const { name, redirect_uris } = req.body as { name?: string; redirect_uris?: string[] };
    if (!name) {
      res
        .status(400)
        .json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
      return;
    }
    const result = await createOAuthClient({
      name,
      redirect_uris: redirect_uris ?? ['https://claude.ai/'],
    });
    res.status(201).json({
      success: true,
      data: {
        client_id: result.client_id,
        client_secret: result.client_secret, // Only returned once
        name: result.client.name,
        message: 'Save the client_secret now — it will not be shown again.',
      },
    });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: String(e) } });
  }
});

// Revoke/delete a client (ADMIN only)
oauthClientsRouter.delete('/:client_id', requirePermission('system:configure'), async (req, res) => {
  try {
    await deleteClient(req.params.client_id!);
    res.json({ success: true, data: { revoked: true } });
  } catch (e) {
    res
      .status(500)
      .json({ success: false, error: { code: 'INTERNAL_ERROR', message: String(e) } });
  }
});

export default oauthClientsRouter;
