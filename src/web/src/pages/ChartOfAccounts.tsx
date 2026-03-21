import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccounts, useCreateAccount, useUpdateAccount } from "../hooks/useAccounts";
import { Modal } from "../components/Modal";
import { fmtMoney } from "../lib/api";
import type { Account } from "../types/api";

const CATEGORIES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

const TYPES_BY_CATEGORY: Record<string, string[]> = {
  ASSET: ["CURRENT_ASSET", "FIXED_ASSET", "OTHER_ASSET"],
  LIABILITY: ["CURRENT_LIABILITY", "LONG_TERM_LIABILITY", "OTHER_LIABILITY"],
  EQUITY: ["EQUITY"],
  REVENUE: ["REVENUE", "OTHER_INCOME"],
  EXPENSE: ["DIRECT_COSTS", "OVERHEADS", "FINANCE_COSTS", "OTHER_EXPENSE"],
};

const CATEGORY_BADGE: Record<string, string> = {
  ASSET: "badge badge-blue",
  LIABILITY: "badge badge-red",
  EQUITY: "badge badge-purple",
  REVENUE: "badge badge-green",
  EXPENSE: "badge badge-amber",
};

interface AccountFormData {
  code: string;
  name: string;
  category: string;
  account_type: string;
  is_active: boolean;
}

const EMPTY_FORM: AccountFormData = {
  code: "",
  name: "",
  category: "ASSET",
  account_type: "CURRENT_ASSET",
  is_active: true,
};

function AccountForm({
  form,
  onChange,
  isEdit,
}: {
  form: AccountFormData;
  onChange: (f: AccountFormData) => void;
  isEdit: boolean;
}) {
  function setField(key: keyof AccountFormData, val: string | boolean) {
    const next = { ...form } as AccountFormData;
    if (key === "is_active") {
      next.is_active = val as boolean;
    } else {
      (next as unknown as Record<string, unknown>)[key] = val;
    }
    if (key === "category") {
      const types = TYPES_BY_CATEGORY[val as string] || [];
      next.account_type = types[0] || "";
    }
    onChange(next);
  }

  const availableTypes = TYPES_BY_CATEGORY[form.category] || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!isEdit && (
        <div className="form-row">
          <label className="form-label">Account Code (required)</label>
          <input
            className="form-input"
            type="text"
            value={form.code}
            onChange={function(e) { setField("code", e.target.value.toUpperCase()); }}
            placeholder="e.g. 1000"
            style={{ fontFamily: "var(--mono)" }}
          />
        </div>
      )}
      <div className="form-row">
        <label className="form-label">Account Name (required)</label>
        <input
          className="form-input"
          type="text"
          value={form.name}
          onChange={function(e) { setField("name", e.target.value); }}
          placeholder="e.g. Bank Current Account"
        />
      </div>
      <div className="form-row">
        <label className="form-label">Category</label>
        <select
          className="form-select"
          value={form.category}
          onChange={function(e) { setField("category", e.target.value); }}
        >
          {CATEGORIES.map(function(c) {
            return <option key={c} value={c}>{c}</option>;
          })}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">Account Type</label>
        <select
          className="form-select"
          value={form.account_type}
          onChange={function(e) { setField("account_type", e.target.value); }}
        >
          {availableTypes.map(function(t) {
            return <option key={t} value={t}>{t.replace(/_/g, " ")}</option>;
          })}
        </select>
      </div>
      <div className="form-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          id="is_active_chk"
          checked={form.is_active}
          onChange={function(e) { setField("is_active", e.target.checked); }}
        />
        <label htmlFor="is_active_chk" className="form-label" style={{ margin: 0, cursor: "pointer" }}>Active</label>
      </div>
    </div>
  );
}

