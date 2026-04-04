import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// pages/ConnectClaude.tsx — guide to connecting Claude.ai via MCP
// ---------------------------------------------------------------------------

interface OAuthClient {
  client_id: string;
  name: string;
  redirect_uris: string[];
  is_active: boolean;
  created_at: string;
}

export function ConnectClaude() {
  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [newClient, setNewClient] = useState<{ client_id: string; client_secret: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mcpUrl = `${window.location.origin}/mcp`;

  useEffect(() => {
    fetch('/api/oauth-clients', { headers: { 'x-api-key': 'dev' } })
      .then(async (r) => {
        const json = await r.json();
        setClients(json.data ?? []);
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const createClient = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/oauth-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': 'dev' },
        body: JSON.stringify({ name: 'Claude AI', redirect_uris: ['https://claude.ai/'] }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      setNewClient({ client_id: json.data.client_id, client_secret: json.data.client_secret });
      setClients((prev) => [...prev, json.data as OAuthClient]);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const revokeClient = async (client_id: string) => {
    if (!confirm('Revoke this connector? Claude will lose access immediately.')) return;
    try {
      await fetch(`/api/oauth-clients/${client_id}`, {
        method: 'DELETE',
        headers: { 'x-api-key': 'dev' },
      });
      setClients((prev) => prev.filter((c) => c.client_id !== client_id));
      if (newClient?.client_id === client_id) setNewClient(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Connect Claude
      </h1>
      <p style={{ color: '#555', marginBottom: '2rem', lineHeight: 1.6 }}>
        Connect Claude.ai to Luca using the MCP protocol. Once connected, Claude can post
        transactions, query the journal, reconcile bank statements, close periods, run reports, and
        use all 50 Luca accounting tools — on your behalf, with your permissions.
      </p>

      {error && (
        <div
          style={{
            background: '#fff0f0',
            border: '1px solid #ffcccc',
            borderRadius: 8,
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            color: '#cc0000',
            fontSize: '0.875rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Step 1 — Generate credentials */}
      <div
        style={{
          background: '#f8f9fa',
          borderRadius: 10,
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          Step 1 — Generate connector credentials
        </h2>

        {loading ? (
          <p style={{ color: '#888', fontSize: '0.9rem' }}>Loading...</p>
        ) : clients.length === 0 ? (
          <>
            <p style={{ color: '#555', marginBottom: '1rem', fontSize: '0.9rem' }}>
              No connector exists yet. Generate credentials to get your Client ID and Secret.
            </p>
            <button
              onClick={() => void createClient()}
              disabled={creating}
              style={{
                background: '#0066cc',
                color: 'white',
                border: 'none',
                borderRadius: 8,
                padding: '0.6rem 1.2rem',
                fontWeight: 600,
                cursor: creating ? 'not-allowed' : 'pointer',
                fontSize: '0.9rem',
                opacity: creating ? 0.7 : 1,
              }}
            >
              {creating ? 'Generating...' : 'Generate credentials'}
            </button>
          </>
        ) : (
          <div>
            <p
              style={{ color: '#22a55a', fontWeight: 600, marginBottom: '1rem', fontSize: '0.9rem' }}
            >
              Connector credentials exist
            </p>
            {clients.map((c) => (
              <div
                key={c.client_id}
                style={{
                  background: 'white',
                  border: '1px solid #e0e0e0',
                  borderRadius: 8,
                  padding: '1rem',
                  marginBottom: '0.75rem',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
                >
                  <div>
                    <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</p>
                    <p
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        color: '#555',
                        marginTop: '0.25rem',
                        wordBreak: 'break-all',
                      }}
                    >
                      {c.client_id}
                    </p>
                  </div>
                  <button
                    onClick={() => void revokeClient(c.client_id)}
                    style={{
                      background: 'none',
                      color: '#cc0000',
                      border: '1px solid #cc0000',
                      borderRadius: 6,
                      padding: '0.3rem 0.7rem',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      flexShrink: 0,
                      marginLeft: '0.75rem',
                    }}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
            <button
              onClick={() => void createClient()}
              disabled={creating}
              style={{
                background: 'none',
                color: '#0066cc',
                border: '1px solid #0066cc',
                borderRadius: 8,
                padding: '0.5rem 1rem',
                fontWeight: 600,
                cursor: creating ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                marginTop: '0.5rem',
              }}
            >
              {creating ? 'Generating...' : '+ Add another connector'}
            </button>
          </div>
        )}

        {/* Show the new secret ONCE after creation */}
        {newClient && (
          <div
            style={{
              background: '#fff8e1',
              border: '1px solid #ffe082',
              borderRadius: 8,
              padding: '1rem',
              marginTop: '1rem',
            }}
          >
            <p
              style={{ fontWeight: 600, color: '#b8860b', marginBottom: '0.75rem', fontSize: '0.875rem' }}
            >
              Save these credentials — the Client Secret will not be shown again
            </p>
            <CopyField label="Client ID" value={newClient.client_id} />
            <CopyField label="Client Secret" value={newClient.client_secret} />
          </div>
        )}
      </div>

      {/* Step 2 — Add in Claude */}
      <div
        style={{
          background: '#f8f9fa',
          borderRadius: 10,
          padding: '1.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
          Step 2 — Add the connector in Claude
        </h2>
        <ol
          style={{ paddingLeft: '1.2rem', color: '#444', fontSize: '0.9rem', lineHeight: 2.2 }}
        >
          <li>
            Open <strong>Claude.ai</strong> or <strong>Claude desktop</strong>
          </li>
          <li>
            Go to <strong>Customize &rarr; Connectors &rarr; Add connector</strong>
          </li>
          <li>Fill in:</li>
        </ol>
        <div style={{ marginTop: '1rem', marginBottom: '1rem' }}>
          <CopyField label="Name" value="Luca" />
          <CopyField label="Remote MCP server URL" value={mcpUrl} />
          <CopyField
            label="OAuth Client ID"
            value={
              newClient?.client_id ??
              clients[0]?.client_id ??
              '(generate credentials above first)'
            }
          />
          <CopyField
            label="OAuth Client Secret"
            value={
              newClient?.client_secret ?? '(shown once when generated — regenerate if needed)'
            }
          />
        </div>
        <ol
          start={4}
          style={{ paddingLeft: '1.2rem', color: '#444', fontSize: '0.9rem', lineHeight: 2.2 }}
        >
          <li>
            Click <strong>Add</strong>
          </li>
          <li>Sign in with your Luca email and password when prompted</li>
          <li>Done — all 50 Luca tools are now available in Claude</li>
        </ol>
      </div>

      {/* What Claude can do */}
      <div
        style={{
          background: '#f0f7ff',
          borderRadius: 10,
          padding: '1.5rem',
          border: '1px solid #cce0ff',
        }}
      >
        <h2
          style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#003d80' }}
        >
          What Claude can do once connected
        </h2>
        <p style={{ fontSize: '0.875rem', color: '#1a3a60', lineHeight: 1.7 }}>
          All 50 Luca accounting tools — post transactions, query the journal, get trial balances,
          reconcile bank statements, manage periods, run reports, process documents from the inbox,
          and more. Claude operates with the permissions of the account used to authorise the
          connection. You can revoke access at any time by clicking Revoke above.
        </p>
      </div>
    </div>
  );
}

// ── CopyField component ───────────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <label
        style={{ display: 'block', fontSize: '0.8rem', color: '#666', marginBottom: '0.2rem' }}
      >
        {label}
      </label>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <code
          style={{
            flex: 1,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            fontSize: '0.82rem',
            wordBreak: 'break-all',
            color: '#111',
            lineHeight: 1.4,
          }}
        >
          {value}
        </code>
        <button
          onClick={copy}
          style={{
            background: copied ? '#22a55a' : '#eee',
            color: copied ? 'white' : '#333',
            border: 'none',
            borderRadius: 6,
            padding: '0.5rem 0.75rem',
            cursor: 'pointer',
            fontSize: '0.8rem',
            whiteSpace: 'nowrap',
            minWidth: 60,
            transition: 'background 0.15s',
          }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
