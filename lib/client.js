/**
 * 浏览器侧：只在「设置 → 会话管理」放一个分区，逐项开关模型可调用的会话能力。
 *
 * 没有侧栏入口、没有管理面板。开关注入后立即保存到宿主
 * `~/.dsh/storages/session-hub.json`；关闭的能力仍出现在工具列表里，但调用会被拒绝。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-hub',
  factory: (require) => {
    const react = require('react')
    const { useState, useEffect, useCallback } = react
    const h = react.createElement
    const createPortal = require('react-dom').createPortal

/**
 * DSH 客户端 UI kit v5（2026-11-18）—— 整段粘进 `lib/client.js` 的 factory 里（`const react = require('react')` 之后）。
 *
 * v5 相对 v4 只改样式实现，导出 API 不变（`check-kit-drift` 的 API 比对不会报）：
 *   1. 浮层阴影 `0 12px 32px rgba(0,0,0,.45)` → `var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.45))`；
 *   2. 删除 `Input` 的 `outline: 'none'`（宿主 `:focus-visible` 已接管键盘焦点环，写 none 会吞掉它）；
 *   3. 首尾加 `kit begin` / `kit end` 标记，防止整段替换时吃掉使用方的 `createUi` 与解构两行。
 * **版本口径**：版本号只在本文件头改，`ui-kit.md` 直接引用这个 vN，不再另立编号（否则会出现「文档说 v3、文件说 v4」的双轨）。
 *
 * 重贴步骤（照做，别凭印象）：
 *   1. 替换范围 = 从本文件开头的块注释起，到**文件最后一行**为止（该行是固定串 kit end 标记，
 *      别用前缀/startsWith 之类匹配——标记行是完整一行，按整行相等去切最稳；也可用 `function createUi(` 做括号配平定位）。
 *      只贴 `kit begin` 之后的内容会丢掉 `kit vN` 标记，check-kit-drift 会报「(无版本标记)」；
 *   2. 范围外那两行 `const ui = createUi(...)` 与解构属于**使用方**，不要替换掉（漏了会白屏 `Section is not defined`）；
 *   3. 替换后必须跑 client-harness 渲染两个槽位（sidebar.footer.action + settings.section），
 *      只看 check-kit-drift 不够 —— 它只比 API，注释块被写坏、组件未解构它都报绿（2026-11-18 两次踩中）。
 *
 * 为什么是"粘贴"而不是 import：插件的浏览器 bundle 由宿主按单文件 `/plugins/<id>/client.js`
 * 提供，没有打包器，`import './ui.js'` 在浏览器里跑不起来。所以公用组件以「可粘贴的片段」分发。
 *
 *   const ui = createUi(react, require('react-dom').createPortal)
 *   const { h, Card, StatusDot, Switch, TextField, Button, Section, SettingsCard, SettingRow,
 *           createStore, useStore, usePoll, placeNear, HoverCard, T, TYPE } = ui
 *
 * 约定：所有颜色/圆角走 DSH token；所有字号走 TYPE 里的档位（小字行高固定 13px，
 * 否则 baseline 行盒会被撑高，同排卡片高度就会差 3px）。
 */
/* ===== kit begin（重贴时从这里开始替换）===== */

