import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';

// Custom plugin to inline iframe content
function inlineIframePlugin() {
  return {
    name: 'inline-iframe',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const iframeMatches = html.match(/<iframe[^>]*?>/g);
        if (iframeMatches && iframeMatches.length > 0) {
          console.log(`📄 内联 ${iframeMatches.length} 个iframe`);
        }

        // 查找所有 iframe 标签并处理
        return html.replace(/<iframe[^>]*?>/g, (iframeTag) => {
          const srcMatch = iframeTag.match(/src=(?:"([^"]*)"|'([^']*)')/);

          // 如果没有 src 属性，则返回原始标签
          if (!srcMatch) {
            return iframeTag;
          }

          const src = srcMatch[1] || srcMatch[2];

          // 如果 src 为空或是外部链接，则返回原始标签
          if (!src || src.startsWith('http') || src.startsWith('//')) {
            return iframeTag;
          }

          try {
            // 解析并读取 iframe 内容
            const iframePath = resolve(dirname(context.filename), src);

            if (!existsSync(iframePath)) {
              return iframeTag;
            }

            let iframeContent = readFileSync(iframePath, 'utf-8');

            // 在内联iframe内容之前，先处理其中的JavaScript引用
            iframeContent = inlineIframeJavaScript(iframeContent, dirname(iframePath));

            // 为 srcdoc 属性转义 HTML 内容（标准 HTML 实体转义）
            const escapedContent = iframeContent
              .replace(/&/g, '&amp;')      // 正确地将 '&' 转义为 '&amp;'
              .replace(/"/g, '&quot;')    // 为属性值转义双引号

            // 将 src 属性替换为 srcdoc（复用之前的匹配结果）
            return iframeTag.replace(srcMatch[0], `srcdoc="${escapedContent}"`);
          } catch (error) {
            return iframeTag; // 出错时返回原始标签
          }
        });
      }
    }
  };
}

// 辅助函数：处理iframe内容中的JavaScript引用
function inlineIframeJavaScript(htmlContent, iframeDir) {
  const projectRoot = resolve(process.cwd());

  return htmlContent.replace(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g, (scriptTag, src) => {
    // 跳过外部链接
    if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) {
      return scriptTag;
    }

    try {
      // 处理带版本号的文件路径，去掉查询参数
      const cleanSrc = src.split('?')[0];

      // 解析文件路径
      let scriptPath;
      if (cleanSrc.startsWith('./') || cleanSrc.startsWith('../')) {
        scriptPath = resolve(iframeDir, cleanSrc);
      } else {
        scriptPath = resolve(projectRoot, cleanSrc);
      }

      // 检查文件是否存在
      if (!existsSync(scriptPath)) {
        return scriptTag;
      }

      // 读取 JavaScript 文件内容
      const jsContent = readFileSync(scriptPath, 'utf-8');

      // 检查是否有 defer 或 async 属性
      const isDeferMatch = scriptTag.match(/\sdefer\s/);
      const isAsyncMatch = scriptTag.match(/\sasync\s/);

      let attributes = '';
      if (isDeferMatch) attributes += ' defer';
      if (isAsyncMatch) attributes += ' async';

      return `<script${attributes}>\n${jsContent}\n</script>`;
    } catch (error) {
      return scriptTag;
    }
  });
}

