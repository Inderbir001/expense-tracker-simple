'use strict';
// The ration (grocery) list page, shared by the family app and the admin dashboard.
//   Ration.mount(container, { isAdmin, onCount })  -> { refresh }
// One list for the whole family: anyone can add; the admin marks items as ordered.

const Ration = (() => {
  const { h, api, toast } = App;

  // [name, other names people search by, category, default unit, default quantity, popular]
  const CATALOG = [
    // ---- Grains & flours ----
    ['Atta (wheat flour)', 'gehun gehu chakki atta', 'Grains & flours', 'kg', 5, 1],
    ['Rice', 'chawal chaval', 'Grains & flours', 'kg', 5, 1],
    ['Basmati rice', 'chawal basmati', 'Grains & flours', 'kg', 5],
    ['Sona Masoori rice', 'chawal', 'Grains & flours', 'kg', 5],
    ['Maida', 'refined flour', 'Grains & flours', 'kg', 1],
    ['Besan (gram flour)', 'chana atta', 'Grains & flours', 'kg', 1],
    ['Suji / Rava', 'semolina sooji rawa', 'Grains & flours', 'kg', 1],
    ['Poha', 'flattened rice chiwda', 'Grains & flours', 'kg', 1],
    ['Sabudana', 'sago', 'Grains & flours', 'kg', 0.5],
    ['Ragi flour', 'nachni finger millet', 'Grains & flours', 'kg', 1],
    ['Jowar flour', 'jwari sorghum', 'Grains & flours', 'kg', 1],
    ['Bajra flour', 'pearl millet', 'Grains & flours', 'kg', 1],
    ['Rice flour', 'chawal atta', 'Grains & flours', 'kg', 1],
    ['Dalia', 'broken wheat', 'Grains & flours', 'kg', 1],
    ['Oats', 'jai', 'Grains & flours', 'packet', 1],
    ['Vermicelli', 'sevai seviyan', 'Grains & flours', 'packet', 1],
    ['Murmura', 'puffed rice kurmura', 'Grains & flours', 'packet', 1],
    ['Cornflakes', 'cereal', 'Grains & flours', 'packet', 1],
    // ---- Pulses ----
    ['Toor dal', 'arhar tur dal lentil', 'Pulses', 'kg', 1, 1],
    ['Moong dal', 'mung lentil', 'Pulses', 'kg', 1, 1],
    ['Moong whole', 'green gram sabut moong', 'Pulses', 'kg', 1],
    ['Chana dal', 'bengal gram', 'Pulses', 'kg', 1],
    ['Masoor dal', 'red lentil', 'Pulses', 'kg', 1],
    ['Urad dal', 'black gram', 'Pulses', 'kg', 1],
    ['Urad whole', 'sabut urad', 'Pulses', 'kg', 1],
    ['Rajma', 'kidney beans', 'Pulses', 'kg', 1],
    ['Kabuli chana', 'chole chickpea white chana', 'Pulses', 'kg', 1],
    ['Kala chana', 'black chickpea', 'Pulses', 'kg', 1],
    ['Lobia', 'black eyed peas chawli', 'Pulses', 'kg', 0.5],
    ['Dried green peas', 'matar', 'Pulses', 'kg', 0.5],
    ['Soya chunks', 'soy nuggets meal maker', 'Pulses', 'packet', 1],
    // ---- Oil & ghee ----
    ['Cooking oil', 'tel refined sunflower oil', 'Oil & ghee', 'L', 1, 1],
    ['Mustard oil', 'sarson tel', 'Oil & ghee', 'L', 1],
    ['Groundnut oil', 'peanut oil moongfali tel', 'Oil & ghee', 'L', 1],
    ['Coconut oil', 'nariyal tel', 'Oil & ghee', 'L', 0.5],
    ['Olive oil', '', 'Oil & ghee', 'bottle', 1],
    ['Ghee', 'clarified butter', 'Oil & ghee', 'kg', 0.5, 1],
    // ---- Spices ----
    ['Salt', 'namak', 'Spices', 'kg', 1, 1],
    ['Turmeric powder', 'haldi', 'Spices', 'packet', 1, 1],
    ['Red chilli powder', 'lal mirch', 'Spices', 'packet', 1, 1],
    ['Coriander powder', 'dhania', 'Spices', 'packet', 1],
    ['Cumin seeds', 'jeera zeera', 'Spices', 'packet', 1],
    ['Mustard seeds', 'rai sarson', 'Spices', 'packet', 1],
    ['Garam masala', '', 'Spices', 'packet', 1],
    ['Black pepper', 'kali mirch', 'Spices', 'packet', 1],
    ['Cardamom', 'elaichi', 'Spices', 'packet', 1],
    ['Cloves', 'laung', 'Spices', 'packet', 1],
    ['Cinnamon', 'dalchini', 'Spices', 'packet', 1],
    ['Hing', 'asafoetida', 'Spices', 'packet', 1],
    ['Bay leaf', 'tej patta', 'Spices', 'packet', 1],
    ['Ajwain', 'carom seeds', 'Spices', 'packet', 1],
    ['Fenugreek seeds', 'methi dana', 'Spices', 'packet', 1],
    ['Kasuri methi', 'dried fenugreek leaves', 'Spices', 'packet', 1],
    ['Amchur', 'dry mango powder', 'Spices', 'packet', 1],
    ['Chaat masala', '', 'Spices', 'packet', 1],
    ['Sambar powder', 'sambhar masala', 'Spices', 'packet', 1],
    ['Rasam powder', '', 'Spices', 'packet', 1],
    ['Biryani masala', '', 'Spices', 'packet', 1],
    ['Pav bhaji masala', '', 'Spices', 'packet', 1],
    ['Chole masala', '', 'Spices', 'packet', 1],
    ['Kitchen king masala', '', 'Spices', 'packet', 1],
    ['Tea masala', 'chai masala', 'Spices', 'packet', 1],
    ['Saunf', 'fennel seeds', 'Spices', 'packet', 1],
    ['Dry red chilli', 'sabut lal mirch', 'Spices', 'packet', 1],
    ['Sesame seeds', 'til', 'Spices', 'packet', 1],
    ['Poppy seeds', 'khus khus', 'Spices', 'packet', 1],
    ['Coriander seeds', 'sabut dhania', 'Spices', 'packet', 1],
    ['Tamarind', 'imli', 'Spices', 'kg', 0.5],
    // ---- Sugar, tea & coffee ----
    ['Sugar', 'cheeni shakkar', 'Sugar, tea & coffee', 'kg', 2, 1],
    ['Jaggery', 'gud gur', 'Sugar, tea & coffee', 'kg', 1],
    ['Honey', 'shahad', 'Sugar, tea & coffee', 'bottle', 1],
    ['Rock sugar', 'mishri', 'Sugar, tea & coffee', 'packet', 1],
    ['Tea', 'chai patti chai powder', 'Sugar, tea & coffee', 'packet', 1, 1],
    ['Coffee', '', 'Sugar, tea & coffee', 'packet', 1],
    ['Health drink', 'bournvita horlicks boost complan', 'Sugar, tea & coffee', 'packet', 1],
    // ---- Dairy & eggs ----
    ['Milk', 'doodh', 'Dairy & eggs', 'L', 1, 1],
    ['Curd', 'dahi yogurt', 'Dairy & eggs', 'packet', 1],
    ['Paneer', 'cottage cheese', 'Dairy & eggs', 'packet', 1],
    ['Butter', 'makhan amul', 'Dairy & eggs', 'packet', 1],
    ['Cheese', '', 'Dairy & eggs', 'packet', 1],
    ['Eggs', 'anda ande', 'Dairy & eggs', 'dozen', 1, 1],
    ['Fresh cream', 'malai', 'Dairy & eggs', 'packet', 1],
    // ---- Dry fruits ----
    ['Almonds', 'badam', 'Dry fruits', 'g', 250],
    ['Cashew', 'kaju', 'Dry fruits', 'g', 250],
    ['Raisins', 'kishmish', 'Dry fruits', 'g', 250],
    ['Peanuts', 'moongfali groundnut', 'Dry fruits', 'kg', 0.5],
    ['Dates', 'khajoor', 'Dry fruits', 'g', 500],
    ['Walnut', 'akhrot', 'Dry fruits', 'g', 250],
    ['Pistachio', 'pista', 'Dry fruits', 'g', 100],
    ['Makhana', 'fox nuts lotus seeds', 'Dry fruits', 'packet', 1],
    ['Coconut', 'nariyal', 'Dry fruits', 'piece', 1],
    ['Dry coconut', 'copra khopra', 'Dry fruits', 'piece', 1],
    // ---- Vegetables (staples) ----
    ['Onion', 'pyaz pyaaz kanda', 'Vegetables', 'kg', 2, 1],
    ['Potato', 'aloo batata', 'Vegetables', 'kg', 2, 1],
    ['Tomato', 'tamatar', 'Vegetables', 'kg', 1, 1],
    ['Garlic', 'lehsun lasun', 'Vegetables', 'g', 250],
    ['Ginger', 'adrak', 'Vegetables', 'g', 250],
    ['Green chilli', 'hari mirch', 'Vegetables', 'g', 100],
    ['Lemon', 'nimbu', 'Vegetables', 'piece', 6],
    ['Coriander leaves', 'dhania patta cilantro', 'Vegetables', 'packet', 1],
    ['Curry leaves', 'kadi patta', 'Vegetables', 'packet', 1],
    // ---- Packaged & snacks ----
    ['Bread', 'pav', 'Packaged & snacks', 'packet', 1],
    ['Biscuits', 'cookies', 'Packaged & snacks', 'packet', 1],
    ['Namkeen', 'snacks mixture bhujia', 'Packaged & snacks', 'packet', 1],
    ['Noodles', 'maggi', 'Packaged & snacks', 'packet', 1],
    ['Pasta', 'macaroni', 'Packaged & snacks', 'packet', 1],
    ['Pickle', 'achaar', 'Packaged & snacks', 'bottle', 1],
    ['Papad', '', 'Packaged & snacks', 'packet', 1],
    ['Jam', '', 'Packaged & snacks', 'bottle', 1],
    ['Tomato ketchup', 'sauce', 'Packaged & snacks', 'bottle', 1],
    ['Peanut butter', '', 'Packaged & snacks', 'bottle', 1],
    ['Chips', 'wafers', 'Packaged & snacks', 'packet', 1],
    // ---- Cleaning & household ----
    ['Washing powder', 'detergent surf', 'Cleaning & household', 'kg', 1, 1],
    ['Dishwash liquid', 'vim bartan', 'Cleaning & household', 'bottle', 1],
    ['Dishwash bar', 'vim bar', 'Cleaning & household', 'piece', 1],
    ['Bath soap', 'sabun', 'Cleaning & household', 'packet', 1],
    ['Shampoo', '', 'Cleaning & household', 'bottle', 1],
    ['Toothpaste', 'paste', 'Cleaning & household', 'piece', 1],
    ['Toothbrush', 'brush', 'Cleaning & household', 'piece', 1],
    ['Hand wash', 'handwash', 'Cleaning & household', 'bottle', 1],
    ['Toilet cleaner', 'harpic', 'Cleaning & household', 'bottle', 1],
    ['Floor cleaner', 'lizol phenyl', 'Cleaning & household', 'bottle', 1],
    ['Agarbatti', 'incense sticks', 'Cleaning & household', 'packet', 1],
    ['Camphor', 'kapoor', 'Cleaning & household', 'packet', 1],
    ['Matchbox', 'machis', 'Cleaning & household', 'packet', 1],
    ['Candles', 'mombatti', 'Cleaning & household', 'packet', 1],
    ['Garbage bags', 'dustbin bags', 'Cleaning & household', 'packet', 1],
    ['Tissue paper', 'napkin', 'Cleaning & household', 'packet', 1],
    ['Aluminium foil', 'foil', 'Cleaning & household', 'piece', 1],
    ['Sanitary pads', '', 'Cleaning & household', 'packet', 1],
    ['Mosquito repellent', 'all out good knight', 'Cleaning & household', 'piece', 1],
    ['Gas cylinder', 'lpg', 'Cleaning & household', 'piece', 1],
  ].map(([name, alt, category, unit, qty, popular]) => ({
    name, category, unit, qty, popular: !!popular,
    find: (name + ' ' + alt).toLowerCase(),
  }));

  const CATEGORIES = ['Popular', ...new Set(CATALOG.map((c) => c.category))];
  const UNITS = ['kg', 'g', 'L', 'ml', 'packet', 'piece', 'dozen', 'bottle', 'box', 'bag', 'pouch', 'can'];
  const STEP = { kg: 0.5, L: 0.5, g: 50, ml: 100 };
  const byName = new Map(CATALOG.map((c) => [c.name.toLowerCase(), c]));

  const fmtQty = (q) => String(Math.round(q * 100) / 100);
  const lineText = (i) => `${i.name}${i.qty || i.unit ? ' – ' + fmtQty(i.qty) + (i.unit ? ' ' + i.unit : '') : ''}`;

  function search(query) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    return CATALOG
      .filter((c) => tokens.every((t) => c.find.includes(t)))
      .sort((a, b) => (b.name.toLowerCase().startsWith(tokens[0]) ? 1 : 0) - (a.name.toLowerCase().startsWith(tokens[0]) ? 1 : 0))
      .slice(0, 30);
  }

  function mount(root, { isAdmin = false, myId = null, onCount = () => {} } = {}) {
    let items = [];
    let tab = 'list';
    let category = 'Popular';
    let query = '';
    let loaded = false;

    const pending = () => items.filter((i) => i.status === 'needed');
    const onList = (name) => pending().some((i) => i.name.toLowerCase() === name.toLowerCase());

    // ---------- skeleton ----------
    const tabList = h('button', { class: 'on', role: 'tab', onclick: () => setTab('list') });
    const tabAdd = h('button', { role: 'tab', onclick: () => setTab('add') }, '➕ Add items');
    const seg = h('div', { class: 'seg', role: 'tablist' }, tabList, tabAdd);
    const listBox = h('div');
    const addBox = h('div', { hidden: true });
    root.replaceChildren(seg, listBox, addBox);

    // keep the search box between re-renders so typing is never interrupted
    const input = h('input', {
      type: 'search', class: 'rsearch', placeholder: 'Search: atta, dal, oil, आटा…', autocomplete: 'off', enterkeyhint: 'search',
      'aria-label': 'Search for an item',
    });
    input.addEventListener('input', () => { query = input.value.trim(); renderResults(); });
    const chips = h('div', { class: 'chips rchips', role: 'tablist', 'aria-label': 'Categories' });
    const results = h('div');
    addBox.append(h('p', { class: 'muted small rhint' }, 'Tap an item to add it. You can change how much on the “To order” tab.'), input, chips, results);

    function setTab(next) {
      tab = next;
      tabList.classList.toggle('on', tab === 'list');
      tabAdd.classList.toggle('on', tab === 'add');
      listBox.hidden = tab !== 'list';
      addBox.hidden = tab !== 'add';
      if (tab === 'add') renderResults();
      else renderList();
    }

    // ---------- API ----------
    async function refresh() {
      try {
        items = (await api('/api/ration')).items;
        loaded = true;
      } catch (err) {
        if (err.status === 401) { location.reload(); return; }
        toast(err.message, true);
      }
      paint();
    }

    function paint() {
      const n = pending().length;
      tabList.replaceChildren('\u{1F6D2} To order', loaded ? h('span', { class: 'badge' }, String(n)) : null);
      onCount(n);
      if (tab === 'list') renderList(); else renderResults();
    }

    async function add(name, unit, qty) {
      if (onList(name)) { toast(`${name} is already on the list.`); return; }
      try {
        const res = await api('/api/ration', { method: 'POST', body: JSON.stringify({ name, unit, qty }) });
        if (res.existed) toast(`${name} is already on the list.`);
        else toast(`✓ ${name} added`);
        await refresh();
      } catch (err) { toast(err.message, true); }
    }

    async function change(item, changes) {
      try {
        await api('/api/ration/' + item.id, { method: 'PATCH', body: JSON.stringify(changes) });
        await refresh();
      } catch (err) { toast(err.message, true); await refresh(); }
    }

    async function remove(item) {
      try {
        await api('/api/ration/' + item.id, { method: 'DELETE' });
        await refresh();
      } catch (err) { toast(err.message, true); }
    }

    // ---------- "Add items" tab ----------
    function renderChips() {
      chips.replaceChildren();
      CATEGORIES.forEach((c) => chips.append(h('button', {
        class: 'chip' + (category === c && !query ? ' on' : ''),
        onclick: () => { category = c; input.value = ''; query = ''; renderResults(); },
      }, c)));
    }

    function tile(c) {
      const has = onList(c.name);
      return h('button', { class: 'rtile' + (has ? ' has' : ''), onclick: () => add(c.name, c.unit, c.qty) },
        h('span', { class: 'rname' }, c.name),
        h('span', { class: 'rsub' }, has ? '✓ On the list' : `${fmtQty(c.qty)} ${c.unit}`),
      );
    }

    function renderResults() {
      renderChips();
      results.replaceChildren();
      const grid = h('div', { class: 'rgrid' });
      if (query) {
        const found = search(query);
        found.forEach((c) => grid.append(tile(c)));
        const exact = byName.has(query.toLowerCase());
        if (!exact) {
          // real matches come first; the "add it yourself" option goes last (or alone when nothing matches)
          grid.append(h('button', { class: 'rtile custom', onclick: async () => { await add(query, '', 1); input.value = ''; query = ''; renderResults(); } },
            h('span', { class: 'rname' }, `➕ Add “${query}”`),
            h('span', { class: 'rsub' }, found.length ? 'Not what you want? Add it as a new item' : 'Not in our list. Add it yourself')));
        }
      } else {
        CATALOG.filter((c) => (category === 'Popular' ? c.popular : c.category === category)).forEach((c) => grid.append(tile(c)));
      }
      results.append(grid);
    }

    // ---------- "To order" tab ----------
    function stepper(item) {
      const step = STEP[item.unit] || 1;
      const set = (q) => change(item, { qty: Math.max(step, Math.round(q * 100) / 100) });
      const select = h('select', { class: 'unit', 'aria-label': 'Unit', onchange: (e) => change(item, { unit: e.target.value }) },
        h('option', { value: '' }, '–'),
        UNITS.map((u) => h('option', { value: u, selected: u === item.unit }, u)));
      return h('div', { class: 'stepper' },
        h('button', { type: 'button', 'aria-label': 'Less', onclick: () => set(item.qty - step) }, '−'),
        h('span', { class: 'q' }, fmtQty(item.qty)),
        h('button', { type: 'button', 'aria-label': 'More', onclick: () => set(item.qty + step) }, '+'),
        select,
      );
    }

    function row(item) {
      const canRemove = isAdmin || item.memberId === myId;
      return h('div', { class: 'rrow' + (isAdmin ? '' : ' solo') },
        h('div', { class: 'rmain' },
          h('div', { class: 'rtitle' }, item.name),
          h('div', { class: 'muted small' }, `added by ${item.memberName}`)),
        canRemove ? h('button', { class: 'link danger small', onclick: () => remove(item) }, 'Remove') : h('span'),
        stepper(item),
        isAdmin ? h('button', { class: 'btn small', onclick: () => change(item, { status: 'ordered' }) }, '✓ Ordered') : null,
      );
    }

    function shareText() {
      const d = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const lines = pending().map((i) => '• ' + lineText(i));
      return `Ration list (${d})\n${lines.join('\n')}`;
    }

    function renderList() {
      listBox.replaceChildren();
      const list = pending();
      if (!loaded) { listBox.append(h('div', { class: 'empty-state' }, 'Loading…')); return; }

      if (!list.length) {
        listBox.append(h('div', { class: 'card empty-state' },
          h('p', null, 'Nothing to order right now.'),
          h('button', { class: 'btn', onclick: () => setTab('add') }, '➕ Add items')));
      } else {
        if (isAdmin) {
          listBox.append(h('div', { class: 'card ractionsbar' },
            h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(shareText()) }, 'Share on WhatsApp'),
            h('button', { class: 'btn ghost', onclick: async () => {
              try { await navigator.clipboard.writeText(shareText()); toast('List copied'); } catch { toast('Could not copy', true); }
            } }, 'Copy list'),
            h('button', { class: 'btn ghost', onclick: async () => {
              if (!confirm(`Mark all ${list.length} items as ordered?`)) return;
              try { await api('/api/ration/order-all', { method: 'POST' }); toast('✓ All marked as ordered'); await refresh(); } catch (e) { toast(e.message, true); }
            } }, `Mark all ${list.length} ordered`),
          ));
        }
        // group by category so the list reads like a shopping trip
        const groups = new Map();
        for (const i of list) {
          const cat = (byName.get(i.name.toLowerCase()) || {}).category || 'Other';
          if (!groups.has(cat)) groups.set(cat, []);
          groups.get(cat).push(i);
        }
        const order = [...CATEGORIES.slice(1), 'Other'];
        [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).forEach(([cat, rows]) => {
          listBox.append(h('section', { class: 'card rgroup' },
            h('h2', null, cat, h('span', { class: 'muted small' }, ` (${rows.length})`)),
            rows.map(row)));
        });
      }

      // recently ordered
      const done = items.filter((i) => i.status === 'ordered')
        .sort((a, b) => (a.orderedAt < b.orderedAt ? 1 : -1))
        .filter((i) => Date.now() - Date.parse(i.orderedAt || 0) < 21 * 24 * 3600 * 1000);
      if (done.length) {
        listBox.append(h('details', { class: 'card rdone' },
          h('summary', null, `Recently ordered (${done.length})`),
          done.slice(0, 40).map((i) => h('div', { class: 'rrow done' },
            h('div', { class: 'rmain' },
              h('div', { class: 'rtitle' }, lineText(i)),
              h('div', { class: 'muted small' }, `ordered ${App.prettyDate(i.orderedAt.slice(0, 10))}`)),
            isAdmin ? h('button', { class: 'btn small ghost', onclick: () => change(i, { status: 'needed' }) }, 'Order again') : null)),
        ));
      }
    }

    paint();
    refresh();
    return { refresh, pendingCount: () => pending().length };
  }

  return { mount };
})();