function createUi(react, createPortal) {
  const h = react.createElement
  const { useState, useEffect, useCallback, useRef } = react

  /* ---------- token 与字号 ---------- */
  const T = {
    text1: 'var(--dsw-alias-label-primary)',
    text2: 'var(--dsw-alias-label-secondary)',
    text3: 'var(--dsw-alias-label-tertiary, #8b929c)',
    line: 'var(--dsw-alias-border-l3)',
    cardFill: 'var(--dsw-alias-settings-card-fill, #2c2c2e)',
    cardStroke: 'var(--dsw-alias-settings-card-stroke, #ffffff26)',
    inputFill: 'var(--dsw-alias-bg-layer-1, #1b1b1c)',
    accent: 'var(--dsw-alias-button-primary-fill, #f9fafb)',
    accentText: 'var(--dsw-alias-label-primary-foreground, #0f1115)',
    radiusMd: 'var(--dsw-radius-md, 12px)',
    radiusXl: 'var(--dsw-radius-xl, 20px)',
  }
  const CARD_BG = 'color-mix(in srgb, currentColor 6%, transparent)'
  const TYPE = {
    /* 官方设置页分区头：标题 18/600，说明 13 弱色（宿主 PluginsSettingsSection.css） */
    h1: { fontSize: 18, fontWeight: 600, lineHeight: '26px', color: T.text1 },
    h2: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1 },
    body: { fontSize: 13, lineHeight: '20px', color: T.text1 },
    secondary: { fontSize: 13, lineHeight: '20px', color: T.text2 },
    intro: { fontSize: 13, lineHeight: '20px', color: T.text3 },
    small: { fontSize: 12, lineHeight: '18px', color: T.text2 },
    micro: { fontSize: 11, lineHeight: '14px', color: T.text2 },
    num: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1, fontVariantNumeric: 'tabular-nums' },
    ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }

  /* ---------- 纯函数 ---------- */
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

  /** 浮层定位：优先右侧，放不下翻左；上下夹在视口内。pure，便于脱离 DOM 测试。 */
  function placeNear(rect, options = {}) {
    const width = options.width ?? 248
    const height = options.height ?? 120
    const gap = options.gap ?? 8
    const vw = options.viewport?.width ?? (typeof window === 'undefined' ? 1280 : window.innerWidth)
    const vh = options.viewport?.height ?? (typeof window === 'undefined' ? 800 : window.innerHeight)
    let side = 'right'
    let left = rect.right + gap
    if (left + width > vw - gap) {
      side = 'left'
      left = rect.left - gap - width
    }
    return {
      side,
      left: clamp(left, gap, Math.max(gap, vw - width - gap)),
      top: clamp(rect.top, gap, Math.max(gap, vh - height - gap)),
    }
  }

  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB'
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  }

  /* ---------- 本地状态：模块级 store + hook ---------- */
  /** 按设备持久化；只存差异值也安全（读取时与默认值合并）。 */
  function createStore(key, defaults = {}) {
    const read = () => {
      try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
      } catch {
        return { ...defaults }
      }
    }
    const store = {
      key,
      value: read(),
      listeners: new Set(),
      set(next) {
        store.value = typeof next === 'function' ? next(store.value) : next
        try { localStorage.setItem(key, JSON.stringify(store.value)) } catch {}
        for (const listener of store.listeners) listener(store.value)
      },
      patch(part) { store.set({ ...store.value, ...part }) },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      },
    }
    return store
  }

  function useStore(store) {
    const [value, setValue] = useState(store.value)
    useEffect(() => store.subscribe(setValue), [store])
    return value
  }

  /** 轮询 + 失败保留上一帧（不要闪成空）。返回 [data, error, refresh]。 */
  function usePoll(task, intervalMs, deps = []) {
    const [state, setState] = useState({ data: null, error: false })
    const run = useCallback(async () => {
      try {
        const data = await task()
        setState({ data, error: false })
      } catch {
        setState((prev) => ({ data: prev.data, error: true }))
      }
    }, deps)
    useEffect(() => {
      run()
      const timer = setInterval(run, intervalMs)
      return () => clearInterval(timer)
    }, [run, intervalMs])
    return [state.data, state.error, run]
  }

  /* ---------- 侧栏卡片 ---------- */
  const StatusDot = ({ color, size = 6, offset = 1.5 }) => h('span', {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      backgroundColor: color || T.text3,
      flex: '0 0 auto',
      alignSelf: 'center',
      transform: `translateY(${offset}px)`,
    },
  })

  /** 侧栏卡片：一行，圆点 + 名称 + 右侧数字。左右两组用同一 baseline。 */
  const Card = ({ children, style, ...rest }) => h('div', {
    ...rest,
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      padding: '2px 12px 5px',
      borderRadius: T.radiusMd,
      background: CARD_BG,
      minWidth: 0,
      overflow: 'hidden',
      ...style,
    },
  }, children)

  /** 侧栏卡片容器：竖排 + 3px 间距 + 左右 2px 内缩（与 newSession 对齐）。 */
  const CardStack = ({ children }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 3, padding: '0 2px 2px', minWidth: 0 },
  }, children)

  const CardName = ({ children }) => h('span', { style: { ...TYPE.h2, fontSize: 12, flex: '1 1 auto', ...TYPE.ellipsis } }, children)
  const CardValue = ({ children }) => h('span', {
    style: { display: 'flex', alignItems: 'baseline', gap: 4, flex: '0 0 auto', ...TYPE.num },
  }, children)

  /* ---------- 设置页 ---------- */
  /* 官方分区结构：flex column gap 12，h2 标题 + p 说明（说明 13 弱色），下面才是内容 */
  const Section = ({ title, description, children }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640, minWidth: 0 },
  },
  h('h2', { style: { margin: 0, ...TYPE.h1 } }, title),
  description ? h('p', { style: { margin: 0, ...TYPE.intro } }, description) : null,
  children)

  /** 设置卡片：官方那种 20px 圆角、深色填充、细描边。 */
  const SettingsCard = ({ children, style }) => h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      padding: '14px 16px',
      borderRadius: T.radiusXl,
      border: `.5px solid ${T.cardStroke}`,
      background: T.cardFill,
      minWidth: 0,
      ...style,
    },
  }, children)

  /** 左标签 + 右控件的一行。副标签行高与 TYPE.micro 对齐（11/14），复用行高就不会差 2px。 */
  const SettingRow = ({ label, hint, children }) => h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  },
  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
    h('span', { style: TYPE.body }, label),
    hint ? h('span', { style: { ...TYPE.micro, ...TYPE.ellipsis } }, hint) : null),
  children)

  /** 药丸开关：36×20，白色底 + 深色旋钮，与官方设置页一致。 */
  const Switch = ({ checked, onChange, title, disabled = false }) => h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    disabled,
    onClick: onChange,
    title,
    style: {
      boxSizing: 'border-box',
      position: 'relative',
      flex: '0 0 auto',
      width: 36,
      height: 20,
      padding: 2,
      border: 0,
      borderRadius: 999,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: checked ? 'flex-end' : 'flex-start',
      transition: 'background-color .12s ease',
      backgroundColor: checked ? T.accent : 'var(--dsw-alias-border-l3, #4a4a4d)',
    },
  }, h('span', {
    style: {
      display: 'block',
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: checked ? T.accentText : 'var(--dsw-alias-label-primary, #f9fafb)',
      transition: 'background-color .12s ease',
    },
  }))

  const Button = ({ children, onClick, variant = 'primary', disabled = false, type = 'button' }) => h('button', {
    type,
    onClick,
    disabled,
    style: {
      boxSizing: 'border-box',
      height: 36,
      padding: '0 16px',
      borderRadius: T.radiusMd,
      whiteSpace: 'nowrap',
      flex: 'none',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      fontSize: 13,
      lineHeight: '20px',
      fontWeight: 500,
      ...(variant === 'primary'
        ? { border: 'none', background: T.accent, color: T.accentText }
        : { border: `.5px solid ${T.cardStroke}`, background: 'transparent', color: T.text1 }),
    },
  }, children)

  /** 文本输入：44px 高、12px 圆角，与官方设置字段一致。 */
  /** 输入框：与 Select / Button 同高（36px），支持单位后缀、禁用、错误态、回车提交。 */
  const Input = ({
    value,
    onChange,
    placeholder = '',
    type = 'text',
    width = 220,
    unit,
    disabled = false,
    invalid = false,
    min,
    max,
    step,
    autoFocus = false,
    onEnter,
  }) => {
    const [focused, setFocused] = useState(false)
    const border = invalid ? 'var(--dsw-alias-state-error-primary, #ff6262)' : focused ? T.text3 : T.cardStroke
    return h('div', {
      style: {
        width,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 36,
        boxSizing: 'border-box',
        padding: '0 10px',
        borderRadius: T.radiusMd,
        border: `.5px solid ${border}`,
        background: T.inputFill,
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color .12s ease',
      },
    },
      h('input', {
        type,
        value: value ?? '',
        placeholder,
        disabled,
        min,
        max,
        step,
        autoFocus,
        onChange: (event) => onChange?.(event.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown: (event) => { if (event.key === 'Enter') onEnter?.(event.target.value) },
        style: {
          flex: 1,
          minWidth: 0,
          border: 0,
          background: 'transparent',
          color: T.text1,
          fontSize: 13,
          lineHeight: '20px',
          padding: 0,
        },
      }),
      unit ? h('span', { style: { ...TYPE.micro, flex: 'none' } }, unit) : null,
    )
  }

  /** 带标签/说明的输入框（Input 的组合封装，保留旧 API）。 */
  const TextField = ({ label, hint, width = '100%', ...props }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  },
  label ? h('span', { style: { fontSize: 12, lineHeight: '16px', color: T.text2 } }, label) : null,
  h(Input, { width, ...props }),
  hint ? h('span', { style: TYPE.micro }, hint) : null)

  /* ---------- 浮层 ---------- */
  /** 悬停详情卡：portal 到 body，先按估算高度定位，挂载后按实测高度夹取。 */
  function HoverCard({ rect, width = 248, estimated = 120, children }) {
    const ref = useRef(null)
    const [placement, setPlacement] = useState(() => placeNear(rect, { width, height: estimated }))
    useEffect(() => {
      const node = ref.current
      if (!node) return
      const measured = node.getBoundingClientRect().height || estimated
      setPlacement(placeNear(rect, { width, height: measured }))
    }, [rect, width, estimated])
    const node = h('div', {
      ref,
      style: {
        position: 'fixed',
        left: placement.left,
        top: placement.top,
        width,
        zIndex: 2147400000,
        background: T.cardFill,
        border: `.5px solid ${T.cardStroke}`,
        borderRadius: T.radiusXl,
        padding: '12px 14px',
        boxShadow: 'var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, .45))',
        color: T.text1,
      },
    }, children)
    return createPortal && typeof document !== 'undefined' ? createPortal(node, document.body) : node
  }

  /** 详情卡里的一行：左标题、右值。 */
  const InfoRow = ({ label, value }) => h('div', {
    style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  },
  h('span', { style: { fontSize: 12, lineHeight: '18px', color: T.text2 } }, label),
  h('span', { style: { fontSize: 12, lineHeight: '18px', color: T.text1, fontVariantNumeric: 'tabular-nums' } }, value))

  /* ---------- 通用控件 ---------- */

  /** 下拉：触发器与设置输入框同高；浮层在触发器内绝对定位（不 portal），宽度与触发器一致。 */
  function Select({ value, options = [], onChange, width = 220, placeholder = '', disabled = false }) {
    const [open, setOpen] = useState(false)
    const [hover, setHover] = useState(-1)
    const ref = useRef(null)
    const current = options.find((option) => option.value === value)

    useEffect(() => {
      if (!open) return undefined
      const onDown = (event) => { if (ref.current && ref.current.contains(event.target)) return; setOpen(false) }
      const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }, [open])

    const trigger = {
      boxSizing: 'border-box',
      width: '100%',
      height: 36,
      padding: '0 8px 0 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: T.radiusMd,
      border: `.5px solid ${T.cardStroke}`,
      background: T.inputFill,
      color: T.text1,
      fontSize: 13,
      lineHeight: '20px',
      cursor: disabled ? 'default' : 'pointer',
      textAlign: 'left',
      opacity: disabled ? 0.55 : 1,
    }

    return h('div', { ref, style: { position: 'relative', width, minWidth: 0 } },
      h('button', {
        type: 'button',
        disabled,
        onClick: () => { if (disabled) return; setHover(-1); setOpen((previous) => !previous) },
        style: trigger,
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
      },
        h('span', { style: { ...TYPE.ellipsis, flex: 1, textAlign: 'left', color: current ? T.text1 : T.text2 } }, current ? current.label : placeholder),
        h('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: T.text2,
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
          style: { flex: 'none', transition: 'transform .12s ease', transform: open ? 'rotate(180deg)' : 'none' },
        }, h('path', { d: 'M6 9l6 6 6-6' })),
      ),
      open && !disabled ? h('div', {
        role: 'listbox',
        style: {
          boxSizing: 'border-box',
          position: 'absolute',
          left: 0,
          top: 'calc(100% + 6px)',
          width,
          maxHeight: 320,
          overflowY: 'auto',
          padding: 4,
          zIndex: 40,
          background: T.cardFill,
          border: `.5px solid ${T.cardStroke}`,
          borderRadius: T.radiusMd,
          boxShadow: 'var(--dsw-elevation-prominent, 0 12px 32px rgba(0, 0, 0, .45))',
        },
      }, options.map((option, index) => h('div', {
        key: option.value,
        role: 'option',
        'aria-selected': option.value === value,
        onMouseEnter: () => setHover(index),
        onMouseLeave: () => setHover(-1),
        onClick: () => { onChange?.(option.value); setOpen(false) },
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          height: 32,
          padding: '0 10px',
          borderRadius: 8,
          fontSize: 13,
          lineHeight: '20px',
          color: T.text1,
          cursor: 'pointer',
          background: hover === index
            ? 'color-mix(in srgb, currentColor 8%, transparent)'
            : option.value === value ? 'color-mix(in srgb, currentColor 4%, transparent)' : 'transparent',
        },
      },
        h('span', { style: { ...TYPE.ellipsis } }, option.label),
        option.value === value ? h('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: T.text1,
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        }, h('path', { d: 'M5 13l4 4L19 7' })) : null,
      ))) : null,
    )
  }

  /** 分段切换（2~4 项）：选中项白底黑字，未选中透明，整组与输入框同高。 */
  function Segmented({ value, options = [], onChange }) {
    return h('div', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 36,
        padding: 2,
        boxSizing: 'border-box',
        borderRadius: T.radiusMd,
        border: `.5px solid ${T.cardStroke}`,
        background: T.inputFill,
      },
    }, options.map((option) => {
      const active = option.value === value
      return h('button', {
        key: option.value,
        type: 'button',
        onClick: () => onChange?.(option.value),
        style: {
          height: 30,
          padding: '0 12px',
          border: 'none',
          borderRadius: 9,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: '20px',
          background: active ? T.accent : 'transparent',
          color: active ? T.accentText : T.text2,
          transition: 'background-color .12s ease, color .12s ease',
        },
      }, option.label)
    }))
  }

  /** 图标按钮：28×28，hover 有底色；用于行内删除、刷新等。 */
  const IconButton = ({ label, onClick, disabled = false, children }) => h('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    onClick,
    disabled,
    style: {
      width: 28,
      height: 28,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 0,
      borderRadius: 8,
      background: 'transparent',
      color: disabled ? T.text3 : T.text2,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    },
  }, children)

  /** 指标块：上标签、下数值，用于面板顶部摘要。 */
  const StatTile = ({ label, value, hint }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 96 },
  },
  h('span', { style: TYPE.micro }, label),
  h('span', { style: { ...TYPE.num } }, value),
  hint ? h('span', { style: TYPE.micro }, hint) : null)

  /** 空态：居中提示，不占空容器。 */
  const EmptyState = ({ title, hint }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '24px 12px', textAlign: 'center' },
  },
  h('span', { style: TYPE.body }, title),
  hint ? h('span', { style: TYPE.small }, hint) : null)

  return {
    h, T, TYPE, CARD_BG,
    clamp, placeNear, formatBytes,
    createStore, useStore, usePoll,
    Card, CardStack, CardName, CardValue, StatusDot,
    Section, SettingsCard, SettingRow, Switch, Button, Input, TextField,
    Select, Segmented, IconButton, StatTile, EmptyState,
    HoverCard, InfoRow,
  }
}