// Custom plugin to inline JavaScript files
function inlineJavaScriptPlugin() {
  return {
    name: 'inline-javascript',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 统计script标签数量
        const scriptMatches = html.match(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g);
        if (scriptMatches && scriptMatches.length > 0) {
          console.log(`🔧 内联 ${scriptMatches.length} 个JavaScript文件`);
        }

        // 查找所有本地 script 标签并内联
        return html.replace(/<script[^>]*src=["']([^"']*?)["'][^>]*><\/script>/g, (scriptTag, src) => {
          // 跳过外部链接和已经有其他属性的脚本
          if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) {
            return scriptTag;
          }

          // 检查是否是 defer 或 async 脚本，保留这些属性
          const isDeferMatch = scriptTag.match(/\sdefer\s/);
          const isAsyncMatch = scriptTag.match(/\sasync\s/);
          const hasDataAttributes = scriptTag.match(/\sdata-[^=]*=/);

          // 如果是外部脚本服务（如 umami），保留原样
          if (hasDataAttributes) {
            return scriptTag;
          }

          try {
            // 处理带版本号的文件路径，去掉查询参数
            const cleanSrc = src.split('?')[0];

            // 解析文件路径
            let scriptPath;
            if (cleanSrc.startsWith('./') || cleanSrc.startsWith('../')) {
              scriptPath = resolve(dirname(context.filename), cleanSrc);
            } else {
              scriptPath = resolve(projectRoot, cleanSrc);
            }

            // 检查文件是否存在
            if (!existsSync(scriptPath)) {
              return scriptTag;
            }

            // 读取 JavaScript 文件内容
            const jsContent = readFileSync(scriptPath, 'utf-8');

            // 构建内联脚本标签，保留 defer 和 async 属性
            let attributes = '';
            if (isDeferMatch) attributes += ' defer';
            if (isAsyncMatch) attributes += ' async';

            return `<script${attributes}>\n${jsContent}\n</script>`;
          } catch (error) {
            return scriptTag;
          }
        });
      }
    }
  };
}

// Custom plugin to inline static assets like icons
function inlineStaticAssetsPlugin() {
  return {
    name: 'inline-static-assets',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 内联所有本地图标文件 - 处理 href 和 src 属性
        let result = html.replace(/(?:href|src)=["']([^"']*?\.(?:png|jpg|jpeg|gif|svg|ico))["']/g, (match, src) => {
          return inlineAsset(match, src, projectRoot, context);
        });

        // 特别处理 PWA 图标的 link 标签
        result = result.replace(/<link[^>]*(?:rel=["'](?:apple-touch-)?icon["']|rel=["']mask-icon["'])[^>]*>/g, (linkTag) => {
          const hrefMatch = linkTag.match(/href=["']([^"']*)["']/);
          if (!hrefMatch) return linkTag;

          const href = hrefMatch[1];
          const newMatch = inlineAsset(hrefMatch[0], href, projectRoot, context);
          return linkTag.replace(hrefMatch[0], newMatch);
        });

        return result;
      }
    }
  };
}

// 辅助函数：内联单个资源
function inlineAsset(match, src, projectRoot, context) {
  // 跳过外部链接
  if (src.startsWith('http') || src.startsWith('//') || src.startsWith('data:')) {
    return match;
  }

  try {
    // 解析文件路径
    let assetPath;

    // 如果src看起来像Vite处理后的文件名（包含hash），尝试在dist目录中查找
    if (src.includes('-') && src.match(/\.[a-zA-Z0-9]{8,}\./)) {
      const distPath = resolve(projectRoot, 'dist', src.replace('./', ''));
      if (existsSync(distPath)) {
        assetPath = distPath;
      }
    }

    // 如果还没找到，尝试原始路径
    if (!assetPath) {
      if (src.startsWith('./') || src.startsWith('../')) {
        assetPath = resolve(dirname(context.filename), src);
      } else {
        assetPath = resolve(projectRoot, src);
      }
    }

    // 检查文件是否存在
    if (!existsSync(assetPath)) {
      return match;
    }

    // 读取文件并转为 base64
    const fileBuffer = readFileSync(assetPath);
    const base64Content = fileBuffer.toString('base64');

    // 获取 MIME 类型
    const ext = src.split('.').pop().split('-')[0].toLowerCase(); // 处理hash后的扩展名
    let mimeType;
    switch (ext) {
      case 'png': mimeType = 'image/png'; break;
      case 'jpg':
      case 'jpeg': mimeType = 'image/jpeg'; break;
      case 'gif': mimeType = 'image/gif'; break;
      case 'svg': mimeType = 'image/svg+xml'; break;
      case 'ico': mimeType = 'image/x-icon'; break;
      case 'json': mimeType = 'application/json'; break;
      default: mimeType = 'application/octet-stream';
    }

    const dataUrl = `data:${mimeType};base64,${base64Content}`;
    return match.replace(src, dataUrl);
  } catch (error) {
    return match;
  }
}

