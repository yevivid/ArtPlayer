# 缩略图预生成优化方案 - 技术讨论文档

## 1. 项目背景

### 1.1 项目架构

这是一个基于 Docker + Nginx 的**纯静态**视频播放器项目：

```
onlinePlayer/
├── docker/
│   ├── docker-compose.yaml    # Docker 部署配置
│   ├── nginx.conf             # Nginx 配置（静态文件服务）
│   └── Dockerfile
├── src/
│   ├── index.html             # 主页面
│   ├── modules/
│   │   ├── player.js          # 播放器初始化
│   │   └── ...
│   └── vendor/
│       ├── artplayer.js
│       ├── artplayer-plugin-auto-thumbnail.js  # 缩略图插件
│       └── artplayer-plugin-danmuku.js          # 弹幕插件
├── media/                     # 视频文件目录（只读挂载）
│   ├── Movies/                # 电影
│   ├── TV_Series/             # 电视剧
│   └── UP_Videos/             # UP主视频
└── scripts/
    └── scan.py                # 扫描媒体目录生成 data.js
```

**关键特点**：
- **纯静态部署**：只有 Nginx，没有 Node.js/Python 后端
- **媒体目录只读挂载**：Docker 容器内无法写入媒体目录
- **文件结构**：`/media/Movies/让子弹飞/正片/《让子弹飞》普通话.mp4`

### 1.2 视频规模

- 电影：约 10 部
- 电视剧：约 10 部（每部 30-40 集）
- UP主视频：多个合集
- **总计：约 420 个视频文件**

### 1.3 弹幕配置

```javascript
artplayerPluginDanmuku({
    danmuku: danmukuUrl,
    speed: 18,
    maxAmount: 60,
    fontSize: 24,
    // ... 其他配置
})
```

用户要求弹幕 **120fps 流畅播放**，不能有卡顿。

---

## 2. 核心需求

### 2.1 需求描述

1. **缩略图用于预览未播放的部分**
   - 鼠标悬停进度条时，显示**未来画面**的预览
   - 让用户可以快速定位想看的位置，不用点击试播

2. **提前截图存在服务器上**
   - 第一次播放时不能卡顿
   - 缩略图应该预先生成好，播放时直接加载

3. **不影响弹幕流畅度**
   - 生成缩略图的过程不能占用太多 CPU
   - 弹幕渲染需要独占资源

### 2.2 使用场景

```
用户播放视频 → 鼠标悬停进度条 → 显示缩略图预览 → 点击跳转
                    ↓
            需要预览"还没播放到的部分"
                    ↓
            所以必须提前截图，不能播放时截图
```

---

## 3. 原插件分析

### 3.1 artplayer-plugin-auto-thumbnail 工作原理

```javascript
// 插件核心逻辑（简化版）
video.onloadedmetadata = () => {
    const duration = video.duration;
    const number = 120; // 截图数量
    
    function seekAndDraw(index) {
        if (index >= number) return;
        
        video.currentTime = (duration * index) / number; // seek 到指定时间
        
        video.onseeked = () => {
            ctx.drawImage(video, ...); // 截图
            seekAndDraw(index + 1);    // 立即进行下一次 seek
        };
    }
    
    seekAndDraw(0); // 开始循环
}
```

### 3.2 问题分析

| 问题 | 影响 |
|------|------|
| 每次播放都重新生成 | 120次 seek + 截图，耗时 30+ 秒 |
| 没有缓存机制 | 同一视频每次播放都要重新生成 |
| 生成过程占用 CPU | 与弹幕渲染竞争资源，导致卡顿 |
| 生成过程阻塞主线程 | 影响播放器响应 |

### 3.3 原插件的 passes 配置

```javascript
const passes = [
    { number: 20, interval: '5min' },   // 第1轮：20张，每5分钟1张
    { number: 50, interval: '2min' },   // 第2轮：50张，每2分钟1张
    { number: 100, interval: '1min' },  // 第3轮：100张，每1分钟1张
];
```

最终生成 3 张 sprite sheet（大图），每张包含多个小缩略图。

---

## 4. 已尝试的方案

### 4.1 方案一：插件内部检测预生成图片

**思路**：修改插件，先检查服务器上是否有预生成的缩略图，有则直接加载，没有才动态生成。

**实现**：
```javascript
// 检查预生成缩略图是否存在
async function checkPrebuiltThumbnail(videoUrl, width, count) {
    const dir = buildThumbnailDir(videoUrl);
    const fileName = `thumb_${width}x${height}_${count}.jpg`;
    const url = `${dir}/${fileName}`;
    
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.ok ? url : null;
}

// 主逻辑
const prebuiltUrl = await checkPrebuiltThumbnail(url, baseWidth, number);
if (prebuiltUrl) {
    // 直接加载预生成图片
    loadFromPrebuiltImage(prebuiltUrl);
} else {
    // 回退到动态生成
    createThumbnail({ url, width, number });
}
```

**结果**：✅ 前端逻辑可行，但需要服务器端有预生成的图片。

### 4.2 方案二：服务器端 ffmpeg 预生成

**思路**：用 Python 脚本调用 ffmpeg，批量为所有视频生成 sprite sheet。

**脚本**（`scripts/generate_thumbnails.py`）：
```python
def generate_thumbnail_for_video(video_path):
    # 获取视频时长
    duration = get_video_duration(video_path)
    
    for config in THUMBNAIL_CONFIGS:
        width = config["width"]
        count = config["count"]
        
        # 使用 ffmpeg 的 fps + tile 滤镜
        cmd = [
            "ffmpeg",
            "-i", video_path,
            "-vf", f"fps=1/{interval},scale={width}:{height},tile={COLUMNS}x{rows}",
            "-frames:v", "1",
            output_file,
        ]
        subprocess.run(cmd)
```

