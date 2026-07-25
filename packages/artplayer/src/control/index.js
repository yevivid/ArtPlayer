import {
  addClass,
  append,
  createElement,
  def,
  errorHandle,
  getComposedPath,
  includeFromEvent,
  inverseClass,
  isMobile,
  removeClass,
  sleep,
  setStyles,
} from '../utils'
import Component from '../utils/component'
import airplay from './airplay'
import fullscreen from './fullscreen'
import fullscreenWeb from './fullscreenWeb'
import pip from './pip'
import playAndPause from './playAndPause'
import progress from './progress'
import screenshot from './screenshot'
import setting from './setting'
import time from './time'
import volume from './volume'

export default class Control extends Component {
  constructor(art) {
    super(art)

    this.isHover = false
    this.name = 'control'
    this.timer = Date.now()

    const { constructor } = art
    const { $player, $bottom } = this.art.template

    art.on('mousemove', () => {
      if (!isMobile) {
        this.show = true
      }
    })

    art.on('click', () => {
      if (isMobile) {
        this.toggle()
      }
      else {
        this.show = true
      }
    })

    art.on('document:mousemove', (event) => {
      this.isHover = includeFromEvent(event, $bottom)
    })

    art.on('video:timeupdate', () => {
      if (
        !art.setting.show
        && !this.isHover
        && !art.isInput
        && art.playing
        && this.show
        && Date.now() - this.timer >= constructor.CONTROL_HIDE_TIME
      ) {
        this.show = false
      }
    })

    art.on('control', (state) => {
      if (state) {
        removeClass($player, 'art-hide-cursor')
        addClass($player, 'art-hover')
        this.timer = Date.now()
      }
      else {
        addClass($player, 'art-hide-cursor')
        removeClass($player, 'art-hover')
      }
    })

    this.init()
  }

  init() {
    const { option } = this.art

    if (!option.isLive) {
      this.add(
        progress({
          name: 'progress',
          position: 'top',
          index: 10,
        }),
      )
    }

    this.add({
      name: 'thumbnails',
      position: 'top',
      index: 20,
    })

    this.add(
      playAndPause({
        name: 'playAndPause',
        position: 'left',
        index: 10,
      }),
    )

    this.add(
      volume({
        name: 'volume',
        position: 'left',
        index: 20,
      }),
    )

    if (!option.isLive) {
      this.add(
        time({
          name: 'time',
          position: 'left',
          index: 30,
        }),
      )
    }

    if (option.quality.length) {
      sleep().then(() => {
        this.art.quality = option.quality
      })
    }

    if (option.screenshot && !isMobile) {
      this.add(
        screenshot({
          name: 'screenshot',
          position: 'right',
          index: 20,
        }),
      )
    }

    if (option.setting) {
      this.add(
        setting({
          name: 'setting',
          position: 'right',
          index: 30,
        }),
      )
    }

    if (option.pip) {
      this.add(
        pip({
          name: 'pip',
          position: 'right',
          index: 40,
        }),
      )
    }

    if (option.airplay && window.WebKitPlaybackTargetAvailabilityEvent) {
      this.add(
        airplay({
          name: 'airplay',
          position: 'right',
          index: 50,
        }),
      )
    }

    if (option.fullscreenWeb) {
      this.add(
        fullscreenWeb({
          name: 'fullscreenWeb',
          position: 'right',
          index: 60,
        }),
      )
    }

    if (option.fullscreen) {
      this.add(
        fullscreen({
          name: 'fullscreen',
          position: 'right',
          index: 70,
        }),
      )
    }

    for (let index = 0; index < option.controls.length; index++) {
      this.add(option.controls[index])
    }

    // Add resolution to controls-center, before danmuku plugin
    this.addResolution()
  }