export function ChartOfAccounts() {
  const navigate = useNavigate();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);

  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState<AccountFormData>({ ...EMPTY_FORM });
  const [newError, setNewError] = useState("");

  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<AccountFormData>({ ...EMPTY_FORM });
  const [editError, setEditError] = useState("");

  const queryFilters: Record<string, string> = {};
  if (categoryFilter) queryFilters.category = categoryFilter;
  if (activeOnly) queryFilters.active_only = "true";

  const { data: accounts, isLoading, error } = useAccounts(queryFilters);
  const createM = useCreateAccount();
  const updateM = useUpdateAccount();

  const allAccounts: Account[] = accounts || [];

  const filtered = allAccounts.filter(function(a) {
    if (!search) return true;
    const q = search.toLowerCase();
    return a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q);
  });

  function handleNew() {
    setNewForm({ ...EMPTY_FORM });
    setNewError("");
    setNewOpen(true);
  }

  function handleNewSubmit() {
    if (!newForm.code.trim() || !newForm.name.trim()) {
      setNewError("Code and name are required.");
      return;
    }
    createM.mutate({
      code: newForm.code.trim(),
      name: newForm.name.trim(),
      category: newForm.category,
      account_type: newForm.account_type,
      is_active: newForm.is_active,
    }, {
      onSuccess: function() {
        setNewOpen(false);
        setNewForm({ ...EMPTY_FORM });
        setNewError("");
      },
      onError: function(e) { setNewError((e as Error).message); },
    });
  }

  function handleEdit(acct: Account, ev: React.MouseEvent) {
    ev.stopPropagation();
    setEditAccount(acct);
    setEditForm({
      code: acct.code,
      name: acct.name,
      category: acct.category,
      account_type: acct.account_type,
      is_active: acct.is_active,
    });
    setEditError("");
  }

  function handleEditSubmit() {
    if (!editAccount || !editForm.name.trim()) {
      setEditError("Name is required.");
      return;
    }
    updateM.mutate({
      code: editAccount.code,
      data: {
        name: editForm.name.trim(),
        category: editForm.category,
        account_type: editForm.account_type,
        is_active: editForm.is_active,
      },
    }, {
      onSuccess: function() {
        setEditAccount(null);
        setEditError("");
      },
      onError: function(e) { setEditError((e as Error).message); },
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>Chart of Accounts</h1>
        <button className="btn btn-primary" onClick={handleNew}>New Account</button>
      </div>

      <div className="page-toolbar">
        <input
          className="form-input"
          type="text"
          placeholder="Search code or name..."
          value={search}
          onChange={function(e) { setSearch(e.target.value); }}
          style={{ width: 220 }}
        />
        <select
          className="form-select"
          value={categoryFilter}
          onChange={function(e) { setCategoryFilter(e.target.value); }}
          style={{ width: 150 }}
        >
          <option value="">-- All categories --</option>
          {CATEGORIES.map(function(c) {
            return <option key={c} value={c}>{c}</option>;
          })}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", userSelect: "none" }}>
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={function(e) { setActiveOnly(e.target.checked); }}
          />
          Active only
        </label>
        <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {String(filtered.length) + " account" + (filtered.length !== 1 ? "s" : "")}
        </span>
      </div>

      <div className="page-body">
        {isLoading && <div className="loading">Loading accounts...</div>}
        {!isLoading && error && <div className="error-box">{"Error: " + (error as Error).message}</div>}
        {!isLoading && !error && filtered.length === 0 && <div className="empty">No accounts match your filters</div>}

        {!isLoading && !error && filtered.length > 0 && (
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 90 }}>Code</th>
                <th>Name</th>
                <th style={{ width: 110 }}>Category</th>
                <th style={{ width: 170 }}>Type</th>
                <th style={{ width: 60, textAlign: "center" }}>Active</th>
                <th style={{ textAlign: "right", width: 130 }}>Balance</th>
                <th style={{ width: 60 }}>Edit</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function(acct) {
                const catCls = CATEGORY_BADGE[acct.category] || "badge badge-gray";
                const hasBalance = acct.balance && (
                  parseFloat(acct.balance.debit) !== 0 || parseFloat(acct.balance.credit) !== 0
                );
                const netBalance = acct.balance ? acct.balance.net : null;
                return (
                  <tr
                    key={acct.code}
                    style={{ cursor: "pointer" }}
                    onClick={function() { navigate("/accounts/" + acct.code); }}
                  >
                    <td style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600 }}>{acct.code}</td>
                    <td style={{ fontSize: 13 }}>{acct.name}</td>
                    <td><span className={catCls}>{acct.category}</span></td>
                    <td style={{ fontSize: 12, color: "var(--text)" }}>{acct.account_type.replace(/_/g, " ")}</td>
                    <td style={{ textAlign: "center" }}>
                      {acct.is_active
                        ? <span title="Active" style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#16a34a", verticalAlign: "middle" }} />
                        : <span title="Inactive" style={{ color: "var(--text)", fontSize: 16, lineHeight: 1 }}>&#8211;</span>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {hasBalance && netBalance !== null
                        ? <span className="mono" style={{ fontSize: 13 }}>{fmtMoney(netBalance)}</span>
                        : <span className="muted" style={{ fontSize: 12 }}>-</span>}
                    </td>
                    <td onClick={function(ev) { handleEdit(acct, ev); }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: 11 }}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {newOpen && (
        <Modal title="New Account" onClose={function() { setNewOpen(false); setNewError(""); }}>
          <div style={{ padding: "0 0 16px 0" }}>
            <AccountForm form={newForm} onChange={setNewForm} isEdit={false} />
            {newError && <div className="error-box" style={{ marginTop: 10 }}>{newError}</div>}
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={function() { setNewOpen(false); setNewError(""); }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleNewSubmit}
              disabled={createM.isPending || !newForm.code.trim() || !newForm.name.trim()}
            >
              {createM.isPending ? "Creating..." : "Create Account"}
            </button>
          </div>
        </Modal>
      )}

      {editAccount && (
        <Modal title={"Edit Account: " + editAccount.code} onClose={function() { setEditAccount(null); setEditError(""); }}>
          <div style={{ padding: "0 0 16px 0" }}>
            <AccountForm form={editForm} onChange={setEditForm} isEdit={true} />
            {editError && <div className="error-box" style={{ marginTop: 10 }}>{editError}</div>}
          </div>
          <div className="modal-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={function() { setEditAccount(null); setEditError(""); }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleEditSubmit}
              disabled={updateM.isPending || !editForm.name.trim()}
            >
              {updateM.isPending ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
