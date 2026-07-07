var artplayerPluginAutoThumbnail = (function() {
  "use strict";
  function create({ url, width, number, canvas, ctx }, onProgress) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.src = url;
      video.onloadedmetadata = () => {
        const duration = video.duration;
        const height = Math.floor(width * video.videoHeight / video.videoWidth);
        const reuse = !!canvas;
        if (!reuse) {
          canvas = document.createElement("canvas");
          ctx = canvas.getContext("2d");
        }
        canvas.width = width * 10;
        canvas.height = height * Math.ceil(number / 10);
        let blobUrl = null;
        function seekAndDraw(index) {
          if (index >= number) {
            canvas.toBlob((blob) => {
              URL.revokeObjectURL(blobUrl);
              blobUrl = URL.createObjectURL(blob);
              resolve({ url: blobUrl, height, canvas, ctx });
            }, "image/jpeg");
            return;
          }
          video.currentTime = duration * index / number;
          video.onseeked = () => {
            ctx.drawImage(video, index % 10 * width, Math.floor(index / 10) * height, width, height);
            if (onProgress) onProgress(index + 1, number);
            seekAndDraw(index + 1);
          };
        }
        seekAndDraw(0);
      };
    });
  }
  function artplayerPluginAutoThumbnail2(option) {
    return async (art) => {
      art.on("video:loadedmetadata", async () => {
        const url = option.url || art.option.url;
        const baseWidth = option.width || 160;
        const scale = option.scale || 1;
        const passes = option.passes || [
          { number: 20, interval: "5min" },
          { number: 50, interval: "2min" },
          { number: 100, interval: "1min" }
        ];
        let sharedCanvas = null;
        let sharedCtx = null;
        for (let p = 0; p < passes.length; p++) {
          const { number } = passes[p];
          const width = Math.floor(baseWidth * (p === 0 ? 0.5 : p === 1 ? 0.75 : 1));
          const config = await create({
            url,
            width,
            number,
            canvas: sharedCanvas,
            ctx: sharedCtx
          }, (done, total) => {
            art.emit("artplayerPluginAutoThumbnail:progress", {
              pass: p,
              done,
              total,
              passes: passes.length
            });
          });
          sharedCanvas = config.canvas;
          sharedCtx = config.ctx;
          art.thumbnails = {
            url: config.url,
            height: config.height,
            column: 10,
            number,
            width,
            scale,
            pass: p
          };
          art.emit("artplayerPluginAutoThumbnail:ready", {
            pass: p,
            number,
            passes: passes.length
          });
        }
      });
      return {
        name: "artplayerPluginAutoThumbnail"
      };
    };
  }
  return artplayerPluginAutoThumbnail2;
})();