  addResolution() {
    const { $controlsCenter } = this.art.template

    // Wrapper - position: relative for panel positioning
    const $wrapper = createElement('div')
    addClass($wrapper, 'art-control-resolution-wrapper')

    // Button - shows "1080P"
    const $btn = createElement('div')
    addClass($btn, 'art-control-resolution-btn')
    $btn.textContent = '--'

    // Hover panel
    const $panel = createElement('div')
    addClass($panel, 'art-control-resolution-panel')

    const makeRow = (label) => {
      const $row = createElement('div')
      addClass($row, 'art-resolution-row')
      const $label = createElement('span')
      addClass($label, 'art-resolution-label')
      $label.textContent = label
      const $value = createElement('span')
      addClass($value, 'art-resolution-value')
      $value.textContent = '--'
      $row.appendChild($label)
      $row.appendChild($value)
      $panel.appendChild($row)
      return $value
    }

    const $resValue = makeRow('分辨率')
    const $fpsValue = makeRow('帧率')
    const $bitrateValue = makeRow('码率')

    $wrapper.appendChild($panel)
    $wrapper.appendChild($btn)

    // FPS state
    let lastFrameCount = 0
    let lastTime = Date.now()
    let currentFps = 0

    // Resolution tier
    const getResolutionTier = (height) => {
      if (height <= 360) return '360P'
      if (height <= 480) return '480P'
      if (height <= 540) return '540P'
      if (height <= 720) return '720P'
      if (height <= 1080) return '1080P'
      if (height <= 1440) return '2K'
      if (height <= 2160) return '4K'
      if (height <= 4320) return '8K'
      return `${height}P`
    }

    // Bitrate state - fetch file size, calculate average bitrate
    let videoBitrate = 0

    const fetchBitrate = () => {
      const videoSrc = this.art.video.currentSrc
      const duration = this.art.video.duration
      if (!videoSrc || !duration) return

      fetch(videoSrc, { method: 'HEAD' })
        .then(res => {
          const size = Number(res.headers.get('content-length'))
          if (size > 0) {
            videoBitrate = (size * 8) / duration / 1000
          }
        })
        .catch(() => {})
    }

    const update = () => {
      const width = this.art.video.videoWidth
      const height = this.art.video.videoHeight
      if (width && height) {
        // FPS
        if (this.art.video.getVideoPlaybackQuality) {
          const quality = this.art.video.getVideoPlaybackQuality()
          const currentFrameCount = quality.totalVideoFrames || 0
          const now = Date.now()
          const timeDiff = (now - lastTime) / 1000
          if (timeDiff >= 1) {
            currentFps = Math.round((currentFrameCount - lastFrameCount) / timeDiff)
            lastFrameCount = currentFrameCount
            lastTime = now
          }
        }

        $btn.textContent = getResolutionTier(height)
        $resValue.textContent = `${width}×${height}`
        $fpsValue.textContent = `${currentFps || '--'} fps`
        $bitrateValue.textContent = videoBitrate > 0 ? `${Math.round(videoBitrate)} Kbps` : '--'
      }
    }

    this.art.on('video:loadedmetadata', () => {
      fetchBitrate()
      update()
    })
    this.art.on('video:timeupdate', update)

    $controlsCenter.insertBefore($wrapper, $controlsCenter.firstChild)
  }

  add(getOption) {
    const option = typeof getOption === 'function' ? getOption(this.art) : getOption
    const { $progress, $controlsLeft, $controlsRight } = this.art.template

    switch (option.position) {
      case 'top':
        this.$parent = $progress
        break
      case 'left':
        this.$parent = $controlsLeft
        break
      case 'right':
        this.$parent = $controlsRight
        break
      default:
        errorHandle(false, `Control option.position must one of 'top', 'left', 'right'`)
        break
    }

    super.add(option)
  }

  check(target) {
    if (!target) {
      return
    }
    target.$control_value.innerHTML = target.html
    for (let index = 0; index < target.$control_option.length; index++) {
      const item = target.$control_option[index]
      item.default = item === target
      if (item.default) {
        inverseClass(item.$control_item, 'art-current')
      }
    }
  }

  selector(option, $ref, events) {
    const { proxy } = this.art.events

    addClass($ref, 'art-control-selector')
    const $value = createElement('div')
    addClass($value, 'art-selector-value')
    append($value, option.html)
    $ref.textContent = ''
    append($ref, $value)

    const $list = createElement('div')
    addClass($list, 'art-selector-list')
    append($ref, $list)

    for (let index = 0; index < option.selector.length; index++) {
      const item = option.selector[index]
      const $item = createElement('div')
      addClass($item, 'art-selector-item')
      if (item.default)
        addClass($item, 'art-current')
      $item.dataset.index = index
      $item.dataset.value = item.value
      $item.innerHTML = item.html
      append($list, $item)

      def(item, '$control_option', {
        get: () => option.selector,
      })

      def(item, '$control_item', {
        get: () => $item,
      })

      def(item, '$control_value', {
        get: () => $value,
      })
    }

    const event = proxy($list, 'click', async (event) => {
      const path = getComposedPath(event)
      const item = option.selector.find(
        item => item.$control_item === path.find($item => item.$control_item === $item),
      )
      this.check(item)
      if (option.onSelect) {
        $value.innerHTML = await option.onSelect.call(this.art, item, item.$control_item, event)
      }
    })

    events.push(event)
  }
}