// Custom plugin to inline JSON files
function inlineJsonPlugin() {
  return {
    name: 'inline-json',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 处理 manifest.json 等JSON文件
        return html.replace(/<link[^>]*rel=["']manifest["'][^>]*>/g, (linkTag) => {
          const hrefMatch = linkTag.match(/href=["']([^"']*)["']/);
          if (!hrefMatch) return linkTag;

          const href = hrefMatch[1];
          if (href.startsWith('http') || href.startsWith('//')) {
            return linkTag;
          }

          try {
            let jsonPath;
            if (href.startsWith('./') || href.startsWith('../')) {
              jsonPath = resolve(dirname(context.filename), href);
            } else {
              jsonPath = resolve(projectRoot, href);
            }

            if (!existsSync(jsonPath)) {
              return linkTag;
            }

            const jsonContent = readFileSync(jsonPath, 'utf-8');
            const base64Content = Buffer.from(jsonContent).toString('base64');
            const dataUrl = `data:application/json;base64,${base64Content}`;

            return linkTag.replace(hrefMatch[0], `href="${dataUrl}"`);
          } catch (error) {
            return linkTag;
          }
        });
      }
    }
  };
}

// Custom plugin to disable ServiceWorker for single file build
function disableServiceWorkerPlugin() {
  return {
    name: 'disable-service-worker',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        // 检查构建模式
        const buildMode = process.env.BUILD_MODE || 'default';

        // 只在PWA模式下保留ServiceWorker功能
        if (buildMode === 'pwa') {
          console.log(`📱 PWA模式：保留ServiceWorker功能`);
          return html;
        }

        console.log(`🚫 ${buildMode}模式：禁用ServiceWorker功能`);

        // 更精确地禁用 ServiceWorker 注册代码
        let result = html;

        // 第一步：处理简单的内联script中的serviceWorker代码
        result = result.replace(
          /<script[^>]*>[\s\S]*?if\s*\(\s*['"]serviceWorker['"] in navigator\s*\)\s*{[\s\S]*?}<\/script>/g,
          `<script>
    console.log('ServiceWorker disabled in single-file mode');
</script>`
        );

        // 第二步：处理独立的registerServiceWorker函数
        result = result.replace(
          /function\s+registerServiceWorker\s*\(\s*\)\s*{[\s\S]*?(?=^function|\n\/\*\*|\nfunction|\n\s*$|\n\s*\/\/)/gm,
          `function registerServiceWorker() {
    console.log('ServiceWorker disabled in single-file mode');
}

`
        );

        // 第三步：处理navigator.serviceWorker.addEventListener调用 - 需要处理完整的代码块
        result = result.replace(
          /navigator\.serviceWorker\.addEventListener\([^}]*\{[^}]*\}\);?/g,
          `// ServiceWorker event listener disabled in single-file mode`
        );

        // 处理更复杂的addEventListener结构
        result = result.replace(
          /navigator\.serviceWorker\.addEventListener\([^}]*\{[\s\S]*?\}\s*\);?/g,
          `// ServiceWorker event listener disabled in single-file mode`
        );

        // 第四步：处理SystemUtils.registerServiceWorker调用
        result = result.replace(
          /window\.SystemUtils\.registerServiceWorker\(\);?/g,
          `console.log('SystemUtils.registerServiceWorker disabled in single-file mode');`
        );

        // 第五步：处理残留的 ServiceWorker 注册代码
        result = result.replace(
          /ServiceWorker registration failed:/g,
          `ServiceWorker disabled in single-file mode:`
        );

        // 第六步：处理完整的ServiceWorker代码块（包括嵌套结构）
        result = result.replace(
          /if\s*\(\s*['"]serviceWorker['"] in navigator\s*\)\s*{[\s\S]*?^\}/gm,
          `console.log('ServiceWorker disabled in single-file mode');`
        );

        // 处理任何残留的ServiceWorker事件监听器代码块
        result = result.replace(
          /\/\/ 🔥 监听来自 Service Worker 的缓存清理消息[\s\S]*?(?=\/\/|function|\n\s*$)/g,
          `// ServiceWorker monitoring disabled in single-file mode\n`
        );

        return result;
      }
    }
  };
}

