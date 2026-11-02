'use strict';
// "Edit expense" dialog, shared by the family app and the admin dashboard.
//   ExpenseEditor.open(expense, { isAdmin, onSaved })
// Anyone can change the date or the note of an expense they added. Changing the amount (or fixing a
// rejected expense) sends it back to the admin for approval; the admin can change anything directly.

const ExpenseEditor = (() => {
  const { h, api, toast, money } = App;

  const parseAmount = (text) => {
    const n = Number(String(text).replace(/[,\s]/g, '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  };

  function open(e, { isAdmin = false, onSaved = () => {} } = {}) {
    const date = h('input', { type: 'date', value: e.date, max: App.todayStr(), 'aria-label': 'Date' });
    const amount = h('input', { type: 'text', inputmode: 'decimal', value: String(e.amount), autocomplete: 'off', 'aria-label': 'Amount' });
    const note = h('textarea', { rows: 2, maxlength: 500, 'aria-label': 'Note' }, e.note || '');
    const error = h('p', { class: 'error', role: 'alert', hidden: true });
    const save = h('button', { type: 'submit', class: 'btn' }, 'Save');

    const hint = isAdmin ? null : h('p', { class: 'muted small' },
      e.status === 'rejected'
        ? 'This was rejected. Saving sends it to the admin for approval again.'
        : 'You can change the date or the note any time. Changing the amount sends it for approval again.');

    const form = h('form', { novalidate: true },
      h('h2', null, 'Edit expense'),
      e.thumb ? h('img', { class: 'editphoto', src: e.thumb, alt: 'Photo of this expense' }) : null,
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Date'), date),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Amount ', h('span', { class: 'opt' }, `(now ${money(e.amount)})`)), amount),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Note'), note),
      hint,
      error,
      h('div', { class: 'dlg-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => closeDlg() }, 'Cancel'),
        save));
    const dlg = h('dialog', { class: 'editdlg' }, form);
    // close AND remove it ourselves (the 'close' event also covers the Escape key)
    const closeDlg = () => { if (dlg.open) dlg.close(); dlg.remove(); };
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) closeDlg(); });

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.hidden = true;
      const changes = {};
      const newAmount = parseAmount(amount.value);
      if (!(newAmount > 0)) { error.textContent = 'Please type how much it cost.'; error.hidden = false; return; }
      if (newAmount !== e.amount) changes.amount = newAmount;
      if (date.value && date.value !== e.date) changes.date = date.value;
      if (note.value.trim() !== (e.note || '')) changes.note = note.value.trim();
      if (!Object.keys(changes).length && e.status !== 'rejected') { closeDlg(); return; }
      if (!Object.keys(changes).length) changes.note = note.value.trim(); // resubmit a rejected one as it is
      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        const res = await api('/api/expenses/' + e.id, { method: 'PATCH', body: JSON.stringify(changes) });
        closeDlg();
        toast(!isAdmin && res.expense.status === 'pending' && (e.status || 'approved') !== 'pending'
          ? '✓ Saved. Sent to the admin for approval.' : '✓ Saved');
        onSaved(res.expense);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        save.disabled = false;
        save.textContent = 'Save';
      }
    });

    document.body.append(dlg);
    dlg.showModal();
  }

  return { open };
})();
