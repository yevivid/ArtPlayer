import { isMobile, queryAll } from './utils'
import Component from './utils/component'

export default class Info extends Component {
  constructor(art) {
    super(art)
    this.name = 'info'
    this.lastFrameCount = 0
    this.lastTime = Date.now()
    this.currentFps = 0
    this.lastBufferedBytes = 0
    this.lastSpeedTime = Date.now()
    this.currentSpeed = 0
    this.speedHistory = []
    this.maxHistoryLength = 60

    if (!isMobile) {
      this.init()
    }
  }

  init() {
    const {
      proxy,
      constructor,
      template: { $infoPanel, $infoClose, $video, $speedChart },
    } = this.art

    const self = this

    proxy($infoClose, 'click', () => {
      self.show = false
    })

    let timer = null
    const $infos = queryAll('[data-info]', $infoPanel) || []
    self.art.on('destroy', () => clearTimeout(timer))

    const calculateFps = () => {
      if (!$video.getVideoPlaybackQuality) return '--'
      const quality = $video.getVideoPlaybackQuality()
      const currentFrameCount = quality.totalVideoFrames || 0
      const now = Date.now()
      const timeDiff = (now - self.lastTime) / 1000

      if (timeDiff >= 1) {
        self.currentFps = Math.round((currentFrameCount - self.lastFrameCount) / timeDiff)
        self.lastFrameCount = currentFrameCount
        self.lastTime = now
      }

      return self.currentFps
    }

    const calculateSpeed = () => {
      const now = Date.now()
      const timeDiff = (now - self.lastSpeedTime) / 1000

      if (timeDiff < 0.5) return self.currentSpeed

      let totalBuffered = 0
      const buffered = $video.buffered
      if (buffered && buffered.length > 0) {
        for (let i = 0; i < buffered.length; i++) {
          totalBuffered += buffered.end(i) - buffered.start(i)
        }
      }

      const width = $video.videoWidth || 1920
      const height = $video.videoHeight || 1080
      const fps = typeof self.currentFps === 'number' ? self.currentFps : 30
      const bytesPerSecond = width * height * 1.5 * fps

      const bufferedDiff = totalBuffered - self.lastBufferedBytes
      if (bufferedDiff > 0) {
        self.currentSpeed = (bufferedDiff * bytesPerSecond / timeDiff)
      }

      self.lastBufferedBytes = totalBuffered
      self.lastSpeedTime = now

      return self.currentSpeed
    }

    const formatSpeed = (speed) => {
      if (speed > 1000000) {
        return `${(speed / 1000000).toFixed(2)} Mbps`
      }
      else if (speed > 1000) {
        return `${(speed / 1000).toFixed(2)} Kbps`
      }
      return `${speed.toFixed(0)} bps`
    }

    const drawChart = () => {
      if (!$speedChart) return

      const ctx = $speedChart.getContext('2d')
      const width = $speedChart.width
      const height = $speedChart.height

      ctx.clearRect(0, 0, width, height)

      if (self.speedHistory.length < 2) return

      const maxSpeed = Math.max(...self.speedHistory, 1)

      // Draw solid white line chart
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()

      const stepX = width / (self.maxHistoryLength - 1)
      const startIndex = self.maxHistoryLength - self.speedHistory.length

      for (let i = 0; i < self.speedHistory.length; i++) {
        const x = (startIndex + i) * stepX
        const y = height - (self.speedHistory[i] / maxSpeed) * (height - 4) - 2

        if (i === 0) {
          ctx.moveTo(x, y)
        }
        else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    }

    const loop = () => {
      for (let index = 0; index < $infos.length; index++) {
        const item = $infos[index]
        const infoType = item.dataset.info
        let textContent = '--'

        if (infoType === 'resolution') {
          const width = $video.videoWidth || '--'
          const height = $video.videoHeight || '--'
          const fps = calculateFps()
          textContent = `${width} × ${height}@${fps}`
        }
        else if (infoType === 'speed') {
          const speed = calculateSpeed()
          textContent = formatSpeed(speed)

          self.speedHistory.push(speed)
          if (self.speedHistory.length > self.maxHistoryLength) {
            self.speedHistory.shift()
          }
          drawChart()
        }
        else if (infoType === 'droppedFrames') {
          if ($video.getVideoPlaybackQuality) {
            const quality = $video.getVideoPlaybackQuality()
            textContent = String(quality.droppedVideoFrames || 0)
          }
        }

        if (item.textContent !== textContent) {
          item.textContent = textContent
        }
      }

      timer = setTimeout(loop, constructor.INFO_LOOP_TIME)
    }

    loop()
  }
}
