/*!
 * artplayer-plugin-auto-thumbnail.js v1.1.0
 * Github: https://github.com/zhw2590582/ArtPlayer
 * (c) 2017-2026 Harvey Zhao
 * Released under the MIT License.
 */
function log(...args) {
  console.log("[Thumbnail]", ...args);
}
function debug(...args) {
}
function buildThumbnailDir(videoUrl) {
  const lastSlash = Math.max(videoUrl.lastIndexOf("/"), videoUrl.lastIndexOf("\\"));
  if (lastSlash === -1)
    return "./thumbnails";
  return `${videoUrl.substring(0, lastSlash + 1)}thumbnails`;
}
async function checkPrebuiltThumbnail(videoUrl) {
  const dir = buildThumbnailDir(videoUrl);
  const videoName = videoUrl.split("/").pop().replace(/\.[^.]+$/, "");
  const url = `${dir}/${videoName}_thumb.jpg`;
  try {
    const resp = await fetch(url, { method: "HEAD" });
    debug("HTTP 状态码:", resp.status);
    if (resp.ok) {
      debug("✅ 找到预生成图片");
      return url;
    }
  } catch (e) {
    debug("请求失败:", e.message);
  }
  return null;
}
function loadFromPrebuiltImage(url) {
  const videoName = url.split("/").pop().replace(/\.[^.]+$/, "");
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      resolve(url);
    };
    img.onerror = () => {
      log(`[${videoName}] ❌ 预生成图片加载失败`);
      reject(new Error("Failed to load prebuilt thumbnail"));
    };
    img.src = url;
  });
}
function createThumbnail({ url, width, number }, onProgress) {
  url.split("/").pop().replace(/\.[^.]+$/, "");
  return new Promise((_resolve) => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.src = url;
    video.onloadedmetadata = () => {
      const duration = video.duration;
      const height = Math.floor(width * video.videoHeight / video.videoWidth);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = width * 10;
      canvas.height = height * Math.ceil(number / 10);
      const indices = [];
      const used = /* @__PURE__ */ new Set();
      const step = Math.floor(number / 20) || 1;
      for (let i = 0; i < number; i += step) {
        if (!used.has(i)) {
          indices.push(i);
          used.add(i);
        }
      }
      for (let i = 0; i < number; i++) {
        if (!used.has(i)) {
          indices.push(i);
          used.add(i);
        }
      }
      let currentIndex = 0;
      function seekAndDraw() {
        if (currentIndex >= indices.length) {
          video.src = "";
          video.load();
          return;
        }
        const frameIndex = indices[currentIndex];
        video.currentTime = duration * frameIndex / number;
        video.onseeked = () => {
          ctx.drawImage(video, frameIndex % 10 * width, Math.floor(frameIndex / 10) * height, width, height);
          const isFirstPass = currentIndex === 19;
          const isMidPass = (currentIndex - 19) % 40 === 0;
          const isLastPass = currentIndex === indices.length - 1;
          if (isFirstPass || isMidPass || isLastPass) {
            canvas.toBlob((blob) => {
              if (blob) {
                onProgress({ url: URL.createObjectURL(blob), height });
              }
            }, "image/jpeg", 0.6);
          }
          currentIndex++;
          window.requestAnimationFrame(seekAndDraw);
        };
      }
      seekAndDraw();
    };
  });
}
function startDynamicGeneration(url, baseWidth, number, scale, art) {
  const videoName = url.split("/").pop().replace(/\.[^.]+$/, "");
  createThumbnail({ url, width: baseWidth, number }, (result) => {
    art.thumbnails = {
      url: result.url,
      height: result.height,
      column: 10,
      number,
      width: baseWidth,
      scale
    };
    log(`⚠️ [${videoName}] 未找到预生成图片，使用动态生成`);
    art.emit("artplayerPluginAutoThumbnail:ready", { source: "dynamic" });
  });
}
function artplayerPluginAutoThumbnail(option = {}) {
  return async (art) => {
    art.on("video:loadedmetadata", async () => {
      const url = option.url || art.option.url;
      const baseWidth = option.width || 320;
      const scale = option.scale || 1;
      let number = option.number;
      if (!number) {
        const duration = art.duration;
        number = duration <= 600 ? 60 : duration <= 3600 ? 120 : 180;
      }
      setTimeout(async () => {
        const videoName = url.split("/").pop().replace(/\.[^.]+$/, "");
        const prebuiltUrl = await checkPrebuiltThumbnail(url);
        if (prebuiltUrl) {
          try {
            debug(`[${videoName}] 尝试加载预生成图片:`, prebuiltUrl);
            const result = await loadFromPrebuiltImage(prebuiltUrl);
            debug(`[${videoName}] 加载成功，设置 thumbnails`);
            art.thumbnails = {
              url: result,
              height: 180,
              column: 10,
              number: 180,
              width: 320,
              scale
            };
            log(`✅ [${videoName}] ${prebuiltUrl}`);
            art.emit("artplayerPluginAutoThumbnail:ready", { source: "prebuilt" });
          } catch {
            startDynamicGeneration(url, baseWidth, number, scale, art);
          }
        } else {
          startDynamicGeneration(url, baseWidth, number, scale, art);
        }
      }, 1e3);
    });
    return {
      name: "artplayerPluginAutoThumbnail"
    };
  };
}
export {
  artplayerPluginAutoThumbnail as default
};
