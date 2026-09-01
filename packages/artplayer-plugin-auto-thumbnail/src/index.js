/**
 * artplayer-plugin-auto-thumbnail
 * 支持预生成缩略图的自动缩略图插件
 */

// 调试开关：设为 true 可在控制台看到详细日志
const DEBUG = false

// 始终输出的关键日志
function log(...args) {
  // eslint-disable-next-line no-console
  console.log('[Thumbnail]', ...args)
}

// 仅 DEBUG 模式输出的详细日志
function debug(...args) {
  if (DEBUG)
    // eslint-disable-next-line no-console
    console.log('[Thumbnail]', ...args)
}

// 根据视频 URL 构建缩略图目录路径
function buildThumbnailDir(videoUrl) {
  const lastSlash = Math.max(videoUrl.lastIndexOf('/'), videoUrl.lastIndexOf('\\'))
  if (lastSlash === -1)
    return './thumbnails'
  return `${videoUrl.substring(0, lastSlash + 1)}thumbnails`
}

// 检查预生成缩略图是否存在
async function checkPrebuiltThumbnail(videoUrl) {
  const dir = buildThumbnailDir(videoUrl)
  const videoName = videoUrl.split('/').pop().replace(/\.[^.]+$/, '')
  const url = `${dir}/${videoName}_thumb.jpg`
  debug('检测路径:', url)
  try {
    const resp = await fetch(url, { method: 'HEAD' })
    debug('HTTP 状态码:', resp.status)
    if (resp.ok) {
      debug('✅ 找到预生成图片')
      return url
    }
  }
  catch (e) {
    debug('请求失败:', e.message)
  }
  debug('❌ 未找到预生成图片')
  return null
}

// 从预生成的图片加载缩略图
function loadFromPrebuiltImage(url) {
  const videoName = url.split('/').pop().replace(/\.[^.]+$/, '')
  debug(`[${videoName}] 加载预生成图片:`, url)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      debug(`[${videoName}] ✅ 预生成图片加载成功`)
      resolve(url)
    }
    img.onerror = () => {
      log(`[${videoName}] ❌ 预生成图片加载失败`)
      reject(new Error('Failed to load prebuilt thumbnail'))
    }
    img.src = url
  })
}

// 动态生成缩略图（回退方案）
function createThumbnail({ url, width, number }, onProgress) {
  const videoName = url.split('/').pop().replace(/\.[^.]+$/, '')
  debug(`[${videoName}] 开始动态生成:`, `${width}x${number}`)
  return new Promise((_resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.src = url

    video.onloadedmetadata = () => {
      const duration = video.duration
      const height = Math.floor((width * video.videoHeight) / video.videoWidth)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = width * 10
      canvas.height = height * Math.ceil(number / 10)

      const indices = []
      const used = new Set()
      const step = Math.floor(number / 20) || 1

      for (let i = 0; i < number; i += step) {
        if (!used.has(i)) {
          indices.push(i)
          used.add(i)
        }
      }
      for (let i = 0; i < number; i++) {
        if (!used.has(i)) {
          indices.push(i)
          used.add(i)
        }
      }

      let currentIndex = 0

      function seekAndDraw() {
        if (currentIndex >= indices.length) {
          video.src = ''
          video.load()
          return
        }

        const frameIndex = indices[currentIndex]
        video.currentTime = (duration * frameIndex) / number

        video.onseeked = () => {
          ctx.drawImage(video, (frameIndex % 10) * width, Math.floor(frameIndex / 10) * height, width, height)

          const isFirstPass = currentIndex === 19
          const isMidPass = (currentIndex - 19) % 40 === 0
          const isLastPass = currentIndex === indices.length - 1

          if (isFirstPass || isMidPass || isLastPass) {
            canvas.toBlob((blob) => {
              if (blob) {
                onProgress({ url: URL.createObjectURL(blob), height })
              }
            }, 'image/jpeg', 0.6)
          }

          currentIndex++
          window.requestAnimationFrame(seekAndDraw)
        }
      }

      seekAndDraw()
    }
  })
}

function startDynamicGeneration(url, baseWidth, number, scale, art) {
  const videoName = url.split('/').pop().replace(/\.[^.]+$/, '')
  createThumbnail({ url, width: baseWidth, number }, (result) => {
    art.thumbnails = {
      url: result.url,
      height: result.height,
      column: 10,
      number,
      width: baseWidth,
      scale,
    }
    log(`⚠️ [${videoName}] 未找到预生成图片，使用动态生成`)
    art.emit('artplayerPluginAutoThumbnail:ready', { source: 'dynamic' })
  })
}

export default function artplayerPluginAutoThumbnail(option = {}) {
  return async (art) => {
    art.on('video:loadedmetadata', async () => {
      const url = option.url || art.option.url
      const baseWidth = option.width || 320
      const scale = option.scale || 1

      let number = option.number
      if (!number) {
        const duration = art.duration
        number = duration <= 600 ? 60 : duration <= 3600 ? 120 : 180
      }

      // 延迟启动，避免阻塞初始加载
      setTimeout(async () => {
        const videoName = url.split('/').pop().replace(/\.[^.]+$/, '')
        debug(`[${videoName}] 开始检测预生成图片...`)
        const prebuiltUrl = await checkPrebuiltThumbnail(url)
        debug(`[${videoName}] 检测结果:`, prebuiltUrl ? '找到' : '未找到')

        if (prebuiltUrl) {
          try {
            debug(`[${videoName}] 尝试加载预生成图片:`, prebuiltUrl)
            const result = await loadFromPrebuiltImage(prebuiltUrl)
            debug(`[${videoName}] 加载成功，设置 thumbnails`)
            art.thumbnails = {
              url: result,
              height: 180,
              column: 10,
              number: 180,
              width: 320,
              scale,
            }
            log(`✅ [${videoName}] ${prebuiltUrl}`)
            art.emit('artplayerPluginAutoThumbnail:ready', { source: 'prebuilt' })
          }
          catch {
            debug(`[${videoName}] ⚠️ 预生成加载失败，回退到动态生成`)
            startDynamicGeneration(url, baseWidth, number, scale, art)
          }
        }
        else {
          debug(`[${videoName}] 未找到预生成图片，开始动态生成`)
          startDynamicGeneration(url, baseWidth, number, scale, art)
        }
      }, 1000)
    })

    return {
      name: 'artplayerPluginAutoThumbnail',
    }
  }
}
