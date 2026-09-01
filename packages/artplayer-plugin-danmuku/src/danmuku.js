import { bilibiliDanmuParseFromUrl } from './bilibili'
import { scheduleHeroDanmuku } from './consensus-scheduler'
import MergeWorker from './merge-worker.js?worker&inline'
import DanmuWorker from './worker.js?worker&inline'

// 根据弹幕数量和 CPU 核心数决定并行 Worker 数量
function getWorkerCount(danmukuCount) {
  if (danmukuCount < 5000)
    return 1
  const hw = navigator.hardwareConcurrency || 4
  return Math.min(hw - 1, 8)
}

// 调试开关
const DEBUG = false
function debug(...args) {
  if (DEBUG)
    // eslint-disable-next-line no-console
    console.log('[Danmuku]', ...args)
}

export default class Danmuku {
  constructor(art, option) {
    const { constructor, template } = art

    this.utils = constructor.utils // 工具库
    this.validator = constructor.validator // 配置校验器
    this.$danmuku = template.$danmuku // 弹幕层容器
    this.$player = template.$player // 播放器容器

    this.art = art
    this.queue = [] // 实际弹幕队列
    this.$refs = [] // 弹幕DOM节点池
    this.isStop = false // 是否停止
    this.isHide = false // 是否隐藏
    this.timer = null // 定时器
    this.index = 0 // 弹幕索引
    this._pendingMessages = new Map() // postMessage 回调映射
    this.loading = false // 防止重复 load
    this._playbackRate = Number(art.playbackRate) || 1 // 当前播放倍速，用于同步弹幕速度

    // 格式化后的配置项
    this.option = Danmuku.option

    // 弹幕状态池
    this.states = { wait: [], ready: [], emit: [], stop: [] }

    // 初始化配置
    this.config(option, true)

    // 创建 Web Worker, 用于计算弹幕的 top 值
    this.worker = new DanmuWorker()
    this.worker.onmessage = (event) => {
      const { data } = event
      if (data.id != null && this._pendingMessages.has(data.id)) {
        this._pendingMessages.get(data.id)(data)
        this._pendingMessages.delete(data.id)
      }
    }

    // 绑定公用事件
    this.start = this.start.bind(this)
    this.stop = this.stop.bind(this)
    this.reset = this.reset.bind(this)
    this.resize = this.resize.bind(this)
    this.destroy = this.destroy.bind(this)
    this.rateChange = this.rateChange.bind(this)

    // 监听事件
    art.on('video:playing', this.start)
    art.on('video:pause', this.stop)
    art.on('video:waiting', this.stop)
    art.on('video:ratechange', this.rateChange)
    art.on('destroy', this.destroy)
    art.on('resize', this.resize)

    // 开始加载弹幕
    this.load()
  }

  // 默认配置
  static get option() {
    return {
      danmuku: [], // 弹幕数据
      speed: 20, // 弹幕持续时间，范围在[1 ~ 10]
      gap: 45, // 弹幕间距，范围在[5 ~ 85]，值越小弹幕越密集
      margin: [10, '25%'], // 弹幕上下边距，支持像素数字和百分比
      opacity: 1, // 弹幕透明度，范围在[0 ~ 1]
      color: '#FFFFFF', // 默认弹幕颜色，可以被单独弹幕项覆盖
      mode: 0, // 默认弹幕模式: 0: 滚动，1: 顶部
      modes: [0, 1], // 弹幕可见的模式
      fontSize: 25, // 弹幕字体大小，支持像素数字和百分比
      antiOverlap: true, // 弹幕是否防重叠
      synchronousPlayback: false, // 是否同步播放速度
      mount: undefined, // 弹幕发射器挂载点, 默认为播放器控制栏中部
      heatmap: false, // 是否开启热力图
      width: 512, // 当播放器宽度小于此值时，弹幕发射器置于播放器底部
      points: [], // 热力图数据
      filter: () => true, // 弹幕载入前的过滤器，只支持返回布尔值
      beforeEmit: () => true, // 弹幕发送前的过滤器，支持返回 Promise
      beforeVisible: () => true, // 弹幕显示前的过滤器，支持返回 Promise
      visible: true, // 弹幕层是否可见
      emitter: true, // 是否开启弹幕发射器
      maxLength: 200, // 弹幕输入框最大长度, 范围在[1 ~ 1000]
      lockTime: 5, // 输入框锁定时间，范围在[1 ~ 60]
      theme: 'dark', // 弹幕主题，支持 dark 和 light，只在自定义挂载时生效
      OPACITY: {}, // 不透明度配置项
      FONT_SIZE: {}, // 弹幕字号配置项
      MARGIN: {}, // 显示区域配置项
      GAP: {}, // 弹幕间距配置项
      SPEED: {}, // 弹幕速度配置项
      COLOR: [], // 颜色列表配置项
      merge: false, // 是否开启弹幕合并
      mergeThreshold: 30, // 合并时间窗口（秒），范围在 [5 ~ 120]
      mergeMaxDist: 5, // 合并最大编辑距离，范围在 [1 ~ 20]
      mergeMaxCosine: 45, // 合并最大余弦相似度，范围在 [0 ~ 100]
      highlight: '', // UI 高亮色（圆点、进度条、发送按钮等），为空则使用默认蓝色
      mergeWasmUrl: '', // WASM 文件地址，开启合并时必填
      preprocess: true, // 是否开启文本预处理（全角转半角、去标点等）
    }
  }

