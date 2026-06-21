/**
 * RegistrationControlCard — admin UI for the v1.70 controlled-registration
 * feature. Mounted on /admin/settings (alongside GoldenTicketSettingsCard).
 *
 * Endpoints (all admin-only):
 *   GET   /api/admin/registration-config         → current state + link
 *   PATCH /api/admin/registration-config         → toggle enabled
 *   POST  /api/admin/registration-config/regenerate-token  → fresh token + link
 *
 * On regenerate we get the plaintext token + the full invite link ONCE
 * from the response. We display it with a Copy button so the admin can
 * paste it into Slack / email. We don't persist the plaintext anywhere
 * client-side — the DB only stores the hash and the next GET returns
 * the same plaintext because the backend keeps it on the server.
 */
import { useEffect, useState, useCallback } from 'react';
import adminApi from '../../utils/adminApi';

interface ConfigResponse {
  enabled: boolean;
  inviteLink: string;
  tokenGeneratedAt: string;
  lastToggledBy: { id: string; name: string | null; email: string | null } | null;
  lastToggledAt: string;
}

interface RegenerateResponse {
  token: string;
  inviteLink: string;
  tokenGeneratedAt: string;
}

interface Props {
  onSaved: (msg: string, type: 'success' | 'error') => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function RegistrationControlCard({ onSaved }: Props): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [lastToggledBy, setLastToggledBy] = useState<ConfigResponse['lastToggledBy']>(null);
  const [lastToggledAt, setLastToggledAt] = useState<string | null>(null);
  const [tokenGeneratedAt, setTokenGeneratedAt] = useState<string | null>(null);

  const [toggling, setToggling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.get<ConfigResponse>('/admin/registration-config');
      setEnabled(res.data.enabled);
      setInviteLink(res.data.inviteLink);
      setLastToggledBy(res.data.lastToggledBy);
      setLastToggledAt(res.data.lastToggledAt);
      setTokenGeneratedAt(res.data.tokenGeneratedAt);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to load registration settings';
      onSaved(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [onSaved]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (next: boolean): Promise<void> => {
    setToggling(true);
    try {
      const res = await adminApi.patch<{ enabled: boolean; lastToggledAt: string }>(
        '/admin/registration-config',
        { enabled: next },
      );
      setEnabled(res.data.enabled);
      setLastToggledAt(res.data.lastToggledAt);
      onSaved(next ? 'Registration enabled' : 'Registration disabled', 'success');
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Toggle failed';
      onSaved(msg, 'error');
    } finally {
      setToggling(false);
    }
  };

  const regenerate = async (): Promise<void> => {
    setRegenerating(true);
    try {
      const res = await adminApi.post<RegenerateResponse>(
        '/admin/registration-config/regenerate-token',
      );
      setInviteLink(res.data.inviteLink);
      setTokenGeneratedAt(res.data.tokenGeneratedAt);
      setConfirmingRegen(false);
      onSaved('Invite link regenerated — old link is now invalid.', 'success');
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Regenerate failed';
      onSaved(msg, 'error');
    } finally {
      setRegenerating(false);
    }
  };

  const copyLink = async (): Promise<void> => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onSaved('Could not copy to clipboard', 'error');
    }
  };

  const lastToggledByLine = lastToggledBy
    ? `${lastToggledBy.name ?? lastToggledBy.email ?? 'admin'} · ${formatDate(lastToggledAt)}`
    : 'Never toggled';

  return (
    <div className="admin-card-surface">
      <div className="admin-card-header">
        <p className="text-sm font-semibold text-ink">Registration Control</p>
        <p className="text-xs text-ink-faint mt-0.5">
          Public self-registration is OFF by default. Share the invite link below
          with new users; the link stops working as soon as you disable
          registration or regenerate the token.
        </p>
      </div>

      <div className="px-5 py-4 space-y-5">
        {/* Toggle */}
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-border">
          <div>
            <p className="text-sm font-medium text-ink">Allow new registrations</p>
            <p className="text-xs text-ink-faint mt-1">
              When OFF, every <code className="font-mono">POST /api/auth/register</code>{' '}
              returns 403 — including requests with a valid token.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Allow new registrations"
            disabled={loading || toggling}
            onClick={() => toggle(!enabled)}
            className={[
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
              enabled ? 'bg-emerald-500' : 'bg-border',
              loading || toggling ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
            ].join(' ')}
          >
            <span
              className={[
                'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5',
                enabled ? 'translate-x-5' : 'translate-x-0.5',
              ].join(' ')}
            />
          </button>
        </div>

        {/* Invite link */}
        <div>
          <label className="admin-label">Current invite link</label>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              value={loading ? 'Loading…' : inviteLink}
              onFocus={(e) => e.currentTarget.select()}
              className="admin-input font-mono text-xs flex-1"
              aria-label="Current invite link URL"
            />
            <button
              type="button"
              onClick={copyLink}
              disabled={!inviteLink || loading}
              className="admin-btn-secondary shrink-0"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] text-ink-faint mt-1.5">
            Anyone with this link can register <em>while the toggle is ON</em>.
            Regenerating instantly invalidates the old link.
          </p>
        </div>

        {/* Regenerate */}
        <div>
          {!confirmingRegen ? (
            <button
              type="button"
              onClick={() => setConfirmingRegen(true)}
              disabled={loading || regenerating}
              className="admin-btn-secondary"
            >
              Regenerate invite link
            </button>
          ) : (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <p className="text-xs text-amber-900">
                Regenerating will invalidate the current link immediately.
                Anyone using the old link will get a 403.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={regenerating}
                  className="admin-btn-primary"
                >
                  {regenerating ? 'Regenerating…' : 'Confirm regenerate'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRegen(false)}
                  disabled={regenerating}
                  className="admin-btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Audit info */}
        <div className="border-t border-border pt-3 space-y-1 text-xs text-ink-soft">
          <div className="flex items-center justify-between">
            <span>Token generated</span>
            <span className="text-ink-faint">{formatDate(tokenGeneratedAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last toggled by</span>
            <span className="text-ink-faint">{lastToggledByLine}</span>
          </div>
        </div>
      </div>
    </div>
  );
}