**遇到的问题**：

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `ffprobe` 找不到 | 服务器未安装 ffmpeg | `sudo dnf install ffmpeg --allowerasing` |
| `montage` 找不到 | 未安装 ImageMagick | 改用 ffmpeg 的 `tile` 滤镜 |
| 生成速度极慢 | 132分钟视频要处理120帧 | 尝试并行处理，但效果有限 |

**速度测试**（让子弹飞，132分钟）：
- 60帧：约 2 分钟
- 120帧：约 4 分钟
- 420个视频全部生成：**约 28 小时**

**结果**：❌ 太慢，不现实。

### 4.3 方案三：播放时顺便截图（已废弃）

**思路**：播放视频时，在 `timeupdate` 事件中顺便截图，存入 IndexedDB。

**问题**：❌ **方向错误**
- 缩略图需要预览**未来画面**，不是已播放的部分
- 播放时截图只能获取已播放的内容
- 无法满足"鼠标悬停预览未播放部分"的需求

---

## 5. 技术约束

### 5.1 服务器环境

- **操作系统**：Fedora 44
- **部署方式**：Docker 容器
- **Web 服务器**：Nginx（纯静态文件服务）
- **后端 API**：❌ 没有
- **媒体目录权限**：只读挂载（Docker 容器内无法写入）

### 5.2 为什么不能浏览器端保存

浏览器运行在沙箱中，JavaScript **无法**直接写入服务器的文件系统。

可能的替代方案：
- **Service Worker + Cache API**：可以缓存，但用户清缓存会丢失
- **IndexedDB**：可以存储，但是浏览器本地存储，不是服务器文件
- **后端 API**：需要新增后端服务，架构改动大

### 5.3 ffmpeg 性能瓶颈

即使使用 `-ss` 快速 seek，ffmpeg 仍然需要：
1. 解码关键帧
2. 缩放图像
3. 编码输出

对于 132 分钟的视频，120 帧意味着 120 次完整的解码-缩放-编码流程。

---

## 6. 当前代码状态

### 6.1 插件代码（已修改）

**文件**：`vendor/artplayer-plugin-auto-thumbnail.js`

**修改内容**：
- 新增 `buildThumbnailDir()` - 根据视频路径推导缩略图目录
- 新增 `checkPrebuiltThumbnail()` - 检测预生成图片是否存在
- 新增 `loadFromPrebuiltImage()` - 直接加载图片
- 修改主逻辑：先检测预生成 → 存在则直接用 → 不存在才动态生成

### 6.2 服务器端脚本

**文件**：`scripts/generate_thumbnails.py`

**功能**：
- 扫描媒体目录，找到所有视频
- 为每个视频生成 3 个质量等级的 sprite sheet
- 保存到视频同目录的 `thumbnails/` 下

**用法**：
```bash
# 生成单个视频
python3 scripts/generate_thumbnails.py --video /path/to/video.mp4

# 生成所有视频
python3 scripts/generate_thumbnails.py

# 强制重新生成
python3 scripts/generate_thumbnails.py --force
```

### 6.3 生成的文件结构

```
media/Movies/让子弹飞/正片/
├── 《让子弹飞》普通话.mp4
└── thumbnails/
    ├── thumb_70x39_60.jpg      (约 40KB)
    ├── thumb_105x59_120.jpg    (约 60KB)
    └── thumb_140x79_120.jpg    (约 80KB)
```

---

## 7. 待解决的问题

### 7.1 主要问题

**如何快速为 420 个视频生成缩略图？**

当前方案（ffmpeg 逐帧处理）需要约 28 小时，不现实。

### 7.2 可能的优化方向

| 方向 | 描述 | 可行性 |
|------|------|--------|
| 降低帧数 | 只生成 60 帧，足够预览用 | ✅ 简单有效 |
| 使用硬件加速 | ffmpeg 的 `-hwaccel` 选项 | ⚠️ 需要 GPU 支持 |
| 使用更高效的工具 | 如 `vips`、`pillow` | ⚠️ 需要调研 |
| 分批处理 | 电影优先，电视剧晚上跑 | ✅ 可行 |
| 生成后增量更新 | 只为新视频生成 | ✅ 合理 |
| 调整截图策略 | 只截关键帧，不均匀分布 | ⚠️ 预览效果可能差 |

### 7.3 需要帮助的问题

1. **ffmpeg 有没有更快的批量处理方式？**
   - 比如一次提取多帧的滤镜组合
   - 或者使用管道（pipe）方式减少 I/O

2. **是否有更高效的缩略图生成工具？**
   - 比如 `libvips`、`GraphicsMagick`
   - 或者专门的视频缩略图工具

3. **如何平衡生成速度和预览质量？**
   - 帧数多少合适？
   - 图片质量多少合适？
   - 分辨率多少合适？

---

## 8. 相关文件

| 文件 | 说明 |
|------|------|
| `vendor/artplayer-plugin-auto-thumbnail.js` | 修改后的插件（支持预生成检测） |
| `scripts/generate_thumbnails.py` | 服务器端生成脚本 |
| `src/modules/player.js` | 播放器初始化（使用插件） |
| `docker/docker-compose.yaml` | Docker 部署配置 |
| `docker/nginx.conf` | Nginx 配置 |

---

## 9. 联系方式

如有问题，请联系项目维护者。

---

*文档最后更新：2025-01*