  // 配置校验
  static get scheme() {
    return {
      // ... 原有字段保持不变
      danmuku: 'array|function|string',
      speed: 'number',
      margin: 'array',
      opacity: 'number',
      color: 'string',
      mode: 'number',
      modes: 'array',
      fontSize: 'number|string',
      antiOverlap: 'boolean',
      synchronousPlayback: 'boolean',
      mount: '?htmldivelement|string',
      heatmap: 'object|boolean',
      width: 'number',
      points: 'array',
      filter: 'function',
      beforeEmit: 'function',
      beforeVisible: 'function',
      visible: 'boolean',
      emitter: 'boolean',
      maxLength: 'number',
      lockTime: 'number',
      theme: 'string',
      OPACITY: 'object',
      FONT_SIZE: 'object',
      MARGIN: 'object',
      SPEED: 'object',
      COLOR: 'array',
      gap: 'number',
      merge: 'boolean',
      mergeThreshold: 'number',
      mergeMaxDist: 'number',
      mergeMaxCosine: 'number',
      highlight: 'string',
      mergeWasmUrl: 'string',
      preprocess: 'boolean',
    }
  }

  // 初始弹幕样式
  static get cssText() {
    return `
            user-select: none;
            position: absolute;
            white-space: pre;
            pointer-events: none;
            perspective: 500px;
            display: inline-block;
            will-change: transform;
            font-weight: normal;
            line-height: 1.125;
            visibility: hidden;
            font-family: SimHei, "Microsoft JhengHei", Arial, Helvetica, sans-serif;
            text-shadow: rgb(0, 0, 0) 1px 0px 1px, rgb(0, 0, 0) 0px 1px 1px, rgb(0, 0, 0) 0px -1px 1px, rgb(0, 0, 0) -1px 0px 1px;
        `
  }

  // 是否在移动端使用了自动旋屏，会影响弹幕的left和top值
  get isRotate() {
    return this.art.plugins?.autoOrientation?.state
  }

  // 计算上空白边距
  get marginTop() {
    const { clamp } = this.utils
    const value = this.option.margin[0]
    const { clientHeight } = this.$player

    if (typeof value === 'number') {
      return clamp(value, 0, clientHeight)
    }

    if (typeof value === 'string' && value.endsWith('%')) {
      const ratio = Number.parseFloat(value) / 100
      return clamp(clientHeight * ratio, 0, clientHeight)
    }

    return Danmuku.option.margin[0]
  }

  // 计算下空白边距
  get marginBottom() {
    const { clamp } = this.utils
    const value = this.option.margin[1]
    const { clientHeight } = this.$player

    if (typeof value === 'number') {
      return clamp(value, 0, clientHeight)
    }

    if (typeof value === 'string' && value.endsWith('%')) {
      const ratio = Number.parseFloat(value) / 100
      return clamp(clientHeight * ratio, 0, clientHeight)
    }

    return Danmuku.option.margin[1]
  }