// Custom plugin to inline CSS files
function inlineCssPlugin() {
  return {
    name: 'inline-css',
    transformIndexHtml: {
      enforce: 'post',
      transform(html, context) {
        const projectRoot = resolve(process.cwd());

        // 统计CSS文件数量
        const cssMatches = html.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/g);
        if (cssMatches && cssMatches.length > 0) {
          console.log(`🎨 内联 ${cssMatches.length} 个CSS文件`);
        }

        // 内联CSS文件
        return html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/g, (linkTag) => {
          const hrefMatch = linkTag.match(/href=["']([^"']*)["']/);
          if (!hrefMatch) return linkTag;

          const href = hrefMatch[1];
          if (href.startsWith('http') || href.startsWith('//') || href.startsWith('data:')) {
            return linkTag;
          }

          try {
            let cssPath;
            if (href.startsWith('./') || href.startsWith('../')) {
              cssPath = resolve(dirname(context.filename), href);
            } else {
              cssPath = resolve(projectRoot, href);
            }

            if (!existsSync(cssPath)) {
              return linkTag;
            }

            const cssContent = readFileSync(cssPath, 'utf-8');
            return `<style>\n${cssContent}\n</style>`;
          } catch (error) {
            return linkTag;
          }
        });
      }
    }
  };
}

// Service Worker 复制插件
function serviceWorkerPlugin() {
  return {
    name: 'service-worker-copy',
    writeBundle() {
      const buildMode = process.env.BUILD_MODE || 'default';

      // 只在PWA模式下复制Service Worker文件
      if (buildMode === 'pwa') {
        const fs = require('fs');
        const path = require('path');

        const swPath = path.resolve(process.cwd(), 'service-worker.js');
        const distSwPath = path.resolve(process.cwd(), 'dist/service-worker.js');

        if (fs.existsSync(swPath)) {
          fs.copyFileSync(swPath, distSwPath);
        }
      }
    }
  };
}

// 最终清理插件 - 在viteSingleFile之后运行，处理剩余的本地引用
function finalCleanupPlugin() {
  return {
    name: 'final-cleanup',
    generateBundle(options, bundle) {
      // 在生成bundle后处理HTML文件
      for (const [fileName, file] of Object.entries(bundle)) {
        if (fileName.endsWith('.html') && file.type === 'asset') {
          let html = file.source;

          // 处理所有剩余的本地文件引用
          html = html.replace(/(?:href|src)=["']\.\/([^"']*?)["']/g, (match, src) => {
            // 查找对应的bundle文件
            const bundleFile = Object.values(bundle).find(f =>
              f.fileName === src || f.fileName.startsWith(src.split('.')[0])
            );

            if (bundleFile && bundleFile.type === 'asset') {
              const ext = src.split('.').pop().toLowerCase();
              let mimeType;
              switch (ext) {
                case 'ico': mimeType = 'image/x-icon'; break;
                case 'json': mimeType = 'application/json'; break;
                case 'png': mimeType = 'image/png'; break;
                case 'jpg':
                case 'jpeg': mimeType = 'image/jpeg'; break;
                case 'svg': mimeType = 'image/svg+xml'; break;
                default: mimeType = 'application/octet-stream';
              }

              const base64Content = Buffer.from(bundleFile.source).toString('base64');
              const dataUrl = `data:${mimeType};base64,${base64Content}`;

              // 删除这个bundle文件，因为已经内联了
              delete bundle[bundleFile.fileName];

              return match.replace(`"./${src}"`, `"${dataUrl}"`);
            }

            return match;
          });

          file.source = html;
        }
      }
    }
  };
}

export default defineConfig({
  plugins: [
    inlineJavaScriptPlugin(),
    inlineStaticAssetsPlugin(),
    inlineJsonPlugin(),
    inlineCssPlugin(),
    disableServiceWorkerPlugin(),
    inlineIframePlugin(),
    viteSingleFile(),
    finalCleanupPlugin(),
    serviceWorkerPlugin()
  ],
  build: {
    rollupOptions: {
      input: 'index.html',
      output: {
        dir: 'dist',
        inlineDynamicImports: true,
        // 禁用文件名哈希，保持原始文件名
        assetFileNames: '[name].[ext]',
        chunkFileNames: '[name].js',
        entryFileNames: '[name].js'
      }
    },
    // 确保复制Service Worker文件
    copyPublicDir: false, // 禁用默认public目录复制

    // Inline all assets including CSS and JS
    assetsInlineLimit: 100000000, // Very large limit to inline everything
    cssCodeSplit: false,
    minify: false // 可选：关闭压缩以便调试
  },
  optimizeDeps: {
    include: []
  }
});