/* ===== kit end ===== */


    const ui = createUi(react, createPortal)
    const { Section, SettingsCard, SettingRow, Switch, T, TYPE } = ui

    const API = '/dsh-session-hub/api/capabilities'

    /** 每项能力对应的工具与说明；顺序就是设置页里的顺序。 */
    const ITEMS = [
      {
        key: 'list',
        title: '会话发现',
        hint: 'session_hub_list：跨项目列出会话、标题、运行状态与当前目标。',
      },
      {
        key: 'messaging',
        title: '跨会话消息',
        hint: 'session_hub_message：给任意会话发消息，冷会话会自动唤醒；不限制项目目录。',
      },
      {
        key: 'sessions',
        title: '会话管理',
        hint: 'session_hub_session：新建、更名、归档、置顶、停止当前轮、复制会话。',
      },
      {
        key: 'goals',
        title: '目标管理',
        hint: 'session_hub_goal：读取、新建、编辑、暂停、恢复、开始、完成、清除目标。',
      },
      {
        key: 'preview',
        title: '对话预览',
        hint: 'session_hub_preview：读取任意会话最近几条对话，发消息前先看上下文。',
      },
    ]

    /** 读宿主开关；失败抛出带说明的错误。 */
    async function fetchCapabilities() {
      const response = await fetch(API, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`)
      return payload
    }

    /** 保存一组开关，返回完整能力表。 */
    async function saveCapabilities(patch) {
      const response = await fetch(API, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json', 'x-session-hub': '1' },
        body: JSON.stringify(patch),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`)
      return payload
    }

    function Settings() {
      const [capabilities, setCapabilities] = useState(null)
      const [error, setError] = useState('')
      const [saving, setSaving] = useState('')

      const load = useCallback(async () => {
        try {
          const payload = await fetchCapabilities()
          setCapabilities(payload.capabilities)
          setError('')
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [])

      useEffect(() => {
        void load()
        const timer = setInterval(load, 30000)
        return () => clearInterval(timer)
      }, [load])

      const toggle = async (key) => {
        if (!capabilities || saving !== '') return
        const previous = capabilities
        const next = capabilities[key] === false
        setCapabilities({ ...capabilities, [key]: next })
        setSaving(key)
        try {
          const payload = await saveCapabilities({ [key]: next })
          setCapabilities(payload.capabilities)
          setError('')
        } catch (failure) {
          setCapabilities(previous)
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setSaving('')
        }
      }

      const enabledCount = capabilities
        ? ITEMS.filter((item) => capabilities[item.key] !== false).length
        : 0

      const status = error
        ? `设置不可用：${error}`
        : capabilities
          ? `${enabledCount} / ${ITEMS.length} 项能力已开启`
          : '读取中…'

      return h(Section, {
        title: '会话管理',
        description: '按能力开关模型可调用的会话工具。关闭后工具仍会出现在模型工具列表里，但调用会被拒绝；开关立即保存并生效。',
      },
      h(SettingsCard, null,
        ITEMS.map((item) => h(SettingRow, {
          key: item.key,
          label: item.title,
          hint: item.hint,
        }, h(Switch, {
          checked: capabilities ? capabilities[item.key] !== false : false,
          disabled: capabilities === null || saving !== '',
          title: `切换${item.title}`,
          onChange: () => { void toggle(item.key) },
        })))),
      h('span', {
        style: {
          ...TYPE.micro,
          color: error ? 'var(--dsw-alias-state-error-primary, #ff6262)' : T.text3,
          minHeight: 14,
        },
      }, status),
      h('span', {
        style: { ...TYPE.micro, color: T.text3 },
      }, '开关保存在本机 ~/.dsh/storages/session-hub.json；不存在侧栏入口或会话面板。'))
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { id: 'session-hub', name: 'settings.section', order: 60, label: () => '会话管理' },
          Settings,
        ))
    }

    return { inject, apply }
  },
})