  // 计算弹幕字体大小
  get fontSize() {
    const { clamp } = this.utils
    const { clientHeight } = this.$player

    const fontSize = this.option.fontSize

    if (typeof fontSize === 'number') {
      return Math.round(clamp(fontSize, 14, clientHeight))
    }

    if (typeof fontSize === 'string' && fontSize.endsWith('%')) {
      const ratio = Number.parseFloat(fontSize) / 100
      return Math.round(clamp(clientHeight * ratio, 14, clientHeight))
    }

    return Danmuku.option.fontSize
  }

  // 获取弹幕DOM节点
  get $ref() {
    const $ref = this.$refs.pop() || document.createElement('div')
    $ref.style.cssText = Danmuku.cssText
    $ref.dataset.mode = ''
    $ref.dataset.id = ''
    $ref.className = ''
    return $ref
  }

  // 获取准备好发送的弹幕
  get readys() {
    const { currentTime } = this.art

    const result = []

    // 有的是ready状态：之前因为弹幕太多而暂停发送的弹幕
    // this.filter('ready', danmu => result.push(danmu))

    // 有的是wait状态：符合时间范围的弹幕
    this.filter('wait', (danmu) => {
      if (currentTime + 0.1 >= danmu.time && danmu.time >= currentTime - 0.1) {
        result.push(danmu)
      }
    })

    return result
  }

  // 可见的弹幕的数据，用于计算下一个弹幕的top值
  get visibles() {
    const result = []
    const { clientWidth } = this.$player
    const clientLeft = this.getLeft(this.$player)

    this.filter('emit', (danmu) => {
      const top = danmu.top ?? danmu.$ref.offsetTop
      const left = this.getLeft(danmu.$ref) - clientLeft
      const height = danmu.$ref.clientHeight
      const width = danmu.$ref.clientWidth
      const distance = left + width
      const right = clientWidth - distance
      const speed = distance / danmu.$restTime

      const emit = {}
      emit.top = top
      emit.left = left
      emit.height = height
      emit.width = width
      emit.right = right
      emit.speed = speed
      emit.distance = distance
      emit.time = danmu.$restTime
      emit.mode = danmu.mode

      result.push(emit)
    })

    return result
  }

  // 计算弹幕绝对速度 (像素/秒)，基于全屏宽度基准
  get velocity() {
    // 默认使用用户的屏幕宽度作为全屏参考（兜底1920）
    const baseWidth = window.screen ? window.screen.width : 1920

    // 计算在标准情况下走完全屏所需的时间
    const baseSpeed = this.option.synchronousPlayback && this.art.playbackRate
      ? this.option.speed / Number(this.art.playbackRate)
      : this.option.speed

    return baseWidth / baseSpeed
  }

  // 加载弹幕
  async load(danmuku) {
    if (this.loading)
      return
    this.loading = true

    const { errorHandle } = this.utils

    let danmus = []
    const target = danmuku || this.option.danmuku

    try {
      if (typeof target === 'function') {
        danmus = await target() // 异步函数获取
      }
      else if (target instanceof Promise) {
        danmus = await target // 从 Promise 对象获取
      }
      else if (typeof target === 'string') {
        danmus = await bilibiliDanmuParseFromUrl(target) // 从B站xml链接解析
      }
      else if (Array.isArray(target)) {
        danmus = target // 直接传入数组
      }

      errorHandle(Array.isArray(danmus), 'Danmuku need return an array as result')
      debug('原始弹幕数量:', danmus.length)

      // 预处理 + 合并 → 交给 Worker（WASM 在 Worker 内运行）
      if (danmus.length > 0) {
        // 相对路径转绝对路径（Blob URL Worker 无法解析相对 URL）
        const wasmUrl = this.option.mergeWasmUrl
          ? new URL(this.option.mergeWasmUrl, window.location.href).href
          : ''

        const mergeOpts = {
          preprocess: this.option.preprocess,
          merge: this.option.merge,
          wasmUrl,
          threshold: this.option.mergeThreshold,
          maxDist: this.option.mergeMaxDist,
          maxCosine: this.option.mergeMaxCosine,
        }

        const workerCount = getWorkerCount(danmus.length)

        if (workerCount <= 1 || !this.option.merge) {
          // 单 Worker 路径
          const { result: processed } = await this.postMessage({
            type: 'mergeDanmuku',
            danmus,
            options: mergeOpts,
          })
          danmus = processed
        }
        else {
          // 多 Worker 并行路径
          danmus = await this.parallelMerge(danmus, mergeOpts, workerCount)
        }
      }

      // 英雄弹幕调度：标记英雄 + 降级其余
      if (danmus.length > 0) {
        scheduleHeroDanmuku(danmus)
      }

      // 假如没有传入弹幕参数，则清空弹幕，否则追加弹幕
      if (danmuku === undefined) {
        this.reset() // 重置弹幕
        this.queue = [] // 清空弹幕队列
        this.states = { wait: [], ready: [], emit: [], stop: [] } // 清空弹幕状态池
        this.$refs = [] // 清空弹幕DOM节点池
        this.$danmuku.textContent = '' // 清空弹幕层
      }

      // 逐个验证原始弹幕并转换到弹幕队列
      for (let index = 0; index < danmus.length; index++) {
        const danmu = danmus[index]
        await this.emit(danmu)
      }

      debug('最终队列数量:', this.queue.length)
      this.art.emit('artplayerPluginDanmuku:loaded', this.queue)
    }
    catch (error) {
      this.art.emit('artplayerPluginDanmuku:error', error)
      throw error
    }
    finally {
      this.loading = false
    }

    return this
  }

