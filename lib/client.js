/**
 * 浏览器侧：侧栏「会话管理」入口 + 全屏管理面板。
 *
 * 面板能力（全部走宿主 /session-hub/api，跨项目）：
 *   - 会话列表：标题、项目、运行状态、目标、归档/置顶标记，可搜索筛选；
 *   - 新建 / 更名 / 归档 / 取消归档 / 置顶 / 停止当前轮 / 复制会话 / 打开会话；
 *   - 给任意会话发消息（排队或插话），冷会话由宿主自动唤醒；
 *   - 查看并管理任意会话的目标：新建、编辑、暂停、恢复、完成、清除、立即开始。
 *
 * 组件与 token 全部来自内联的 client-ui kit（v5）；本文件不另写颜色与字号。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-session-hub',
  factory: (require) => {
    const react = require('react')
    const { useState, useEffect, useCallback, useRef } = react
    const h = react.createElement
    let createPortal
    try {
      createPortal = require('react-dom').createPortal
    } catch {
      createPortal = undefined
    }

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
    const { T, TYPE, Button, Input, Select, Segmented, EmptyState, usePoll } = ui

    const API = '/session-hub/api'
    const PANEL_Z = 2147400000
    const NARROW_WIDTH = 820

    /** 目标阶段 → 展示文案与颜色。 */
    const PHASE = {
      active: { label: '进行中', color: 'var(--dsw-alias-state-success-primary, #43c982)' },
      paused: { label: '已暂停', color: 'var(--dsw-alias-state-warning-primary, #f5a623)' },
      blocked: { label: '受阻', color: 'var(--dsw-alias-state-error-primary, #ff6262)' },
      complete: { label: '已完成', color: 'var(--dsw-alias-label-tertiary, #8b929c)' },
    }

    /** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / MM-DD。 */
    function timeAgo(timestamp) {
      const value = Number(timestamp) || 0
      if (value <= 0) return '未知时间'
      const diff = Date.now() - value
      if (diff < 60_000) return '刚刚'
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
      if (diff < 172_800_000) return '昨天'
      const date = new Date(value)
      return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    /** 完整时间，给悬浮提示用。 */
    function fullTime(timestamp) {
      const value = Number(timestamp) || 0
      if (value <= 0) return ''
      return new Date(value).toLocaleString('zh-CN', { hour12: false })
    }

    /** 会话 id 缩短展示；完整 id 仍在提示与复制里。 */
    function shortId(id) {
      const text = String(id)
      return text.length <= 18 ? text : `${text.slice(0, 14)}…`
    }

    /** 统一的 JSON 请求；非 2xx 抛出带 code 的错误。 */
    async function api(path, body) {
      const response = await fetch(`${API}/${path}`, body === undefined
        ? { cache: 'no-store' }
        : {
            method: 'POST',
            cache: 'no-store',
            headers: { 'content-type': 'application/json', 'x-session-hub': '1' },
            body: JSON.stringify(body),
          })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`)
        error.code = payload?.error?.code
        error.status = response.status
        throw error
      }
      return payload
    }

    /** 复制到剪贴板，返回是否成功。 */
    function copyText(text) {
      try {
        void navigator.clipboard.writeText(String(text))
        return true
      } catch {
        return false
      }
    }

    /** 视口尺寸：窄屏时列表与详情分屏显示。 */
    function useViewport() {
      const [width, setWidth] = useState(typeof window === 'undefined' ? 1280 : window.innerWidth)
      useEffect(() => {
        const update = () => setWidth(window.innerWidth)
        window.addEventListener('resize', update)
        return () => window.removeEventListener('resize', update)
      }, [])
      return width
    }

    /* ── 图标 ──────────────────────────────────────────────────────────── */
    const iconProps = {
      width: 16,
      height: 16,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.9,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    }

    const IconList = () => h('svg', iconProps,
      h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
      h('path', { d: 'M7 9h10M7 12.5h7M7 16h4' }))

    const IconClose = () => h('svg', iconProps, h('path', { d: 'M6 6l12 12M18 6L6 18' }))
    const IconRefresh = () => h('svg', iconProps,
      h('path', { d: 'M20 11a8 8 0 1 0-2.3 5.7' }),
      h('path', { d: 'M20 5v6h-6' }))
    const IconBack = () => h('svg', iconProps, h('path', { d: 'M15 5l-7 7 7 7' }))

    /* ── 小控件 ────────────────────────────────────────────────────────── */
    /** 胶囊标签：用于目标阶段、归档、置顶。 */
    function Chip({ children, color, title }) {
      return h('span', {
        title,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          height: 20,
          padding: '0 8px',
          borderRadius: 999,
          fontSize: 11,
          lineHeight: '14px',
          color: color || T.text2,
          background: 'color-mix(in srgb, currentColor 7%, transparent)',
          border: `.5px solid ${T.cardStroke}`,
          flex: '0 0 auto',
          whiteSpace: 'nowrap',
        },
      }, children)
    }

    /** 紧凑按钮：详情区的次级动作。 */
    function MiniButton({ children, onClick, disabled = false, tone, title }) {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        title,
        disabled,
        onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          boxSizing: 'border-box',
          height: 28,
          padding: '0 10px',
          borderRadius: 8,
          border: `.5px solid ${T.cardStroke}`,
          background: hover && !disabled ? 'color-mix(in srgb, currentColor 8%, transparent)' : 'transparent',
          color: tone || T.text1,
          fontSize: 12,
          lineHeight: '18px',
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          whiteSpace: 'nowrap',
          flex: '0 0 auto',
        },
      }, children)
    }

    /** 可切换的筛选小按钮。 */
    function MiniToggle({ children, active, onClick }) {
      return h('button', {
        type: 'button',
        onClick,
        'aria-pressed': active,
        style: {
          height: 28,
          padding: '0 9px',
          borderRadius: 8,
          border: `.5px solid ${active ? T.text3 : T.cardStroke}`,
          background: active ? 'color-mix(in srgb, currentColor 10%, transparent)' : 'transparent',
          color: active ? T.text1 : T.text2,
          fontSize: 12,
          lineHeight: '18px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          flex: '0 0 auto',
        },
      }, children)
    }

    /** 详情区里的一块内容。 */
    const blockStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: '12px 14px',
      borderRadius: T.radiusMd,
      border: `.5px solid ${T.cardStroke}`,
      background: 'color-mix(in srgb, currentColor 4%, transparent)',
      minWidth: 0,
    }

    const blockTitle = { ...TYPE.h2, fontSize: 13, lineHeight: '18px' }

    /** 文本域：与 Input 同风格，可纵向拉伸。 */
    function TextArea({ value, onChange, placeholder, rows = 3, disabled = false, onEnter }) {
      const [focused, setFocused] = useState(false)
      return h('textarea', {
        value,
        placeholder,
        rows,
        disabled,
        onChange: (event) => onChange?.(event.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown: (event) => {
          if (onEnter && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onEnter()
          }
        },
        style: {
          boxSizing: 'border-box',
          width: '100%',
          minHeight: 64,
          resize: 'vertical',
          padding: '8px 10px',
          borderRadius: T.radiusMd,
          border: `.5px solid ${focused ? T.text3 : T.cardStroke}`,
          background: T.inputFill,
          color: T.text1,
          fontSize: 13,
          lineHeight: '20px',
          fontFamily: 'inherit',
          outline: 'none',
        },
      })
    }

    /* ── 会话行 ────────────────────────────────────────────────────────── */
    function SessionRow({ session, active, onSelect }) {
      const [hover, setHover] = useState(false)
      const running = session.running === true
      const phase = session.goal ? PHASE[session.goal.phase] : null

      const dot = h('span', {
        style: {
          width: 6,
          height: 6,
          borderRadius: '50%',
          marginTop: 6,
          flex: '0 0 auto',
          backgroundColor: running
            ? 'var(--dsw-alias-state-success-primary, #43c982)'
            : 'var(--dsw-alias-label-tertiary, #8b929c)',
          boxShadow: running
            ? '0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary, #43c982) 18%, transparent)'
            : 'none',
        },
      })

      const titleRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('span', { style: { ...TYPE.body, fontSize: 13, fontWeight: 500, ...TYPE.ellipsis, flex: '1 1 auto' } },
          session.title || '未命名会话'),
        session.pinned ? h(Chip, { color: 'var(--dsw-alias-state-warning-primary, #f5a623)' }, '置顶') : null,
        session.archived ? h(Chip, null, '已归档') : null)

      const metaRow = h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 } },
        h('span', { style: { ...TYPE.micro, ...TYPE.ellipsis, flex: '0 1 auto' } }, session.project),
        h('span', { style: { ...TYPE.micro, color: T.text3, flex: '0 0 auto' } }, '·'),
        h('span', { style: { ...TYPE.micro, color: T.text3, flex: '0 0 auto' } }, timeAgo(session.updatedAt)),
        phase
          ? h('span', { style: { ...TYPE.micro, color: phase.color, flex: '0 0 auto', marginLeft: 2 } }, `目标·${phase.label}`)
          : null)

      return h('div', {
        role: 'button',
        tabIndex: 0,
        'aria-current': active,
        onClick: () => onSelect(session.id),
        onKeyDown: (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onSelect(session.id)
        },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          padding: '8px 10px',
          marginBottom: 2,
          borderRadius: T.radiusMd,
          border: `.5px solid ${active ? T.cardStroke : 'transparent'}`,
          background: active
            ? 'color-mix(in srgb, currentColor 9%, transparent)'
            : hover ? 'color-mix(in srgb, currentColor 5%, transparent)' : 'transparent',
          cursor: 'pointer',
          minWidth: 0,
        },
      },
      dot,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: '1 1 auto' } },
        titleRow,
        metaRow))
    }

    /* ── 新建会话 ──────────────────────────────────────────────────────── */
    function CreateSession({ ctx, state, notify, refresh, onCreated, onBack }) {
      const [cwd, setCwd] = useState(() => state?.workspaces?.[0]?.path || '')
      const [title, setTitle] = useState('')
      const [preset, setPreset] = useState('')
      const [busy, setBusy] = useState('')

      const workspaces = state?.workspaces ?? []
      const options = [
        { value: '', label: '选择已登记项目' },
        ...workspaces.map((workspace) => ({ value: workspace.path, label: workspace.title || workspace.path })),
      ]

      const pick = async () => {
        try {
          const picked = await ctx.uiWorkspace?.pickDirectory?.()
          if (typeof picked === 'string' && picked !== '') setCwd(picked)
        } catch {
          notify('无法打开目录选择器，请直接输入路径', 'error')
        }
      }

      const submit = async (open) => {
        if (busy) return
        setBusy(open ? '创建并打开' : '创建')
        try {
          const created = await api('session/create', {
            cwd: cwd.trim() || undefined,
            title: title.trim() || undefined,
            agentPreset: preset.trim() || undefined,
          })
          notify('会话已创建')
          await refresh()
          onCreated(created.sessionId, open)
        } catch (error) {
          notify(error.message || '创建失败', 'error')
        } finally {
          setBusy('')
        }
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: 0, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: `.5px solid ${T.cardStroke}` } },
          h(MiniButton, { onClick: onBack, title: '返回列表' }, '返回'),
          h('span', { style: { ...TYPE.h2, flex: '1 1 auto' } }, '新建会话')),
        h('div', { style: { flex: '1 1 auto', overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 } },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { style: { fontSize: 12, lineHeight: '16px', color: T.text2 } }, '项目目录'),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h(Input, { value: cwd, onChange: setCwd, placeholder: '例如 C:\\Projects\\ai-tooling', width: 300 }),
              h(Button, { variant: 'secondary', onClick: pick }, '浏览…')),
            workspaces.length
              ? h(Select, { value: '', options, onChange: (value) => { if (value) setCwd(value) }, width: 300, placeholder: '从已登记项目里选' })
              : null,
            h('span', { style: TYPE.micro }, '留空则使用 DSH 的默认目录。')),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { style: { fontSize: 12, lineHeight: '16px', color: T.text2 } }, '会话名称（可选）'),
            h(Input, { value: title, onChange: setTitle, placeholder: '先不填也可以，之后随时改名', width: 300 })),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('span', { style: { fontSize: 12, lineHeight: '16px', color: T.text2 } }, 'Agent 预设（可选）'),
            h(Input, { value: preset, onChange: setPreset, placeholder: '留空使用默认预设', width: 300 })),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 4 } },
            h(Button, { onClick: () => submit(true), disabled: busy !== '' }, busy === '创建并打开' ? '创建中…' : '创建并打开'),
            h(Button, { variant: 'secondary', onClick: () => submit(false), disabled: busy !== '' }, '仅创建'))))
    }

    /* ── 目标面板 ──────────────────────────────────────────────────────── */
    function GoalPanel({ session, notify, refresh, setConfirm, compact }) {
      const goal = session.goal
      const phase = goal ? PHASE[goal.phase] : null
      const [objective, setObjective] = useState('')
      const [rounds, setRounds] = useState('')
      const [editing, setEditing] = useState(false)
      const [editObjective, setEditObjective] = useState('')
      const [editRounds, setEditRounds] = useState('')
      const [busy, setBusy] = useState('')

      useEffect(() => {
        setEditing(false)
        setObjective('')
        setRounds('')
      }, [session.id])

      const action = async (label, request, success) => {
        if (busy) return
        setBusy(label)
        try {
          await api('goal/action', { sessionId: session.id, ...request })
          if (success) notify(success)
          await refresh()
        } catch (error) {
          notify(error.message || '目标操作失败', 'error')
        } finally {
          setBusy('')
        }
      }

      const submitCreate = (start) => {
        if (objective.trim() === '') return notify('先填写目标内容', 'error')
        return action(start ? '创建并开始' : '创建', {
          action: 'create',
          objective,
          maxGoalRounds: rounds.trim() === '' ? undefined : Number(rounds),
          start,
        }, start ? '目标已创建并启动' : '目标已创建')
      }

      const submitEdit = () => {
        if (editObjective.trim() === '') return notify('目标内容不能为空', 'error')
        return action('保存', {
          action: 'edit',
          revision: goal?.revision,
          objective: editObjective,
          maxGoalRounds: editRounds.trim() === '' ? undefined : Number(editRounds),
        }, '目标已更新').then(() => setEditing(false))
      }

      if (!goal) {
        return h('div', { style: blockStyle },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: blockTitle }, '目标'),
            h(Chip, null, '未设置')),
          h(TextArea, {
            value: objective,
            onChange: setObjective,
            placeholder: '例如：把会话管理插件的 UI 做到可发布，并补齐测试',
            rows: 3,
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { ...TYPE.micro, flex: '0 0 auto' } }, '轮次上限'),
            h(Input, { value: rounds, onChange: setRounds, placeholder: '默认', width: 90, type: 'number', min: 1, max: 1000 }),
            h('span', { style: { flex: '1 1 auto' } }),
            h(Button, { variant: 'secondary', onClick: () => submitCreate(false), disabled: busy !== '' }, busy === '创建' ? '创建中…' : '新建目标'),
            h(Button, { onClick: () => submitCreate(true), disabled: busy !== '' }, busy === '创建并开始' ? '启动中…' : '新建并开始')))
      }

      return h('div', { style: blockStyle },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: blockTitle }, '目标'),
          h(Chip, { color: phase?.color }, phase?.label || goal.phase),
          goal.maxGoalRounds
            ? h('span', { style: TYPE.micro }, `轮次 ${goal.roundsStarted || 0} / ${goal.maxGoalRounds}`)
            : null,
          h('span', { style: { flex: '1 1 auto' } }),
          h(MiniButton, { onClick: () => setEditing((value) => !value), title: '编辑目标' }, editing ? '收起' : '编辑')),
        editing
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
              h(TextArea, { value: editObjective, onChange: setEditObjective, rows: 4 }),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('span', { style: { ...TYPE.micro, flex: '0 0 auto' } }, '轮次上限'),
                h(Input, { value: editRounds, onChange: setEditRounds, width: 90, type: 'number', min: 1, max: 1000 }),
                h('span', { style: { flex: '1 1 auto' } }),
                h(Button, { variant: 'secondary', onClick: () => setEditing(false) }, '取消'),
                h(Button, { onClick: submitEdit, disabled: busy !== '' }, busy === '保存' ? '保存中…' : '保存')))
          : h('p', { style: { margin: 0, ...TYPE.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, goal.objective),
        goal.blockedReason
          ? h('span', { style: { ...TYPE.micro, color: 'var(--dsw-alias-state-error-primary, #ff6262)' } },
              `受阻原因：${goal.blockedReason.message || goal.blockedReason.code}`)
          : null,
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          h(MiniButton, { onClick: () => action('开始', { action: 'start', revision: goal.revision }, '已触发一轮'), disabled: busy !== '', title: '恢复目标并立即给会话发一轮指令' }, busy === '开始' ? '启动中…' : '开始'),
          goal.phase === 'paused'
            ? h(MiniButton, { onClick: () => action('恢复', { action: 'resume', revision: goal.revision }, '目标已恢复'), disabled: busy !== '' }, busy === '恢复' ? '恢复中…' : '恢复')
            : h(MiniButton, { onClick: () => action('暂停', { action: 'pause', revision: goal.revision }, '目标已暂停'), disabled: busy !== '' }, busy === '暂停' ? '暂停中…' : '暂停'),
          goal.phase !== 'complete'
            ? h(MiniButton, { onClick: () => action('完成', { action: 'complete', revision: goal.revision }, '目标已完成'), disabled: busy !== '' }, busy === '完成' ? '完成中…' : '完成')
            : null,
          h(MiniButton, {
            onClick: () => setConfirm({ kind: 'goal-clear', sessionId: session.id, text: '清除后目标会保留历史记录，但不再作为当前目标；确认清除？' }),
            disabled: busy !== '',
            tone: 'var(--dsw-alias-state-error-primary, #ff6262)',
          }, '清除')))
    }

    /* ── 详情 ──────────────────────────────────────────────────────────── */
    function SessionDetail({ ctx, session, narrow, notify, refresh, onBack, onClose, setConfirm, confirm }) {
      const [rename, setRename] = useState(false)
      const [title, setTitle] = useState('')
      const [draft, setDraft] = useState('')
      const [mode, setMode] = useState('queue')
      const [busy, setBusy] = useState('')
      const [preview, setPreview] = useState(null)
      const [previewTick, setPreviewTick] = useState(0)

      useEffect(() => {
        setRename(false)
        setDraft('')
        setPreview(null)
        setPreviewTick(0)
      }, [session.id])

      useEffect(() => {
        let alive = true
        api(`preview?session=${encodeURIComponent(session.id)}`)
          .then((value) => { if (alive) setPreview(value.messages ?? []) })
          .catch(() => { if (alive) setPreview([]) })
        return () => { alive = false }
      }, [session.id, previewTick])

      const run = async (label, task, success) => {
        if (busy) return
        setBusy(label)
        try {
          await task()
          if (success) notify(success)
          await refresh()
        } catch (error) {
          notify(error.message || '操作失败', 'error')
          throw error
        } finally {
          setBusy('')
        }
      }

      const open = () => {
        try {
          ctx.uiWorkspace?.openSession?.(session.id)
          onClose()
        } catch {
          notify('当前界面不支持打开会话', 'error')
        }
      }

      const send = () => {
        if (draft.trim() === '') return notify('先输入消息', 'error')
        void run('message', () => api('session/message', {
          sessionId: session.id,
          message: draft,
          mode,
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }), '消息已发送')
          .then(() => setDraft(''))
          .catch(() => {})
      }

      const archive = () => {
        if (session.archived) {
          void run('archive', () => api('session/archive', { sessionId: session.id, archived: false }), '已取消归档').catch(() => {})
          return
        }
        if (session.running) {
          setConfirm({
            kind: 'archive',
            sessionId: session.id,
            text: '会话正在运行。归档会先停止当前工作，之后可在「已归档」里恢复。确认继续？',
          })
          return
        }
        void run('archive', () => api('session/archive', { sessionId: session.id, archived: true }), '已归档').catch(() => {})
      }

      const saveRename = () => {
        if (title.trim() === '') return notify('名称不能为空', 'error')
        void run('rename', () => api('session/rename', { sessionId: session.id, title }), '已更名')
          .then(() => { setRename(false); setTitle('') })
          .catch(() => {})
      }

      const pendingConfirm = confirm && confirm.sessionId === session.id ? confirm : null

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: 0, minWidth: 0 } },
        h('div', { style: { padding: '12px 16px', borderBottom: `.5px solid ${T.cardStroke}`, display: 'flex', flexDirection: 'column', gap: 8 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            narrow ? h(MiniButton, { onClick: onBack, title: '返回列表' }, '返回') : null,
            h('span', { style: { ...TYPE.h2, ...TYPE.ellipsis, flex: '1 1 auto' } }, session.title || '未命名会话'),
            session.running ? h(Chip, { color: 'var(--dsw-alias-state-success-primary, #43c982)' }, '运行中') : h(Chip, null, '空闲'),
            session.archived ? h(Chip, null, '已归档') : null),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 } },
            h('span', { style: { ...TYPE.micro, ...TYPE.ellipsis, maxWidth: 220 } }, session.project),
            h('span', { style: { ...TYPE.micro, color: T.text3 } }, '·'),
            h('span', { title: session.id, style: { ...TYPE.micro, color: T.text2 } }, shortId(session.id)),
            h('span', { style: { ...TYPE.micro, color: T.text3 } }, '·'),
            h('span', { title: fullTime(session.updatedAt), style: TYPE.micro }, timeAgo(session.updatedAt))),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '100%' } },
            h(MiniButton, { onClick: open }, '打开会话'),
            h(MiniButton, { onClick: () => { setRename((value) => !value); setTitle(session.title || '') } }, rename ? '收起改名' : '重命名'),
            h(MiniButton, { onClick: () => { if (copyText(session.id)) notify('会话 id 已复制') } }, '复制 id'),
            h(MiniButton, { onClick: () => {
              void run('pin', () => api('session/pin', { sessionId: session.id, pinned: !session.pinned }), session.pinned ? '已取消置顶' : '已置顶').catch(() => {})
            } }, session.pinned ? '取消置顶' : '置顶'),
            h(MiniButton, { onClick: archive, tone: session.archived ? undefined : 'var(--dsw-alias-state-warning-primary, #f5a623)' }, session.archived ? '取消归档' : '归档'),
            session.running
              ? h(MiniButton, { onClick: () => setConfirm({ kind: 'cancel', sessionId: session.id, text: '停止当前一轮？已产生的内容会保留。' }), tone: 'var(--dsw-alias-state-error-primary, #ff6262)' }, '停止当前轮')
              : null,
            h(MiniButton, { onClick: () => {
              void run('fork', () => api('session/fork', { sessionId: session.id }), '已复制会话').catch(() => {})
            } }, '复制会话'))),
        pendingConfirm
          ? h('div', {
              style: {
                margin: '10px 16px 0',
                padding: '10px 12px',
                borderRadius: T.radiusMd,
                border: `.5px solid color-mix(in srgb, var(--dsw-alias-state-warning-primary, #f5a623) 45%, transparent)`,
                background: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary, #f5a623) 10%, transparent)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              },
            },
            h('span', { style: { ...TYPE.small, flex: '1 1 220px', minWidth: 0 } }, pendingConfirm.text),
            h(MiniButton, {
              onClick: () => {
                const current = pendingConfirm
                setConfirm(null)
                if (current.kind === 'archive') {
                  void run('archive', () => api('session/archive', { sessionId: session.id, archived: true, stopActivity: true }), '已归档并停止').catch(() => {})
                } else if (current.kind === 'cancel') {
                  void run('cancel', () => api('session/cancel', { sessionId: session.id }), '已请求停止').catch(() => {})
                } else if (current.kind === 'goal-clear') {
                  void api('goal/action', { sessionId: session.id, action: 'clear' })
                    .then(() => { notify('目标已清除'); return refresh() })
                    .catch((error) => notify(error.message || '清除失败', 'error'))
                }
              },
            }, '确认'),
            h(MiniButton, { onClick: () => setConfirm(null) }, '取消'))
          : null,
        h('div', { style: { flex: '1 1 auto', overflowY: 'auto', padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 } },
          rename
            ? h('div', { style: blockStyle },
                h('span', { style: blockTitle }, '重命名'),
                h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                  h(Input, { value: title, onChange: setTitle, width: 260, autoFocus: true, onEnter: saveRename }),
                  h(Button, { onClick: saveRename, disabled: busy !== '' }, busy === 'rename' ? '保存中…' : '保存'),
                  h(Button, { variant: 'secondary', onClick: () => setRename(false) }, '取消')))
            : null,
          h('div', { style: blockStyle },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: blockTitle }, '发消息'),
              h(Chip, null, '跨项目')),
            h(TextArea, {
              value: draft,
              onChange: setDraft,
              placeholder: '发送给这个会话；冷会话会被自动唤醒，正在跑的会话按下面的方式投递。Ctrl/⌘ + Enter 发送',
              rows: 3,
              onEnter: send,
            }),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h(Segmented, {
                value: mode,
                options: [{ value: 'queue', label: '排队' }, { value: 'steer', label: '插话' }],
                onChange: setMode,
              }),
              h('span', { style: { flex: '1 1 auto' } }),
              h(Button, { onClick: send, disabled: busy !== '' || draft.trim() === '' }, busy === 'message' ? '发送中…' : '发送'))),
          h(GoalPanel, { session, notify, refresh, setConfirm, compact: narrow }),
          h('div', { style: blockStyle },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { style: blockTitle }, '最近对话'),
              h('span', { style: { flex: '1 1 auto' } }),
              h(MiniButton, { onClick: () => setPreviewTick((value) => value + 1) }, '刷新')),
            preview === null
              ? h('span', { style: TYPE.micro }, '读取中…')
              : preview.length === 0
                ? h(EmptyState, { title: '还没有对话', hint: '发出第一条消息后这里会显示最近 6 条' })
                : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                    preview.map((message, index) => h('div', {
                      key: `${index}-${message.time}`,
                      style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
                    },
                    h('span', { style: { ...TYPE.micro, color: message.role === 'user' ? T.text2 : 'var(--dsw-alias-state-success-primary, #43c982)' } },
                      message.role === 'user' ? '用户' : '助手'),
                    h('span', { style: { ...TYPE.secondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'hidden' } },
                      message.text)))))))
    }

    /* ── 主面板 ────────────────────────────────────────────────────────── */
    function HubModal({ ctx, onClose }) {
      const width = useViewport()
      const narrow = width < NARROW_WIDTH
      const [selectedId, setSelectedId] = useState(null)
      const [search, setSearch] = useState('')
      const [project, setProject] = useState('')
      const [showArchived, setShowArchived] = useState(false)
      const [showSubagents, setShowSubagents] = useState(false)
      const [createMode, setCreateMode] = useState(false)
      const [confirm, setConfirm] = useState(null)
      const [toast, setToast] = useState(null)
      const toastTimer = useRef(null)

      const [data, pollError, refresh] = usePoll(
        () => api(`state?includeSubagents=${showSubagents ? 1 : 0}`),
        5000,
        [showSubagents],
      )

      const notify = useCallback((text, tone = 'info') => {
        setToast({ text, tone })
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => {
          setToast(null)
          toastTimer.current = null
        }, 3500)
      }, [])

      useEffect(() => () => {
        if (toastTimer.current !== null) clearTimeout(toastTimer.current)
      }, [])

      useEffect(() => {
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => {
          document.body.style.overflow = previous
          window.removeEventListener('keydown', onKey)
        }
      }, [onClose])

      const all = data?.sessions ?? []
      const selected = all.find((session) => session.id === selectedId) ?? null
      const query = search.trim().toLowerCase()

      const projectOptions = [
        { value: '', label: '全部项目' },
        ...(data?.workspaces ?? []).map((workspace) => ({ value: workspace.id, label: workspace.title || workspace.path })),
      ]

      const visible = all
        .filter((session) => showArchived || !session.archived)
        .filter((session) => project === '' || session.workspaceId === project)
        .filter((session) => query === '' || `${session.title} ${session.project} ${session.cwd} ${session.id}`.toLowerCase().includes(query))
        .sort((left, right) => (Number(right.pinned) - Number(left.pinned)) || (right.updatedAt - left.updatedAt))

      const onCreated = (sessionId, open) => {
        setCreateMode(false)
        setSelectedId(sessionId)
        if (open) {
          try {
            ctx.uiWorkspace?.openSession?.(sessionId)
            onClose()
          } catch {
            notify('会话已创建，但当前界面无法自动打开', 'error')
          }
        }
      }

      const header = h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 52,
          width: '100%',
          minWidth: 0,
          padding: '0 14px',
          boxSizing: 'border-box',
          borderBottom: `.5px solid ${T.cardStroke}`,
          flex: '0 0 auto',
        },
      },
      h('span', { style: { ...TYPE.h2, flex: '0 0 auto' } }, '会话管理'),
      narrow
        ? h('span', { style: { flex: '1 1 auto' } })
        : data
          ? h('span', { style: { ...TYPE.micro, flex: '1 1 auto', minWidth: 0, ...TYPE.ellipsis } },
              `${data.counts.total} 个会话 · ${data.counts.running} 运行中 · ${data.counts.goals} 个目标`)
          : h('span', { style: { ...TYPE.micro, flex: '1 1 auto' } }, pollError ? '数据不可用' : '读取中…'),
      h(MiniButton, { onClick: () => setCreateMode(true), title: '新建会话' }, narrow ? '新建' : '新建会话'),
      h(IconAction, { label: '刷新', onClick: () => { void refresh() } }, h(IconRefresh, null)),
      h(IconAction, { label: '关闭', onClick: onClose }, h(IconClose, null)))

      const list = h('div', {
        style: {
          width: narrow ? '100%' : 320,
          flex: narrow ? '1 1 auto' : '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          borderRight: narrow ? 'none' : `.5px solid ${T.cardStroke}`,
        },
      },
      h('div', { style: { padding: '10px 12px 6px', display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto' } },
        h(Input, { value: search, onChange: setSearch, placeholder: '搜索名称 / 项目 / id', width: '100%' }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h(Select, { value: project, options: projectOptions, onChange: setProject, width: 150 }),
          h(MiniToggle, { active: showArchived, onClick: () => setShowArchived((value) => !value) }, '已归档'),
          h(MiniToggle, { active: showSubagents, onClick: () => setShowSubagents((value) => !value) }, '子会话'))),
      h('div', { style: { flex: '1 1 auto', overflowY: 'auto', padding: '0 8px 10px', minHeight: 0 } },
        !data && pollError
          ? h(EmptyState, { title: '读取会话失败', hint: '检查 DSH 宿主是否仍在运行，然后点右上角刷新' })
          : visible.length === 0
            ? h(EmptyState, { title: '没有匹配的会话', hint: '换个关键词，或打开「已归档」看看' })
            : visible.map((session) => h(SessionRow, {
                key: session.id,
                session,
                active: session.id === selectedId,
                onSelect: (id) => { setSelectedId(id); setCreateMode(false); setConfirm(null) },
              }))))

      const detail = createMode
        ? h(CreateSession, { ctx, state: data, notify, refresh, onCreated, onBack: () => setCreateMode(false) })
        : selected
          ? h(SessionDetail, {
              ctx,
              session: selected,
              narrow,
              notify,
              refresh,
              setConfirm,
              confirm,
              onClose,
              onBack: () => setSelectedId(null),
            })
          : h('div', { style: { flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 } },
              h(EmptyState, { title: '选择左侧一个会话', hint: '可以发消息、改名、归档，或给它建目标并立即启动' }))

      const body = narrow && !createMode && selected
        ? h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0, maxWidth: '100%' } }, detail)
        : narrow
          ? h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0, maxWidth: '100%' } }, list)
          : h('div', { style: { display: 'flex', flex: '1 1 auto', minHeight: 0, minWidth: 0, maxWidth: '100%' } }, list,
              h('div', { style: { flex: '1 1 auto', minWidth: 0, minHeight: 0 } }, detail))

      const panel = h('div', {
        role: 'dialog',
        'aria-modal': true,
        'aria-label': '会话管理',
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: PANEL_Z,
          background: 'rgba(0, 0, 0, 0.45)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: narrow ? 0 : 24,
        },
      },
      h('div', {
        onMouseDown: (event) => event.stopPropagation(),
        style: {
          width: narrow ? '100%' : 'min(96vw, 1020px)',
          maxWidth: '100vw',
          height: narrow ? '100%' : 'min(86vh, 860px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: narrow ? 0 : T.radiusXl,
          border: narrow ? 'none' : `.5px solid ${T.cardStroke}`,
          background: 'var(--dsw-alias-bg-layer-2, #242427)',
          boxShadow: 'var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.45))',
          color: T.text1,
          minWidth: 0,
          minHeight: 0,
        },
      },
      header,
      body,
      toast
        ? h('div', {
            style: {
              position: 'fixed',
              left: '50%',
              bottom: narrow ? 24 : 40,
              transform: 'translateX(-50%)',
              zIndex: PANEL_Z + 1,
              maxWidth: 'min(560px, calc(100vw - 48px))',
              padding: '8px 14px',
              borderRadius: T.radiusMd,
              border: `.5px solid ${toast.tone === 'error' ? 'var(--dsw-alias-state-error-primary, #ff6262)' : T.cardStroke}`,
              background: T.cardFill,
              color: T.text1,
              fontSize: 13,
              lineHeight: '20px',
              boxShadow: 'var(--dsw-elevation-prominent, 0 12px 32px rgba(0,0,0,.45))',
              pointerEvents: 'none',
            },
          }, toast.text)
        : null))

      return createPortal ? createPortal(panel, document.body) : panel
    }

    /** 28×28 的图标按钮。 */
    function IconAction({ label, onClick, children }) {
      const [hover, setHover] = useState(false)
      return h('button', {
        type: 'button',
        title: label,
        'aria-label': label,
        onClick,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 0,
          borderRadius: 8,
          background: hover ? 'color-mix(in srgb, currentColor 8%, transparent)' : 'transparent',
          color: T.text2,
          cursor: 'pointer',
          flex: '0 0 auto',
        },
      }, children)
    }

    /* ── 侧栏入口 ──────────────────────────────────────────────────────── */
    function SidebarEntry({ wide, ctx }) {
      const [open, setOpen] = useState(false)
      const [counts, setCounts] = useState(null)
      const [hover, setHover] = useState(false)

      useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const state = await api('state')
            if (alive) setCounts(state.counts)
          } catch {
            // 侧栏徽标只是提示，读不到就不显示
          }
        }
        void load()
        const timer = setInterval(load, 20000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [open])

      const running = counts?.running ?? 0

      return h(react.Fragment, null,
        h('button', {
          type: 'button',
          title: '会话管理',
          'aria-label': '会话管理',
          onClick: () => setOpen(true),
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            position: 'relative',
            boxSizing: 'border-box',
            width: 28,
            height: 28,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 0,
            borderRadius: 8,
            background: hover ? 'color-mix(in srgb, currentColor 8%, transparent)' : 'transparent',
            color: T.text2,
            cursor: 'pointer',
            flex: '0 0 auto',
          },
        },
        h(IconList, null),
        running > 0
          ? h('span', {
              style: {
                position: 'absolute',
                top: 1,
                right: 1,
                minWidth: 13,
                height: 13,
                padding: '0 3px',
                boxSizing: 'border-box',
                borderRadius: 999,
                background: 'var(--dsw-alias-state-success-primary, #43c982)',
                color: '#0f1115',
                fontSize: 9,
                lineHeight: '13px',
                fontWeight: 700,
                textAlign: 'center',
              },
            }, String(running))
          : null),
        open
          ? (createPortal
              ? createPortal(h(HubModal, { ctx, onClose: () => setOpen(false) }), document.body)
              : h(HubModal, { ctx, onClose: () => setOpen(false) }))
          : null)
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register({ id: 'session-hub', name: 'sidebar.footer.action', order: 30, label: () => '会话管理' },
          (props) => h(SidebarEntry, { ...props, ctx })))
    }

    return { inject, apply }
  },
})
