/**
 * Model palette: Ctrl+L opens a keyboard-driven model picker over the session's
 * shared ModelDirectory (`ctx.modelDirectories`, the same store the composer
 * seat and the /model popup use), so a switch here is what those entries show
 * next. The current session id is captured from the session-scoped composer
 * dock seat; the palette renders through the frame-wide `shell.overlay` slot.
 *
 * Picking a model that exposes reasoning levels opens a second pane to pick
 * the effort; both go through the same `dir.select()` RPC — selecting the
 * unchanged model with a new `reasoningEffort` is the official
 * thinking-level-switch path the composer itself uses.
 *
 * apply() is written defensively on purpose: every step is independent and
 * failures are logged, so one broken registration never silences the shortcut.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-model-palette',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const uSES = React.useSyncExternalStore;
    if (!uSES) console.error('dsh-model-palette: React.useSyncExternalStore unavailable');

    const NS = 'modelPalette';

    /** Latest open session id, captured by the composer dock seat. */
    const sessionHolder = { sessionId: undefined };

    /** Root-context services captured in apply(). */
    const api = { ctx: null, t: null };

    /** Whether a subagent-addressed session may not use model RPCs. */
    function modelAvailable(sessionId) {
      try {
        const sessions = api.ctx && api.ctx.sessions;
        return sessions ? sessions.subagentAddress(sessionId) === undefined : true;
      } catch {
        return true;
      }
    }

    const paletteStore = (() => {
      let state = { open: false };
      const listeners = new Set();
      return {
        subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        getSnapshot() { return state; },
        set(next) { state = next; for (const fn of listeners) fn(); },
      };
    })();

    function openPalette() {
      if (paletteStore.getSnapshot().open) { paletteStore.set({ open: false }); return; }
      const sid = sessionHolder.sessionId;
      if (sid && modelAvailable(sid)) {
        try {
          const modelDirectories = api.ctx && api.ctx.get('modelDirectories');
          if (modelDirectories) {
            const dir = modelDirectories.directoryFor(sid);
            void dir.load().catch(() => { /* the palette surfaces the store error */ });
          }
        } catch { /* no resident scope yet; the palette shows the hint */ }
      }
      paletteStore.set({ open: true });
    }

    function closePalette() { paletteStore.set({ open: false }); }

    let cached = { sid: null, dir: null };
    function getDirectory() {
      const sid = sessionHolder.sessionId;
      if (!sid || !modelAvailable(sid)) return null;
      if (cached.sid === sid && cached.dir) return cached.dir;
      try {
        const modelDirectories = api.ctx && api.ctx.get('modelDirectories');
        if (!modelDirectories) return null;
        const dir = modelDirectories.directoryFor(sid);
        cached = { sid, dir };
        void dir.load().catch(() => { /* surfaced on the store */ });
        return dir;
      } catch {
        return null;
      }
    }

    const EMPTY_STATE = { current: null, routable: null, groups: [], failures: [], status: 'idle', pending: null, error: null };
    const noopSubscribe = () => () => {};

    function matchRow(query, group, model) {
      if (!query) return true;
      const hay = `${model.name} ${model.id} ${group.name}`.toLowerCase();
      return query.split(/\s+/).every(part => hay.includes(part));
    }

    /** A model offers the effort pane when it declares at least one level. */
    function hasEffortStep(model) {
      return Boolean(model && model.reasoning && Array.isArray(model.reasoning.efforts) && model.reasoning.efforts.length > 0);
    }

    function Palette() {
      const { open } = uSES(paletteStore.subscribe, paletteStore.getSnapshot);
      if (!open) return null;
      return h(PalettePanel);
    }

    /** Nth selectable model ordinal, skipping group/failure rows. */
    function modelOrdinal(list, target) {
      let n = -1;
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].kind !== 'model') continue;
        n += 1;
        if (i === target) return n;
      }
      return -1;
    }
    function countModels(list) {
      let n = 0;
      for (const r of list) if (r.kind === 'model') n += 1;
      return n;
    }
    function rowOfOrdinal(list, ordinal) {
      for (let i = 0; i < list.length; i += 1) {
        if (list[i].kind === 'model' && modelOrdinal(list, i) === ordinal) return list[i];
      }
      return null;
    }
    function nextModelIndex(list, ordinal, step) {
      const total = countModels(list);
      if (total === 0) return -1;
      let n = ordinal;
      for (let i = 0; i <= total; i += 1) {
        n = (n + step + total) % total;
        if (rowOfOrdinal(list, n)) return n;
      }
      return -1;
    }

    function PalettePanel() {
      const t = api.t;
      const dir = getDirectory();
      const state = uSES(
        dir ? dir.store.subscribe : noopSubscribe,
        dir ? dir.store.getSnapshot : () => EMPTY_STATE,
      );

      const [query, setQuery] = React.useState('');
      const [index, setIndex] = React.useState(0);
      /** Model being configured in the effort pane ({provider, model}), or null. */
      const [target, setTarget] = React.useState(null);
      const inputRef = React.useRef(null);
      const listRef = React.useRef(null);

      React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);

      const q = query.trim().toLowerCase();
      const rows = [];
      if (dir) {
        for (const group of state.groups) {
          const models = group.models.filter(m => matchRow(q, group, m));
          if (models.length === 0) continue;
          rows.push({ kind: 'group', key: `g:${group.id}`, label: group.name });
          for (const m of models) {
            rows.push({
              kind: 'model', key: `${group.id}/${m.id}`,
              provider: group.id, providerName: group.name, model: m,
            });
          }
        }
        if (q === '') {
          for (const f of state.failures) rows.push({ kind: 'failure', key: `f:${f.id}`, label: f.name, message: f.message });
        }
      }

      const current = state.current;
      // Effort pane inputs: the target model's reasoning metadata drives the
      // level list, mirroring the composer's own effortChoices shape.
      const targetModel = target && state.groups
        ? (state.groups.find(group => group.id === target.provider) || { models: [] }).models.find(m => m.id === target.model)
        : null;
      const reasoning = targetModel ? targetModel.reasoning : null;
      const effortChoices = !target || !reasoning ? [] : [
        ...(reasoning.defaultEffort === undefined ? [{ key: 'provider-default', effort: undefined, label: t('effortDefault') }] : []),
        ...reasoning.efforts.map(level => ({ key: `effort:${level.id}`, effort: level.id, label: level.name })),
      ];
      const filteredEfforts = effortChoices.filter(level => {
        if (!q) return true;
        return `${level.label} ${level.effort ?? ''}`.toLowerCase().includes(q);
      });
      const onCurrentTarget = target !== null && current !== null
        && current.provider === target.provider && current.model === target.model;
      const effectiveEffort = !target || !reasoning ? undefined
        : (onCurrentTarget && current && current.reasoningEffort !== undefined
          ? current.reasoningEffort
          : reasoning.defaultEffort);
      const total = target ? filteredEfforts.length : countModels(rows);
      const clamped = total === 0 ? 0 : Math.min(index, total - 1);
      const pendingKey = state.pending ? `${state.pending.provider}/${state.pending.model}` : null;

      function choose(row) {
        if (!dir || !row || row.kind !== 'model') return;
        if (hasEffortStep(row.model)) {
          setTarget({ provider: row.provider, model: row.model.id });
          setQuery('');
          setIndex(0);
          // Clicking a row moved focus to the (soon removed) button; keep it
          // on the search input so Esc/Backspace keep working in the pane.
          if (inputRef.current) inputRef.current.focus();
          return;
        }
        Promise.resolve(dir.select({ provider: row.provider, model: row.model.id }))
          .then(result => { if (result && result.ok) closePalette(); })
          .catch(() => { /* the store error row shows the reason */ });
      }

      function chooseEffort(level) {
        if (!dir || !target) return;
        const selection = { provider: target.provider, model: target.model };
        if (level.effort !== undefined) selection.reasoningEffort = level.effort;
        Promise.resolve(dir.select(selection))
          .then(result => { if (result && result.ok) closePalette(); })
          .catch(() => { /* the store error row shows the reason */ });
      }

      function backToModels() {
        setTarget(null);
        setQuery('');
        setIndex(0);
        if (inputRef.current) inputRef.current.focus();
      }

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (target) backToModels(); else closePalette();
          return;
        }
        if (event.key === 'Backspace' && target && query === '') {
          event.preventDefault();
          backToModels();
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          if (target) {
            if (filteredEfforts.length > 0) setIndex((clamped + 1) % filteredEfforts.length);
          } else {
            const next = nextModelIndex(rows, clamped, 1);
            if (next >= 0) setIndex(next);
          }
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          if (target) {
            if (filteredEfforts.length > 0) setIndex((clamped - 1 + filteredEfforts.length) % filteredEfforts.length);
          } else {
            const next = nextModelIndex(rows, clamped, -1);
            if (next >= 0) setIndex(next);
          }
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (target) {
            const level = filteredEfforts[clamped];
            if (level) chooseEffort(level);
          } else {
            choose(rowOfOrdinal(rows, clamped));
          }
        }
      }

      React.useEffect(() => {
        const node = listRef.current && listRef.current.querySelector(`[data-ord="${clamped}"]`);
        if (node) node.scrollIntoView({ block: 'nearest' });
      }, [clamped, q]);

      return h('div', { className: 'dmp-backdrop', onMouseDown: closePalette },
        h('div', {
          className: 'dmp-panel', role: 'dialog', 'aria-label': t('command'),
          onMouseDown: e => e.stopPropagation(),
        },
          h('input', {
            ref: inputRef, className: 'dmp-search', value: query, spellCheck: false,
            placeholder: target ? t('effortSearch') : dir ? t('placeholder') : t('noSession'),
            onChange: e => { setQuery(e.target.value); setIndex(0); },
            onKeyDown,
          }),
          target ? h('button', {
            type: 'button', className: 'dmp-back', onClick: backToModels,
            onMouseDown: event => event.preventDefault(),
          },
            h('span', { 'aria-hidden': true }, '←'),
            ` ${targetModel ? targetModel.name : target.model} · ${t('effortMenu')}`,
          ) : null,
          h('div', { className: 'dmp-list', ref: listRef, role: 'listbox' },
            target ? (
              reasoning == null ? h('div', { className: 'dmp-empty' }, t('emptyEfforts'))
                : filteredEfforts.length === 0 ? h('div', { className: 'dmp-empty' }, t('empty'))
                  : filteredEfforts.map((level, ord) => h('button', {
                    key: level.key, type: 'button', className: 'dmp-row', role: 'option',
                    'data-ord': ord, 'aria-selected': effectiveEffort === level.effort,
                    'data-active': ord === clamped ? 'true' : 'false',
                    onMouseDown: event => event.preventDefault(),
                    onClick: () => chooseEffort(level),
                    onMouseEnter: () => setIndex(ord),
                  },
                    h('span', null, level.label),
                    state.pending && target
                      && state.pending.provider === target.provider && state.pending.model === target.model
                      && state.pending.reasoningEffort === level.effort
                      ? h('span', { className: 'dmp-sub' }, '…') : null,
                    effectiveEffort === level.effort ? h('span', { className: 'dmp-check' }, '✓') : null,
                  ))
            ) : !dir ? h('div', { className: 'dmp-empty' }, t('noSession'))
              : state.status === 'loading' && rows.length === 0 ? h('div', { className: 'dmp-empty' }, t('loading'))
                : rows.length === 0 ? h('div', { className: 'dmp-empty' }, t('empty'))
                  : rows.map(row => {
                    if (row.kind === 'group') {
                      return h('div', { key: row.key, className: 'dmp-group' }, row.label);
                    }
                    if (row.kind === 'failure') {
                      return h('div', { key: row.key, className: 'dmp-failure' },
                        `${row.label} — ${row.message}`);
                    }
                    const ord = modelOrdinal(rows, rows.indexOf(row));
                    const active = current !== null && current.provider === row.provider && current.model === row.model.id;
                    let rowEffort = null;
                    if (active && row.model.reasoning) {
                      const eff = current && current.reasoningEffort !== undefined
                        ? current.reasoningEffort
                        : row.model.reasoning.defaultEffort;
                      rowEffort = eff === undefined ? t('effortDefault')
                        : row.model.reasoning.efforts.find(level => level.id === eff)?.name ?? eff;
                    }
                    return h('button', {
                      key: row.key, type: 'button', className: 'dmp-row', role: 'option',
                      'data-ord': ord, 'aria-selected': active,
                      'data-active': ord === clamped ? 'true' : 'false',
                      onMouseDown: event => event.preventDefault(),
                      onClick: () => choose(row),
                      onMouseEnter: () => setIndex(ord),
                    },
                      h('span', null, row.model.name),
                      rowEffort ? h('span', { className: 'dmp-sub' }, rowEffort) : null,
                      row.model.badge ? h('span', { className: 'dmp-sub' }, row.model.badge.label ?? '') : null,
                      pendingKey === row.key ? h('span', { className: 'dmp-sub' }, '…') : null,
                      active ? h('span', { className: 'dmp-check' }, '✓') : null,
                    );
                  })),
          state.error ? h('div', { className: 'dmp-error' }, state.error) : null,
          h('div', { className: 'dmp-footer' }, t(target ? 'footerEffort' : 'footerHint')),
        ),
      );
    }

    const CSS = `
      .dmp-backdrop{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,.28)}
      .dmp-panel{position:fixed;left:50%;top:16vh;transform:translateX(-50%);width:min(540px,92vw);
        background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;
        box-shadow:0 12px 48px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary);overflow:hidden}
      .dmp-search{width:100%;box-sizing:border-box;padding:12px 16px;background:transparent;border:none;outline:none;
        border-bottom:1px solid var(--dsw-alias-border-l1);color:inherit;font-size:14px}
      .dmp-search::placeholder{color:var(--dsw-alias-label-secondary)}
      .dmp-list{max-height:46vh;overflow-y:auto;padding:6px}
      .dmp-group{padding:8px 10px 4px;font-size:11px;color:var(--dsw-alias-label-secondary);
        text-transform:uppercase;letter-spacing:.04em}
      .dmp-row{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:7px 10px;border:none;
        background:none;color:inherit;font-size:13px;border-radius:8px;cursor:pointer}
      .dmp-row[data-active="true"]{background:var(--dsw-alias-bg-layer-2)}
      .dmp-sub{color:var(--dsw-alias-label-secondary);font-size:11px}
      .dmp-check{color:var(--dsw-alias-brand-primary);margin-left:auto}
      .dmp-failure{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 10px}
      .dmp-error{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 12px;
        border-top:1px solid var(--dsw-alias-border-l1)}
      .dmp-empty{padding:16px;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}
      .dmp-footer{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);
        color:var(--dsw-alias-label-secondary);font-size:11px}
      .dmp-back{display:flex;align-items:center;gap:6px;width:100%;padding:9px 12px;border:none;
        background:none;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;text-align:left}
      .dmp-back:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
    `;

    const ZH = {
      command: '选择模型',
      placeholder: '搜索模型…',
      empty: '没有可用模型',
      noSession: '先打开一个会话',
      loading: '加载中…',
      footerHint: '↑↓ 选择 · Enter 确认 · Esc 关闭',
      effortSearch: '筛选推理等级…',
      effortDefault: '跟随默认',
      effortMenu: '推理等级',
      emptyEfforts: '该模型未提供推理等级',
      footerEffort: '↑↓ 选择 · Enter 确认 · Backspace/Esc 返回',
    };
    const EN = {
      command: 'Select model',
      placeholder: 'Search models…',
      empty: 'No models available',
      noSession: 'Open a session first',
      loading: 'Loading…',
      footerHint: '↑↓ move · Enter select · Esc close',
      effortSearch: 'Filter efforts…',
      effortDefault: 'Provider default',
      effortMenu: 'Reasoning effort',
      emptyEfforts: 'This model has no reasoning levels',
      footerEffort: '↑↓ move · Enter apply · Backspace/Esc back',
    };
    const LOCALE_DICTS = { zh: ZH, en: EN, ja: EN, es: EN, fr: EN, de: EN, ru: EN, pt: EN };

    function sessionHoldComponent(props) {
      const sid = props && (props.sessionId ?? (props.session && props.session.id));
      if (typeof sid === 'string' && sid) sessionHolder.sessionId = sid;
      return null;
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        api.ctx = ctx;
        const safe = (label, fn) => {
          try { return fn(); } catch (error) { console.error(`dsh-model-palette: ${label} failed`, error); return undefined; }
        };

        // 1. Locale dictionary first — shortcuts.register calls label()
        //    synchronously, so the bound translator must already exist.
        safe('locale', () => {
          ctx.effect(() => ctx.locale.register(NS, LOCALE_DICTS), 'dsh-model-palette: dictionaries');
          api.t = ctx.locale.bind(NS);
        });
        if (!api.t) api.t = key => ({ command: 'Select model', placeholder: 'Search models…', empty: 'No models available', noSession: 'Open a session first', loading: 'Loading…', footerHint: '↑↓ move · Enter select · Esc close', effortSearch: 'Filter efforts…', effortDefault: 'Provider default', effortMenu: 'Reasoning effort', emptyEfforts: 'This model has no reasoning levels', footerEffort: '↑↓ move · Enter apply · Backspace/Esc back' }[key] || key);

        // 2. The shortcut — the user-visible feature.
        safe('shortcut', () => ctx.effect(() => {
          let disposer = null;
          let tries = 0;
          const attempt = () => {
            const shortcuts = ctx.get('shortcuts');
            if (!shortcuts || typeof shortcuts.register !== 'function') return false;
            try {
              disposer = shortcuts.register({
                id: 'modelPalette.open',
                label: () => api.t('command'),
                aliases: ['model', 'palette', 'select model', '模型', '选择模型'],
                defaults: {
                  'desktop:macos': { code: 'KeyL', modifiers: ['control'] },
                  'desktop:windows': { code: 'KeyL', modifiers: ['control'] },
                  'desktop:linux': { code: 'KeyL', modifiers: ['control'] },
                  // Web policy (isWebBindingAllowed): a two-modifier combo must
                  // include the platform primary (meta on macOS, control on
                  // Windows); Linux web allows only whitelisted keys, so no
                  // web:linux default — registration validates every declared
                  // platform eagerly and one invalid binding fails them all.
                  'web:macos': { code: 'KeyL', modifiers: ['meta', 'alt'] },
                  'web:windows': { code: 'KeyL', modifiers: ['control', 'alt'] },
                },
                regions: ['page', 'editable'],
                modals: [],
                resolve: () => ({ status: 'handled', run: openPalette }),
              });
              return true;
            } catch (error) {
              console.error('dsh-model-palette: shortcuts.register failed', error);
              return true;
            }
          };
          if (attempt()) return () => { if (disposer) disposer(); };
          const timer = setInterval(() => { if (attempt() || (tries += 1) > 50) clearInterval(timer); }, 200);
          return () => { clearInterval(timer); if (disposer) disposer(); };
        }, 'dsh-model-palette: shortcut'));

        // 3. Package-owned stylesheet — prefer the styles builtin; hand-written
        //    bundles may not have it, so fall back to a plain <style> node.
        safe('styles', () => ctx.effect(() => {
          if (typeof styles !== 'undefined' && styles && styles.insert) return styles.insert(CSS);
          const node = document.createElement('style');
          node.dataset.source = 'dsh-model-palette';
          node.textContent = CSS;
          document.head.append(node);
          return () => node.remove();
        }, 'dsh-model-palette: styles'));

        // 4. Session-id capture from the session-scoped composer dock seat.
        safe('dock.hold', () => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-model-palette.hold',
          order: 900,
          inject: (sessionId) => { sessionHolder.sessionId = sessionId; return {}; },
        }, sessionHoldComponent)));

        // 5. The frame-wide palette overlay.
        safe('overlay', () => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-model-palette',
          order: 60,
          locale: NS,
        }, Palette)));
      },
    };
  },
});