  // 把原始弹幕转换到弹幕队列
  async emit(danmu) {
    const { clamp } = this.utils

    // 打印前3条合并后的弹幕结构
    if (this.queue.length < 3) {
      debug('emit 输入:', {
        text: danmu.text,
        time: danmu.time,
        mode: danmu.mode,
        color: danmu.color,
        _mergeCount: danmu._mergeCount,
      })
    }

    this.validator(danmu, {
      id: '?string', // 弹幕唯一标识
      text: 'string', // 弹幕文本
      mode: '?number', // 弹幕模式: 0: 滚动，1: 顶部
      color: '?string', // 弹幕颜色
      time: '?number', // 弹幕时间
      border: '?boolean', // 弹幕是否有边框
      style: '?object', // 弹幕额外样式
    })

    // 弹幕文本为空则直接忽略
    if (!danmu.text.trim())
      return this

    // 设置弹幕时间，如果没有则默认为当前时间加 0.5 秒
    if (danmu.time) {
      danmu.time = clamp(danmu.time, 0, Infinity)
    }
    else {
      danmu.time = this.art.currentTime + 0.5
    }

    // 设置弹幕模式，如果没有则默认为全局配置
    if (danmu.mode === undefined) {
      danmu.mode = this.option.mode
    }

    // 设置弹幕单独样式，如果没有则默认为空对象
    if (danmu.style === undefined) {
      danmu.style = {}
    }

    // 设置弹幕颜色，如果没有则默认为全局配置
    if (danmu.color === undefined) {
      danmu.color = this.option.color
    }

    // 弹幕模式只能是 0, 1
    if (![0, 1].includes(danmu.mode))
      return this

    // 自定义弹幕过滤函数
    if (!this.option.filter(danmu))
      return this

    // 添加自定义属性
    const item = {
      ...danmu,
      $state: 'wait', // 弹幕初始状态
      $index: this.index++, // 弹幕索引
      $ref: null, // 弹幕 DOM 节点
      $restTime: 0, // 弹幕剩余时间
      $lastStartTime: 0, // 弹幕上次开始时间
    }

    // 清理临时属性
    delete item._normalizedText

    // 新弹幕直接加入 wait 阳列，跳过 setState 的 .filter() 开销
    this.states.wait.push(item)

    // 添加到实际弹幕队列
    this.queue.push(item)

    // 弹幕有四个状态：
    // - wait: 弹幕还未开始显示，没有被添加到 DOM 中
    // - ready: 弹幕准备好显示，没有被添加到 DOM 中
    // - emit: 弹幕正在显示，已经被添加到 DOM 中
    // - stop: 弹幕正在停止显示，已经被添加到 DOM 中

    return this
  }

  // 动态配置
  config(option, isInit = false) {
    const { clamp } = this.utils
    const { $controlsCenter } = this.art.template

    // 判断配置项是否有变化
    const changed = Object.keys(option).some(
      key => JSON.stringify(this.option[key]) !== JSON.stringify(option[key]),
    )

    // 没有变化则直接返回
    if (!changed && !isInit)
      return this

    // 更新配置项
    this.option = Object.assign({}, Danmuku.option, this.option, option)
    this.validator(this.option, Danmuku.scheme)

    this.option.mode = clamp(this.option.mode, 0, 1)
    this.option.speed = clamp(this.option.speed, 1, 20)
    this.option.opacity = clamp(this.option.opacity, 0, 1)
    this.option.lockTime = clamp(this.option.lockTime, 1, 60)
    this.option.maxLength = clamp(this.option.maxLength, 1, 1000)
    this.option.gap = clamp(this.option.gap, 5, 85)
    this.option.mergeThreshold = clamp(this.option.mergeThreshold, 5, 120)
    this.option.mergeMaxDist = clamp(this.option.mergeMaxDist, 1, 20)
    this.option.mergeMaxCosine = clamp(this.option.mergeMaxCosine, 0, 100)

    this.option.mount = this.option.mount || $controlsCenter

    if (option.fontSize) {
      this.reset()
    }

    // danmuku 选项变化时重新加载弹幕数据
    if (option.danmuku !== undefined) {
      // 先清空旧队列，避免 resize 等事件使用过期数据
      this.queue = []
      this.states = { wait: [], ready: [], emit: [], stop: [] }
      this.$refs = []
      this.$danmuku.textContent = ''
      this.load()
    }

    // 通过配置项控制弹幕的显示和隐藏
    if (this.option.visible) {
      this.show()
    }
    else {
      this.hide()
    }

    this.art.emit('artplayerPluginDanmuku:config', this.option)

    return this
  }

  // 计算DOM的left值，受到旋屏影响
  getLeft($ref) {
    const rect = $ref.getBoundingClientRect()
    return this.isRotate ? rect.top : rect.left
  }

  // 复杂运算交给 Web Worker 处理
  postMessage(message = {}) {
    return new Promise((resolve) => {
      const id = Date.now() + Math.random()
      message.id = id
      this._pendingMessages.set(id, resolve)
      this.worker.postMessage(message)
    })
  }

  // 多 Worker 并行合并弹幕
  parallelMerge(danmus, options, workerCount) {
    return new Promise((resolve) => {
      const sorted = [...danmus].sort((a, b) => (a.time || 0) - (b.time || 0))
      const minTime = sorted[0].time || 0
      const maxTime = sorted[sorted.length - 1].time || 0

      // 按时间区间分片
      const interval = (maxTime - minTime) / workerCount
      const chunks = []
      for (let i = 0; i < workerCount; i++) {
        const start = minTime + i * interval
        const end = i === workerCount - 1 ? Infinity : start + interval
        const chunk = sorted.filter((d) => {
          const t = d.time || 0
          return t >= start && t < end
        })
        chunks.push(chunk)
      }

      // 过滤空分片
      const validChunks = chunks.filter(c => c.length > 0)
      if (validChunks.length === 0) {
        resolve(danmus)
        return
      }

      // 创建 Worker 并并行初始化
      const workers = validChunks.map(() => new MergeWorker())
      let initialized = 0

      const onWorkerReady = () => {
        initialized++
        if (initialized < workers.length)
          return

        // 所有 Worker 初始化完成，并行处理
        let completed = 0
        const results = []

        const checkDone = () => {
          completed++
          if (completed < workers.length)
            return
          // 全部完成，终止 Worker 并合并结果
          workers.forEach(w => w.terminate())
          const merged = results.flat()
          merged.sort((a, b) => (a.time || 0) - (b.time || 0))
          resolve(merged)
        }

        workers.forEach((w, i) => {
          w.onmessage = (e) => {
            if (e.data.error) {
              console.error('[Danmuku] Worker merge error:', e.data.error)
              results[i] = validChunks[i] // 出错时返回原始数据
            }
            else {
              results[i] = e.data.result || []
            }
            checkDone()
          }
          w.postMessage({
            type: 'process',
            items: validChunks[i],
            options,
            id: i,
          })
        })
      }

      workers.forEach((w, i) => {
        w.onmessage = (e) => {
          if (e.data.error) {
            console.error('[Danmuku] Worker init error:', e.data.error)
            // 初始化失败，回退到单 Worker
            workers.forEach(w => w.terminate())
            this.postMessage({
              type: 'mergeDanmuku',
              danmus,
              options,
            }).then(({ result }) => resolve(result))
            return
          }
          onWorkerReady()
        }
        w.postMessage({ type: 'init', wasmUrl: options.wasmUrl, id: i })
      })
    })
  }

  // 根据状态获取弹幕
  filter(state, callback) {
    const danmus = this.states[state] || []
    for (let index = 0; index < danmus.length; index++) {
      callback(danmus[index])
    }
    return danmus
  }

  // 设置弹幕状态
  setState(danmu, state) {
    // 从原状态池中删除
    this.states[danmu.$state] = this.states[danmu.$state].filter(item => item !== danmu)

    // 设置新状态
    danmu.$state = state

    // 设置DOM节点状态
    if (danmu.$ref) {
      danmu.$ref.dataset.state = state
    }

    // 添加到新状态池中
    this.states[state].push(danmu)
  }

  // 重置弹幕到wait状态，回收弹幕DOM节点
  makeWait(danmu) {
    this.setState(danmu, 'wait')
    if (danmu.$ref) {
      danmu.$ref.style.cssText = Danmuku.cssText
      danmu.$ref.style.visibility = 'hidden'
      danmu.$ref.style.marginLeft = '0px'
      danmu.$ref.style.transform = 'translateX(0px)'
      danmu.$ref.style.transition = 'transform 0s linear 0s'
      this.$refs.push(danmu.$ref)
      danmu.$ref = null
    }
  }

  // 实时更新弹幕
  update() {
    const { setStyles } = this.utils

    this.timer = window.requestAnimationFrame(async () => {
      if (this.art.playing && !this.isHide) {
        // 更新剩余时间 + 回收过期
        this.filter('emit', (danmu) => {
          const emitTime = (Date.now() - danmu.$lastStartTime) / 1000
          danmu.$restTime -= emitTime
          danmu.$lastStartTime = Date.now()
          if (danmu.$restTime <= 0) {
            danmu.top = undefined
            this.makeWait(danmu)
          }
        })

        const readys = this.readys

        if (readys.length > 0) {
          debug('readys 数量:', readys.length, '当前时间:', this.art.currentTime)
        }

        for (let index = 0; index < readys.length; index++) {
          const danmu = readys[index]

          // 防止并发 update() 重复处理同一弹幕（会导致 DOM 节点泄漏）
          if (danmu.$state === 'emit')
            continue

          const state = await this.option.beforeVisible(danmu)

          if (state) {
            if (this.queue.length <= 5) {
              debug('即将显示:', { text: danmu.text, time: danmu.time })
            }
            const { clientWidth, clientHeight } = this.$player
            danmu.$ref = this.$ref
            danmu.$ref.textContent = danmu.text

            if (danmu._mergeCount && danmu._mergeCount > 1) {
              const mark = document.createElement('span')
              mark.className = 'art-danmuku-merge-mark'
              mark.textContent = ` \u2211 ${danmu._mergeCount}`
              danmu.$ref.appendChild(mark)
            }

            this.$danmuku.appendChild(danmu.$ref)

            danmu.$ref.style.opacity = this.option.opacity
            danmu.$ref.style.color = danmu.color
            danmu.$ref.style.border = danmu.border ? `1px solid ${danmu.color}` : null
            danmu.$ref.style.backgroundColor = danmu.border ? 'rgb(0 0 0 / 50%)' : null

            // 英雄弹幕：放大字号 + 阴影
            if (danmu._isHero) {
              const rate = Math.min(Math.log(danmu._mergeCount) / Math.log(5), 3)
              danmu.$ref.style.fontSize = `${Math.ceil(this.fontSize * rate)}px`
              danmu.$ref.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)'
            }
            else {
              danmu.$ref.style.fontSize = `${this.fontSize}px`
            }

            setStyles(danmu.$ref, danmu.style)

            danmu.$lastStartTime = Date.now()

            const distance = clientWidth + danmu.$ref.clientWidth
            danmu.$restTime = distance / this.velocity
            if (danmu.mode === 1) {
              danmu.$restTime = danmu.$restTime / 2
            }

            // 速度抖动
            const jitter = Math.random()
            if (jitter < 0.15) {
              danmu.$restTime *= 0.8
            }
            else if (jitter > 0.85) {
              danmu.$restTime *= 1.2
            }

            // === 传 gap 和 fontSize 给 Worker 计算 top ===
            const { result: top } = await this.postMessage({
              type: 'getDanmuTop',
              target: {
                mode: danmu.mode,
                height: danmu.$ref.clientHeight,
                width: danmu.$ref.clientWidth,
                isHero: !!danmu._isHero,
              },
              visibles: this.visibles,
              antiOverlap: this.option.antiOverlap,
              gap: this.option.gap,
              fontSize: this.fontSize,
              clientWidth,
              clientHeight,
              marginBottom: this.marginBottom,
              marginTop: this.marginTop,
            })

            if (danmu.$ref) {
              const finalTop = top

              if (!this.isStop && finalTop !== undefined) {
                this.setState(danmu, 'emit')
                danmu.top = finalTop
                danmu.$ref.style.top = `${finalTop}px`
                danmu.$ref.style.visibility = 'visible'
                danmu.$ref.dataset.mode = danmu.mode
                danmu.$ref.dataset.id = danmu.id || ''

                // 英雄弹幕：清除与它重叠的普通顶部弹幕
                if (danmu._isHero) {
                  const heroBottom = finalTop + danmu.$ref.clientHeight
                  this.filter('emit', (other) => {
                    if (other === danmu || other.mode !== 1 || other._isHero)
                      return
                    const otherTop = other.top ?? other.$ref.offsetTop
                    const otherBottom = otherTop + (other.$ref?.clientHeight || 0)
                    if (finalTop < otherBottom && heroBottom > otherTop) {
                      this.makeWait(other)
                    }
                  })
                }

                // 固定弹幕诊断日志
                switch (danmu.mode) {
                  case 0: {
                    danmu.$ref.style.left = '0px'
                    danmu.$ref.style.marginLeft = '0px'
                    danmu.$ref.style.transform = `translateX(${clientWidth}px)`
                    danmu.$ref.style.transition = 'none'
                    // eslint-disable-next-line no-unused-expressions
                    danmu.$ref.clientWidth
                    danmu.$ref.style.transform = `translateX(${-danmu.$ref.clientWidth}px)`
                    danmu.$ref.style.transition = `transform ${danmu.$restTime}s linear 0s`
                    break
                  }
                  case 1:
                    danmu.$ref.style.left = '50%'
                    danmu.$ref.style.marginLeft = `-${danmu.$ref.clientWidth / 2}px`
                    break
                }

                this.art.emit('artplayerPluginDanmuku:visible', danmu)
              }
              else {
                this.setState(danmu, 'ready')
                this.$refs.push(danmu.$ref)
                danmu.$ref = null
              }
            }
          }
        }
      }

      // 递归调用
      if (!this.isStop) {
        this.update()
      }
    })
    return this
  }

  // 重置正在显示的弹幕: stop/emit 状态的弹幕
  resize() {
    // 因为滚动弹幕(mode 0)绑定了left=0原点，resize时它的相对位移不会错乱，
    // 所以只需要针对顶部悬浮(mode 1)做调整
    const fixCenter = (danmu) => {
      if (danmu.mode === 1) {
        danmu.$ref.style.left = '50%'
        danmu.$ref.style.marginLeft = `-${danmu.$ref.clientWidth / 2}px`
      }
    }

    this.filter('stop', fixCenter)
    this.filter('emit', fixCenter)
  }

  // 继续弹幕
  continue() {
    this.filter('stop', (danmu) => {
      this.setState(danmu, 'emit') // 转换为emit状态
      danmu.$lastStartTime = Date.now()
      switch (danmu.mode) {
        // 继续滚动的弹幕
        case 0: {
          // 从当前位置，直接无缝继续走到自身的负宽度位置
          danmu.$ref.style.transform = `translateX(${-danmu.$ref.clientWidth}px)`
          danmu.$ref.style.transition = `transform ${danmu.$restTime}s linear 0s`
          break
        }
        default:
          break
      }
    })

    return this
  }

  // 播放倍速变化时，同步调整飞行中弹幕的速度（synchronousPlayback）
  rateChange() {
    const newRate = Number(this.art.playbackRate) || 1
    const oldRate = this._playbackRate
    this._playbackRate = newRate

    if (!this.option.synchronousPlayback || newRate === oldRate)
      return this

    // 剩余距离不变，速度随倍速缩放，剩余时长按反比换算（等价于按新倍速重新 spawn）
    const ratio = oldRate / newRate

    this.filter('emit', (danmu) => {
      danmu.$restTime *= ratio
      switch (danmu.mode) {
        // 滚动弹幕：冻结当前位置，按新速度无缝走到终点
        case 0: {
          const currentX = this.getLeft(danmu.$ref) - this.getLeft(this.$player)
          danmu.$ref.style.transition = 'transform 0s linear 0s'
          danmu.$ref.style.transform = `translateX(${currentX}px)`
          // eslint-disable-next-line no-unused-expressions
          danmu.$ref.clientWidth // 强制重排，确保新过渡从当前位置起步
          danmu.$ref.style.transition = `transform ${danmu.$restTime}s linear 0s`
          danmu.$ref.style.transform = `translateX(${-danmu.$ref.clientWidth}px)`
          break
        }
        default:
          break
      }
    })

    // 暂停中的弹幕只换算剩余时长，恢复时 continue() 会按新速度续播
    this.filter('stop', (danmu) => {
      danmu.$restTime *= ratio
    })

    return this
  }

  // 暂停弹幕
  suspend() {
    this.filter('emit', (danmu) => {
      this.setState(danmu, 'stop')
      switch (danmu.mode) {
        case 0: {
          // 获取实际距离原点(left:0)的X坐标并固定它
          const currentX = this.getLeft(danmu.$ref) - this.getLeft(this.$player)
          danmu.$ref.style.transform = `translateX(${currentX}px)`
          danmu.$ref.style.transition = 'transform 0s linear 0s'
          break
        }
        default:
          break
      }
    })

    return this
  }

  stop() {
    this.isStop = true
    this.suspend()
    window.cancelAnimationFrame(this.timer)
    this.art.emit('artplayerPluginDanmuku:stop')
    return this
  }

  start() {
    this.isStop = false
    this.continue()
    this.update()
    this.art.emit('artplayerPluginDanmuku:start')
    return this
  }

  reset() {
    const recycled = []
    for (let i = 0; i < this.queue.length; i++) {
      const danmu = this.queue[i]
      danmu.$state = 'wait'
      if (danmu.$ref) {
        danmu.$ref.style.cssText = Danmuku.cssText
        danmu.$ref.style.visibility = 'hidden'
        danmu.$ref.style.marginLeft = '0px'
        danmu.$ref.style.transform = 'translateX(0px)'
        danmu.$ref.style.transition = 'transform 0s linear 0s'
        recycled.push(danmu.$ref)
        danmu.$ref = null
      }
    }
    for (let i = 0; i < recycled.length; i++) {
      this.$refs.push(recycled[i])
    }
    this.states = { wait: this.queue.slice(), ready: [], emit: [], stop: [] }
    this.art.emit('artplayerPluginDanmuku:reset')
    return this
  }

  show() {
    this.isHide = false
    this.$danmuku.style.opacity = 1
    this.option.visible = true
    this.art.emit('artplayerPluginDanmuku:show')
    return this
  }

  hide() {
    this.isHide = true
    this.$danmuku.style.opacity = 0
    this.option.visible = false
    this.art.emit('artplayerPluginDanmuku:hide')
    return this
  }

  destroy() {
    this.stop()
    this.worker.terminate()
    this.art.off('video:playing', this.start)
    this.art.off('video:pause', this.stop)
    this.art.off('video:waiting', this.stop)
    this.art.off('video:ratechange', this.rateChange)
    this.art.off('resize', this.resize)
    this.art.off('destroy', this.destroy)
    this.art.emit('artplayerPluginDanmuku:destroy')
  }
}
